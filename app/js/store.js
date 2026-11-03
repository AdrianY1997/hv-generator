// Persistencia: perfil y plantillas en localStorage, binarios en IndexedDB.
import { normalizeProfile, normalizeTemplates } from './backup-validate.js';
import { prepareBackup, mergeBackup } from './backup-merge.js';
import { migrate as migrateProfile, CURRENT_VERSION } from './migrate.js';
const K_PROFILE = 'hv.profile', K_TEMPLATES = 'hv.templates', K_VERSION = 'hv.version', K_BACKUP = 'hv.lastBackup';
const DB_NAME = 'hv', STORE = 'files';
const listeners = new Set();

/** subscribe(fn) -> unsubscribe. fn({type:'profile'|'templates'|'files'|'all'}) */
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const emit = (type) => listeners.forEach((fn) => { try { fn({ type }); } catch (e) { console.error(e); } });

function readJSON(key, def) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch { return def; }
}

// ---- Errores de almacenamiento (G04): tipados, con mensaje en español y avisados a la UI aunque quien llama los ignore.
export const QUOTA_MESSAGE = 'El almacenamiento del navegador está lleno y el último cambio NO se guardó. Revisa Ajustes > Almacenamiento (borra archivos que no uses) y descarga un respaldo.';
export class StorageError extends Error {
  constructor(kind, cause) {
    super(kind === 'quota' ? 'quota-exceeded' : 'storage-failed');
    this.name = 'StorageError';
    this.kind = kind; // 'quota' | 'write'
    this.quota = kind === 'quota';
    this.userMessage = kind === 'quota' ? QUOTA_MESSAGE : 'No se pudo guardar en este navegador (almacenamiento bloqueado o modo privado). Descarga un respaldo para no perder datos.';
    this.cause = cause;
  }
}
export const isQuotaError = (e) => !!e && (e.quota === true || e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
const errListeners = new Set();
/** onStorageError(fn) -> unsubscribe. fn(StorageError) se llama en cada fallo de escritura. */
export function onStorageError(fn) { errListeners.add(fn); return () => errListeners.delete(fn); }
/** Convierte cualquier fallo de escritura en StorageError y lo notifica. */
function storageFail(e) {
  const err = e instanceof StorageError ? e : new StorageError(isQuotaError(e) ? 'quota' : 'write', e);
  errListeners.forEach((fn) => { try { fn(err); } catch (x) { console.error(x); } });
  return err;
}
function writeJSON(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { throw storageFail(e); }
}

// ---- Perfil (un solo aspirante). Forma libre; la define el schema del modelo.
export const getProfile = () => normalizeProfile(readJSON(K_PROFILE, {}));
export function setProfile(p) { writeJSON(K_PROFILE, p); emit('profile'); }
export function updateProfile(patch) { setProfile({ ...getProfile(), ...patch }); }

// ---- Plantillas
export const getTemplates = () => normalizeTemplates(readJSON(K_TEMPLATES, []));
export function setTemplates(list) { writeJSON(K_TEMPLATES, list); emit('templates'); }
export function saveTemplate(t) {
  const list = getTemplates();
  const i = list.findIndex((x) => x.id === t.id);
  if (i >= 0) list[i] = t; else list.push(t);
  setTemplates(list);
}
export const deleteTemplate = (id) => setTemplates(getTemplates().filter((t) => t.id !== id));

// ---- Archivos (IndexedDB)
let dbp = null;
function db() {
  if (dbp) return dbp;
  const p = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => {
      const d = r.result;
      d.onversionchange = () => { d.close(); if (dbp === p) dbp = null; };
      d.onclose = () => { if (dbp === p) dbp = null; };
      res(d);
    };
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('IndexedDB bloqueada'));
  });
  dbp = p;
  p.catch(() => { if (dbp === p) dbp = null; }); // un fallo no se queda en caché: el siguiente intento reabre
  return p;
}
const idbFail = (e, mode) => (mode === 'readwrite' ? storageFail(e) : e instanceof Error ? e : new Error('Transacción cancelada'));
async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    try {
      const t = d.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => res(req?.result);
      // Un error de petición aborta la transacción: t.error ya trae la causa real (p. ej. QuotaExceededError) en `abort`.
      t.onabort = () => rej(idbFail(t.error || new Error('Transacción cancelada'), mode));
    } catch (e) { rej(idbFail(e, mode)); }
  });
}
/** putFile(id, blob, meta={}) guarda {id, blob, meta{name,type,size,...}} */
export async function putFile(id, blob, meta = {}) {
  await tx('readwrite', (s) => s.put({ id, blob, meta: { name: blob.name, type: blob.type, size: blob.size, ...meta } }));
  emit('files');
}
/** updateFileMeta(id, patch): fusiona `patch` en el meta sin tocar el blob (las claves con valor null se eliminan). */
export async function updateFileMeta(id, patch) {
  const rec = await getFile(id);
  if (!rec) return null;
  const meta = { ...rec.meta, ...patch };
  for (const k of Object.keys(meta)) if (meta[k] === null) delete meta[k];
  await tx('readwrite', (s) => s.put({ id, blob: rec.blob, meta }));
  emit('files');
  return meta;
}
/** getFile(id) -> {id, blob, meta} | undefined */
export const getFile = (id) => tx('readonly', (s) => s.get(id));
export async function deleteFile(id) { await tx('readwrite', (s) => s.delete(id)); emit('files'); }
/** listFiles() -> [{id, meta}] */
export async function listFiles() {
  const all = await tx('readonly', (s) => s.getAll());
  return all.map(({ id, meta }) => ({ id, meta }));
}

// ---- Backup JSON (archivos en base64)
const toB64 = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1] || '');
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});
export async function exportBackup() {
  const files = [];
  for (const { id } of await listFiles()) {
    const f = await getFile(id);
    files.push({ id, meta: f.meta, data: await toB64(f.blob) });
  }
  markBackup();
  return { app: 'hv-minerva', version: 1, schemaVersion: CURRENT_VERSION, exportedAt: new Date().toISOString(), profile: getProfile(), templates: getTemplates(), files };
}
/**
 * exportBackupEncrypted(passphrase): igual que exportBackup() pero devuelve el sobre cifrado (backup-crypto.js: PBKDF2-SHA256 -> AES-256-GCM).
 * Lanza CryptoBackupError (con userMessage) si la contraseña no cumple el mínimo o el navegador no tiene WebCrypto.
 * El archivo en claro solo existe en memoria; la contraseña no se guarda en ninguna parte.
 */
export async function exportBackupEncrypted(passphrase) {
  const { encryptBackup } = await import('./backup-crypto.js');
  return encryptBackup(await exportBackup(), passphrase); // valida la contraseña (mínimo de longitud) antes de derivar nada
}
/**
 * importBackup(data, {mode='replace'|'merge', preferBackup=false, docIds}): valida TODO primero (backup-validate.js), migra la versión
 * (migrate.js), arma el resultado EN MEMORIA (merge: backup-merge.js) y solo entonces escribe.
 * Atómico en lo posible: localStorage (con reversión) y luego UNA transacción IndexedDB (replace: clear + puts; merge: solo los puts).
 * Si falla, se conserva lo anterior. Lanza Error con userMessage si el respaldo no es válido. Emite un único evento 'all'.
 * `docIds` (ids de documentos del modelo) permite unir `documentsShown` con la lista efectiva actual.
 * Devuelve {mode, changed, files, templates, stats?}.
 */
export async function importBackup(data, opts = {}) {
  const mode = opts.mode === 'merge' ? 'merge' : 'replace';
  // Un sobre cifrado se descifra ANTES (backup-crypto.js `decryptBackup`; ver vista-previa.js) y el resultado entra por aquí sin cambios.
  if (data && typeof data === 'object' && data.format === 'hv-minerva-enc') throw Object.assign(new Error('encrypted'), { userMessage: 'Este respaldo está cifrado con contraseña: hay que descifrarlo antes de importarlo. Tus datos actuales no se modificaron.' });
  // Al fusionar, los renombrados de la migración del respaldo no pueden reutilizar ids que ya existen en IndexedDB.
  const existing = mode === 'merge' ? await listFiles() : [];
  const v = prepareBackup(data, { takenIds: existing.map((f) => f.id) });
  if (!v.ok) throw Object.assign(new Error(v.error), { userMessage: v.error });
  const records = v.files.map((f) => ({ id: f.id, blob: new Blob([f.bytes], { type: f.type }), meta: f.meta }));
  let profile = v.profile, templates = v.templates, puts = records, clear = true, stats = null;
  if (mode === 'merge') {
    const cur = existing.map((f) => ({ id: f.id, size: f.meta?.size }));
    let currentShown = null;
    if (Array.isArray(opts.docIds)) { const { shownDocIds } = await import('./doc-sources.js'); currentShown = shownDocIds(getProfile(), opts.docIds); }
    const m = mergeBackup({ profile: getProfile(), templates: getTemplates(), files: cur }, v, { preferBackup: !!opts.preferBackup, currentShown });
    if (!m.ok) throw Object.assign(new Error(m.error), { userMessage: m.error });
    stats = m.stats;
    if (!m.changed) return { mode, changed: false, files: 0, templates: m.templates.length, stats };
    const want = new Set(m.filesToPut);
    profile = m.profile; templates = m.templates; puts = records.filter((r) => want.has(r.id)); clear = false;
  }
  const prev = { p: localStorage.getItem(K_PROFILE), t: localStorage.getItem(K_TEMPLATES), v: localStorage.getItem(K_VERSION) };
  const restore = () => {
    try { prev.p === null ? localStorage.removeItem(K_PROFILE) : localStorage.setItem(K_PROFILE, prev.p); } catch (e) { console.error(e); }
    try { prev.t === null ? localStorage.removeItem(K_TEMPLATES) : localStorage.setItem(K_TEMPLATES, prev.t); } catch (e) { console.error(e); }
    try { prev.v === null ? localStorage.removeItem(K_VERSION) : localStorage.setItem(K_VERSION, prev.v); } catch (e) { console.error(e); }
  };
  try {
    writeJSON(K_PROFILE, profile);
    writeJSON(K_TEMPLATES, templates);
    writeJSON(K_VERSION, CURRENT_VERSION);
    if (clear || puts.length) {
      const d = await db();
      await new Promise((res, rej) => {
        const t = d.transaction(STORE, 'readwrite');
        const s = t.objectStore(STORE);
        if (clear) s.clear();
        for (const r of puts) s.put(r);
        t.oncomplete = () => res();
        t.onabort = () => rej(t.error || new Error('Transacción cancelada'));
      });
    }
  } catch (e) {
    restore();
    console.error(e);
    if (isQuotaError(e)) storageFail(e);
    throw Object.assign(new Error('import-failed'), { userMessage: isQuotaError(e) ? 'No se pudo importar el respaldo: el almacenamiento está lleno. Tus datos actuales no se modificaron.' : 'No se pudo importar el respaldo. Tus datos actuales no se modificaron.' });
  }
  emit('all');
  return { mode, changed: true, files: puts.length, templates: templates.length, stats };
}

// ---- Migración de datos (G15) ----
/** ¿Dos blobs tienen exactamente los mismos bytes? (tamaño y tipo primero, luego contenido) */
async function sameBlob(a, b) {
  if (!a || !b || a.size !== b.size || a.type !== b.type) return false;
  const [x, y] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  for (let i = 0; i < u.length; i++) if (u[i] !== v[i]) return false;
  return true;
}
export const getDataVersion = () => { try { const n = Number(localStorage.getItem(K_VERSION)); return Number.isInteger(n) && n >= 0 ? n : 0; } catch { return 0; } };
/**
 * migrate(): lleva perfil y archivos locales a la versión actual (migrate.js). Idempotente; se llama al arrancar.
 * Solo escribe si hubo cambios y solo sube `hv.version` si todo salió bien (si falla, se reintenta en el próximo arranque).
 * Devuelve { changed, renames, dropped } o null si no hacía falta / no se pudo.
 */
export async function migrate() {
  const from = getDataVersion();
  if (from >= CURRENT_VERSION) return null;
  try {
    const hasProfile = localStorage.getItem(K_PROFILE) !== null;
    const files = await listFiles();
    // fileIds ya incluye todo lo que hay en IndexedDB: migrate() nunca elige como destino un id existente.
    const res = migrateProfile(readJSON(K_PROFILE, {}), { from, fileIds: files.map((f) => f.id), takenIds: files.map((f) => f.id) });
    // Renombrar archivos primero: si falla, el perfil sigue apuntando a los ids viejos (que aún existen).
    // El id viejo solo se borra cuando el destino quedó escrito (o ya contenía exactamente lo mismo).
    for (const [oldId, newId] of Object.entries(res.renames)) {
      const rec = await getFile(oldId);
      if (!rec) continue;
      const dest = await getFile(newId);
      if (!dest) await tx('readwrite', (s) => s.put({ id: newId, blob: rec.blob, meta: rec.meta }));
      else if (!(await sameBlob(dest.blob, rec.blob))) throw new Error(`migrate: el destino ${newId} ya existe con otro contenido; se conserva ${oldId}`);
      await tx('readwrite', (s) => s.delete(oldId));
    }
    if (res.changed && hasProfile) writeJSON(K_PROFILE, res.profile);
    writeJSON(K_VERSION, res.version);
    if (res.changed || Object.keys(res.renames).length) emit('all');
    return { changed: res.changed, renames: res.renames, dropped: res.dropped };
  } catch (e) {
    console.error('migrate', e);
    return null;
  }
}

// ---- Respaldo: recordatorio (G05) ----
export function markBackup() { try { localStorage.setItem(K_BACKUP, String(Date.now())); } catch { /* no crítico */ } }
/** Milisegundos desde el último respaldo descargado, o null si nunca. */
export function lastBackupAt() { try { const n = Number(localStorage.getItem(K_BACKUP)); return n > 0 ? n : null; } catch { return null; } }
/** ¿Hay algo que perder? (perfil con contenido, plantillas o archivos). */
export async function hasData() {
  const p = readJSON(K_PROFILE, {}), t = readJSON(K_TEMPLATES, []);
  if ((p && Object.keys(p).filter((k) => k !== 'documents' && k !== 'documentsShown' && k !== 'legacyConditions').length) || (Array.isArray(t) && t.length)) return true;
  try { return (await tx('readonly', (st) => st.count())) > 0; } catch { return false; }
}

// ---- Uso de almacenamiento y persistencia (G04) ----
/** storageEstimate() -> {usage, quota, persisted} (null en lo que el navegador no informe). */
export async function storageEstimate() {
  const out = { usage: null, quota: null, persisted: null };
  try {
    const e = await navigator.storage?.estimate?.();
    if (e) { out.usage = e.usage ?? null; out.quota = e.quota ?? null; }
  } catch { /* sin datos */ }
  try { out.persisted = (await navigator.storage?.persisted?.()) ?? null; } catch { /* sin datos */ }
  return out;
}
/** requestPersist() -> true | false | null (null: el navegador no lo ofrece). Algunos navegadores piden permiso; otros deciden solos. */
export async function requestPersist() {
  try { if (!navigator.storage?.persist) return null; return await navigator.storage.persist(); } catch { return false; }
}

// ---- Archivos huérfanos (G11) ----
/** deleteFiles(ids): borra varios archivos en una sola transacción y emite un único evento. Solo se llama tras confirmar. */
export async function deleteFiles(ids) {
  if (!ids.length) return 0;
  await tx('readwrite', (s) => { for (const id of ids) s.delete(id); });
  emit('files');
  return ids.length;
}

// ---- Borrar todos mis datos (G05) ----
/** wipeAll(): borra localStorage `hv.*` (también sessionStorage), el contenido de IndexedDB `hv` y la base. No toca cachés de la app (código público). */
export async function wipeAll() {
  for (const st of [localStorage, sessionStorage]) {
    try { for (const k of Object.keys(st)) if (k.startsWith('hv.')) st.removeItem(k); } catch (e) { console.error(e); }
  }
  let failed = false;
  try { await tx('readwrite', (s) => s.clear()); } catch (e) { console.error(e); failed = true; }
  try {
    const d = dbp ? await dbp.catch(() => null) : null;
    d?.close(); dbp = null;
    await new Promise((res) => {
      const r = indexedDB.deleteDatabase(DB_NAME);
      r.onsuccess = r.onerror = r.onblocked = () => res();
      setTimeout(res, 1500);
    });
  } catch (e) { console.error(e); }
  emit('all');
  return !failed;
}

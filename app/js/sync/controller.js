// Controlador de la sincronización en el navegador (G04): configuración, claves de la sesión, proveedor, bloqueo entre pestañas,
// estado observable y sincronización automática. La interfaz (sync-ui.js) solo llama a estas funciones.
//
// Secretos: la contraseña de sincronización nunca se guarda (solo vive durante la derivación). La clave derivada vive en memoria y,
// si la persona elige "Recordar en este equipo" (DESACTIVADO por omisión), en IndexedDB como CryptoKey NO extraíble. El token de GitHub se
// guarda envuelto (cifrado) con esa clave: sin la contraseña no se puede usar. OJO: con "recordar" activado la protección del token se
// limita a la CSP y al mismo origen (un XSS podría usar la clave recordada para desenvolverlo). Nada de esto se registra en la consola.
import * as sdb from './sync-db.js';
import { syncOnce } from './engine.js';
import { createLocalStore, applying } from './local-store.js';
import { SyncError, toSyncError } from './provider.js';
import { deriveSyncKeys, wrapSecret, unwrapSecret, newSalt, checkSyncPassphrase } from './sync-crypto.js';
import { syncSummaryText } from './sync-merge.js';
import { MANIFEST_NAME, parseManifest, DEFAULT_BUDGET_MB, MAX_BUDGET_MB } from './sync-format.js';
import { KDF_ITERATIONS } from '../backup-crypto.js';

const MB = 1048576;
const CHECK = 'hv-minerva-sync-check';
let keys = null;
let status = { running: false, progress: '', lastError: null, lastResult: null };
const listeners = new Set();
export function onStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export const getStatus = () => status;
function setStatus(patch) { status = { ...status, ...patch }; for (const fn of listeners) { try { fn(status); } catch (e) { console.error(e); } } }
// Marca barata en localStorage: sin ella no se abre la base `hv-sync` (quien nunca usa la sincronización no la crea).
const K_ON = 'hv.sync.on';
const isOn = () => { try { return localStorage.getItem(K_ON) === '1'; } catch { return false; } };
const markOn = (on) => { try { if (on) localStorage.setItem(K_ON, '1'); else localStorage.removeItem(K_ON); } catch { /* nada */ } };
const clampBudget = (n) => { const v = Number(n); return Number.isFinite(v) ? Math.min(MAX_BUDGET_MB, Math.max(0, Math.round(v))) : DEFAULT_BUDGET_MB; };

/** Olvida la clave de la sesión (al desconectar o borrar datos). */
export function forgetSession() { keys = null; }

/** Evita dos sincronizaciones a la vez (también entre pestañas con Web Locks). */
let localBusy = false;
async function withLock(fn) {
  if (globalThis.navigator?.locks?.request) {
    return navigator.locks.request('hv-minerva-sync', { ifAvailable: true }, async (lock) => { if (!lock) throw new SyncError('busy'); return fn(); });
  }
  if (localBusy) throw new SyncError('busy');
  localBusy = true;
  try { return await fn(); } finally { localBusy = false; }
}

async function loadKeys(cfg) {
  if (keys && keys.salt === cfg.kdf.salt && keys.iterations === cfg.kdf.iterations) return keys;
  if (cfg.remember) {
    const k = await sdb.get('keys').catch(() => null);
    if (k?.aes && k.salt === cfg.kdf.salt && k.iterations === cfg.kdf.iterations) { keys = k; return keys; }
  }
  return null;
}

/** Resumen para la interfaz (sin secretos). */
export async function getInfo() {
  if (!isOn()) return { configured: false, status };
  const cfg = await sdb.get('config').catch(() => null);
  if (!cfg) return { configured: false, status };
  const st = (await sdb.get('state').catch(() => null)) || {};
  const snap = await sdb.get('snapshot').catch(() => null);
  return {
    configured: true, status, provider: cfg.provider, auto: !!cfg.auto, remember: !!cfg.remember, budgetMB: cfg.budgetMB ?? DEFAULT_BUDGET_MB,
    login: cfg.gist?.login || '', extraScopes: cfg.gist?.extraScopes || [], folderName: cfg.folder?.name || '',
    unlocked: !!(await loadKeys(cfg)), lastSyncAt: st.lastSyncAt || null, skipped: st.skipped || [], snapshotAt: snap?.at || null,
  };
}

async function buildProvider(cfg, k, { interactive }) {
  if (cfg.provider === 'gist') {
    const { createGistProvider } = await import('./gist.js');
    let token;
    try { token = await unwrapSecret(k, cfg.gist.token); } catch { throw new SyncError('locked'); }
    return createGistProvider({ token, indexId: cfg.gist.indexId, login: cfg.gist.login });
  }
  const { createFolderProvider, ensurePermission, folderSupported } = await import('./folder.js');
  if (!folderSupported()) throw new SyncError('unsupported');
  await ensurePermission(cfg.folder.dir, { request: interactive });
  return createFolderProvider({ dir: cfg.folder.dir });
}

function summarize(r) {
  const parts = [];
  if (r.status === 'created') parts.push('Se creó la copia sincronizada cifrada.');
  else if (r.status === 'up-to-date') parts.push('Todo está al día.');
  else if (r.status === 'pulled') parts.push('Este equipo quedó igual a la copia remota.');
  else if (r.applied) parts.push(syncSummaryText(r.stats) || 'Se recibieron cambios de otro equipo.');
  if (r.pushed && r.status !== 'created') parts.push('Se subieron los cambios de este equipo.');
  if (r.incoming?.length) parts.push(`${r.incoming.length} adjunto(s) remoto(s) no se pudieron traer.`);
  return { at: Date.now(), status: r.status, applied: !!r.applied, pushed: !!r.pushed, text: parts.join(' '), skipped: r.skipped || [], incoming: r.incoming || [] };
}
function fail(e) {
  const err = toSyncError(e);
  if (err.code === 'unknown') console.error('sync', err.cause || e); else console.warn('sync:', err.code);
  setStatus({ running: false, progress: '', lastError: { code: err.code, message: err.userMessage, at: Date.now() } });
  return err;
}

/**
 * connect({kind:'gist'|'folder', token, dir, passphrase, remember, auto, budgetMB, confirmJoin, onProgress}) -> resultado de syncOnce
 * Verifica el acceso, busca una sincronización existente (en Gist, entre los Gists de la cuenta), deriva la clave con su sal (o una
 * nueva), hace la PRIMERA sincronización (fusionando si ya existía) y solo entonces guarda la configuración.
 */
export function connect({ kind, token, dir, passphrase, remember = false, auto = true, budgetMB = DEFAULT_BUDGET_MB, confirmJoin, onProgress = () => {} }) {
  return withLock(async () => {
    const progress = (p) => { setStatus({ progress: p }); onProgress(p); };
    setStatus({ running: true, progress: '' });
    try {
      checkSyncPassphrase(passphrase, { creating: true });
      let provider, gistInfo = null, tok = null;
      if (kind === 'gist') {
        const { createGistProvider, cleanToken } = await import('./gist.js');
        tok = cleanToken(token);
        provider = createGistProvider({ token: tok });
        progress('Verificando el token con GitHub…');
        const who = await provider.checkToken();
        progress('Buscando una sincronización existente en tu cuenta…');
        await provider.findIndex();
        gistInfo = { login: who.login, extraScopes: who.extraScopes };
      } else {
        const { createFolderProvider, ensurePermission } = await import('./folder.js');
        if (!dir) throw new SyncError('cancelled', 'Primero elige la carpeta sincronizada.');
        await ensurePermission(dir, { request: true });
        provider = createFolderProvider({ dir });
      }
      progress('Leyendo la copia remota…');
      const r = await provider.read({});
      let kdf = { salt: newSalt(), iterations: KDF_ITERATIONS };
      if (r.files?.[MANIFEST_NAME] != null) {
        const p = parseManifest(r.files[MANIFEST_NAME]);
        if (!p.ok) throw new SyncError(p.code, p.error);
        kdf = { salt: p.manifest.kdf.salt, iterations: p.manifest.kdf.iterations };
      }
      progress('Derivando la clave de cifrado (puede tardar unos segundos)…');
      const k = await deriveSyncKeys(passphrase, { ...kdf, creating: true });
      const budget = clampBudget(budgetMB);
      const res = await syncOnce({ provider, local: createLocalStore(), state: {}, getKeys: async () => k, budget: budget * MB, confirmJoin, onProgress: progress });
      if (res.status === 'cancelled') { setStatus({ running: false, progress: '' }); return res; }
      const cfg = { v: 1, provider: kind, auto: !!auto, remember: !!remember, budgetMB: budget, kdf: { salt: k.salt, iterations: k.iterations }, check: await wrapSecret(k, CHECK), connectedAt: Date.now() };
      if (kind === 'gist') cfg.gist = { indexId: provider.indexId, ...gistInfo, token: await wrapSecret(k, tok) };
      else cfg.folder = { dir, name: dir.name || '' };
      await sdb.set('config', cfg);
      await sdb.set('state', res.state);
      markOn(true);
      keys = k;
      if (remember) await sdb.set('keys', k); else await sdb.del('keys');
      setStatus({ running: false, progress: '', lastError: null, lastResult: summarize(res) });
      return res;
    } catch (e) { throw fail(e); }
  });
}

/** Desbloquea en esta sesión con la contraseña (cuando no se recordó la clave). */
export async function unlock(passphrase) {
  const cfg = await sdb.get('config');
  if (!cfg) throw new SyncError('off', 'La sincronización no está configurada.');
  const k = await deriveSyncKeys(passphrase, { salt: cfg.kdf.salt, iterations: cfg.kdf.iterations });
  let ok = false;
  try { ok = (await unwrapSecret(k, cfg.check)) === CHECK; } catch { ok = false; }
  if (!ok) throw new SyncError('auth', 'Contraseña de sincronización incorrecta.');
  keys = k;
  if (cfg.remember) await sdb.set('keys', k);
  setStatus({ lastError: null });
  return true;
}

/**
 * syncNow({mode:'merge'|'push'|'pull', interactive}) -> resultado. `interactive` = hubo un clic (se puede pedir permiso de carpeta).
 * 'push' = reemplazar la copia remota con este equipo; 'pull' = dejar este equipo igual a la copia remota (ambos con confirmación en la UI).
 */
export function syncNow({ mode = 'merge', interactive = true } = {}) {
  return withLock(async () => {
    setStatus({ running: true, progress: '' });
    try {
      const cfg = await sdb.get('config');
      if (!cfg) throw new SyncError('off', 'La sincronización no está configurada.');
      const k = await loadKeys(cfg);
      if (!k) throw new SyncError('locked');
      const provider = await buildProvider(cfg, k, { interactive });
      const st = (await sdb.get('state')) || {};
      const getKeys = async (kdf) => {
        if (kdf && (kdf.salt !== k.salt || kdf.iterations !== k.iterations)) throw new SyncError('rekeyed', 'La copia remota se volvió a crear desde otro equipo con otra clave. Desconecta este equipo y vuelve a conectarlo con la contraseña de sincronización.');
        return k;
      };
      const res = await syncOnce({ provider, local: createLocalStore(), state: st, getKeys, budget: clampBudget(cfg.budgetMB) * MB, mode, onProgress: (p) => setStatus({ progress: p }) });
      await sdb.set('state', res.state);
      if (cfg.provider === 'gist' && provider.indexId && provider.indexId !== cfg.gist.indexId) { cfg.gist.indexId = provider.indexId; await sdb.set('config', cfg); }
      if (cfg.provider === 'folder') { try { res.conflictCopies = await provider.conflictCopies(); } catch { /* sin listado */ } }
      setStatus({ running: false, progress: '', lastError: null, lastResult: { ...summarize(res), conflictCopies: res.conflictCopies || [] } });
      return res;
    } catch (e) { throw fail(e); }
  });
}

/** Cambia opciones (sin reconectar). */
export async function setOptions({ auto, budgetMB, remember } = {}) {
  const cfg = await sdb.get('config');
  if (!cfg) return;
  if (auto !== undefined) cfg.auto = !!auto;
  if (budgetMB !== undefined) cfg.budgetMB = clampBudget(budgetMB);
  if (remember !== undefined) {
    cfg.remember = !!remember;
    if (!cfg.remember) await sdb.del('keys'); else if (keys) await sdb.set('keys', keys);
  }
  await sdb.set('config', cfg);
}

/** Desconecta este equipo: borra configuración, token, claves, estado y copia previa locales. NO toca los datos ni la copia remota. */
export async function disconnect() {
  await sdb.clear();
  markOn(false);
  keys = null;
  setStatus({ running: false, progress: '', lastError: null, lastResult: null });
}

// ---- Sincronización automática: al abrir la app, al recuperar la conexión y un rato después de editar (para subir los cambios).
let autoStarted = false;
// Si se aplicaron cambios recibidos y la vista abierta no es Ajustes (que se repinta sola), se vuelve a montar la vista para que no
// muestre (ni vuelva a guardar) datos viejos: el router de main.js escucha 'hashchange'.
const remount = () => { if (!/ajustes/.test(location.hash)) dispatchEvent(new HashChangeEvent('hashchange')); };
export function startAutoSync({ store, toast, onApplied = remount } = {}) {
  if (autoStarted) return;
  autoStarted = true;
  let timer = null;
  const warned = new Set();
  const schedule = (ms) => { clearTimeout(timer); timer = setTimeout(run, ms); };
  async function run() {
    if (!isOn()) return;
    let cfg = null;
    try { cfg = await sdb.get('config'); } catch { return; }
    if (!cfg?.auto || globalThis.navigator?.onLine === false || status.running) return;
    if (!(await loadKeys(cfg))) return; // bloqueada: se ve en Ajustes
    try {
      const r = await syncNow({ interactive: false });
      if (r.applied) { toast?.(summarize(r).text || 'Sincronizado: se recibieron cambios de otro equipo.', 6000); onApplied?.(r); }
    } catch (e) {
      if (['unauthorized', 'forbidden', 'not-found', 'auth', 'rekeyed', 'format', 'unsupported'].includes(e.code) && !warned.has(e.code)) {
        warned.add(e.code);
        toast?.('Sincronización: ' + e.userMessage, 4000, 'error');
      }
    }
  }
  schedule(1500);
  addEventListener('online', () => schedule(3000));
  store?.subscribe?.(() => { if (!applying) schedule(60000); });
}

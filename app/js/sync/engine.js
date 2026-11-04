// Motor de sincronización (G04): leer remoto -> descifrar -> fusionar -> aplicar en local (con copia previa) -> subir el resultado.
// Sin DOM: recibe el proveedor (provider.js), el adaptador local (local-store.js en el navegador; uno en memoria en las pruebas) y una
// función que entrega las claves. Probado con un proveedor en memoria en tests/sync-engine.test.mjs.
//
// Adaptador local:
//   read() -> { profile, templates, clock, files:[{id, meta}] }        readBytes(id) -> Uint8Array
//   apply({ base, profile, templates, clock, puts:[{id, bytes|null, meta}], dels:[ids] })   (guarda copia previa; lanza code 'local-changed'
//        si los datos locales cambiaron desde `base`: el motor reintenta)      saveClock(clock)      hasData() -> bool
//
// Estado de sincronización (lo guarda quien llama; nada secreto):
//   { lastRev, etag, manifest, fingerprint, phantoms, hashSalt, hashCache, lastSyncAt, skipped }
//
// Contrato de provider.write({ manifest, index, blobs, expectRev }): en `blobs`, un valor texto es un trozo NUEVO (se escribe ANTES del índice) y
// `null` un trozo huérfano: el proveedor lo borra solo DESPUÉS de escribir el índice y nunca si lanza 'conflict' (si no, el índice vigente
// quedaría apuntando a adjuntos borrados).
import { canon, stampUndated } from './clock.js';
import { mergeSync } from './sync-merge.js';
import { SyncError, toSyncError } from './provider.js';
import { sealJson, sealBytes, openJson, openBytes, mac, blobId, randomId } from './sync-crypto.js';
import {
  MANIFEST_NAME, parseManifest, parseCore, buildCore, buildManifest, splitText, joinChunks, coreName, coreNames, blobNames,
  sanitizeMeta, checkBlob, MAX_CHUNKS, MAX_REMOTE_FILES, DEFAULT_BUDGET_MB,
} from './sync-format.js';
import { CURRENT_VERSION } from '../migrate.js';

const MB = 1048576;
const envLen = (size) => Math.ceil(size / 3) * 4 + 400; // largo aproximado del sobre (base64 + cabecera)
const chunksFor = (size, max) => (Number.isFinite(max) ? Math.ceil(envLen(size) / max) : 1);

/** Huella local (HMAC) de lo que importa para sincronizar: si no cambió y el remoto tampoco, no hay nada que hacer. */
async function fingerprint(keys, st) {
  const files = {};
  for (const [id, f] of Object.entries(st.files)) files[id] = { h: f.h, meta: f.meta };
  return mac(keys, canon({ profile: st.profile, templates: st.templates, clock: st.clock, files }));
}
/** Índice de los archivos locales {id: {h, meta, size}} (con caché de HMAC por id+tamaño+fecha). */
async function indexLocal(local, files, clock, keys, cache) {
  const out = {};
  for (const { id, meta } of files) {
    const m = sanitizeMeta(meta);
    if (!m) continue;
    const ck = `${id}|${m.size}|${m.name}|${m.type}|${clock['f:' + id] || 0}`;
    let h = cache[ck];
    if (!h) { const bytes = await local.readBytes(id); if (!bytes) continue; h = await blobId(keys, bytes); cache[ck] = h; }
    out[id] = { h, meta: m };
  }
  return out;
}
/** Resultado "reemplazar este equipo con el remoto" con la misma forma que mergeSync. */
function replaceWithRemote(loc, remote) {
  const put = [], del = [];
  for (const [id, r] of Object.entries(remote.files)) { const l = loc.files[id]; if (!l || l.h !== r.h || canon(l.meta) !== canon(r.meta)) put.push({ id, needBytes: !l || l.h !== r.h }); }
  for (const id of Object.keys(loc.files)) if (!remote.files[id]) del.push(id);
  return { profile: remote.profile, templates: remote.templates, clock: remote.clock, files: { ...remote.files }, apply: { put, del }, changedLocal: true, stats: { fields: 0, items: 0, itemsDeleted: 0, templates: 0, templatesDeleted: 0, files: put.length, filesDeleted: del.length, replaced: true } };
}
const prio = (id) => (id === 'photo' ? 0 : id.startsWith('doc:') ? 1 : 2);

/**
 * syncOnce(opts) -> { status, state, stats, skipped, applied, pushed }
 *   status: 'up-to-date' | 'created' | 'pushed' | 'pulled' | 'merged' | 'cancelled'
 * opts: { provider, local, state, getKeys(kdf|null) -> keys, budget (bytes), mode: 'merge'|'push'|'pull',
 *         confirmJoin?({remoteUpdatedAt}) -> 'remote'|'local'|null, now?, onProgress?(texto), retries? }
 * Nunca sobrescribe a ciegas: en modo 'merge' siempre lee y fusiona antes de subir; si otro equipo escribió entre la lectura y la escritura
 * (conflicto) vuelve a empezar (hasta `retries` veces).
 */
export async function syncOnce(opts) {
  const retries = opts.retries ?? 2;
  for (let i = 0; ; i++) {
    try { return await attempt(opts); }
    catch (e) {
      const err = toSyncError(e);
      if ((err.code === 'conflict' || err.code === 'local-changed') && i < retries) { opts = { ...opts, state: { ...opts.state, etag: null } }; continue; }
      throw err;
    }
  }
}

async function attempt({ provider, local, state: st0 = {}, getKeys, budget = DEFAULT_BUDGET_MB * MB, mode = 'merge', confirmJoin, now = Date.now, onProgress = () => {} }) {
  const state = { ...st0 };
  onProgress('Leyendo la copia remota…');
  let res = await provider.read({ etag: mode === 'merge' ? state.etag : null });
  let manifest = null, indexFiles = null;
  if (res.notModified) {
    const p = state.manifest ? parseManifest(state.manifest) : null;
    if (p?.ok) manifest = p.manifest; else res = await provider.read({});
  }
  if (!res.notModified) {
    indexFiles = res.files || {};
    if (indexFiles[MANIFEST_NAME] != null) {
      const p = parseManifest(indexFiles[MANIFEST_NAME]);
      if (!p.ok) throw new SyncError(p.code, p.error);
      manifest = p.manifest;
    }
  }
  const keys = await getKeys(manifest ? manifest.kdf : null);
  if (manifest && (keys.salt !== manifest.kdf.salt || keys.iterations !== manifest.kdf.iterations)) throw new SyncError('locked');

  const loc = await local.read();
  if (state.hashSalt !== keys.salt) { state.hashCache = {}; state.phantoms = {}; }
  const cache = { ...(state.hashCache || {}) };
  const localIdx = await indexLocal(local, loc.files, loc.clock, keys, cache);
  // Fantasmas: entradas del índice cuyo contenido ganador NO está en este equipo (adjunto omitido por el presupuesto de otro equipo, o
  // que no se pudo bajar). Se conservan tal cual para no borrarlas ni pisarlas con una versión vieja local, salvo que aquí se haya
  // editado o borrado ese archivo DESPUÉS (reloj local más nuevo que el del fantasma).
  const phantoms = {};
  for (const [id, f] of Object.entries(state.phantoms || {})) {
    const t = Math.max(loc.clock['f:' + id] || 0, loc.clock['xf:' + id] || 0);
    if (t <= (f.at || 0)) phantoms[id] = { h: f.h, meta: f.meta };
  }
  if (mode === 'pull' && !manifest) throw new SyncError('not-found', 'No hay una copia remota que traer.');
  let mine = { profile: loc.profile, templates: loc.templates, clock: loc.clock, files: { ...localIdx, ...phantoms } };
  const fp = await fingerprint(keys, mine);
  if (mode === 'merge' && manifest && manifest.rev === state.lastRev && fp === state.fingerprint) {
    return { status: 'up-to-date', state: { ...state, etag: res.etag ?? state.etag, hashCache: cache, hashSalt: keys.salt, lastSyncAt: now() }, stats: null, skipped: state.skipped || [], applied: false, pushed: false };
  }

  let merged = mine, stats = null, applied = false;
  const have = {}; // id -> h de los bytes que hay en este equipo tras aplicar
  for (const [id, f] of Object.entries(localIdx)) have[id] = f.h;
  const bytesCache = new Map();
  const incoming = [];
  if (manifest && (mode === 'pull' || (mode === 'merge' && manifest.rev !== state.lastRev))) {
    onProgress('Descifrando la copia remota…');
    if (!indexFiles) indexFiles = (await provider.read({})).files || {};
    const core = parseCore(await openJson(keys, joinChunks(indexFiles, coreNames(manifest.core))), { now: now() });
    if (!core.ok) throw new SyncError(core.code, core.error);
    if (mode === 'merge' && !state.lastRev && confirmJoin && await local.hasData()) {
      const choice = await confirmJoin({ remoteUpdatedAt: manifest.updatedAt });
      if (!choice) return { status: 'cancelled', state: st0, stats: null, skipped: [], applied: false, pushed: false };
      if (choice === 'local') mine = { ...mine, clock: stampUndated(mine, mine.clock, now()) };
    }
    const r = mode === 'pull' ? replaceWithRemote(mine, core.core) : mergeSync(mine, core.core, { now: now() });
    // Bytes que hay que bajar (ganó el remoto con otro contenido): se verifican el HMAC (integridad) y el tipo real antes de aplicar.
    const need = r.apply.put.filter((p) => p.needBytes && r.files[p.id].b && manifest.blobs[r.files[p.id].h]);
    if (need.length) onProgress(`Descargando ${need.length} adjunto(s)…`);
    const names = need.flatMap((p) => blobNames(r.files[p.id].h, manifest.blobs[r.files[p.id].h]));
    const texts = names.length ? await provider.readBlobs(manifest, names) : {};
    for (const p of need) {
      const e = r.files[p.id];
      try {
        const bytes = await openBytes(keys, joinChunks(texts, blobNames(e.h, manifest.blobs[e.h])));
        if ((await blobId(keys, bytes)) !== e.h) throw new SyncError('format', `El adjunto «${e.meta.name}» llegó alterado y se omitió.`);
        const bad = checkBlob(e.meta, bytes);
        if (bad) throw new SyncError('format', bad);
        bytesCache.set(p.id, bytes);
      } catch (x) { incoming.push({ id: p.id, name: e.meta.name, error: toSyncError(x).userMessage }); }
    }
    const puts = [];
    for (const p of r.apply.put) {
      const e = r.files[p.id];
      if (!p.needBytes) puts.push({ id: p.id, bytes: null, meta: e.meta });
      else if (bytesCache.has(p.id)) puts.push({ id: p.id, bytes: bytesCache.get(p.id), meta: e.meta });
    }
    const dels = r.apply.del.filter((id) => localIdx[id]);
    const contentChanged = puts.length || dels.length || canon(r.profile) !== canon(loc.profile) || canon(r.templates) !== canon(loc.templates);
    if (contentChanged) {
      onProgress('Aplicando cambios en este equipo…');
      await local.apply({ base: loc, profile: r.profile, templates: r.templates, clock: r.clock, puts, dels });
      applied = true;
    } else if (canon(r.clock) !== canon(loc.clock)) await local.saveClock(r.clock);
    for (const p of puts) have[p.id] = r.files[p.id].h;
    for (const id of dels) delete have[id];
    merged = { profile: r.profile, templates: r.templates, clock: r.clock, files: r.files };
    stats = r.stats;
  }

  // ---- Plan de adjuntos: los que ya están en el remoto se quedan; los nuevos suben mientras quepan en el presupuesto.
  const existing = manifest?.blobs || {};
  const files = {}, keep = new Set(), upload = [], skipped = [];
  let used = 0, remoteFiles = 1;
  const sizeOf = new Map();
  for (const [id, e] of Object.entries(merged.files)) { files[id] = { h: e.h, meta: e.meta, b: false }; sizeOf.set(e.h, e.meta.size || 0); }
  for (const e of Object.values(files)) if (existing[e.h]) { e.b = true; if (!keep.has(e.h)) { keep.add(e.h); used += sizeOf.get(e.h); remoteFiles += existing[e.h]; } }
  const cands = Object.entries(files).filter(([id, e]) => !e.b && have[id] === e.h).sort(([a, x], [b, y]) => prio(a) - prio(b) || (x.meta.size - y.meta.size) || (a < b ? -1 : 1));
  const queued = new Set();
  for (const [id, e] of cands) {
    if (queued.has(e.h)) { e.b = true; continue; }
    const n = chunksFor(e.meta.size, provider.maxChunk);
    if (used + e.meta.size <= budget && remoteFiles + n <= MAX_REMOTE_FILES) { e.b = true; used += e.meta.size; remoteFiles += n; queued.add(e.h); upload.push({ id, h: e.h }); }
    else skipped.push({ id, name: e.meta.name, size: e.meta.size });
  }
  for (const [id, e] of Object.entries(files)) if (!e.b && have[id] !== e.h && !skipped.some((s) => s.id === id)) skipped.push({ id, name: e.meta.name, size: e.meta.size, elsewhere: true });

  const coreData = { profile: merged.profile, templates: merged.templates, clock: merged.clock, files };
  const digest = await mac(keys, canon({ ...coreData, schemaVersion: CURRENT_VERSION }));
  let lastRev = manifest?.rev ?? null, etag = res.notModified ? (state.etag ?? null) : (res.etag ?? null), finalManifest = manifest, pushed = false;
  if (!manifest || digest !== manifest.digest || mode === 'push') {
    onProgress(upload.length ? `Cifrando y subiendo ${upload.length} adjunto(s)…` : 'Cifrando y subiendo…');
    const rev = randomId();
    const coreText = JSON.stringify(await sealJson(keys, buildCore({ ...coreData, schemaVersion: CURRENT_VERSION })));
    const chunks = splitText(coreText, provider.maxChunk);
    if (chunks.length > MAX_CHUNKS) throw new SyncError('size', 'El perfil y las plantillas son demasiado grandes para sincronizar.');
    const index = {};
    chunks.forEach((c, i) => { index[coreName(i)] = c; });
    for (let i = chunks.length; i < (manifest?.core || 0); i++) index[coreName(i)] = null;
    const blobs = {}, blobFiles = {};
    for (const h of keep) blobs[h] = existing[h];
    for (const { id, h } of upload) {
      const bytes = bytesCache.get(id) || await local.readBytes(id);
      const parts = splitText(JSON.stringify(await sealBytes(keys, bytes)), provider.maxChunk);
      blobs[h] = parts.length;
      parts.forEach((p, i) => { blobFiles[blobNames(h, parts.length)[i]] = p; });
    }
    for (const [h, n] of Object.entries(existing)) if (!blobs[h]) for (const name of blobNames(h, n)) blobFiles[name] = null;
    finalManifest = buildManifest({ rev, parent: manifest?.rev ?? null, kdf: { salt: keys.salt, iterations: keys.iterations }, digest, core: chunks.length, blobs, store: { ...(manifest?.store || {}) }, updatedAt: new Date(now()).toISOString() });
    const w = await provider.write({ manifest: finalManifest, index, blobs: blobFiles, expectRev: manifest?.rev ?? null });
    lastRev = rev; etag = w?.etag ?? null; pushed = true;
  }
  const status = !manifest ? 'created' : applied ? (mode === 'pull' ? 'pulled' : 'merged') : pushed ? 'pushed' : 'up-to-date';

  // Estado: fantasmas = entradas del índice cuyo contenido no está en este equipo (ver arriba), con la fecha del reloj de ese momento.
  const ph = {};
  for (const [id, e] of Object.entries(files)) if (have[id] !== e.h) ph[id] = { h: e.h, meta: e.meta, at: merged.clock['f:' + id] || 0 };
  const phNow = {};
  for (const [id, f] of Object.entries(ph)) phNow[id] = { h: f.h, meta: f.meta };
  let base = { ...mine, clock: merged.clock }, idx = localIdx;
  if (applied) { base = await local.read(); idx = await indexLocal(local, base.files, base.clock, keys, cache); }
  const after = { profile: base.profile, templates: base.templates, clock: base.clock, files: { ...idx, ...phNow } };
  return {
    status, pushed, applied, stats, skipped, incoming,
    state: { ...state, lastRev, etag, manifest: finalManifest, fingerprint: await fingerprint(keys, after), phantoms: ph, hashSalt: keys.salt, hashCache: pruneCache(cache, after.files), lastSyncAt: now(), skipped },
  };
}
const pruneCache = (cache, files) => { const ids = new Set(Object.keys(files)); const out = {}; for (const [k, v] of Object.entries(cache)) if (ids.has(k.split('|')[0])) out[k] = v; return out; };

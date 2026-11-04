// Formato remoto de la sincronización (G04): manifiesto, trozos y núcleo. PURO. Probado en tests/sync-format.test.mjs.
//
// Espacio remoto = conjunto de archivos de TEXTO con nombre:
//   hv-generator-sync.json              manifiesto (en claro: números de trozos, ids opacos, la sal y fechas; sin nombres ni contenido, pero SÍ conteos y tamaños aproximados)
//   hv-core-000.txt ...                 núcleo cifrado (perfil, plantillas, reloj, índice de archivos), un sobre partido en trozos
//   hv-blob-<id>-000.txt ...            cada adjunto, un sobre partido en trozos; <id> = HMAC del contenido (direccionado por contenido)
// Un sobre es el JSON de `hv-minerva-enc` (backup-crypto.js); se parte en trozos de <= maxChunk caracteres (Gist: 800 000, ver gist.js).
import { isPlainObject, isReservedKey, isAllowedType, sniffMime, MAX_FILE, MAX_TOTAL, MAX_FILES, validateBackup } from '../backup-validate.js';
import { fromB64, MIN_ITERATIONS, MAX_ITERATIONS } from '../backup-crypto.js';
import { CURRENT_VERSION, migrate } from '../migrate.js';
import { sanitizeClock } from './clock.js';

export const MANIFEST_NAME = 'hv-generator-sync.json';
export const SYNC_FORMAT = 'hv-minerva-sync';
export const SYNC_VERSION = 1;
export const CORE_FORMAT = 'hv-minerva-sync-core';
export const CORE_VERSION = 1;
export const GIST_CHUNK = 800000;          // caracteres por archivo de Gist (la API corta el contenido de un archivo a partir de 1 MB)
export const MAX_CHUNKS = 200;             // por sobre
export const MAX_REMOTE_FILES = 280;       // un Gist lista como máximo 300 archivos
export const DEFAULT_BUDGET_MB = 20;
export const MAX_BUDGET_MB = MAX_TOTAL / 1048576;

const pad = (i) => String(i).padStart(3, '0');
export const coreName = (i) => `hv-core-${pad(i)}.txt`;
export const blobName = (id, i) => `hv-blob-${id}-${pad(i)}.txt`;
const BLOB_ID = /^[0-9a-f]{32}$/;
const REV = /^[0-9a-f]{8,64}$/;
export const GIST_ID = /^[0-9a-f]{32}$/i; // id de un Gist (32 hex): el único valor aceptado en store.blobGist

/** Parte un texto en trozos de <= max caracteres (Infinity = uno solo). Siempre al menos un trozo. */
export function splitText(text, max = GIST_CHUNK) {
  const s = String(text);
  if (!Number.isFinite(max) || s.length <= max) return [s];
  const out = [];
  for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max));
  return out;
}
/** Une los trozos `names` de `files`; lanza si falta alguno (escritura a medias en el remoto). */
export function joinChunks(files, names) {
  const parts = [];
  for (const n of names) {
    const v = files[n];
    if (typeof v !== 'string') throw Object.assign(new Error('missing-chunk'), { code: 'incomplete', userMessage: 'La copia remota está incompleta (falta un trozo). Vuelve a sincronizar desde el equipo que la escribió.' });
    parts.push(v);
  }
  return parts.join('');
}
export const coreNames = (n) => Array.from({ length: n }, (_, i) => coreName(i));
export const blobNames = (id, n) => Array.from({ length: n }, (_, i) => blobName(id, i));

/** Manifiesto nuevo. */
export function buildManifest({ rev, parent = null, kdf, digest, core, blobs = {}, store = {}, updatedAt = new Date().toISOString() }) {
  return { app: 'hv-minerva', format: SYNC_FORMAT, v: SYNC_VERSION, rev, parent, updatedAt, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: kdf.iterations, salt: kdf.salt }, digest, core, blobs, store };
}

/** Valida un manifiesto (texto u objeto) -> {ok:true, manifest} | {ok:false, code, error}. No confía en nada: el remoto puede estar alterado. */
export function parseManifest(raw) {
  const bad = (code, error) => ({ ok: false, code, error });
  let m = raw;
  if (typeof m === 'string') { try { m = JSON.parse(m); } catch { return bad('format', 'La copia remota está dañada (manifiesto ilegible).'); } }
  if (!isPlainObject(m) || m.app !== 'hv-minerva' || m.format !== SYNC_FORMAT) return bad('format', 'El destino no contiene una sincronización de HV Minerva.');
  if (!Number.isInteger(m.v) || m.v < 1) return bad('format', 'La copia remota no indica su versión.');
  if (m.v > SYNC_VERSION) return bad('unsupported', 'La copia remota la escribió una versión más nueva de la app. Actualiza la app en este equipo (recarga la página) y vuelve a sincronizar.');
  if (typeof m.rev !== 'string' || !REV.test(m.rev)) return bad('format', 'La copia remota está dañada (revisión inválida).');
  const k = m.kdf;
  if (!isPlainObject(k) || k.name !== 'PBKDF2' || k.hash !== 'SHA-256' || !Number.isInteger(k.iterations) || k.iterations < MIN_ITERATIONS || k.iterations > MAX_ITERATIONS) return bad('params', 'La copia remota usa una derivación de clave que la app no acepta (posible degradación): no se usa.');
  const salt = fromB64(k.salt);
  if (!salt || salt.length < 16 || salt.length > 64) return bad('format', 'La copia remota está dañada (sal inválida).');
  if (!Number.isInteger(m.core) || m.core < 1 || m.core > MAX_CHUNKS) return bad('format', 'La copia remota está dañada (núcleo inválido).');
  if (typeof m.digest !== 'string' || !/^[0-9a-f]{16,64}$/.test(m.digest)) return bad('format', 'La copia remota está dañada (resumen inválido).');
  if (!isPlainObject(m.blobs)) return bad('format', 'La copia remota está dañada (lista de adjuntos inválida).');
  const blobs = {};
  let total = m.core;
  for (const [id, n] of Object.entries(m.blobs)) {
    if (!BLOB_ID.test(id) || !Number.isInteger(n) || n < 1 || n > MAX_CHUNKS) return bad('format', 'La copia remota está dañada (adjunto inválido).');
    blobs[id] = n; total += n;
  }
  if (total > 5000) return bad('format', 'La copia remota tiene demasiados trozos.');
  const store = {};
  if (isPlainObject(m.store)) for (const [kk, v] of Object.entries(m.store)) if (!isReservedKey(kk) && typeof v === 'string' && v.length <= 200 && /^[\w.-]*$/.test(v)) store[kk] = v;
  // blobGist se usa como parte de una URL (/gists/<id>): solo se acepta un id de Gist real; cualquier otro valor invalida el manifiesto.
  if (isPlainObject(m.store) && Object.hasOwn(m.store, 'blobGist') && !(typeof m.store.blobGist === 'string' && GIST_ID.test(m.store.blobGist))) return bad('format', 'La copia remota está dañada (Gist de adjuntos inválido).');
  return { ok: true, manifest: { app: 'hv-minerva', format: SYNC_FORMAT, v: m.v, rev: m.rev, parent: typeof m.parent === 'string' && REV.test(m.parent) ? m.parent : null, updatedAt: typeof m.updatedAt === 'string' ? m.updatedAt.slice(0, 40) : '', kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: k.iterations, salt: k.salt }, digest: m.digest, core: m.core, blobs, store } };
}

/** Metadatos de un archivo, saneados como en validateBackup (sin claves reservadas, nombre acotado, tipo permitido, tamaño numérico). */
export function sanitizeMeta(meta) {
  if (!isPlainObject(meta) || !isAllowedType(meta.type)) return null;
  const out = {};
  for (const [k, v] of Object.entries(meta)) if (!isReservedKey(k) && k !== 'type' && k !== 'size' && k !== 'name') out[k] = v;
  out.name = typeof meta.name === 'string' ? meta.name.slice(0, 255) : 'archivo';
  out.type = meta.type;
  out.size = Number.isInteger(meta.size) && meta.size >= 0 && meta.size <= MAX_FILE ? meta.size : 0;
  return out;
}
const FILE_ID = /^[\w:.\-]{1,200}$/;

/** Núcleo para cifrar. */
export function buildCore({ profile, templates, clock, files, schemaVersion = CURRENT_VERSION, exportedAt = new Date().toISOString() }) {
  return { app: 'hv-minerva', format: CORE_FORMAT, v: CORE_VERSION, schemaVersion, exportedAt, profile, templates, clock, files };
}

/**
 * Valida y normaliza un núcleo descifrado -> {ok:true, core:{profile, templates, clock, files}} | {ok:false, code, error}.
 * Perfil y plantillas pasan por validateBackup (las mismas reglas que un respaldo); una versión de datos más nueva se rechaza; una más
 * vieja se migra (migrate.js), renombrando también el índice de archivos y el reloj.
 */
export function parseCore(raw, { now = Date.now() } = {}) {
  const bad = (code, error) => ({ ok: false, code, error });
  if (!isPlainObject(raw) || raw.app !== 'hv-minerva' || raw.format !== CORE_FORMAT) return bad('format', 'La copia remota está dañada (núcleo con otro formato).');
  if (!Number.isInteger(raw.v) || raw.v < 1) return bad('format', 'La copia remota no indica la versión del núcleo.');
  if (raw.v > CORE_VERSION) return bad('unsupported', 'La copia remota la escribió una versión más nueva de la app. Actualiza la app en este equipo y vuelve a sincronizar.');
  const v = validateBackup({ app: 'hv-minerva', schemaVersion: raw.schemaVersion, profile: raw.profile, templates: raw.templates, files: [] });
  if (!v.ok) return bad(/más nueva/.test(v.error) ? 'unsupported' : 'format', v.error);
  if (!isPlainObject(raw.files)) return bad('format', 'La copia remota está dañada (índice de archivos).');
  let files = {};
  const ids = Object.keys(raw.files);
  if (ids.length > MAX_FILES) return bad('format', 'La copia remota tiene demasiados archivos.');
  for (const id of ids) {
    const f = raw.files[id];
    if (!FILE_ID.test(id) || isReservedKey(id) || !isPlainObject(f) || typeof f.h !== 'string' || !BLOB_ID.test(f.h)) return bad('format', 'La copia remota está dañada (archivo inválido en el índice).');
    const meta = sanitizeMeta(f.meta);
    if (!meta) return bad('format', 'La copia remota trae un archivo de un tipo no permitido.');
    files[id] = { h: f.h, meta, b: f.b === true };
  }
  let clock = sanitizeClock(raw.clock, now); // sellos limitados a now + 1 día
  let profile = v.profile;
  const from = v.schemaVersion;
  if (from < CURRENT_VERSION) {
    const mig = migrate(profile, { from, fileIds: ids });
    profile = mig.profile;
    for (const [o, n] of Object.entries(mig.renames)) {
      if (files[o] && !files[n]) { files[n] = files[o]; delete files[o]; }
      if (clock['f:' + o] && !clock['f:' + n]) { clock['f:' + n] = clock['f:' + o]; delete clock['f:' + o]; }
    }
  }
  return { ok: true, core: { profile, templates: v.templates, clock, files }, schemaVersion: from };
}

/** Valida los bytes de un adjunto descargado contra su entrada del índice (tipo real, tamaño). -> mensaje de error o null. */
export function checkBlob(meta, bytes) {
  if (!(bytes instanceof Uint8Array)) return 'Adjunto remoto ilegible.';
  if (bytes.length > MAX_FILE) return `Un adjunto remoto pesa más de ${MAX_FILE / 1048576} MB y se omitió.`;
  if (sniffMime(bytes) !== meta.type) return `El contenido de «${meta.name}» no coincide con su tipo y se omitió.`;
  return null;
}

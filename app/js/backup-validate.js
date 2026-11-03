// Validación y normalización PURAS (sin DOM ni IndexedDB) de respaldos, perfil y tipos de archivo.
// Se usa en store.js (importBackup), forms.js (subida) y vista-previa.js (lectura del JSON). Probado en tests/backup-validate.test.mjs.
import { normalizeTemplate } from './template-model.js';
import { CURRENT_VERSION } from './migrate.js';

export const MAX_FILE = 5 * 1024 * 1024;          // por archivo
export const MAX_TOTAL = 40 * 1024 * 1024;        // suma de archivos de un respaldo
export const MAX_BACKUP_JSON = 50 * 1024 * 1024;  // tamaño del .json que se lee
export const MAX_ENVELOPE_JSON = Math.ceil(MAX_BACKUP_JSON * 4 / 3) + 4096;  // un respaldo cifrado (base64) pesa ~4/3 del claro (backup-crypto.js)
export const MAX_FILES = 500;
export const MAX_TEMPLATES = 500;
/** Únicos tipos de archivo que la app guarda y abre. NUNCA text/html ni image/svg+xml (ejecutarían script con el origen de la app). */
export const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
export const ALLOWED_IMAGE_TYPES = ALLOWED_TYPES.filter((t) => t.startsWith('image/'));
export const isAllowedType = (t) => ALLOWED_TYPES.includes(t);
export const isAllowedImageType = (t) => ALLOWED_IMAGE_TYPES.includes(t);

/** Claves que nunca se aceptan como claves de datos del usuario (contaminación de prototipo / búsquedas heredadas). */
export const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
export const isReservedKey = (k) => RESERVED_KEYS.has(k);

export const isPlainObject = (v) => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
};

/** Tipo real según los primeros bytes (o null). `bytes`: Uint8Array con los primeros 1024 bytes (o el archivo entero). */
export function sniffMime(b) {
  if (!b || b.length < 4) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  // La especificación PDF admite basura antes de "%PDF-" dentro del primer KB.
  const last = Math.min(b.length, 1024) - 5;
  for (let i = 0; i <= last; i++) {
    if (b[i] === 0x25 && b[i + 1] === 0x50 && b[i + 2] === 0x44 && b[i + 3] === 0x46 && b[i + 4] === 0x2d) return 'application/pdf';
  }
  return null;
}

/** Tamaño decodificado de un base64 (sin decodificarlo) o -1 si no tiene forma de base64. */
export function b64DecodedSize(s) {
  if (typeof s !== 'string' || s.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) return -1;
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  return (s.length / 4) * 3 - pad;
}
/** base64 -> Uint8Array, o null si no es válido. */
export function decodeBase64(s) {
  if (b64DecodedSize(s) < 0) return null;
  try {
    const bin = atob(s), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  } catch { return null; }
}

const strList = (a) => a.filter((x) => typeof x === 'string');
/**
 * normalizeProfile(p, sections?) -> perfil con la forma correcta (objeto nuevo; no muta).
 * Siempre: objeto plano; documents = {docId: string[]}; documentsShown = string[].
 * Con `sections` (schema del modelo): las repetibles deben ser arrays de objetos; las simples, objetos. Lo que tenga otro tipo se descarta.
 */
export function normalizeProfile(p, sections = null) {
  if (!isPlainObject(p)) return {};
  const out = {};
  for (const [k, v] of Object.entries(p)) if (!isReservedKey(k)) out[k] = v;
  if ('documents' in out) {
    if (isPlainObject(out.documents)) {
      const d = {};
      for (const [k, v] of Object.entries(out.documents)) if (!isReservedKey(k)) d[k] = Array.isArray(v) ? strList(v) : [];
      out.documents = d;
    } else delete out.documents;
  }
  if ('legacyConditions' in out && out.legacyConditions !== true) delete out.legacyConditions; // marca de metadatos: solo `true`
  if ('documentsShown' in out) {
    if (Array.isArray(out.documentsShown)) out.documentsShown = strList(out.documentsShown); else delete out.documentsShown;
  }
  for (const s of sections || []) {
    const v = out[s.id];
    if (v === undefined) continue;
    if (s.repeatable) { if (Array.isArray(v)) out[s.id] = v.filter(isPlainObject); else delete out[s.id]; }
    else if (!isPlainObject(v)) delete out[s.id];
  }
  return out;
}

/** Normaliza la lista de plantillas guardada: descarta lo que no sea objeto con id. */
export function normalizeTemplates(list) {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeTemplate).filter((t) => t && t.id);
}

const ID_RE = /^[\w:.\-]{1,200}$/;
const fail = (error) => ({ ok: false, error });

/**
 * validateBackup(data) -> { ok:true, profile, templates, files:[{id, meta, bytes, type}], totalBytes } | { ok:false, error }
 * Valida TODO antes de que nadie escriba nada. Un solo archivo inválido rechaza el respaldo completo (no se importa nada).
 */
export function validateBackup(data) {
  if (!isPlainObject(data) || data.app !== 'hv-minerva') return fail('Archivo de respaldo no válido.');
  if (data.format === 'hv-minerva-enc') return fail('Este respaldo está cifrado con contraseña: hay que descifrarlo antes de importarlo.');
  // G12: un respaldo de un esquema más nuevo que el de la app no se puede interpretar sin perder datos; los más viejos se migran (migrate.js).
  if (Number.isInteger(data.schemaVersion) && data.schemaVersion > CURRENT_VERSION) return fail(`Este respaldo viene de una versión más nueva de la app (datos v${data.schemaVersion}; esta app entiende hasta v${CURRENT_VERSION}). Actualiza la app e inténtalo de nuevo.`);
  if (!isPlainObject(data.profile)) return fail('El respaldo no es válido: el perfil debe ser un objeto.');
  if (!Array.isArray(data.templates)) return fail('El respaldo no es válido: las plantillas deben ser una lista.');
  if (data.templates.length > MAX_TEMPLATES) return fail('El respaldo no es válido: demasiadas plantillas.');
  if (!Array.isArray(data.files)) return fail('El respaldo no es válido: los archivos deben ser una lista.');
  if (data.files.length > MAX_FILES) return fail(`El respaldo no es válido: más de ${MAX_FILES} archivos.`);
  const templates = [];
  for (const [i, raw] of data.templates.entries()) {
    const t = isPlainObject(raw) && isPlainObject(raw.include) && isPlainObject(raw.options) ? normalizeTemplate(raw) : null;
    if (!t || !t.id) return fail(`El respaldo no es válido: la plantilla ${i + 1} está mal formada.`);
    templates.push(t);
  }
  const files = [], seen = new Set();
  let totalBytes = 0;
  for (const [i, f] of data.files.entries()) {
    const n = i + 1;
    if (!isPlainObject(f) || typeof f.id !== 'string' || !ID_RE.test(f.id)) return fail(`El respaldo no es válido: el archivo ${n} no tiene un identificador válido.`);
    if (seen.has(f.id)) return fail(`El respaldo no es válido: el archivo "${f.id}" está repetido.`);
    seen.add(f.id);
    if (!isPlainObject(f.meta)) return fail(`El respaldo no es válido: el archivo ${n} no tiene metadatos.`);
    const type = f.meta.type;
    if (!isAllowedType(type)) return fail(`Respaldo rechazado: el archivo ${n} es de un tipo no permitido (${String(type).slice(0, 40)}). Solo se aceptan PDF, JPG, PNG y WebP.`);
    const size = b64DecodedSize(f.data);
    if (size < 0) return fail(`El respaldo no es válido: el contenido del archivo ${n} está dañado.`);
    if (size > MAX_FILE) return fail(`Respaldo rechazado: el archivo ${n} pesa más de ${MAX_FILE / 1048576} MB.`);
    totalBytes += size;
    if (totalBytes > MAX_TOTAL) return fail(`Respaldo rechazado: los archivos suman más de ${MAX_TOTAL / 1048576} MB.`);
    const bytes = decodeBase64(f.data);
    if (!bytes) return fail(`El respaldo no es válido: el contenido del archivo ${n} está dañado.`);
    if (sniffMime(bytes) !== type) return fail(`Respaldo rechazado: el contenido del archivo ${n} no coincide con su tipo (${type}).`);
    const meta = {};
    for (const [k, v] of Object.entries(f.meta)) if (!isReservedKey(k) && k !== 'type' && k !== 'size' && k !== 'name') meta[k] = v;
    meta.name = typeof f.meta.name === 'string' ? f.meta.name.slice(0, 255) : 'archivo';
    meta.type = type;
    meta.size = bytes.length;
    files.push({ id: f.id, meta, bytes, type });
  }
  return { ok: true, profile: normalizeProfile(data.profile), templates, files, totalBytes, schemaVersion: Number.isInteger(data.schemaVersion) && data.schemaVersion >= 0 ? data.schemaVersion : 0 };
}

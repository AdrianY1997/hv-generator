// Migración PURA del perfil (sin DOM ni IndexedDB). La aplica store.js al cargar y al importar un respaldo.
// Versión 0 = sin versión (datos de la app antes de G15). CURRENT = forma actual.
// Idempotente: aplicarla a un perfil ya migrado no cambia nada (changed=false).

export const CURRENT_VERSION = 2;

/** Clave de metadatos del perfil (junto a `documents` y `documentsShown`): `true` = el perfil es anterior a las condiciones de visibilidad (ver conditions.js). */
export const LEGACY_KEY = 'legacyConditions';
const META_KEYS = new Set(['documents', 'documentsShown', LEGACY_KEY]);
const nonEmpty = (v) => {
  if (v == null || v === false || v === '') return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.some(nonEmpty);
  if (isObjLike(v)) return Object.values(v).some(nonEmpty);
  return true;
};
function isObjLike(v) { return v !== null && typeof v === 'object'; }
/** ¿El perfil tiene datos del usuario (fuera de los metadatos documents / documentsShown / legacyConditions)? */
export function profileHasContent(p) {
  return isObjLike(p) && !Array.isArray(p) && Object.entries(p).some(([k, v]) => !META_KEYS.has(k) && nonEmpty(v));
}

const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const defaultId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2, 12));

/** Id de archivo de documento en forma actual: `doc:<docId>` (primera página) o `doc:<docId>:<n>` con n>=2. */
const DOC_RE = /^doc:([^:]+)(?::(\d+))?$/;

/**
 * Migración 0 -> 1.
 *  - documents: ids legacy (`doc:rut:1`, `doc:rut:0`) pasan a la forma actual (`doc:rut`); si el destino ya existe se toma el siguiente `:n` libre.
 *    Se quitan duplicados y valores que no son texto. Si se conoce `fileIds` se retiran los ids "fantasma" (sin archivo).
 *  - claves ausentes: `documents` pasa a {}; cada registro de una sección repetible (arreglo de objetos) sin `id` recibe uno.
 * Devuelve {profile, renames:{viejo:nuevo}, dropped:[ids]} (profile es un objeto nuevo).
 * `takenIds` (opcional): ids ya existentes en el destino (p. ej. IndexedDB al fusionar un respaldo) que ningún renombrado puede reutilizar.
 */
function toV1(profile, { fileIds = null, genId = defaultId, takenIds = null } = {}) {
  const out = { ...profile };
  const renames = {}, dropped = [];
  if (!isObj(out.documents)) out.documents = {};
  const docs = {};
  const fileSet = fileIds ? new Set(fileIds) : null;
  // `taken`: ids que un renombrado no puede pisar = los del perfil + los ya presentes en IndexedDB / el respaldo (fileIds, takenIds).
  const taken = new Set([...(fileIds || []), ...(takenIds || [])].filter((x) => typeof x === 'string'));
  for (const lst of Object.values(out.documents)) if (Array.isArray(lst)) for (const id of lst) if (typeof id === 'string') taken.add(id);
  for (const [docId, lst] of Object.entries(out.documents)) {
    if (RESERVED.has(docId)) continue; // claves que contaminarían el prototipo: se descartan
    const next = [], seen = new Set();
    for (const id of Array.isArray(lst) ? lst : []) {
      if (typeof id !== 'string') continue;
      let cur = id;
      const m = DOC_RE.exec(id);
      if (m && m[1] === docId && (m[2] === '1' || m[2] === '0')) {
        // Legacy: el destino es `doc:<docId>`; si ya está en uso (por otra página) se busca el siguiente :n libre.
        cur = `doc:${docId}`;
        if (taken.has(cur) || seen.has(cur)) { let n = 2; while (taken.has(`doc:${docId}:${n}`) || seen.has(`doc:${docId}:${n}`)) n++; cur = `doc:${docId}:${n}`; }
        taken.add(cur);
        renames[id] = cur;
      }
      if (seen.has(cur)) continue;
      if (fileSet && !fileSet.has(id) && !fileSet.has(cur)) { dropped.push(id); continue; }
      seen.add(cur);
      next.push(cur);
    }
    docs[docId] = next;
  }
  out.documents = docs;
  for (const [k, v] of Object.entries(out)) {
    if (k === 'documents' || !Array.isArray(v)) continue;
    if (v.some((it) => isObj(it) && !it.id)) out[k] = v.map((it) => (isObj(it) && !it.id ? { ...it, id: genId() } : it));
  }
  return { profile: out, renames, dropped };
}

/**
 * Migración 1 -> 2 (condiciones de visibilidad): un perfil que ya tenía datos antes de las condiciones recibe la marca `legacyConditions`,
 * que conserva visibles los campos con dato cuyo controlador sigue sin responder. Un perfil vacío / nuevo NUNCA la recibe.
 */
function toV2(profile) {
  if (profile[LEGACY_KEY] === true || !profileHasContent(profile)) return { profile: { ...profile }, renames: {}, dropped: [] };
  return { profile: { ...profile, [LEGACY_KEY]: true }, renames: {}, dropped: [] };
}

const STEPS = [{ to: 1, run: toV1 }, { to: 2, run: toV2 }];

/**
 * migrate(profile, {from=0, fileIds=null, genId}) -> { profile, version, changed, renames, dropped }
 * `from`: versión de los datos (0 si se desconoce). Si es mayor que CURRENT_VERSION (datos de una versión futura) no se toca nada.
 * `renames`: {idViejo: idNuevo} de archivos; el llamador debe renombrar los registros de IndexedDB.
 */
export function migrate(profile, opts = {}) {
  const from = Number.isInteger(opts.from) && opts.from >= 0 ? opts.from : 0;
  const base = isObj(profile) ? profile : {};
  if (from > CURRENT_VERSION) return { profile: base, version: from, changed: false, renames: {}, dropped: [] };
  let cur = base, renames = {}, dropped = [];
  for (const step of STEPS) {
    if (step.to <= from) continue;
    const r = step.run(cur, opts);
    cur = r.profile;
    Object.assign(renames, r.renames);
    dropped = dropped.concat(r.dropped);
  }
  const changed = !isObj(profile) || JSON.stringify(cur) !== JSON.stringify(profile);
  return { profile: cur, version: CURRENT_VERSION, changed, renames, dropped };
}

// Fusión PURA de un respaldo con los datos actuales (G12). Sin DOM ni IndexedDB: store.js solo escribe el resultado.
// Se usa en store.js (importBackup, modo 'merge') y en el diálogo de importación (vista previa del resultado). Probado en tests/backup-merge.test.mjs.
//
// Reglas (todas en memoria; nada se muta):
//  - perfil, sección simple (objeto): el valor del respaldo solo llena los campos VACÍOS; con `preferBackup` también reemplaza los distintos.
//  - perfil, sección repetible (arreglo de objetos con `id`): se agregan los registros cuyo id no existe; si el id existe y el registro es
//    distinto, gana el de `updatedAt` más reciente (si alguno no la tiene, se conserva el actual). Con `preferBackup` gana siempre el respaldo.
//  - `documents` (docId -> ids de archivo) y `documentsShown`: unión.
//  - plantillas: se agregan las de id nuevo; con el mismo id y contenido distinto se conservan AMBAS (la importada con id `<id>:imp` y
//    nombre "... (importada)"); si es idéntica no se hace nada.
//  - archivos: se agregan los que faltan; con el mismo id se conserva el actual salvo `preferBackup`.
//  - Idempotente: fusionar dos veces el mismo respaldo no cambia nada la segunda vez.
import { validateBackup, normalizeProfile, isPlainObject, isReservedKey, MAX_FILES, MAX_TEMPLATES } from './backup-validate.js';
import { normalizeTemplate } from './template-model.js';
import { migrate, CURRENT_VERSION, LEGACY_KEY, profileHasContent } from './migrate.js';

const MAX_DEPTH = 20;

/** Copia profunda de un valor JSON descartando claves reservadas (`__proto__`, `constructor`, `prototype`), funciones y lo que supere la profundidad máxima. */
function clean(v, d = 0) {
  if (d > MAX_DEPTH) return undefined;
  if (Array.isArray(v)) return v.map((x) => clean(x, d + 1)).filter((x) => x !== undefined);
  if (isPlainObject(v)) {
    const o = {};
    for (const [k, x] of Object.entries(v)) {
      if (isReservedKey(k)) continue;
      const c = clean(x, d + 1);
      if (c !== undefined) o[k] = c;
    }
    return o;
  }
  if (typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint' || v === undefined) return undefined;
  if (typeof v === 'number' && !Number.isFinite(v)) return undefined;
  return v;
}

/** Vacío = sin dato: null, '', solo espacios, false, [] , {} . (0 NO es vacío.) */
export function isEmptyValue(v) {
  if (v === null || v === undefined || v === false) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (isPlainObject(v)) return Object.keys(v).length === 0;
  return false;
}

/** Forma canónica (claves ordenadas) para comparar valores JSON. */
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (isPlainObject(v)) return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v) ?? 'null';
}

const own = (o, k) => (Object.hasOwn(o, k) ? o[k] : undefined); // evita heredar `constructor`, `toString`, ...
const stamp = (v) => { if (typeof v !== 'string') return null; const n = Date.parse(v); return Number.isNaN(n) ? null : n; };
const strings = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string') : []);
const union = (a, b) => { const out = [...a], seen = new Set(a); for (const x of b) if (!seen.has(x)) { seen.add(x); out.push(x); } return out; };
const newStats = () => ({ filled: 0, replaced: 0, kept: 0, itemsAdded: 0, itemsReplaced: 0, itemsKept: 0, itemsSame: 0, skipped: 0 });

/** Sección simple: llena vacíos (o reemplaza con `prefer`). Devuelve el objeto resultante (nuevo). */
function mergeSimple(cur, inc, prefer, st) {
  const out = clean(cur);
  for (const [k, raw] of Object.entries(inc)) {
    if (isReservedKey(k)) continue;
    const iv = clean(raw);
    if (iv === undefined || isEmptyValue(iv)) continue;
    const cv = own(out, k);
    if (isEmptyValue(cv)) { out[k] = iv; st.filled++; }
    else if (canon(cv) !== canon(iv)) {
      if (prefer) { out[k] = iv; st.replaced++; } else st.kept++;
    }
  }
  return out;
}

/**
 * Un registro con el mismo id en los dos lados gana ENTERO (el más reciente), pero no pierde campos que el otro tenía y a él le faltan del todo
 * (clave ausente, no vacía): p. ej. una versión anterior de la app no conoce `cargoJefe` y su copia del registro solo trae `cargo`
 * (docs/SYNC.md, «Versiones distintas»). Un valor vacío del ganador cuenta como dato (borrado a propósito): no se rellena. Idempotente.
 */
export function fillAbsent(win, lose) {
  if (!isPlainObject(win) || !isPlainObject(lose)) return win;
  let out = win;
  for (const [k, v] of Object.entries(lose)) {
    if (isReservedKey(k) || k === 'id' || Object.hasOwn(win, k) || isEmptyValue(v)) continue;
    if (out === win) out = { ...win };
    out[k] = v;
  }
  return out;
}

/** Sección repetible: agrega ids nuevos; con id repetido gana el más reciente (updatedAt) o el respaldo con `prefer`. */
function mergeRepeatable(cur, inc, prefer, st) {
  const out = [], idx = new Map();
  for (const it of cur) {
    const c = clean(it);
    if (c === undefined) continue;
    out.push(c);
    if (isPlainObject(c) && typeof c.id === 'string' && c.id) idx.set(c.id, out.length - 1);
  }
  const seen = new Set();
  for (const raw of inc) {
    if (!isPlainObject(raw) || typeof raw.id !== 'string' || !raw.id || seen.has(raw.id)) { st.skipped++; continue; }
    seen.add(raw.id);
    const it = clean(raw);
    if (!idx.has(it.id)) { idx.set(it.id, out.push(it) - 1); st.itemsAdded++; continue; }
    const i = idx.get(it.id), c = out[i];
    if (canon(c) === canon(it)) { st.itemsSame++; continue; }
    const tc = stamp(c.updatedAt), ti = stamp(it.updatedAt);
    if (prefer || (tc !== null && ti !== null && ti > tc)) { out[i] = fillAbsent(it, c); st.itemsReplaced++; }
    else { const f = fillAbsent(c, it); if (f !== c) { out[i] = f; st.filled++; } st.itemsKept++; }
  }
  return out;
}

/**
 * mergeProfile(current, incoming, {preferBackup, fileIds, currentShown}) -> { profile, stats, sections }
 * `fileIds`: ids de archivo del resultado final (si se da, los ids de `documents` que aporta el respaldo y no existan se descartan).
 * `currentShown`: documentos visibles hoy (shownDocIds) para unir con `documentsShown` cuando el perfil actual no tiene lista propia.
 */
export function mergeProfile(current, incoming, { preferBackup = false, fileIds = null, currentShown = null } = {}) {
  const cur = isPlainObject(current) ? current : {};
  const inc = isPlainObject(incoming) ? incoming : {};
  const out = clean(cur);
  const stats = newStats(), sections = {};
  for (const [k, raw] of Object.entries(inc)) {
    if (isReservedKey(k) || k === 'documents' || k === 'documentsShown' || k === LEGACY_KEY) continue;
    const iv = clean(raw);
    if (iv === undefined || isEmptyValue(iv)) continue;
    const st = newStats();
    const cv = own(out, k);
    if (Array.isArray(iv)) {
      if (Array.isArray(cv)) out[k] = mergeRepeatable(cv, iv, preferBackup, st);
      else if (isEmptyValue(cv)) { const m = mergeRepeatable([], iv, preferBackup, st); if (m.length) out[k] = m; }
      else st.skipped++; // el tipo no coincide con el actual: se conserva lo actual
    } else if (isPlainObject(iv)) {
      if (isPlainObject(cv)) out[k] = mergeSimple(cv, iv, preferBackup, st);
      else if (isEmptyValue(cv)) { const m = mergeSimple({}, iv, preferBackup, st); if (Object.keys(m).length) out[k] = m; }
      else st.skipped++;
    } else if (isEmptyValue(cv)) { out[k] = iv; st.filled++; }
    else if (canon(cv) !== canon(iv)) { if (preferBackup) { out[k] = iv; st.replaced++; } else st.kept++; }
    sections[k] = st;
    for (const n of Object.keys(st)) stats[n] += st[n];
  }
  // Marca de perfil anterior a las condiciones: la conserva el actual; un respaldo la aporta SOLO si el perfil actual está vacío (nada que ocultar por error).
  if (inc[LEGACY_KEY] === true && out[LEGACY_KEY] !== true && !profileHasContent(cur)) out[LEGACY_KEY] = true;
  // documents: unión por documento. Los ids que aporta el respaldo se filtran contra los archivos finales.
  const fileSet = fileIds ? new Set(fileIds) : null;
  const incDocs = isPlainObject(inc.documents) ? inc.documents : {};
  if (isPlainObject(cur.documents) || Object.keys(incDocs).length) {
    const docs = {};
    for (const [d, lst] of Object.entries(isPlainObject(cur.documents) ? cur.documents : {})) if (!isReservedKey(d)) docs[d] = strings(lst);
    for (const [d, lst] of Object.entries(incDocs)) {
      if (isReservedKey(d)) continue;
      const add = strings(lst).filter((id) => !fileSet || fileSet.has(id));
      const prev = own(docs, d);
      if (!add.length && prev) continue;
      const merged = union(prev || [], add);
      if (!prev && !merged.length) continue;
      if (merged.length > (prev || []).length) stats.docsAdded = (stats.docsAdded || 0) + merged.length - (prev || []).length;
      docs[d] = merged;
    }
    out.documents = docs;
  }
  // documentsShown: unión. Si el actual no tiene lista propia solo se fija cuando se conoce la lista efectiva y el respaldo aporta algo.
  if (Array.isArray(inc.documentsShown)) {
    const incShown = strings(inc.documentsShown);
    const own = Array.isArray(cur.documentsShown);
    const base = own ? strings(cur.documentsShown) : Array.isArray(currentShown) ? strings(currentShown) : null;
    if (base) {
      const merged = union(base, incShown);
      if (own || merged.length > base.length) { out.documentsShown = merged; stats.shownAdded = merged.length - base.length; }
    }
  }
  return { profile: out, stats, sections };
}

/** mergeTemplates(current[], incoming[]) -> { templates, added, renamed, same } */
export function mergeTemplates(current, incoming) {
  const norm = (list) => (Array.isArray(list) ? list.map((t) => (isPlainObject(t) ? normalizeTemplate(t) : null)).filter((t) => t && t.id) : []);
  const out = norm(current), byId = new Map(out.map((t) => [t.id, t]));
  let added = 0, renamed = 0, same = 0;
  for (const t of norm(incoming)) {
    const cur = byId.get(t.id);
    if (!cur) { out.push(t); byId.set(t.id, t); added++; continue; }
    if (canon(cur) === canon(t)) { same++; continue; }
    const name = `${t.name || 'Plantilla'}`.replace(/ \(importada\)$/, '').slice(0, 185) + ' (importada)';
    let n = 1, done = false;
    while (!done) {
      const id = t.id.slice(0, 190) + ':imp' + (n > 1 ? n : '');
      const copy = { ...t, id, name };
      const exists = byId.get(id);
      if (!exists) { out.push(copy); byId.set(id, copy); renamed++; done = true; }
      else if (canon(exists) === canon(copy)) { same++; done = true; }
      else n++;
    }
  }
  return { templates: out, added, renamed, same };
}

/**
 * mergeBackup(current, incoming, {preferBackup, currentShown}) ->
 *   { ok:true, profile, templates, filesToPut:[ids], changed, stats } | { ok:false, error }
 * current: {profile, templates, files:[{id, size?}]}   incoming: respaldo ya validado y migrado (prepareBackup): {profile, templates, files:[{id,...}]}
 * `filesToPut`: ids de `incoming.files` que hay que escribir (nuevos, o los que reemplaza `preferBackup`).
 */
export function mergeBackup(current, incoming, opts = {}) {
  const prefer = !!opts.preferBackup;
  const cur = isPlainObject(current) ? current : {};
  const inc = isPlainObject(incoming) ? incoming : {};
  const curFiles = Array.isArray(cur.files) ? cur.files.filter((f) => isPlainObject(f) && typeof f.id === 'string') : [];
  const incFiles = Array.isArray(inc.files) ? inc.files.filter((f) => isPlainObject(f) && typeof f.id === 'string') : [];
  const have = new Set(curFiles.map((f) => f.id));
  const put = [], seenF = new Set();
  const files = { added: 0, replaced: 0, kept: 0 };
  for (const f of incFiles) {
    if (seenF.has(f.id)) continue;
    seenF.add(f.id);
    if (!have.has(f.id)) { put.push(f.id); files.added++; }
    else if (prefer) { put.push(f.id); files.replaced++; }
    else files.kept++;
  }
  if (have.size + files.added > MAX_FILES) return { ok: false, error: `No se puede combinar: el resultado tendría más de ${MAX_FILES} archivos.` };
  const finalIds = [...have, ...put.filter((id) => !have.has(id))];
  const p = mergeProfile(cur.profile, inc.profile, { preferBackup: prefer, fileIds: finalIds, currentShown: opts.currentShown ?? null });
  const t = mergeTemplates(cur.templates, inc.templates);
  if (t.templates.length > MAX_TEMPLATES) return { ok: false, error: `No se puede combinar: el resultado tendría más de ${MAX_TEMPLATES} plantillas.` };
  const profile = normalizeProfile(p.profile);
  const curProfile = isPlainObject(cur.profile) ? cur.profile : {};
  const curTpl = Array.isArray(cur.templates) ? cur.templates.map((x) => (isPlainObject(x) ? normalizeTemplate(x) : null)).filter((x) => x && x.id) : [];
  const changed = put.length > 0 || canon(profile) !== canon(normalizeProfile(curProfile)) || canon(t.templates) !== canon(curTpl);
  return {
    ok: true, profile, templates: t.templates, filesToPut: put, changed,
    stats: { profile: p.stats, sections: p.sections, templates: { added: t.added, renamed: t.renamed, same: t.same }, files },
  };
}

/** Resumen del contenido de un perfil: { sections, fields, items } (campos con dato en secciones simples + registros repetibles). */
export function summarizeProfile(profile) {
  const out = { sections: 0, fields: 0, items: 0 };
  if (!isPlainObject(profile)) return out;
  for (const [k, v] of Object.entries(profile)) {
    if (k === 'documents' || k === 'documentsShown' || k === LEGACY_KEY || isReservedKey(k)) continue;
    if (Array.isArray(v)) { const n = v.filter(isPlainObject).length; if (n) { out.sections++; out.items += n; } }
    else if (isPlainObject(v)) { const n = Object.values(v).filter((x) => !isEmptyValue(x)).length; if (n) { out.sections++; out.fields += n; } }
    else if (!isEmptyValue(v)) { out.sections++; out.fields++; }
  }
  return out;
}

/**
 * prepareBackup(data) -> validateBackup + versión + migración (G15). Devuelve
 *   { ok:true, profile, templates, files, totalBytes, schemaVersion, exportedAt, upgraded } | { ok:false, error }
 * `takenIds`: ids ya presentes en IndexedDB (modo fusionar) que un renombrado de la migración no debe reutilizar.
 * Un respaldo de un esquema MÁS NUEVO que el de la app se rechaza (validateBackup); uno más viejo se migra.
 */
export function prepareBackup(data, { takenIds = null } = {}) {
  const v = validateBackup(data);
  if (!v.ok) return v;
  const from = Number.isInteger(data.schemaVersion) && data.schemaVersion >= 0 ? data.schemaVersion : 0;
  const mig = migrate(v.profile, { from, fileIds: v.files.map((f) => f.id), takenIds });
  const files = Object.keys(mig.renames).length ? v.files.map((f) => (Object.hasOwn(mig.renames, f.id) ? { ...f, id: mig.renames[f.id] } : f)) : v.files;
  return {
    ok: true, profile: mig.profile, templates: v.templates, files, totalBytes: v.totalBytes,
    schemaVersion: from, exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt.slice(0, 40) : '', upgraded: from < CURRENT_VERSION,
  };
}

/** Texto (español) del resultado de una fusión, para el aviso posterior. */
export function mergeSummaryText(stats) {
  if (!stats) return '';
  const p = stats.profile, parts = [];
  if (p.filled) parts.push(`${p.filled} campo(s) completado(s)`);
  if (p.replaced) parts.push(`${p.replaced} campo(s) reemplazado(s)`);
  if (p.itemsAdded) parts.push(`${p.itemsAdded} registro(s) nuevo(s)`);
  if (p.itemsReplaced) parts.push(`${p.itemsReplaced} registro(s) actualizado(s)`);
  if (stats.templates.added || stats.templates.renamed) parts.push(`${stats.templates.added + stats.templates.renamed} plantilla(s)`);
  if (stats.files.added || stats.files.replaced) parts.push(`${stats.files.added + stats.files.replaced} archivo(s)`);
  const kept = p.kept + p.itemsKept + stats.files.kept;
  return (parts.length ? 'Se agregó o cambió: ' + parts.join(', ') + '.' : 'No había nada nuevo que agregar.') + (kept ? ` Se conservaron ${kept} dato(s) actuales distintos.` : '');
}

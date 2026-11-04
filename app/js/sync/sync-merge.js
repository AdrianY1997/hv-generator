// Fusión PURA para la sincronización (G04): "gana el cambio más reciente" por campo, registro, plantilla y archivo, con lápidas.
// Sin DOM ni almacenamiento. Probado en tests/sync-merge.test.mjs.
//
// Entradas (ambos lados con la misma forma):
//   { profile, templates, clock, files: { [id]: { h, meta, b? } } }      h = id del contenido (HMAC), b = el remoto guarda los bytes
// Reglas:
//  - Cada entidad (campo de sección simple, registro de sección repetible, valor escalar, plantilla, archivo) se resuelve por separado.
//  - Gana la fecha mayor del reloj (para registros y plantillas también cuenta su `updatedAt`). Una lápida más nueva que la última
//    edición borra; una edición más nueva que la lápida "resucita".
//  - Empate (típico: datos anteriores a la sincronización, sin fecha en ningún lado): gana el remoto salvo que el remoto esté vacío y el
//    local no (así se llenan huecos). Así todos los equipos convergen al mismo resultado (ver docs/SYNC.md); para que gane este equipo al
//    unirse, el motor sella antes las entidades sin fecha (`stampUndated`).
//  - El reloj resultante es el máximo de los dos relojes.
// Idempotente y convergente: fusionar el resultado con cualquiera de los dos lados no cambia nada.
import { isPlainObject, isReservedKey } from '../backup-validate.js';
import { isEmptyValue, fillAbsent } from '../backup-merge.js';
import { canon, kindOf, combineKind, kField, kScalar, kItem, kTpl, kFile, tomb, pruneClock, sanitizeClock, MAX_FUTURE } from './clock.js';

const own = (o, k) => (o && Object.hasOwn(o, k) ? o[k] : undefined);
const keysOf = (...objs) => { const s = new Set(); for (const o of objs) if (isPlainObject(o)) for (const k of Object.keys(o)) if (!isReservedKey(k)) s.add(k); return [...s]; };
const ts0 = (v) => { if (typeof v !== 'string') return 0; const n = Date.parse(v); return Number.isNaN(n) ? 0 : n; };
const listById = (arr) => { const m = new Map(); for (const x of Array.isArray(arr) ? arr : []) if (isPlainObject(x) && typeof x.id === 'string' && x.id && !m.has(x.id)) m.set(x.id, x); return m; };

/** Elige entre el valor local y el remoto de UNA entidad. -> 'L' | 'R'. */
function pickValue(lv, rv, tl, tr) {
  if (canon(lv) === canon(rv)) return 'L';
  if (tl > tr) return 'L';
  if (tr > tl) return 'R';
  return isEmptyValue(rv) && !isEmptyValue(lv) ? 'L' : 'R';
}
/** Igual, con lápida `d` (ms; 0 = sin lápida) para entidades que se pueden borrar. -> 'L' | 'R' | 'D' (borrar) | null (no existe). */
function pickEntity(lv, rv, tl, tr, d) {
  if (lv === undefined && rv === undefined) return null;
  if (lv !== undefined && rv !== undefined) {
    const w = pickValue(lv, rv, tl, tr);
    return d > Math.max(tl, tr) ? 'D' : w;
  }
  if (lv !== undefined) return d > tl ? 'D' : 'L';
  return d > tr ? 'D' : 'R';
}

const newStats = () => ({ fields: 0, items: 0, itemsDeleted: 0, templates: 0, templatesDeleted: 0, files: 0, filesDeleted: 0 });

function mergeProfile(lp, rp, lc, rc, st, cap) {
  const ts = (v) => { const n = ts0(v); return n > cap ? 0 : n; }; // updatedAt de registros: uno más allá de now + 1 día no es confiable (es dato, no se reescribe al fusionar) y se ignora
  const out = {};
  const t = (c, k) => c[k] || 0;
  const d = (k) => Math.max(t(lc, tomb(k)), t(rc, tomb(k)));
  for (const k of keysOf(lp, rp)) {
    const a = own(lp, k), b = own(rp, k);
    const kind = combineKind(kindOf(a), kindOf(b));
    if (kind === 'obj') {
      const o = {};
      for (const f of keysOf(a, b)) {
        const la = own(a, f), rb = own(b, f), key = kField(k, f);
        const w = pickValue(la, rb, t(lc, key), t(rc, key));
        const v = w === 'L' ? la : rb;
        if (w === 'R' && canon(la) !== canon(rb)) st.fields++;
        if (v !== undefined) o[f] = v;
      }
      if (Object.keys(o).length || a !== undefined) out[k] = o;
    } else if (kind === 'items') {
      const ma = listById(a), mb = listById(b), arr = [];
      const take = (id) => {
        const la = ma.get(id), rb = mb.get(id), key = kItem(k, id);
        const w = pickEntity(la, rb, Math.max(t(lc, key), ts(la?.updatedAt)), Math.max(t(rc, key), ts(rb?.updatedAt)), d(key));
        // El registro ganador conserva los campos que solo tenía el otro (versiones distintas de la app: cargo / cargoJefe), ver fillAbsent.
        if (w === 'L') arr.push(fillAbsent(la, rb));
        else if (w === 'R') { arr.push(fillAbsent(rb, la)); if (canon(la) !== canon(rb)) st.items++; }
        else if (w === 'D' && la !== undefined) st.itemsDeleted++;
      };
      for (const id of ma.keys()) take(id);
      for (const id of mb.keys()) if (!ma.has(id)) take(id);
      // Registros sin id (no deberían existir tras migrate): se conservan los locales tal cual.
      for (const x of Array.isArray(a) ? a : []) if (!(isPlainObject(x) && typeof x.id === 'string' && x.id)) arr.push(x);
      if (arr.length || a !== undefined || b !== undefined) out[k] = arr;
    } else if (kind !== 'none') {
      const key = kScalar(k);
      // documentsShown (lista de ids visibles): sin fecha que decida (empate: datos anteriores a la sincronización, o cada equipo migró por su cuenta
      // con los archivos que tenía) se UNE, ordenada para que todos los equipos converjan a la misma lista. Con una edición más nueva manda esa
      // (ocultar un documento en un equipo debe propagarse).
      if (k === 'documentsShown' && Array.isArray(a) && Array.isArray(b) && t(lc, key) === t(rc, key) && canon(a) !== canon(b)) {
        const u = [...new Set([...a, ...b].filter((x) => typeof x === 'string'))].sort();
        if (canon(u) !== canon(a)) st.fields++;
        out[k] = u;
        continue;
      }
      const w = pickValue(a, b, t(lc, key), t(rc, key));
      const v = w === 'L' ? a : b;
      if (w === 'R' && canon(a) !== canon(b)) st.fields++;
      if (v !== undefined) out[k] = v;
    }
  }
  return out;
}

/**
 * mergeSync(local, remote) -> { profile, templates, clock, files, apply:{put:[{id, needBytes}], del:[ids]}, changedLocal, stats }
 * `files` es el índice resultante; `apply` dice qué archivos locales hay que escribir (los que ganó el remoto) o borrar.
 */
export function mergeSync(local, remote, { now = Date.now() } = {}) {
  const L = isPlainObject(local) ? local : {}, R = isPlainObject(remote) ? remote : {};
  // Los sellos remotos se limitan a now + 1 día (un reloj adelantado o alterado ganaría para siempre); los locales los pone este equipo.
  const cap = now + MAX_FUTURE;
  const ts = (v) => { const n = ts0(v); return n > cap ? 0 : n; };
  const lc = isPlainObject(L.clock) ? L.clock : {}, rc = sanitizeClock(R.clock, now);
  const st = newStats();
  const lp = isPlainObject(L.profile) ? L.profile : {}, rp = isPlainObject(R.profile) ? R.profile : {};
  const profile = mergeProfile(lp, rp, lc, rc, st, cap);
  const t = (c, k) => c[k] || 0;
  const d = (k) => Math.max(t(lc, tomb(k)), t(rc, tomb(k)));

  // Plantillas
  const ml = listById(L.templates), mr = listById(R.templates), templates = [];
  const takeT = (id) => {
    const a = ml.get(id), b = mr.get(id), key = kTpl(id);
    const w = pickEntity(a, b, Math.max(t(lc, key), ts(a?.updatedAt)), Math.max(t(rc, key), ts(b?.updatedAt)), d(key));
    if (w === 'L') templates.push(a);
    else if (w === 'R') { templates.push(b); if (canon(a) !== canon(b)) st.templates++; }
    else if (w === 'D' && a !== undefined) st.templatesDeleted++;
  };
  for (const id of ml.keys()) takeT(id);
  for (const id of mr.keys()) if (!ml.has(id)) takeT(id);

  // Archivos (índice): el contenido se compara por `h` y metadatos.
  const lf = isPlainObject(L.files) ? L.files : {}, rf = isPlainObject(R.files) ? R.files : {};
  const files = {}, put = [], del = [];
  const sameFile = (a, b) => !!a && !!b && a.h === b.h && canon(a.meta) === canon(b.meta);
  for (const id of keysOf(lf, rf)) {
    const a = own(lf, id), b = own(rf, id), key = kFile(id);
    const w = pickEntity(a && { h: a.h, meta: a.meta }, b && { h: b.h, meta: b.meta }, t(lc, key), t(rc, key), d(key));
    if (w === 'L') files[id] = a;
    else if (w === 'R') {
      files[id] = b;
      if (!sameFile(a, b)) { put.push({ id, needBytes: !a || a.h !== b.h }); st.files++; }
    } else if (w === 'D' && a !== undefined) { del.push(id); st.filesDeleted++; }
  }

  const clock = {};
  for (const k of new Set([...Object.keys(lc), ...Object.keys(rc)])) clock[k] = Math.max(t(lc, k), t(rc, k));
  const merged = pruneClock(clock, now);
  const changedLocal = put.length > 0 || del.length > 0 || canon(profile) !== canon(lp) || canon(templates) !== canon([...ml.values()]);
  return { profile, templates, clock: merged, files, apply: { put, del }, changedLocal, stats: st };
}

/** Texto (español) del resultado para el aviso posterior. */
export function syncSummaryText(stats) {
  if (!stats) return '';
  const parts = [];
  if (stats.fields) parts.push(`${stats.fields} campo(s)`);
  if (stats.items) parts.push(`${stats.items} registro(s)`);
  if (stats.templates) parts.push(`${stats.templates} plantilla(s)`);
  if (stats.files) parts.push(`${stats.files} archivo(s)`);
  const dels = (stats.itemsDeleted || 0) + (stats.templatesDeleted || 0) + (stats.filesDeleted || 0);
  const out = parts.length ? 'Se recibieron cambios de otro equipo: ' + parts.join(', ') + '.' : '';
  return out + (dels ? `${out ? ' ' : ''}Se aplicaron ${dels} borrado(s) hechos en otro equipo.` : '');
}

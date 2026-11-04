// Reloj de cambios para la sincronización (G04). PURO: sin DOM ni almacenamiento.
//
// La fusión de respaldos (backup-merge.js) no sirve tal cual para sincronizar: en secciones simples el respaldo solo LLENA campos vacíos,
// así que un campo editado en el equipo A nunca llegaría al B; y una plantilla editada se duplicaría como "(importada)" en cada ida y vuelta.
// La sincronización necesita saber QUÉ cambió y CUÁNDO. store.js llama a estas funciones al guardar (perfil, plantillas, archivos) y
// mantiene un mapa `clave -> ms` en localStorage (`hv.sync.clock`):
//   p:<sec>.<campo>   campo de una sección simple (objeto)          p:<clave>     valor escalar o lista de textos (documentsShown)
//   i:<sec>/<id>      registro de una sección repetible               t:<id>        plantilla          f:<id>   archivo (contenido o metadatos)
//   x<clave>          lápida (borrado) de un registro, plantilla o archivo: `xi:<sec>/<id>`, `xt:<id>`, `xf:<id>`
// `documents` es una sección simple más (p:documents.<docId>). Las lápidas viven TOMBSTONE_TTL días.
import { isPlainObject, isReservedKey } from '../backup-validate.js';

export const TOMBSTONE_TTL = 180 * 86400000;
export const MAX_CLOCK_KEYS = 20000;
export const MAX_FUTURE = 86400000; // los sellos (y updatedAt) se limitan a ahora + 1 día: un reloj adelantado no puede ganar para siempre

/** Forma canónica (claves ordenadas) de un valor JSON, para comparar. */
export function canon(v) {
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (isPlainObject(v)) return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v) ?? 'null';
}

export const kField = (sec, f) => `p:${sec}.${f}`;
export const kScalar = (k) => `p:${k}`;
export const kItem = (sec, id) => `i:${sec}/${id}`;
export const kTpl = (id) => `t:${id}`;
export const kFile = (id) => `f:${id}`;
export const tomb = (k) => 'x' + k;

/** Tipo de un valor de primer nivel del perfil: 'none' | 'obj' | 'items' (arreglo de objetos con id) | 'empty' ([]) | 'scalar'. */
export function kindOf(v) {
  if (v === undefined) return 'none';
  if (isPlainObject(v)) return 'obj';
  if (Array.isArray(v)) {
    if (!v.length) return 'empty';
    return v.every((x) => isPlainObject(x) && typeof x.id === 'string' && x.id) ? 'items' : 'scalar';
  }
  return 'scalar';
}
/** Tipo común de dos lados (el mismo en el reloj y en la fusión: si no, un cambio se fecharía con una clave y se fusionaría con otra). */
export function combineKind(a, b) {
  if (a === b) return a === 'empty' ? 'items' : a === 'none' ? 'none' : a;
  if (a === 'none') return b === 'empty' ? 'items' : b;
  if (b === 'none') return a === 'empty' ? 'items' : a;
  if ((a === 'empty' && b === 'items') || (a === 'items' && b === 'empty')) return 'items';
  return 'scalar';
}
const own = (o, k) => (o && Object.hasOwn(o, k) ? o[k] : undefined);
const keysOf = (...objs) => { const s = new Set(); for (const o of objs) if (isPlainObject(o)) for (const k of Object.keys(o)) if (!isReservedKey(k)) s.add(k); return [...s]; };
const byId = (arr) => { const m = new Map(); for (const x of Array.isArray(arr) ? arr : []) if (isPlainObject(x) && typeof x.id === 'string' && x.id && !m.has(x.id)) m.set(x.id, x); return m; };

/** Copia validada de un reloj guardado o recibido (solo claves de texto razonables con números finitos >= 0, limitados a now + 1 día). */
export function sanitizeClock(raw, now = Date.now()) {
  const cap = now + MAX_FUTURE;
  const out = {};
  if (!isPlainObject(raw)) return out;
  let n = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (n >= MAX_CLOCK_KEYS) break;
    if (typeof k !== 'string' || k.length > 400 || isReservedKey(k) || !/^x?[pitf]:/.test(k)) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) continue;
    out[k] = Math.min(Math.floor(v), cap); n++;
  }
  return out;
}

/** Quita lápidas vencidas. Devuelve un reloj nuevo. */
export function pruneClock(clock, now = Date.now()) {
  const out = {};
  for (const [k, v] of Object.entries(clock || {})) if (!(k[0] === 'x' && now - v > TOMBSTONE_TTL)) out[k] = v;
  return out;
}

const set = (c, k, now) => { c[k] = Math.max(now, (c[k] || 0) + 1); }; // estrictamente creciente aunque el reloj del sistema no avance

/** Fecha en el reloj lo que cambió entre dos perfiles. Devuelve un reloj NUEVO (no muta). */
export function stampProfile(prev, next, clock, now = Date.now()) {
  const c = { ...(clock || {}) };
  const a0 = isPlainObject(prev) ? prev : {}, b0 = isPlainObject(next) ? next : {};
  for (const k of keysOf(a0, b0)) {
    const a = own(a0, k), b = own(b0, k);
    if (canon(a) === canon(b)) continue;
    const kind = combineKind(kindOf(a), kindOf(b));
    if (kind === 'obj') {
      for (const f of keysOf(a, b)) if (canon(own(a, f)) !== canon(own(b, f))) set(c, kField(k, f), now);
    } else if (kind === 'items') {
      const ma = byId(a), mb = byId(b);
      for (const id of new Set([...ma.keys(), ...mb.keys()])) {
        const ia = ma.get(id), ib = mb.get(id);
        if (!ib) set(c, tomb(kItem(k, id)), now);
        else if (!ia || canon(ia) !== canon(ib)) { set(c, kItem(k, id), now); delete c[tomb(kItem(k, id))]; }
      }
    } else set(c, kScalar(k), now);
  }
  return c;
}

/** Fecha altas, cambios y bajas de plantillas (por id). Devuelve un reloj nuevo. */
export function stampTemplates(prev, next, clock, now = Date.now()) {
  const c = { ...(clock || {}) };
  const ma = byId(prev), mb = byId(next);
  for (const id of new Set([...ma.keys(), ...mb.keys()])) {
    const a = ma.get(id), b = mb.get(id);
    if (!b) set(c, tomb(kTpl(id)), now);
    else if (!a || canon(a) !== canon(b)) { set(c, kTpl(id), now); delete c[tomb(kTpl(id))]; }
  }
  return c;
}

/** Fecha archivos escritos (`put`) y borrados (`del`). Devuelve un reloj nuevo. */
export function stampFiles(clock, { put = [], del = [] } = {}, now = Date.now()) {
  const c = { ...(clock || {}) };
  for (const id of put) { set(c, kFile(id), now); delete c[tomb(kFile(id))]; }
  for (const id of del) set(c, tomb(kFile(id)), now);
  return c;
}

/** Sella con `now` toda entidad del estado local que aún no tenga fecha (unirse a una sincronización existente "prefiriendo este equipo"). */
export function stampUndated(state, clock, now = Date.now()) {
  const c = { ...(clock || {}) };
  const mark = (k) => { if (!c[k]) c[k] = now; };
  const p = isPlainObject(state.profile) ? state.profile : {};
  for (const k of keysOf(p)) {
    const v = p[k], kind = combineKind(kindOf(v), 'none');
    if (kind === 'obj') for (const f of keysOf(v)) mark(kField(k, f));
    else if (kind === 'items') for (const id of byId(v).keys()) mark(kItem(k, id));
    else mark(kScalar(k));
  }
  for (const id of byId(state.templates).keys()) mark(kTpl(id));
  for (const id of Object.keys(state.files || {})) mark(kFile(id));
  return c;
}

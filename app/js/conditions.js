// Condiciones de visibilidad del formulario (puras, sin DOM, sin eval). El schema del modelo las declara con la clave aditiva
// `showIf` en campos y en secciones; el formulario, la validación, el render de la HV y las plantillas usan estas mismas funciones.
//
//   { id:'empresaActual', ..., showIf: { field:'trabajaActualmente', equals:'Si' } }
//   { id:'conyugeNombre', ..., showIf: { field:'personales.estadoCivil', in:['Casado(a)', 'Unión libre'] } }   // otra sección simple: «sec.campo»
//   showIf: { allOf: [ cond, ... ] } | { anyOf: [ ... ] } | { noneOf: [ ... ] }
//
// Hoja (leaf): { field, <operador>, whenEmpty? } con UN operador:
//   equals | not | in | notIn | includes (el valor es una lista que contiene) | notEmpty | empty | gt | gte | lt | lte
// `field` sin punto = otro campo del MISMO registro (en secciones repetibles, el mismo ítem); `sec.campo` = campo de una sección SIMPLE.
//
// Evaluación en tres valores: true / false / null (= «no se sabe todavía», porque el campo que controla está vacío).
//   - «Vacío» = sin responder: undefined, null, '' o solo espacios. `false` (casilla sin marcar), 0 y [] SÍ son respuestas.
//   - Un controlador vacío da null con equals / in / includes / gt…; con not / notIn / empty da su valor lógico (vacío no es igual a nada).
//     `whenEmpty: true|false` en la hoja fija el resultado para un controlador vacío.
//   - Un controlador que a su vez está oculto deja oculto al dependiente (la cadena se respeta).
// Visibilidad final: true -> se muestra; false -> se oculta; null -> se oculta, SALVO en perfiles ANTERIORES a las condiciones
// (marca `legacyConditions` del perfil, puesta por migrate.js v2): ahí un campo con dato se queda visible mientras su controlador siga sin
// responder; en cuanto se responde, manda la respuesta. Sin la marca, un controlador sin responder (o borrado) oculta al dependiente aunque tenga dato.
// Una condición mal formada (operador desconocido, no es un objeto) NO oculta nada: ante la duda, el dato se muestra.
// Los valores de los campos ocultos se CONSERVAN en el perfil (pruneProfile devuelve una copia sin ellos solo para validar e imprimir).

/** ¿Hay una respuesta? (distinto de «vacío»: false, 0 y [] sí son respuestas). */
export const answered = (v) => !(v == null || (typeof v === 'string' && v.trim() === ''));
/** ¿Hay un dato con contenido? (false, '', [] y vacío no cuentan). */
export const hasValue = (v) => !(v == null || v === '' || v === false || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && !v.length));

import { LEGACY_KEY } from './migrate.js';
export const OPS = ['equals', 'not', 'in', 'notIn', 'includes', 'notEmpty', 'empty', 'gt', 'gte', 'lt', 'lte'];
const NUM_OPS = ['gt', 'gte', 'lt', 'lte'];
const COMBINERS = ['allOf', 'anyOf', 'noneOf'];
const own = (o, k) => (o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined); // nunca hereda (constructor, __proto__...)
const same = (a, b) => a === b || (a != null && b != null && typeof a !== 'object' && typeof b !== 'object' && String(a) === String(b));

function evalLeaf(c, resolve) {
  const r = resolve(c.field);
  if (r && r.visible === false) return false; // el controlador está oculto: el dependiente también
  const v = r ? r.value : undefined;
  const op = OPS.find((k) => k in c);
  if (!op) return true; // sin operador: condición mal formada
  if (NUM_OPS.includes(op) && !Number.isFinite(c[op])) return true; // umbral que no es número: condición mal formada, no oculta nada
  if (!answered(v)) {
    if (typeof c.whenEmpty === 'boolean') return c.whenEmpty;
    if (op === 'not' || op === 'notIn') return true;
    if (op === 'empty') return true;
    if (op === 'notEmpty') return false;
    return null;
  }
  switch (op) {
    case 'equals': return same(v, c.equals);
    case 'not': return !same(v, c.not);
    case 'in': return Array.isArray(c.in) ? c.in.some((x) => same(v, x)) : true;
    case 'notIn': return Array.isArray(c.notIn) ? !c.notIn.some((x) => same(v, x)) : true;
    case 'includes': return Array.isArray(v) ? v.some((x) => same(x, c.includes)) : false;
    case 'notEmpty': return hasValue(v);
    case 'empty': return !hasValue(v);
    default: {
      const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
      if (!Number.isFinite(n)) return null;
      return op === 'gt' ? n > c.gt : op === 'gte' ? n >= c.gte : op === 'lt' ? n < c.lt : n <= c.lte;
    }
  }
}

/**
 * Evalúa una condición. resolve(ref) -> { value, visible? } (visible:false = el controlador está oculto).
 * -> true | false | null (ver arriba). Una condición ausente es true.
 */
export function evalCond(cond, resolve, depth = 0) {
  if (cond == null) return true;
  if (typeof cond !== 'object' || Array.isArray(cond) || depth > 8) return true;
  const comb = COMBINERS.find((k) => k in cond);
  if (comb) {
    const list = Array.isArray(cond[comb]) ? cond[comb] : [];
    if (!list.length) return true;
    const rs = list.map((x) => evalCond(x, resolve, depth + 1));
    if (comb === 'allOf') return rs.includes(false) ? false : rs.includes(null) ? null : true;
    const any = rs.includes(true) ? true : rs.includes(null) ? null : false;
    return comb === 'anyOf' ? any : any === null ? null : !any;
  }
  if (typeof cond.field !== 'string' || !cond.field) return true;
  return evalLeaf(cond, resolve);
}

/** Referencias («campo» o «sec.campo») que usa una condición. */
export function refsOf(cond, out = new Set(), depth = 0) {
  if (!cond || typeof cond !== 'object' || depth > 8) return out;
  for (const k of COMBINERS) if (Array.isArray(cond[k])) cond[k].forEach((x) => refsOf(x, out, depth + 1));
  if (typeof cond.field === 'string') out.add(cond.field);
  return out;
}

/**
 * Visibilidad de secciones y campos de un perfil según el schema.
 *   const V = createVisibility(sections, profile);
 *   V.sectionVisible(sec) · V.fieldVisible(sec, record, field) · V.visibleIds(sec, record) -> Set de ids de campo visibles
 * `profile` puede cambiar entre llamadas (se lee en vivo); crear uno nuevo es barato.
 */
export function createVisibility(sections, profile) {
  const secById = new Map((sections || []).map((s) => [s.id, s]));
  const legacy = () => profile?.[LEGACY_KEY] === true; // perfil anterior a las condiciones: el dato sin controlador respondido se muestra
  const stack = new Set(); // evita ciclos (a depende de b y b de a): un ciclo no oculta nada

  function resolver(sec, record) {
    return (ref) => {
      const dot = String(ref).indexOf('.');
      if (dot > 0) {
        const s = secById.get(ref.slice(0, dot)), fid = ref.slice(dot + 1);
        if (!s || s.repeatable) return { value: undefined, visible: true };
        const rec = profile?.[s.id] && typeof profile[s.id] === 'object' ? profile[s.id] : {};
        const f = s.fields.find((x) => x.id === fid);
        return { value: own(rec, fid), visible: sectionVisible(s) && (!f || fieldVisible(s, rec, f)) };
      }
      const f = sec?.fields.find((x) => x.id === ref);
      return { value: own(record, ref), visible: !f || fieldVisible(sec, record, f) };
    };
  }
  function sectionVisible(sec) {
    if (!sec || !sec.showIf) return true;
    const key = 's:' + sec.id;
    if (stack.has(key)) return true;
    stack.add(key);
    try {
      const r = evalCond(sec.showIf, resolver(null, null));
      if (r !== null) return r;
      if (!legacy()) return false;
      const d = profile?.[sec.id];
      return Array.isArray(d) ? d.length > 0 : !!d && Object.values(d).some(hasValue);
    } finally { stack.delete(key); }
  }
  function fieldVisible(sec, record, field) {
    if (!field || !field.showIf) return true;
    const key = `${sec.id}.${field.id}`;
    if (stack.has(key)) return true;
    stack.add(key);
    try {
      const r = evalCond(field.showIf, resolver(sec, record));
      return r === null ? legacy() && hasValue(record?.[field.id]) : r;
    } finally { stack.delete(key); }
  }
  function visibleIds(sec, record) {
    return new Set(sec.fields.filter((f) => fieldVisible(sec, record, f)).map((f) => f.id));
  }
  return { sectionVisible, fieldVisible, visibleIds };
}

/**
 * Copia del perfil SIN los datos que no aplican (campos ocultos, secciones ocultas). No muta el original.
 * -> { profile, off } con off = Set de 'secId' (sección oculta) y 'secId.campoId' (campo oculto de una sección simple).
 * Es lo que se valida, se cuenta como pendiente y se imprime; el perfil guardado conserva todo.
 */
export function pruneProfile(sections, profile) {
  const off = new Set();
  const V = createVisibility(sections, profile);
  const out = { ...(profile || {}) };
  for (const sec of sections || []) {
    const v = profile?.[sec.id];
    if (v === undefined) continue;
    const secOn = V.sectionVisible(sec);
    if (!secOn) { off.add(sec.id); out[sec.id] = sec.repeatable ? [] : {}; continue; }
    const strip = (rec, simple) => {
      if (!rec || typeof rec !== 'object') return rec;
      const copy = { ...rec };
      for (const f of sec.fields) {
        if (f.showIf && !V.fieldVisible(sec, rec, f)) { delete copy[f.id]; if (simple) off.add(`${sec.id}.${f.id}`); }
      }
      return copy;
    };
    out[sec.id] = sec.repeatable ? (Array.isArray(v) ? v.map((it) => strip(it, false)) : v) : strip(v, true);
  }
  return { profile: out, off };
}

/** Problemas de las condiciones de un schema (para pruebas): referencias inexistentes, operadores desconocidos, obligatorios condicionales. -> string[] */
export function checkSchemaConditions(sections) {
  const out = [];
  const secs = new Map((sections || []).map((s) => [s.id, s]));
  const checkCond = (where, sec, cond, depth = 0) => {
    if (!cond || typeof cond !== 'object' || Array.isArray(cond)) { out.push(`${where}: la condición no es un objeto`); return; }
    const comb = COMBINERS.filter((k) => k in cond);
    if (comb.length) {
      if (comb.length > 1 || 'field' in cond) out.push(`${where}: mezcla combinadores u hoja`);
      for (const k of comb) { if (!Array.isArray(cond[k]) || !cond[k].length) out.push(`${where}: ${k} debe ser una lista no vacía`); else cond[k].forEach((x) => checkCond(where, sec, x, depth + 1)); }
      return;
    }
    if (typeof cond.field !== 'string') { out.push(`${where}: falta field`); return; }
    const ops = OPS.filter((k) => k in cond);
    for (const k of ops) if (NUM_OPS.includes(k) && !Number.isFinite(cond[k])) out.push(`${where}: el umbral de «${k}» debe ser un número`);
    if (ops.length !== 1) out.push(`${where}: debe llevar exactamente un operador (${ops.join(',') || 'ninguno'})`);
    const dot = cond.field.indexOf('.');
    const tsec = dot > 0 ? secs.get(cond.field.slice(0, dot)) : sec, fid = dot > 0 ? cond.field.slice(dot + 1) : cond.field;
    if (!tsec) { out.push(`${where}: sección inexistente en «${cond.field}»`); return; }
    if (dot > 0 && tsec.repeatable) out.push(`${where}: «${cond.field}» apunta a una sección repetible`);
    if (!tsec.fields.some((f) => f.id === fid)) out.push(`${where}: el campo «${cond.field}» no existe`);
  };
  for (const s of sections || []) {
    if (s.showIf) checkCond(`sección ${s.id}`, s, s.showIf);
    for (const f of s.fields) {
      if (!f.showIf) continue;
      checkCond(`${s.id}.${f.id}`, s, f.showIf);
      if (f.required) out.push(`${s.id}.${f.id}: un campo obligatorio no puede ser condicional`);
      if (f.type === 'photo') out.push(`${s.id}.${f.id}: la foto no puede ser condicional`);
    }
  }
  return out;
}

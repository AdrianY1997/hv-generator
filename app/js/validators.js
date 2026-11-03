// Validadores puros de datos de entrada (G17). Sin DOM. Los declara el schema del modelo como clave aditiva
// `validate` de cada campo, de modo que cualquier modelo los reutiliza:
//
//   { id:'celular', type:'tel', validate:['celular'] }
//   { id:'fechaFin', type:'date', validate:[{ rule:'notBefore', other:'fechaInicio', otherLabel:'la fecha de ingreso' }] }
//
// Una regla es un nombre (string) o { rule, level?, ...parámetros }. Devuelve null (todo bien) o { level, message }.
//   level 'error' = dato incorrecto (rojo, aria-invalid); 'warn' = dato dudoso (ámbar). Ninguno bloquea el guardado.
// Un valor vacío nunca incumple una regla (lo obligatorio se valida aparte con `required`).
// ctx = { get(fieldId) -> valor de otro campo del mismo registro, root(secId, fieldId) -> valor del perfil, today?: 'AAAA-MM-DD' }.
// Reglas desconocidas se ignoran (un modelo nuevo puede declarar reglas que esta versión aún no tiene).

import { createVisibility } from './conditions.js';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '') || v === false || (Array.isArray(v) && !v.length);
const txt = (v) => String(v ?? '').trim();
const digitsOf = (s) => String(s ?? '').replace(/\D/g, '');

/** Hoy en AAAA-MM-DD (hora local). */
export function todayIso(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
const todayOf = (ctx) => (ISO.test(ctx?.today || '') ? ctx.today : todayIso());

/** Años cumplidos en la fecha `onIso` por quien nació en `birthIso`. */
export function ageOn(birthIso, onIso) {
  const [by, bm, bd] = birthIso.split('-').map(Number), [y, m, d] = onIso.split('-').map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}
const yearOf = (v) => {
  const s = txt(v);
  if (ISO.test(s)) return +s.slice(0, 4);
  return /^\d{4}$/.test(s) ? +s : null;
};
const fmt = (iso) => (ISO.test(iso) ? iso.split('-').reverse().join('/') : iso);

// ---------- Teléfonos (Colombia) ----------
/** Quita prefijo de país (+57 / 57 / 0057) y todo lo que no sea dígito. */
function phoneDigits(s) {
  let d = digitsOf(String(s).replace(/\b(ext|extensi[oó]n|x)\b.*$/i, ''));
  if (d.startsWith('0057')) d = d.slice(4); else if (d.length === 12 && d.startsWith('57')) d = d.slice(2);
  return d;
}
const isMobile = (d) => d.length === 10 && d[0] === '3';
const landKind = (d) => (d.length === 7 ? 7 : d.length === 8 ? 8 : d.length === 10 && d.startsWith('60') ? 10 : 0);
const fmtMobile = (d) => `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
function fmtLandline(d) {
  if (d.length === 7) return `${d.slice(0, 3)} ${d.slice(3)}`;
  if (d.length === 8) return `${d[0]} ${d.slice(1, 4)} ${d.slice(4)}`;
  return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
}
const phoneParts = (v) => txt(v).split(/\s*(?:\/|,|;|\by\b)\s*/i).filter(Boolean);

/** Dígito de verificación de un NIT colombiano (módulo 11, pesos de la DIAN). */
export function nitCheckDigit(base) {
  const W = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  const d = digitsOf(base).split('').reverse();
  const r = d.reduce((acc, x, i) => acc + +x * W[i], 0) % 11;
  return r > 1 ? 11 - r : r;
}

// ---------- Reglas ----------
const MSG = {
  celular: 'Un celular colombiano tiene 10 dígitos y empieza por 3 (ej. 300 123 4567).',
  telefono: 'Revisa el teléfono: un fijo tiene 7 dígitos (8 o 10 con indicativo) y un celular 10 dígitos que empiezan por 3.',
  email: 'Escribe un correo válido, por ejemplo nombre@dominio.com.',
};
const DOC_RANGE = { CC: [6, 10], TI: [10, 11], CE: [4, 12] };

export const RULES = {
  /** Documento de identidad según el tipo (campo `typeField`, por defecto tipoDocumento). CC: 6 a 10 dígitos (error). */
  documento(v, p, ctx) {
    const tipo = txt(ctx?.get?.(p.typeField || 'tipoDocumento')) || 'CC';
    const s = txt(v);
    if (['Pasaporte', 'PEP', 'PPT'].includes(tipo)) {
      return /^[A-Za-z0-9-]{4,20}$/.test(s.replace(/\s/g, '')) ? null : { level: 'warn', message: 'Revisa el número: de 4 a 20 letras o dígitos, sin símbolos.' };
    }
    const d = s.replace(/[.\s-]/g, '');
    if (!/^\d+$/.test(d)) return { level: 'error', message: `El ${tipo === 'CC' ? 'número de la cédula' : 'número de documento'} solo lleva dígitos (sin letras ni símbolos).` };
    const [lo, hi] = DOC_RANGE[tipo] || DOC_RANGE.CC;
    if (d.length < lo || d.length > hi) return { level: tipo === 'CC' ? 'error' : 'warn', message: `Un documento ${tipo} tiene entre ${lo} y ${hi} dígitos; este tiene ${d.length}.` };
    return null;
  },
  /** Cédula como sola cifra (6 a 10 dígitos). */
  cedula(v) {
    const d = txt(v).replace(/[.\s-]/g, '');
    if (!/^\d+$/.test(d)) return { level: 'error', message: 'La cédula solo lleva dígitos (sin letras ni símbolos).' };
    return d.length < 6 || d.length > 10 ? { level: 'error', message: `Una cédula tiene entre 6 y 10 dígitos; esta tiene ${d.length}.` } : null;
  },
  celular(v) { return isMobile(phoneDigits(v)) ? null : { level: 'error', message: MSG.celular }; },
  telefono(v) {
    const parts = phoneParts(v);
    const ok = parts.length && parts.every((x) => { const d = phoneDigits(x); return isMobile(d) || landKind(d); });
    return ok ? null : { level: 'warn', message: MSG.telefono };
  },
  email(v) { return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;.]{2,}$/.test(txt(v)) ? null : { level: 'error', message: MSG.email }; },
  /** La fecha (o año) no puede ser posterior a hoy. */
  notFuture(v, p, ctx) {
    const s = txt(v), now = todayOf(ctx);
    if (ISO.test(s)) return s > now ? { level: 'error', message: 'La fecha no puede ser futura.' } : null;
    const y = yearOf(s);
    return y != null && y > +now.slice(0, 4) ? { level: 'error', message: 'El año no puede ser futuro.' } : null;
  },
  /** Edad de quien nació en la fecha: menor de `min` (14) o de `adult` (18) o mayor de `max` (100): siempre advertencia. */
  edad(v, p, ctx) {
    const s = txt(v);
    if (!ISO.test(s)) return null;
    const now = todayOf(ctx);
    if (s > now) return null; // lo dice notFuture
    const a = ageOn(s, now), min = p.min ?? 14, adult = p.adult ?? 18, max = p.max ?? 100;
    if (a < min) return { level: 'warn', message: `Con esta fecha tendrías ${a} año${a === 1 ? '' : 's'}: revisa que sea correcta.` };
    if (a < adult) return { level: 'warn', message: `Con esta fecha eres menor de ${adult} años; para trabajar un menor necesita autorización especial. Revisa que sea correcta.` };
    if (a > max) return { level: 'warn', message: `Con esta fecha tendrías ${a} años: revisa el año.` };
    return null;
  },
  /** No puede ser anterior a otro campo del registro (fin >= inicio). Compara fechas ISO o años numéricos. */
  notBefore(v, p, ctx) {
    const other = ctx?.get?.(p.other);
    if (blank(other)) return null;
    const a = txt(v), b = txt(other);
    const bad = ISO.test(a) && ISO.test(b) ? a < b : /^\d+$/.test(a) && /^\d+$/.test(b) ? +a < +b : false;
    const what = p.otherLabel || 'la fecha de inicio';
    return bad ? { level: p.level || 'error', message: `No puede ser anterior a ${what}${ISO.test(b) ? ' (' + fmt(b) + ')' : ' (' + b + ')'}.` } : null;
  },
  /** La fecha (o año) debe quedar al menos `years` años después del nacimiento (campo de otra sección: rootSection/rootField). */
  afterBirth(v, p, ctx) {
    const birth = ctx?.root?.(p.section || 'personales', p.field || 'fechaNacimiento');
    if (!ISO.test(txt(birth))) return null;
    const years = p.years ?? 0, by = +txt(birth).slice(0, 4);
    const s = txt(v);
    if (ISO.test(s)) {
      if (s < txt(birth)) return { level: 'warn', message: 'Esta fecha es anterior a tu fecha de nacimiento.' };
      return years && ageOn(txt(birth), s) < years ? { level: 'warn', message: `Esta fecha te deja con menos de ${years} años: revísala.` } : null;
    }
    const y = yearOf(s);
    if (y == null) return null;
    if (y < by) return { level: 'warn', message: 'Este año es anterior a tu año de nacimiento.' };
    return years && y - by < years ? { level: 'warn', message: `Este año te deja con menos de ${years} años: revísalo.` } : null;
  },
  /** Dirección postal: vaga si es muy corta o no lleva letras (aviso). Las rurales ("Vereda El Roble") no llevan número y son válidas. */
  direccion(v) {
    const s = txt(v);
    return s.length < 6 || !/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(s) ? { level: 'warn', message: 'La dirección parece incompleta: escribe la vía y el número (ej. Calle 10 # 5-20) o el nombre de la vereda.' } : null;
  },
  /** NIT colombiano (empresa): base de 8 a 10 dígitos y, si se escribe, el dígito de verificación (DV, módulo 11). */
  nit(v) {
    const m = /^\s*(\d{1,3}(?:[.\s]?\d{3}){1,3}|\d{6,10})\s*(?:-\s*(\d))?\s*$/.exec(txt(v));
    if (!m) return { level: 'warn', message: 'Un NIT lleva solo dígitos, con un guion y el dígito de verificación al final (ej. 900.123.456-7).' };
    const base = digitsOf(m[1]);
    if (base.length < 8 || base.length > 10) return { level: 'warn', message: `Un NIT tiene entre 8 y 10 dígitos antes del guion; este tiene ${base.length}.` };
    if (m[2] !== undefined && +m[2] !== nitCheckDigit(base)) return { level: 'warn', message: `El dígito de verificación no coincide: para ${base} debería ser ${nitCheckDigit(base)}.` };
    return null;
  },
  /** El año de la fecha no puede ser anterior al de otra del perfil (sección simple: p.section / p.field), p. ej. el grado superior antes del bachillerato. */
  notBeforeRoot(v, p, ctx) {
    const other = ctx?.root?.(p.section, p.field);
    const a = yearOf(v), b = yearOf(other);
    if (a == null || b == null || a >= b) return null;
    return { level: p.level || 'warn', message: `Este año (${a}) es anterior a ${p.otherLabel || 'otro dato de tu perfil'} (${b}): revisa el orden.` };
  },
  /** Cruce con otros registros de la misma sección (experiencia): avisa si este empieza antes de que termine uno anterior por más de `tolerance` días
   *  (31 por defecto: los empalmes cortos entre un empleo y el siguiente son normales). Solo se informa en el registro que empieza después. Un trabajo
   *  actual cuenta hasta hoy. Nunca bloquea: puede haber trabajos simultáneos. Usa ctx.others() (los demás registros). */
  noOverlap(v, p, ctx) {
    const others = ctx?.others?.();
    if (!Array.isArray(others) || !others.length) return null;
    const start = txt(v);
    if (!ISO.test(start)) return null;
    const sF = p.start || 'fechaInicio', eF = p.end || 'fechaFin', cF = p.current || 'actual', today = todayOf(ctx);
    const endOf = (get) => { const e = txt(get(eF)); return ISO.test(e) ? e : get(cF) === true ? today : null; };
    const end = endOf((id) => ctx.get(id));
    if (!end || end < start) return null;
    const tol = p.tolerance ?? 31, day = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;
    let top = null;
    for (const o of others) {
      if (!o || typeof o !== 'object') continue;
      const os = txt(o[sF]);
      if (!ISO.test(os) || os > start) continue; // el otro empieza después: lo avisa su propio registro
      const oe = endOf((id) => o[id]);
      if (!oe || oe < os) continue;
      const days = day(oe < end ? oe : end) - day(start) + 1; // días compartidos desde el ingreso de este registro
      if (days > tol && (!top || days > top.days)) top = { days, o, os, oe };
    }
    if (!top) return null;
    const who = txt(top.o[p.label || 'empresa']), open = !ISO.test(txt(top.o[eF]));
    return { level: p.level || 'warn', message: `Se cruza ${top.days} días con ${who ? 'tu trabajo en ' + who : 'otro trabajo'} (${fmt(top.os)} a ${open ? 'hoy' : fmt(top.oe)}). Si fueron simultáneos, ignora este aviso.` };
  },
  /** Año de 4 cifras entre min y el año actual + maxFuture. */
  year(v, p, ctx) {
    const s = txt(v);
    const lo = p.min ?? 1940, hi = +todayOf(ctx).slice(0, 4) + (p.maxFuture ?? 1);
    if (!/^\d{4}$/.test(s) || +s < lo || +s > hi) return { level: p.level || 'warn', message: `Escribe un año de 4 cifras entre ${lo} y ${hi}.` };
    return null;
  },
  /** Número dentro de [min, max]. */
  range(v, p) {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    if ((p.min != null && n < p.min) || (p.max != null && n > p.max)) {
      return { level: p.level || 'warn', message: p.message || `Revisa el valor: se espera entre ${p.min ?? '−∞'} y ${p.max ?? '∞'}.` };
    }
    return null;
  },
  /** Expresión regular (como texto, para que el schema siga siendo datos). Cumple si el texto la satisface. */
  pattern(v, p) {
    let re;
    try { re = new RegExp(p.re, p.flags || ''); } catch { return null; }
    return re.test(txt(v)) ? null : { level: p.level || 'warn', message: p.message || 'El formato no parece correcto.' };
  },
};

/** Normalizadores al salir del campo (blur). Reciben el texto y devuelven el texto limpio; si no entienden, lo dejan igual. */
export const NORMALIZERS = {
  documento(v, p, ctx) {
    const tipo = txt(ctx?.get?.(p.typeField || 'tipoDocumento')) || 'CC';
    const s = txt(v);
    if (['Pasaporte', 'PEP', 'PPT'].includes(tipo)) return s.replace(/\s+/g, '').toUpperCase();
    return /^[\d.\s-]+$/.test(s) ? s.replace(/[.\s-]/g, '') : s;
  },
  cedula(v) { const s = txt(v); return /^[\d.\s-]+$/.test(s) ? s.replace(/[.\s-]/g, '') : s; },
  celular(v) { const d = phoneDigits(v); return isMobile(d) ? fmtMobile(d) : txt(v); },
  telefono(v) {
    const parts = phoneParts(v);
    if (parts.length !== 1) return txt(v);
    const d = phoneDigits(v);
    if (/[a-z]/i.test(txt(v).replace(/\b(ext|extensi[oó]n|x)\b.*$/i, ''))) return txt(v);
    if (/\b(ext|extensi[oó]n|x)\b/i.test(txt(v))) return txt(v);
    return isMobile(d) ? fmtMobile(d) : landKind(d) ? fmtLandline(d) : txt(v);
  },
  /** Espacios sobrantes y puntuación suelta; "#" y guiones con el formato "Calle 10 # 5-20". No cambia mayúsculas ni abrevia. */
  direccion(v) {
    return txt(v).replace(/\s+/g, ' ').replace(/\s*#\s*/g, ' # ').replace(/(\d)\s*-\s*(\d)/g, '$1-$2').replace(/^[\s,.;]+|[\s,;]+$/g, '').replace(/\s+/g, ' ');
  },
  /** NIT como 900123456-7 (sin puntos ni espacios). Si no se reconoce, se deja igual. */
  nit(v) {
    const m = /^\s*([\d.\s]+?)\s*(?:-\s*(\d))?\s*$/.exec(txt(v));
    return m && digitsOf(m[1]).length >= 8 ? digitsOf(m[1]) + (m[2] !== undefined ? '-' + m[2] : '') : txt(v);
  },
  email(v) { return txt(v).toLowerCase(); },
  pattern(v) { return txt(v); },
};

const specOf = (r) => (typeof r === 'string' ? { rule: r } : r && typeof r === 'object' ? r : null);

/** Incumplimientos de un valor: [{ level, message, rule }], los errores primero. Vacío = []. */
export function check(rules, value, ctx = {}) {
  if (!Array.isArray(rules) || blank(value)) return [];
  const out = [];
  for (const r of rules) {
    const spec = specOf(r), fn = spec && RULES[spec.rule];
    if (!fn) continue;
    let res = null;
    try { res = fn(value, spec, ctx); } catch { res = null; }
    if (res) out.push({ rule: spec.rule, level: spec.level || res.level, message: res.message });
  }
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
}

/** El incumplimiento más grave (error antes que advertencia) o null. */
export const worst = (issues) => (issues && issues.length ? issues[0] : null);

/** Aplica los normalizadores de las reglas (en orden) a un valor de texto. No toca vacíos ni valores que no son texto. */
export function normalize(rules, value, ctx = {}) {
  if (!Array.isArray(rules) || typeof value !== 'string' || blank(value)) return value;
  let v = value;
  for (const r of rules) {
    const spec = specOf(r), fn = spec && NORMALIZERS[spec.rule];
    if (fn) { try { v = fn(v, spec, ctx); } catch { /* se deja el valor */ } }
  }
  return v;
}

/** Incumplimientos de un registro: [{ fieldId, label, level, message, rule }]. */
export function validateRecord(fields, record, ctx = {}) {
  const out = [];
  const c = { ...ctx, get: ctx.get || ((id) => record?.[id]) };
  for (const f of fields || []) {
    if (!f.validate || f.type === 'photo') continue;
    for (const i of check(f.validate, record?.[f.id], c)) out.push({ fieldId: f.id, label: f.label, ...i });
  }
  return out;
}

/** Incumplimientos de todo el perfil según el schema: [{ secId, section, index?, fieldId, label, level, message }].
 *  opts.include(secId, fieldId) -> bool limita a lo que entra en una plantilla.
 *  Los campos y secciones que no aplican según las respuestas (showIf, js/conditions.js) no se validan. */
export function validateProfile(sections, profile, opts = {}) {
  const out = [];
  const root = (s, f) => profile?.[s]?.[f];
  const today = opts.today;
  const V = createVisibility(sections, profile);
  for (const sec of sections || []) {
    if (!V.sectionVisible(sec)) continue;
    const rows = sec.repeatable ? (Array.isArray(profile?.[sec.id]) ? profile[sec.id] : []) : [profile?.[sec.id] || {}];
    rows.forEach((rec, i) => {
      if (!rec || typeof rec !== 'object') return;
      const fields = sec.fields.filter((f) => V.fieldVisible(sec, rec, f) && (!opts.include || opts.include(sec.id, f.id, rec)));
      const others = sec.repeatable ? () => rows.filter((r) => r !== rec) : undefined; // reglas de cruce entre registros (noOverlap)
      for (const x of validateRecord(fields, rec, { root, today, others })) out.push({ secId: sec.id, section: sec.title, ...(sec.repeatable ? { index: i } : {}), ...x });
    });
  }
  return out;
}

/** Texto corto de un incumplimiento de validateProfile para listas. */
export const issueText = (x) => `${x.section}${x.index != null ? ' #' + (x.index + 1) : ''} · ${x.label}: ${x.message}`;

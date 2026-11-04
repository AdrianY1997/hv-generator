// Tiempo servido de un empleo (Minerva: «Total tiempo servido» de cada bloque de experiencia; Formato Único: dato informativo en Perfil).
// Funciones puras, sin DOM. Las usan el render de los modelos y el formulario de Perfil (valor calculado en vivo).
//
// Regla (docs/MODELOS.md, «Tiempo servido»): MESES CALENDARIO completos entre la fecha de ingreso y el día siguiente a la fecha de retiro
// (las dos fechas cuentan, como en los certificados laborales: del 01/01/2015 al 30/06/2017 son 2 años, 6 meses). Un trabajo actual corre
// hasta hoy (incluido). Los días sueltos que no completan un mes no se cuentan; menos de un mes completo es «menos de 1 mes». Fechas al revés
// o incompletas no dan valor (nunca un tiempo negativo). El tiempo TOTAL del Formato Único (sección 4) usa otra convención (meses de 30 días
// sobre la unión de periodos, la de la función pública) y vive en formato-unico.js.

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
/** [año, mes, día] de una fecha AAAA-MM-DD REAL (mes 1-12, día válido para ese mes y año, bisiestos incluidos; años 1900-2100) o null. */
const parts = (iso) => {
  const m = ISO.exec(typeof iso === 'string' ? iso.trim() : '');
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return null;
  return [y, mo, d];
};

/** Meses calendario completos de [inicio, fin] con las dos fechas incluidas, o null si faltan fechas o fin < inicio. */
export function serviceMonths(start, end) {
  const a = parts(start), b = parts(end);
  if (!a || !b) return null;
  const ta = Date.UTC(a[0], a[1] - 1, a[2]), tb = Date.UTC(b[0], b[1] - 1, b[2]);
  if (!Number.isFinite(ta) || !Number.isFinite(tb) || tb < ta) return null;
  const n = new Date(tb + 864e5); // día siguiente al retiro: el último día también se trabajó
  const y = n.getUTCFullYear(), mo = n.getUTCMonth() + 1, d = n.getUTCDate();
  return Math.max(0, (y - a[0]) * 12 + (mo - a[1]) - (d < a[2] ? 1 : 0));
}

/** 30 -> «2 años, 6 meses»; 12 -> «1 año»; 1 -> «1 mes»; 0 -> «menos de 1 mes»; null -> ''. */
export function formatServiceTime(months) {
  if (months == null || !Number.isFinite(months) || months < 0) return '';
  const y = Math.floor(months / 12), m = months % 12;
  if (!y && !m) return 'menos de 1 mes';
  return [y ? `${y} año${y === 1 ? '' : 's'}` : '', m ? `${m} mes${m === 1 ? '' : 'es'}` : ''].filter(Boolean).join(', ');
}

/**
 * Tiempo servido calculado de un registro de experiencia ({fechaInicio, fechaFin, actual}) o '' si no se puede calcular.
 * El trabajo actual (actual === true) corre hasta `today` aunque tenga una fecha de retiro guardada (queda oculta en el formulario).
 */
export function serviceTime(rec, today) {
  if (!rec || typeof rec !== 'object') return '';
  const end = rec.actual === true ? today : rec.fechaFin;
  return formatServiceTime(serviceMonths(rec.fechaInicio, end));
}

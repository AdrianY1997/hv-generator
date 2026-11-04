// Datos compartidos entre modelos de HV (docs/MODELOS.md). Funciones puras, sin DOM.
//
// Regla base: el perfil es UNO solo (hv.profile) y se indexa por `seccion.campo`. Dos modelos que usan el mismo id comparten el dato:
// se escribe una vez y lo ven los dos. Lo propio de un modelo va en ids propios (aditivos): los demás modelos no lo muestran ni lo
// imprimen, pero se conserva (los formularios editan el registro completo, nunca borran claves que no conocen).
//
// Cuando dos formatos piden lo mismo con distinta granularidad (Minerva: «Apellidos» en una casilla; Formato Único: primer y segundo
// apellido), cada uno guarda su forma y `deriveShared` rellena, SOLO AL LEER, lo que esté vacío a partir de la otra forma. Nunca se
// escribe en el perfil guardado ni se pisa un dato escrito: si la persona llena los dos, manda lo que escribió en cada uno.
// Lo usan el render y los faltantes de cada modelo, la vista Perfil (marcador de posición "Se usará: …" y obligatorios pendientes)
// y la Vista previa (nombre del archivo).

const has = (v) => !(v == null || (typeof v === 'string' && v.trim() === ''));
const str = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
const join = (sep, ...xs) => xs.map(str).filter(Boolean).join(sep);

// Partículas que forman parte de un apellido compuesto («de la Torre», «del Río», «San Martín», «van der Berg»).
const PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'lo', 'y', 'e', 'san', 'santa', 'santo', 'van', 'von', 'der', 'den', 'da', 'das', 'do', 'dos', 'di', 'mac', 'mc']);

/** "Pérez Gómez" -> ["Pérez", "Gómez"]; "de la Torre Ruiz" -> ["de la Torre", "Ruiz"]; un solo apellido -> [apellido, ""]. */
export function splitApellidos(full) {
  const words = str(full).split(/\s+/).filter(Boolean);
  if (!words.length) return ['', ''];
  let i = 0;
  while (i < words.length - 1 && PARTICLES.has(words[i].toLowerCase())) i++;
  return [words.slice(0, i + 1).join(' '), words.slice(i + 1).join(' ')];
}

/** Último grado aprobado (Formato Único: 1 a 11) a partir del nivel de Minerva, y al revés. */
const GRADO_DE_NIVEL = { Primaria: '5', 'Bachiller básico': '9', 'Bachiller académico': '11', 'Bachiller técnico': '11' };
export const gradoDeNivel = (nivel) => GRADO_DE_NIVEL[nivel] || '';
export function nivelDeGrado(g) {
  const n = Number(g);
  if (!Number.isInteger(n) || n < 1 || n > 11) return '';
  return n <= 5 ? 'Primaria' : n <= 9 ? 'Bachiller básico' : 'Bachiller académico';
}

/**
 * Equivalencias de lectura: [seccion, destino, (registro) -> valor derivado | '', descripción]. Se aplican solo si el destino está vacío.
 * La descripción la muestra docs/MODELOS.md y las pruebas recorren esta lista (app/tests/modelos.test.mjs).
 */
export const DERIVED = [
  ['personales', 'apellidos', (r) => join(' ', r.primerApellido, r.segundoApellido), 'Primer + segundo apellido (Formato Único) -> Apellidos (Minerva)'],
  ['personales', 'primerApellido', (r) => (has(r.segundoApellido) ? '' : splitApellidos(r.apellidos)[0]), 'Apellidos (Minerva) -> primer apellido: la primera palabra, con sus partículas (de, del, de la, san...)'],
  ['personales', 'segundoApellido', (r) => (has(r.primerApellido) ? '' : splitApellidos(r.apellidos)[1]), 'Apellidos (Minerva) -> segundo apellido: el resto'],
  ['personales', 'lugarNacimiento', (r) => join(', ', r.nacimientoMunicipio, r.nacimientoDepto, r.nacimientoPais), 'Municipio, departamento y país de nacimiento (Formato Único) -> Lugar de nacimiento (Minerva)'],
  ['personales', 'nacimientoMunicipio', (r) => (has(r.nacimientoDepto) || has(r.nacimientoPais) ? '' : str(r.lugarNacimiento)), 'Lugar de nacimiento (Minerva) -> municipio de nacimiento, tal cual'],
  ['personales', 'ciudad', (r) => join(' / ', r.residenciaMunicipio, r.residenciaDepto), 'Municipio / departamento de correspondencia (Formato Único) -> Ciudad / Departamento (Minerva)'],
  ['personales', 'residenciaMunicipio', (r) => (has(r.residenciaDepto) || has(r.residenciaPais) ? '' : str(r.ciudad)), 'Ciudad / Departamento (Minerva) -> municipio de correspondencia, tal cual'],
  ['basica', 'ultimoGrado', (r) => gradoDeNivel(r.nivel), 'Nivel alcanzado (Minerva) -> último grado aprobado: primaria 5.º, bachiller básico 9.º, académico o técnico 11.º'],
  ['basica', 'nivel', (r) => nivelDeGrado(r.ultimoGrado), 'Último grado aprobado (Formato Único) -> nivel: 1.º-5.º primaria, 6.º-9.º bachiller básico, 10.º-11.º bachiller académico'],
];

/**
 * Copia del perfil con los campos compartidos vacíos rellenados desde su equivalente (ver DERIVED). No muta `profile`; las secciones
 * sin cambios conservan su misma referencia. Un perfil sin ninguno de estos datos sale igual (mismo contenido).
 */
export function deriveShared(profile) {
  if (!profile || typeof profile !== 'object') return profile;
  let out = profile;
  for (const [sec, field, fn] of DERIVED) {
    const rec = out[sec];
    if (!rec || typeof rec !== 'object' || Array.isArray(rec) || has(rec[field])) continue;
    const v = fn(profile[sec] || {}); // siempre desde lo escrito, no desde otro derivado (sin cadenas ni ciclos)
    if (!has(v)) continue;
    if (out === profile) out = { ...profile };
    if (out[sec] === profile[sec]) out[sec] = { ...profile[sec] };
    out[sec][field] = v;
  }
  return out;
}

/** Valor derivado de un campo vacío (para el marcador de posición del formulario) o '' si no hay. */
export function derivedValue(profile, secId, fieldId) {
  const rec = profile?.[secId];
  if (!rec || typeof rec !== 'object' || Array.isArray(rec) || has(rec[fieldId])) return '';
  const rule = DERIVED.find(([s, f]) => s === secId && f === fieldId);
  return rule ? str(rule[2](rec)) : '';
}

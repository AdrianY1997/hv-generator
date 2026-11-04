// Modelo "Formato Único de Hoja de Vida - Persona Natural" (Departamento Administrativo de la Función Pública, Leyes 190 de 1995,
// 489 y 443 de 1998). 3 hojas Carta. Réplica 1:1 del PDF oficial: docs/models/formato-unico/ (fuente y versión en
// docs/design/formato-unico-spec.md). La geometría vive en formato-unico-layout.js (generado por docs/design/model-extract.py con las
// cajas de docs/design/formato-unico-fields.json; no editar a mano).
//
// Datos compartidos (docs/MODELOS.md): los campos con el mismo significado que en Minerva usan el mismo id (personales.nombres,
// superior.programa, experiencia.empresa...) y toman su definición de minerva.js (`use`), así el dato se escribe una vez. Lo propio de
// este formato (primer/segundo apellido, lugar de nacimiento desglosado, sector de la entidad, tiempo total...) son ids nuevos.
// Mismo contrato de render que minerva.js: render(profile, template, files) -> HTML con .hv-sheet, .hv-sr, continuación y anexos.
import layout from './formato-unico-layout.js';
import minerva from './minerva.js';
import { normalizeProfile } from '../backup-validate.js';
import { createVisibility, pruneProfile } from '../conditions.js';
import { docsMissing, certGaps } from '../template-check.js';
import { shownDocIds } from '../doc-sources.js';
import { todayIso } from '../validators.js';
import { deriveShared } from './shared-fields.js';
import { createFitLimit } from './layout-fit.js';
import * as K from './sheet-kit.js';

const T = 'text';
const sel = (arr) => arr.map((v) => (Array.isArray(v) ? { value: v[0], label: v[1] } : { value: v, label: v }));
const base = Object.fromEntries(minerva.schema.sections.map((s) => [s.id, Object.fromEntries(s.fields.map((f) => [f.id, f]))]));
/** Campo compartido: la definición de Minerva (tipo, opciones, validadores, condición) con rótulos propios; `undefined` quita una clave. */
function use(sec, id, patch = {}) {
  const f = { ...base[sec][id], ...patch };
  for (const k of Object.keys(f)) if (f[k] === undefined) delete f[k];
  return f;
}
const NIVEL = sel([['Bajo', 'Regular (R)'], ['Medio', 'Bien (B)'], ['Alto', 'Muy bien (MB)']]); // mismos valores que Minerva (Bajo/Medio/Alto)
const MESES = sel(['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'].map((m, i) => [String(i + 1).padStart(2, '0'), `${m} (${String(i + 1).padStart(2, '0')})`]));
const GRADOS = sel(Array.from({ length: 11 }, (_, i) => [String(i + 1), `${i + 1}.º (${i < 5 ? 'primaria' : i < 9 ? 'secundaria' : 'media'})`]));
const MODALIDAD = [['Técnica', 'TC', 'TC (técnica)'], ['Tecnológica', 'TL', 'TL (tecnológica)'], ['Tecnológica especializada', 'TE', 'TE (tecnológica especializada)'],
  ['Profesional', 'UN', 'UN (universitaria)'], ['Especialización', 'ES', 'ES (especialización)'], ['Maestría', 'MG', 'MG (maestría o magíster)'], ['Doctorado', 'DOC', 'DOC (doctorado o PhD)']];
const OCUPACION = [['Servidor público', 'Servidor público'], ['Empleado privado', 'Empleado del sector privado'], ['Independiente', 'Trabajador independiente']];
const manual = { field: 'calculo', equals: 'manual' };
const anios = (id, label) => ({ id, label, type: 'number', validate: [{ rule: 'range', min: 0, max: 70 }], showIf: manual });
const meses = (id, label) => ({ id, label, type: 'number', validate: [{ rule: 'range', min: 0, max: 11 }], showIf: manual });

const sections = [
  { id: 'solicitud', title: 'Entidad receptora y fecha', fields: [
    { id: 'entidadReceptora', label: 'Entidad receptora', type: T, hint: 'Recuadro del encabezado: entidad ante la que se presenta la hoja de vida' },
    use('solicitud', 'fecha', { label: 'Fecha de diligenciamiento', hint: 'Si se deja vacía se usa la fecha de impresión' }),
    { id: 'ciudadDiligenciamiento', label: 'Ciudad de diligenciamiento', type: T, hint: 'Si se deja vacía se usa el municipio de la dirección de correspondencia' },
  ] },
  { id: 'personales', title: '1. Datos personales', fields: [
    { id: 'primerApellido', label: 'Primer apellido', type: T, required: true, hint: 'Tal como aparece en el documento de identificación' },
    { id: 'segundoApellido', label: 'Segundo apellido (o de casada)', type: T },
    use('personales', 'nombres'),
    use('personales', 'tipoDocumento', { label: 'Documento de identificación', hint: 'El formato tiene casillas para C.C., C.E. y pasaporte (PAS); otro tipo se escribe junto al número' }),
    use('personales', 'numeroDocumento'),
    use('personales', 'sexo', { hint: 'El formato marca F o M' }),
    use('personales', 'nacionalidad', { hint: '«Colombiana» marca COL.; otra nacionalidad marca EXTRANJERO' }),
    { id: 'paisNacionalidad', label: 'País (si la nacionalidad es extranjera)', type: T, hint: 'Si se deja vacío se escribe la nacionalidad' },
    use('personales', 'libretaMilitar', { label: 'Libreta militar: número' }),
    use('personales', 'claseLibreta'),
    use('personales', 'distritoMilitar', { label: 'Libreta militar: distrito militar (D.M.)' }),
    use('personales', 'fechaNacimiento'),
    { id: 'nacimientoPais', label: 'Lugar de nacimiento: país', type: T },
    { id: 'nacimientoDepto', label: 'Lugar de nacimiento: departamento', type: T },
    { id: 'nacimientoMunicipio', label: 'Lugar de nacimiento: municipio', type: T },
    use('personales', 'direccion', { label: 'Dirección de correspondencia' }),
    { id: 'residenciaPais', label: 'Correspondencia: país', type: T },
    { id: 'residenciaDepto', label: 'Correspondencia: departamento', type: T },
    { id: 'residenciaMunicipio', label: 'Correspondencia: municipio', type: T },
    use('personales', 'telefono', { hint: 'El formato tiene una sola casilla: si se deja vacío se imprime el celular' }),
    use('personales', 'celular'),
    use('personales', 'correo', { label: 'Correo electrónico (email)' }),
  ] },
  { id: 'basica', title: '2. Formación académica: educación básica y media', fields: [
    { id: 'ultimoGrado', label: 'Último grado aprobado', type: 'select', options: GRADOS, hint: 'Los grados 1.º a 6.º de bachillerato equivalen a los grados 6.º a 11.º de educación básica secundaria y media' },
    use('basica', 'titulo'),
    { id: 'mesGrado', label: 'Fecha de grado: mes', type: 'select', options: MESES },
    use('basica', 'anio', { label: 'Fecha de grado: año', validate: [{ rule: 'year' }, { rule: 'afterBirth', years: 10 }] }),
  ] },
  { id: 'superior', title: '2. Educación superior (pregrado y postgrado)', repeatable: true, certificate: true, fields: [
    use('superior', 'modalidad', { label: 'Modalidad académica', options: MODALIDAD.map(([value, , label]) => ({ value, label })) }),
    use('superior', 'semestres', { label: 'No. de semestres aprobados', showIf: undefined }),
    use('superior', 'graduado'),
    use('superior', 'programa', { label: 'Nombre de los estudios o título obtenido' }),
    use('superior', 'fechaGrado', { label: 'Fecha de terminación', hint: 'Se imprimen el mes y el año', showIf: undefined }),
    use('superior', 'tarjetaProfesional', { label: 'No. de tarjeta profesional', hint: 'Si está prevista en una ley' }),
  ] },
  { id: 'idiomas', title: '2. Idiomas diferentes al español', repeatable: true, certificate: true, fields: [
    use('idiomas', 'idioma'),
    use('idiomas', 'habla', { label: 'Lo habla', options: NIVEL }),
    use('idiomas', 'lee', { label: 'Lo lee', options: NIVEL }),
    use('idiomas', 'escribe', { label: 'Lo escribe', options: NIVEL }),
  ] },
  // serviceTime: true = Perfil muestra el tiempo servido calculado de cada empleo (informativo: este formato no lo pide por empleo; el total va en la sección 4).
  { id: 'experiencia', title: '3. Experiencia laboral', repeatable: true, certificate: true, serviceTime: true, fields: [
    use('experiencia', 'empresa', { label: 'Empresa o entidad' }),
    { id: 'sector', label: 'Tipo de entidad', type: 'select', options: sel(['Pública', 'Privada']) },
    { id: 'pais', label: 'País', type: T },
    { id: 'departamento', label: 'Departamento', type: T },
    { id: 'municipio', label: 'Municipio', type: T },
    { id: 'correoEntidad', label: 'Correo electrónico de la entidad', type: 'email', validate: ['email'] },
    use('experiencia', 'telefono', { label: 'Teléfonos' }),
    use('experiencia', 'fechaInicio', { label: 'Fecha de ingreso' }),
    use('experiencia', 'actual', { label: 'Empleo actual o contrato vigente', hint: 'Va en el primer bloque de la hoja de experiencia; oculta la fecha de retiro' }),
    use('experiencia', 'fechaFin', { label: 'Fecha de retiro' }),
    // `cargo` es el cargo de la persona. Minerva ya no lo muestra (su casilla «Cargo» es la del jefe, `cargoJefe`), así que se define aquí.
    { id: 'cargo', label: 'Cargo o contrato', type: T, required: true },
    { id: 'dependencia', label: 'Dependencia', type: T },
    use('experiencia', 'direccion', { label: 'Dirección' }),
    { id: 'ocupacion', label: 'Ocupación (para el tiempo total de experiencia)', type: 'select', options: sel(OCUPACION), hint: 'Si se deja vacía: entidad pública = servidor público; privada = empleado del sector privado' },
  ] },
  { id: 'tiempoExperiencia', title: '4. Tiempo total de experiencia', fields: [
    { id: 'calculo', label: 'Tiempo total', type: 'select', options: sel([['auto', 'Calcularlo desde la experiencia laboral'], ['manual', 'Escribirlo a mano']]),
      hint: 'Sin elegir se calcula: suma los periodos de cada ocupación sin contar dos veces los tiempos simultáneos (meses de 30 días). Es orientativo: la entidad lo verifica con los certificados.' },
    anios('servidorAnios', 'Servidor público: años'), meses('servidorMeses', 'Servidor público: meses'),
    anios('privadoAnios', 'Empleado del sector privado: años'), meses('privadoMeses', 'Empleado del sector privado: meses'),
    anios('independienteAnios', 'Trabajador independiente: años'), meses('independienteMeses', 'Trabajador independiente: meses'),
  ] },
  { id: 'declaracion', title: '5. Firma del servidor público o contratista', fields: [
    { id: 'inhabilidad', label: 'Manifiesto bajo la gravedad del juramento que (sí / no) me encuentro dentro de las causales de inhabilidad e incompatibilidad del orden constitucional o legal para ejercer cargos o empleos públicos o para celebrar contratos de prestación de servicios con la administración pública',
      type: 'select', options: sel([['Si', 'SÍ me encuentro'], ['No', 'NO me encuentro']]), hint: 'La ciudad y la fecha salen de «Entidad receptora y fecha». La firma se pone a mano sobre la hoja impresa.' },
  ] },
];

// Documentos: los mismos objetos que Minerva, del registro único (doc-sources.js): mismos ids, etiquetas y base legal; un archivo cargado sirve para los dos formatos.
// La declaración de bienes y rentas (`bienesrentas`, propia de la función pública) vive en ese registro.
const documents = [...minerva.schema.documents];

// ---------- Faltantes, anexos ----------
const secById = Object.fromEntries(sections.map((s) => [s.id, s]));
const incField = K.incFieldIn(secById); // misma regla que template-check.fieldIncluded (incluye `replaces`)
const ORDER = { experiencia: K.experienceOrder };

/** N: perfil normalizado con los datos compartidos derivados (shared-fields.js); P: solo lo que aplica; off: ocultos de secciones simples. */
function prep(profile) {
  const N = deriveShared(normalizeProfile(profile, sections));
  const { profile: P, off } = pruneProfile(sections, N);
  return { N, P, off };
}

function missing(profile, template, files) {
  const { N, P } = prep(profile);
  const V = createVisibility(sections, N);
  const t = template || null, out = [];
  for (const sec of sections) {
    if (!K.incSection(t, sec.id) || !V.sectionVisible(sec)) continue;
    const req = sec.fields.filter((f) => f.required && incField(t, sec.id, f.id));
    if (!req.length) continue;
    const rows = sec.repeatable ? K.itemsOf(N, sec.id, t) : [N?.[sec.id] || {}];
    rows.forEach((r, i) => req.filter((f) => V.fieldVisible(sec, r, f)).forEach((f) => { if (!K.has(r[f.id])) out.push(`${sec.title}${sec.repeatable ? ' #' + (i + 1) : ''}: ${f.label}`); }));
  }
  if (t) {
    const shown = new Set(shownDocIds(P, documents.map((x) => x.id)));
    const count = (id) => (Array.isArray(P?.documents?.[id]) ? P.documents[id] : []).filter((fid) => K.getFile(files, fid)).length;
    for (const id of docsMissing(t, documents.map((d) => d.id), count)) out.push(`Documento: ${documents.find((d) => d.id === id).label}${shown.has(id) ? '' : ' (oculto en Documentos)'}`);
    for (const g of certGaps(sections, t, P, (id) => !!K.getFile(files, id), ['field', 'section'])) out.push(`Certificado sin archivo: ${g.title}${g.kind === 'field' ? ' · ' + g.label : ''}`);
  }
  return out;
}

// ---------- Tiempo total de experiencia (sección 4) ----------
const dayOf = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5 : null; };
/** Días de la unión de intervalos [inicio, fin] (inclusivos): lo simultáneo cuenta una vez. */
function unionDays(list) {
  const iv = list.filter(([a, b]) => a != null && b != null && b >= a).sort((x, y) => x[0] - y[0]);
  let total = 0, cur = null;
  for (const [a, b] of iv) {
    if (cur && a <= cur[1] + 1) cur[1] = Math.max(cur[1], b);
    else { if (cur) total += cur[1] - cur[0] + 1; cur = [a, b]; }
  }
  if (cur) total += cur[1] - cur[0] + 1;
  return total;
}
const ymOf = (months) => ({ years: Math.floor(months / 12), months: months % 12 });
/** Categoría de un registro para la sección 4 (ocupación explícita o, si falta, por el tipo de entidad). */
export const ocupacionDe = (it) => it?.ocupacion || (it?.sector === 'Pública' ? 'Servidor público' : it?.sector === 'Privada' ? 'Empleado privado' : '');

/**
 * Tiempo total por ocupación: { 'Servidor público'|'Empleado privado'|'Independiente': {years,months}|null, total: {years,months}|null }.
 * Meses de 30 días sobre la unión de periodos (convención de la función pública para certificar experiencia). Un trabajo actual corre
 * hasta `today`. Los registros sin fecha de ingreso, o sin retiro y sin marcar «actual», no suman. Sin ocupación ni tipo de entidad
 * solo suman al total.
 */
export function experienceTotals(items, today = todayIso()) {
  const per = { 'Servidor público': [], 'Empleado privado': [], Independiente: [] }, all = [];
  for (const it of items || []) {
    const a = dayOf(it?.fechaInicio), b = dayOf(it?.fechaFin || (it?.actual === true ? today : ''));
    if (a == null || b == null || b < a) continue;
    all.push([a, b]);
    const k = ocupacionDe(it);
    if (per[k]) per[k].push([a, b]);
  }
  const out = {};
  for (const [k, list] of Object.entries(per)) out[k] = list.length ? ymOf(Math.floor(unionDays(list) / 30)) : null;
  out.total = all.length ? ymOf(Math.floor(unionDays(all) / 30)) : null;
  return out;
}
/** Tiempo total escrito a mano (modo manual). */
function manualTotals(tx) {
  const n = (v) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Math.max(0, Math.floor(Number(v))) : null);
  const row = (a, m) => (n(tx[a]) == null && n(tx[m]) == null ? null : (n(tx[a]) || 0) * 12 + (n(tx[m]) || 0));
  const rows = { 'Servidor público': row('servidorAnios', 'servidorMeses'), 'Empleado privado': row('privadoAnios', 'privadoMeses'), Independiente: row('independienteAnios', 'independienteMeses') };
  const out = {};
  for (const [k, v] of Object.entries(rows)) out[k] = v == null ? null : ymOf(v);
  const vals = Object.values(rows).filter((v) => v != null);
  out.total = vals.length ? ymOf(vals.reduce((s, v) => s + v, 0)) : null;
  return out;
}

// ---------- Mapa campo -> caja (formato-unico-layout.js) ----------
const ln = (p, key, reserve) => ({ mode: 'line', boxes: [[p, key]], ...(reserve ? { reserve } : {}) });
const FIT = {
  'solicitud.entidadReceptora': ln(0, 'ent'), 'solicitud.ciudadDiligenciamiento': ln(2, 'ciudadFecha', 12),
  'personales.primerApellido': ln(0, 'ape1'), 'personales.segundoApellido': ln(0, 'ape2'), 'personales.nombres': ln(0, 'nom'),
  'personales.numeroDocumento': ln(0, 'docNo'), 'personales.nacionalidad': ln(0, 'nacPais'), 'personales.paisNacionalidad': ln(0, 'nacPais'),
  'personales.libretaMilitar': ln(0, 'libNo'), 'personales.distritoMilitar': ln(0, 'libDm'),
  'personales.nacimientoPais': ln(0, 'nPais'), 'personales.nacimientoDepto': ln(0, 'nDep'), 'personales.nacimientoMunicipio': ln(0, 'nMun'),
  'personales.direccion': ln(0, 'dir'), 'personales.residenciaPais': ln(0, 'rPais'), 'personales.residenciaDepto': ln(0, 'rDep'), 'personales.residenciaMunicipio': ln(0, 'rMun'),
  'personales.telefono': ln(0, 'tel'), 'personales.celular': ln(0, 'tel'), 'personales.correo': ln(0, 'mail'),
  'basica.titulo': ln(0, 'bTit'), 'superior.programa': ln(0, 's0nom'), 'superior.tarjetaProfesional': ln(0, 's0tp'), 'idiomas.idioma': ln(0, 'i0nom'),
  'experiencia.empresa': ln(1, 'e0emp'), 'experiencia.pais': ln(1, 'e0pais'), 'experiencia.departamento': ln(1, 'e0dep'), 'experiencia.municipio': ln(1, 'e0mun'),
  'experiencia.correoEntidad': ln(1, 'e0mail'), 'experiencia.telefono': ln(1, 'e0tel'), 'experiencia.cargo': ln(1, 'e0car'), 'experiencia.dependencia': ln(1, 'e0dpd'), 'experiencia.direccion': ln(1, 'e0dir'),
};
const fitLimit = createFitLimit(layout, FIT);

/** Capacidades del formato: casillas por sección repetible y hojas de experiencia (las demás van a la hoja de continuación). */
export const CAPACITY = { superior: 5, idiomas: 2, experienciaPorHoja: 4, experienciaAnterioresPorHoja: 3 };
const COL = /colombi/i;
/** Sí/No explícitos de un campo (casilla booleana o texto): lo no definido no es ni uno ni otro. */
const isYes = (x) => x === true || (typeof x === 'string' && /^s[ií]$/i.test(x.trim()));
const isNo = (x) => x === false || (typeof x === 'string' && /^no$/i.test(x.trim()));

function renderForm(P, t, today) {
  const get = (sec, id) => (K.incSection(t, sec) && incField(t, sec, id) ? P?.[sec]?.[id] : undefined);
  const items = (sec) => (K.incSection(t, sec) ? K.itemsOf(P, sec, t).filter(K.filled(secById[sec])) : []); // un registro vacío no ocupa un bloque
  const fv = (sec, it, id) => (incField(t, sec, id) ? it?.[id] : undefined);
  const overflow = [];

  // ---- Hoja 1: datos personales y formación académica ----
  const s0 = K.sheetWriter(layout.pages[0]);
  const per = (id) => get('personales', id);
  s0.text('ent', get('solicitud', 'entidadReceptora'));
  s0.text('ape1', per('primerApellido')); s0.text('ape2', per('segundoApellido')); s0.text('nom', per('nombres'));
  const td = per('tipoDocumento');
  s0.mark('cc', td === 'CC'); s0.mark('ce', td === 'CE'); s0.mark('pas', td === 'Pasaporte');
  s0.text('docNo', K.has(per('numeroDocumento')) && K.has(td) && !['CC', 'CE', 'Pasaporte'].includes(td) ? `${td} ${per('numeroDocumento')}` : per('numeroDocumento'));
  s0.mark('sf', per('sexo') === 'F'); s0.mark('sm', per('sexo') === 'M');
  const nac = per('nacionalidad');
  if (K.has(nac)) { s0.mark('col', COL.test(nac)); s0.mark('ext', !COL.test(nac)); }
  s0.text('nacPais', per('paisNacionalidad') || (K.has(nac) && !COL.test(nac) ? nac : ''));
  s0.mark('lib1', per('claseLibreta') === 'Primera clase'); s0.mark('lib2', per('claseLibreta') === 'Segunda clase');
  s0.text('libNo', per('libretaMilitar')); s0.text('libDm', per('distritoMilitar'));
  const [nd, nm, na] = K.ymd(per('fechaNacimiento'));
  s0.digits('fnD', nd, 2); s0.digits('fnM', nm, 2); s0.digits('fnA', na, 4);
  s0.text('nPais', per('nacimientoPais')); s0.text('nDep', per('nacimientoDepto')); s0.text('nMun', per('nacimientoMunicipio'));
  s0.text('dir', per('direccion')); s0.text('rPais', per('residenciaPais')); s0.text('rDep', per('residenciaDepto')); s0.text('rMun', per('residenciaMunicipio'));
  s0.text('tel', per('telefono') || per('celular')); s0.text('mail', per('correo'));
  const bas = (id) => get('basica', id);
  const g = Number(bas('ultimoGrado'));
  if (Number.isInteger(g) && g >= 1 && g <= 11) s0.mark('g' + g);
  s0.text('bTit', bas('titulo'));
  s0.digits('bMes', bas('mesGrado'), 2); s0.digits('bAnio', K.has(bas('anio')) ? String(bas('anio')) : '', 4);

  const sup = items('superior');
  sup.slice(0, CAPACITY.superior).forEach((it, r) => {
    const v = (id) => fv('superior', it, id);
    s0.text(`s${r}mod`, MODALIDAD.find((m) => m[0] === v('modalidad'))?.[1] || v('modalidad'), { align: 'center' });
    s0.text(`s${r}sem`, v('semestres'), { align: 'center' });
    // «Graduado» es una casilla (marcada = sí): un valor sin definir NO imprime NO. Se marca SÍ solo con true y NO solo con un false/«no» explícito.
    if (incField(t, 'superior', 'graduado')) { const gr = v('graduado'); if (isYes(gr)) s0.mark(`s${r}si`); else if (isNo(gr)) s0.mark(`s${r}no`); }
    s0.text(`s${r}nom`, v('programa'));
    const [, mm, yy] = K.ymd(v('fechaGrado'));
    s0.text(`s${r}mes`, mm, { align: 'center' }); s0.digits(`s${r}anio`, yy, 4);
    s0.text(`s${r}tp`, v('tarjetaProfesional'), { align: 'center' });
  });
  if (sup.length > CAPACITY.superior) overflow.push({ sec: 'superior', list: sup.slice(CAPACITY.superior) });

  const LV = { Bajo: 0, Medio: 1, Alto: 2 };
  const idi = items('idiomas');
  idi.slice(0, CAPACITY.idiomas).forEach((it, r) => {
    s0.text(`i${r}nom`, fv('idiomas', it, 'idioma'));
    [['habla', 'h'], ['lee', 'l'], ['escribe', 'e']].forEach(([f, k]) => { const lv = LV[fv('idiomas', it, f)]; if (lv !== undefined) s0.mark(`i${r}${k}${lv}`); });
  });
  if (idi.length > CAPACITY.idiomas) overflow.push({ sec: 'idiomas', list: idi.slice(CAPACITY.idiomas) });

  // ---- Hoja 2: experiencia laboral. "Si requiere adicionar más experiencia laboral, imprima nuevamente esta hoja": una hoja por cada
  // 3 empleos anteriores. El bloque superior ("empleo actual o contrato vigente") solo lleva trabajos marcados como actuales. ----
  const exp = items('experiencia').sort(K.experienceOrder);
  const cur = exp.filter((it) => it.actual === true), prev = exp.filter((it) => it.actual !== true);
  const nSheets = Math.max(1, cur.length, Math.ceil(prev.length / CAPACITY.experienciaAnterioresPorHoja));
  const expSheets = [];
  for (let k = 0; k < nSheets; k++) {
    const w = K.sheetWriter(layout.pages[1]);
    [cur[k], ...prev.slice(k * 3, k * 3 + 3)].forEach((it, b) => {
      if (!it) return;
      const v = (id) => fv('experiencia', it, id), e = 'e' + b;
      w.text(e + 'emp', v('empresa'));
      w.mark(e + 'pub', v('sector') === 'Pública'); w.mark(e + 'pri', v('sector') === 'Privada');
      w.text(e + 'pais', v('pais')); w.text(e + 'dep', v('departamento')); w.text(e + 'mun', v('municipio')); w.text(e + 'mail', v('correoEntidad'));
      w.text(e + 'tel', v('telefono'));
      const [id1, im, ia] = K.ymd(v('fechaInicio')), [rd, rm, ra] = K.ymd(v('fechaFin'));
      w.digits(e + 'iD', id1, 2); w.digits(e + 'iM', im, 2); w.digits(e + 'iA', ia, 4);
      w.digits(e + 'rD', rd, 2); w.digits(e + 'rM', rm, 2); w.digits(e + 'rA', ra, 4);
      w.text(e + 'car', v('cargo')); w.text(e + 'dpd', v('dependencia')); w.text(e + 'dir', v('direccion'));
    });
    expSheets.push(w);
  }

  // ---- Hoja 3: tiempo total, declaración, ciudad y fecha ----
  const s2 = K.sheetWriter(layout.pages[2]);
  const totals = tiempoTotal(P, t, exp, today);
  if (totals) {
    [['Servidor público', 'Sp'], ['Empleado privado', 'Pr'], ['Independiente', 'Ti'], ['total', 'To']].forEach(([k, key]) => {
      const v = totals[k];
      if (v) { s2.text(`t${key}A`, String(v.years), { align: 'center' }); s2.text(`t${key}M`, String(v.months), { align: 'center' }); }
    });
  }
  const inh = get('declaracion', 'inhabilidad');
  s2.mark('inhSi', inh === 'Si'); s2.mark('inhNo', inh === 'No');
  if (K.incSection(t, 'solicitud')) {
    const fecha = get('solicitud', 'fecha') || today;
    const ciudad = get('solicitud', 'ciudadDiligenciamiento') || get('personales', 'residenciaMunicipio'); // incField respetado en el respaldo
    s2.text('ciudadFecha', [ciudad, K.fmtDate(fecha)].filter(K.has).join(', '));
  }
  return { sheets: [[0, s0], ...expSheets.map((w) => [1, w]), [2, s2]], overflow, totals };
}

/** Tiempo total que se imprime (null = la sección no va en esta plantilla). */
function tiempoTotal(P, t, exp, today) {
  if (!K.incSection(t, 'tiempoExperiencia')) return null;
  // Solo cuentan los campos que la plantilla incluye (un campo desmarcado no se imprime ni por el modo manual).
  const raw = P?.tiempoExperiencia || {}, tx = {};
  for (const k of Object.keys(raw)) if (incField(t, 'tiempoExperiencia', k)) tx[k] = raw[k];
  return tx.calculo === 'manual' ? manualTotals(tx) : experienceTotals(exp, today);
}

const fmtYM = (v) => (v ? `${v.years} año${v.years === 1 ? '' : 's'} y ${v.months} mes${v.months === 1 ? '' : 'es'}` : '');

/** render(profile, template, files, opts) · opts.annex = { certificates?, documents? } (interruptores de la Vista previa, sheet-kit.js annexFlags). */
function render(profile, template, files, opts = {}) {
  const t = template || null, { P, off } = prep(profile);
  const today = todayIso();
  const { sheets, overflow, totals } = renderForm(P, t, today);
  const spill = new Set(overflow.flatMap((o) => o.list));
  // La lectura lineal sigue lo impreso: el tiempo total va calculado (no los campos del modo manual) y la ciudad y fecha con sus respaldos.
  const custom = (sec) => {
    if (sec.id === 'tiempoExperiencia') {
      if (!totals) return '';
      const rows = [['Servidor público', 'Servidor público'], ['Empleado privado', 'Empleado del sector privado'], ['Independiente', 'Trabajador independiente'], ['total', 'Total tiempo experiencia']]
        .filter(([k]) => totals[k]).map(([k, label]) => `<dt>${K.esc(label)}</dt><dd>${K.esc(fmtYM(totals[k]))}</dd>`);
      return rows.length ? `<div role="group" aria-label="${K.esc(sec.title)}"><dl>${rows.join('')}</dl></div>` : '';
    }
    return null;
  };
  let html = K.a11yBlock(sections, P, t, { spill, custom, order: ORDER })
    + sheets.map(([i, w], n) => K.sheetHtml(layout, i, w, i === 1 && sheets.filter(([j]) => j === 1).length > 1 ? ` data-copy="${n}"` : '')).join('')
    + K.continuation(secById, overflow, t, { title: 'FORMATO ÚNICO HOJA DE VIDA <small>información adicional</small>', note: 'Registros que exceden el espacio previsto en el formato (el instructivo indica utilizar una hoja en blanco).' });
  html += K.annexHtml(K.annexes({ sections, documents }, P, t, files, off, ORDER, opts.annex));
  return `<div class="hv-doc">${html}</div>`;
}

const ANY_FILE = new Proxy({}, { get: () => ({}) });

export default {
  id: 'formato-unico',
  name: 'Formato Único de Hoja de Vida - Persona Natural (Función Pública)',
  schema: { sections, documents },
  /** Qué ofrece el formato además del contrato básico (plantillas: sin foto ni objetivo en este formato). */
  features: { photo: false, objective: false },
  render,
  fitLimit,
  missing,
  fileIds(profile, template, opts = {}) {
    const t = template || null, { P, off } = prep(profile);
    return K.annexes({ sections, documents }, P, t, ANY_FILE, off, ORDER, opts.annex).map((a) => a.id);
  },
  annexList(profile, template, files, opts = {}) {
    const { P, off } = prep(profile);
    return K.annexes({ sections, documents }, P, template || null, files, off, ORDER, opts.annex);
  },
  annexInfo(profile, template, files, opts = {}) {
    const { P, off } = prep(profile);
    return K.annexSummary(K.annexes({ sections, documents }, P, template || null, files, off, ORDER, opts.annex));
  },
};

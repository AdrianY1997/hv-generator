// Modelo "Hoja de Vida para solicitud de empleo" (formato Minerva / LIBRE, 4 páginas Carta). 100% declarativo.
// field: {id,label,type,required?,options?,hint?,certificate?,validate?}
//   type: text|textarea|date|email|tel|number|select|photo|checkbox|multiselect
//   validate: reglas de js/validators.js ('celular', { rule:'notBefore', other:'fechaInicio' }, ...); avisan, nunca bloquean el guardado.
// section: {id,title,repeatable?,certificate?,fields[]}  (certificate=true => admite adjunto por ítem)
//   showIf (clave aditiva, en campos y secciones): condición declarativa de visibilidad ({ field, equals|not|in|... }); ver js/conditions.js y docs/CONDICIONALES.md.
//     Un campo oculto no se valida, no se imprime y no cuenta como pendiente; su valor se conserva en el perfil.
// schema: { sections, documents, photo? }  photo = { aspect, width, height, maxKB } (todo opcional): formato inicial del editor de foto.
// El render reproduce docs/minerva.pdf (geometría en minerva-layout.js, generada por docs/design/minerva-extract.py).
import { escapeHtml as esc } from '../ui.js';
import layout from './minerva-layout.js';
import { shownDocIds } from '../doc-sources.js';
import { docSelected, docsMissing, certGaps } from '../template-check.js';
import { normalizeProfile, isAllowedImageType } from '../backup-validate.js';
import { createVisibility, pruneProfile } from '../conditions.js';
import { fitCapacity } from './minerva-fit.js';
import { todayIso } from '../validators.js';
const T = 'text';
const sel = (arr) => arr.map((v) => (Array.isArray(v) ? { value: v[0], label: v[1] } : { value: v, label: v }));
const doc = (id, label, hint = '') => ({ id, label, hint });
const YN = sel([['Si', 'Sí'], ['No', 'No']]);
const RBMB = sel([['R', 'Regular (R)'], ['B', 'Bien (B)'], ['MB', 'Muy bien (MB)']]);
const yn = (id, label) => ({ id, label, type: 'select', options: YN });

// Opciones de "V. Trayectoria por empresas": [etiqueta, casilla del PDF]
const SECTORES = [
  ['AGRICULTURA', 'c47'], ['GANADERIA / AVICULTURA', 'c48'], ['MINERIA', 'c49'], ['HIDROCARBUROS', 'c50'], ['INDUSTRIA', 'c51'],
  ['Alimentos y Bebidas', 'c52'], ['Tabaco', 'c53'], ['Textiles y Confecciones', 'c54'], ['Cuero y Calzado', 'c55'], ['Papel y Cartón', 'c56'],
  ['Editorial y Artes Gráficas', 'c57'], ['Químico y Farmacéutico', 'c58'], ['Caucho y Plástico', 'c59'], ['Vidrio, Cerámica y Cemento', 'c60'],
  ['Metalurgia', 'c61'], ['Maquinaria', 'c62'], ['Automotores', 'c63'], ['Muebles', 'c64'], ['Reciclaje', 'c65'], ['Industria: otros', 'c66'],
  ['ELECTRICIDAD / GAS / AGUA', 'c69'], ['CONSTRUCCION', 'c70'], ['COMERCIO', 'c71'], ['HOTELES Y RESTAURANTES', 'c72'],
  ['TRANSPORTE Y ALMACENAMIENTO', 'c73'], ['COMUNICACIONES', 'c74'],
  ['FINANCIERO', 'c82'], ['INMOBILIARIO', 'c81'], ['INFORMATICO', 'c80'], ['SALUD', 'c79'], ['EDUCACION', 'c75'], ['SEGUROS', 'c78'],
  ['TURISMO / RECREACION', 'c77'], ['OTROS SERVICIOS', 'c76'], ['Asesorías Profesionales', 'c83'], ['Servicios Temporales', 'c84'],
  ['Seguridad Vigilancia', 'c85'], ['OTROS SECTORES', 'c86'],
];
const AREAS = [
  ['Administración', 'c97'], ['Auditoría', 'c96'], ['Bodega', 'c95'], ['Compras', 'c94'], ['Contabilidad', 'c89'], ['Costos', 'c93'],
  ['Crédito y Cobranzas', 'c92'], ['Diseño', 'c91'], ['Finanzas', 'c90'], ['Gerencia General', 'c98'], ['Impuestos', 'c99'], ['Mercadeo', 'c100'],
  ['Producción', 'c101'], ['Publicidad', 'c102'], ['Personal', 'c106'], ['Sistemas', 'c105'], ['Tesorería', 'c104'], ['Otras áreas', 'c103'],
];
const opt = (list) => list.map(([v]) => ({ value: v, label: v }));

const sections = [
  { id: 'solicitud', title: 'Solicitud de empleo', fields: [
    { id: 'fecha', label: 'Fecha de la solicitud', type: 'date', hint: 'Si se deja vacía se usa la fecha de impresión' },
    { id: 'cargoInteres', label: 'Empleo o cargo en el que está interesado', type: T },
    { id: 'codigoCargo', label: 'Código cargo', type: T },
  ] },
  { id: 'personales', title: 'I. Información general', fields: [
    { id: 'foto', label: 'Fotografía', type: 'photo', hint: 'Fondo claro, rostro visible' },
    { id: 'nombres', label: 'Nombres', type: T, required: true },
    { id: 'apellidos', label: 'Apellidos', type: T, required: true },
    { id: 'tipoDocumento', label: 'Tipo de documento', type: 'select', required: true, options: sel(['CC', 'CE', 'TI', 'PEP', 'PPT', 'Pasaporte']) },
    { id: 'numeroDocumento', label: 'Número de documento', type: T, required: true, validate: [{ rule: 'documento' }] },
    { id: 'expedidaEn', label: 'Documento expedido en', type: T },
    { id: 'lugarNacimiento', label: 'Lugar de nacimiento', type: T },
    { id: 'fechaNacimiento', label: 'Fecha de nacimiento', type: 'date', validate: ['notFuture', 'edad'] },
    { id: 'nacionalidad', label: 'Nacionalidad', type: T },
    { id: 'sexo', label: 'Sexo', type: 'select', options: sel([['F', 'Femenino'], ['M', 'Masculino'], ['O', 'Otro']]) },
    { id: 'estadoCivil', label: 'Estado civil', type: 'select', options: sel(['Soltero(a)', 'Casado(a)', 'Unión libre', 'Separado(a)', 'Divorciado(a)', 'Viudo(a)']) },
    { id: 'libretaMilitar', label: 'Libreta militar (número / clase / distrito)', type: T, certificate: true, validate: [{ rule: 'pattern', re: '\d{5,}', message: 'Incluye el número de la libreta (al menos 5 dígitos).' }], showIf: { field: 'sexo', not: 'F' } },
    { id: 'claseLibreta', label: 'Libreta militar: clase', type: 'select', options: sel(['Primera clase', 'Segunda clase']), showIf: { allOf: [{ field: 'sexo', not: 'F' }, { field: 'libretaMilitar', notEmpty: true }] } },
    { id: 'distritoMilitar', label: 'Libreta militar: distrito', type: T, showIf: { allOf: [{ field: 'sexo', not: 'F' }, { field: 'libretaMilitar', notEmpty: true }] } },
    { id: 'licenciaConduccion', label: 'Licencia de conducción (categoría)', type: T, certificate: true, validate: [{ rule: 'pattern', re: '\b(A1|A2|B1|B2|B3|C1|C2|C3)\b', flags: 'i', message: 'No se reconoce la categoría: usa A1, A2, B1, B2, B3, C1, C2 o C3.' }] },
    { id: 'licenciaNumero', label: 'Licencia de conducción: número', type: T, validate: [{ rule: 'pattern', re: '^[A-Za-z0-9 .-]{5,20}$', message: 'El número de la licencia lleva entre 5 y 20 letras o dígitos.' }], showIf: { field: 'licenciaConduccion', notEmpty: true } },
    yn('tieneVehiculo', '¿Tiene vehículo?'),
    { id: 'tarjetaProfesional', label: 'Tarjeta profesional No.', type: T },
    { id: 'profesion', label: 'Profesión, ocupación u oficio', type: T },
    { id: 'aniosExperiencia', label: 'Años de experiencia laboral', type: T },
    { id: 'direccion', label: 'Dirección de residencia / barrio', type: T, validate: ['direccion'] },
    { id: 'ciudad', label: 'Ciudad / Departamento', type: T },
    { id: 'telefono', label: 'Teléfono', type: 'tel', validate: ['telefono'] },
    { id: 'celular', label: 'No. celular', type: 'tel', validate: ['celular'] },
    { id: 'correo', label: 'Correo electrónico', type: 'email', validate: ['email'] },
    { id: 'perfil', label: 'Perfil profesional (se usa como objetivo si la plantilla no define uno)', type: 'textarea' },
  ] },
  { id: 'infopersonal', title: 'II. Información personal', fields: [
    yn('trabajaActualmente', '¿Está trabajando actualmente?'),
    { id: 'empresaActual', label: '¿En qué empresa?', type: T, showIf: { field: 'trabajaActualmente', equals: 'Si' } },
    { id: 'vinculacionActual', label: 'Vinculación actual', type: 'select', options: sel(['Empleado', 'Independiente']), showIf: { field: 'trabajaActualmente', equals: 'Si' } },
    { id: 'tipoContratoActual', label: 'Tipo de contrato', type: T, showIf: { field: 'trabajaActualmente', equals: 'Si' } },
    yn('trabajoAntes', '¿Trabajó antes en esta empresa?'),
    yn('solicitoAntes', '¿Solicitó empleo antes en esta empresa?'),
    { id: 'fechaSolicitudAnterior', label: 'Fecha de la solicitud anterior', type: 'date', validate: [{ rule: 'notFuture', level: 'warn' }], showIf: { field: 'solicitoAntes', equals: 'Si' } },
    yn('recomendado', '¿Lo recomienda alguien de esta empresa?'),
    { id: 'recomendadoNombre', label: 'Quién lo recomienda: nombre', type: T, showIf: { field: 'recomendado', equals: 'Si' } },
    { id: 'recomendadoDependencia', label: 'Quién lo recomienda: dependencia', type: T, showIf: { field: 'recomendado', equals: 'Si' } },
    yn('parientes', '¿Tiene parientes que trabajan en esta empresa?'),
    { id: 'parientesNombre', label: 'Parientes: nombre', type: T, showIf: { field: 'parientes', equals: 'Si' } },
    { id: 'parientesDependencia', label: 'Parientes: dependencia', type: T, showIf: { field: 'parientes', equals: 'Si' } },
    { id: 'comoSupo', label: '¿Cómo tuvo conocimiento de la existencia de la vacante?', type: 'select', options: sel(['Anuncio', 'Amigo', 'Por medio de agencia', 'Otro']) },
    { id: 'comoSupoOtro', label: 'Otro medio (¿cuál?)', type: T, showIf: { field: 'comoSupo', equals: 'Otro' } },
    { id: 'ciudadVivida', label: '¿En qué ciudad o población ha vivido la mayor parte de su vida?', type: T },
    { id: 'ciudadesTrabajadas', label: '¿En qué ciudades o regiones del país ha trabajado?', type: T },
    yn('aceptaOtraCiudad', '¿Aceptaría trabajar en una ciudad o sitio distinto al inicialmente contratado?'),
    { id: 'vivienda', label: 'Vive en casa', type: 'select', options: sel(['Propia', 'Familiar', 'Alquilada']) },
    { id: 'arrendador', label: 'Nombre del arrendador', type: T, showIf: { field: 'vivienda', equals: 'Alquilada' } },
    { id: 'arrendadorTelefono', label: 'Teléfono del arrendador', type: 'tel', validate: ['telefono'], showIf: { field: 'vivienda', equals: 'Alquilada' } },
    { id: 'tiempoResidencia', label: '¿Hace cuánto tiempo reside en este lugar?', type: T },
    yn('ingresoAdicional', '¿Actualmente tiene algún ingreso adicional?'),
    { id: 'ingresoDescripcion', label: 'Descríbalo e indique su valor mensual', type: T, showIf: { field: 'ingresoAdicional', equals: 'Si' } },
    { id: 'ingresoConceptos', label: '¿Por qué conceptos?', type: T, showIf: { field: 'ingresoAdicional', equals: 'Si' } },
    { id: 'obligacionesMensuales', label: '¿Cuánto suman sus obligaciones económicas mensuales? ($)', type: T },
    { id: 'aspiracionSalarial', label: '¿Cuánto es su aspiración salarial? ($)', type: T },
    { id: 'aficiones', label: '¿Cuál(es) es(son) su(s) principal(es) afición(es)?', type: T },
    yn('practicaDeporte', '¿Practica algún deporte?'),
    { id: 'deporteCual', label: 'Deporte: ¿cuál(es)?', type: T, showIf: { field: 'practicaDeporte', equals: 'Si' } },
    yn('distinciones', '¿Ha obtenido distinciones o reconocimientos por su desempeño en actividades deportivas, culturales, sociales?'),
    { id: 'distincionesCual', label: 'Distinciones: ¿cuál(es)?', type: T, showIf: { field: 'distinciones', equals: 'Si' } },
    yn('asociacion', '¿Pertenece a algún tipo de asociación comunitaria, deportiva, cultural?'),
    { id: 'asociacionCual', label: 'Asociación: ¿cuál(es)?', type: T, showIf: { field: 'asociacion', equals: 'Si' } },
  ] },
  { id: 'familiar', title: 'III. Información familiar', fields: [
    { id: 'conyugeNombre', label: 'Nombre esposa(o) o compañera(o)', type: T, showIf: { field: 'personales.estadoCivil', in: ['Casado(a)', 'Unión libre'] } },
    { id: 'conyugeProfesion', label: 'Profesión, ocupación u oficio', type: T, showIf: { field: 'personales.estadoCivil', in: ['Casado(a)', 'Unión libre'] } },
    { id: 'conyugeEmpresa', label: 'Empresa donde trabaja', type: T, showIf: { field: 'personales.estadoCivil', in: ['Casado(a)', 'Unión libre'] } },
    { id: 'conyugeCargo', label: 'Cargo actual', type: T, showIf: { field: 'personales.estadoCivil', in: ['Casado(a)', 'Unión libre'] } },
    { id: 'conyugeDireccion', label: 'Dirección', type: T, validate: ['direccion'], showIf: { field: 'personales.estadoCivil', in: ['Casado(a)', 'Unión libre'] } },
    { id: 'conyugeTelefono', label: 'Teléfono', type: 'tel', validate: ['telefono'], showIf: { field: 'personales.estadoCivil', in: ['Casado(a)', 'Unión libre'] } },
    { id: 'conyugeCiudad', label: 'Ciudad', type: T, showIf: { field: 'personales.estadoCivil', in: ['Casado(a)', 'Unión libre'] } },
    { id: 'personasACargo', label: 'N.º de personas que dependen económicamente del solicitante', type: 'number', validate: [{ rule: 'range', min: 0, max: 20 }] },
    { id: 'parentescoDependientes', label: 'Parentesco', type: T, showIf: { field: 'personasACargo', gt: 0 } },
    { id: 'edadesDependientes', label: 'Edades', type: T, showIf: { field: 'personasACargo', gt: 0 } },
    { id: 'padreNombre', label: 'Nombre del padre', type: T },
    { id: 'padreProfesion', label: 'Padre: profesión, ocupación u oficio', type: T },
    { id: 'padreTelefono', label: 'Padre: teléfono', type: 'tel', validate: ['telefono'] },
    { id: 'madreNombre', label: 'Nombre de la madre', type: T },
    { id: 'madreProfesion', label: 'Madre: profesión, ocupación u oficio', type: T },
    { id: 'madreTelefono', label: 'Madre: teléfono', type: 'tel', validate: ['telefono'] },
  ] },
  { id: 'hermanos', title: 'III. Hermanos', repeatable: true, fields: [
    { id: 'nombre', label: 'Nombre del hermano(a)', type: T, required: true },
    { id: 'profesion', label: 'Profesión, ocupación u oficio', type: T },
    { id: 'telefono', label: 'Teléfono', type: 'tel', validate: ['telefono'] },
  ] },
  { id: 'basica', title: 'IV. Educación básica y media', fields: [
    { id: 'nivel', label: 'Nivel alcanzado', type: 'select', options: sel(['Primaria', 'Bachiller básico', 'Bachiller académico', 'Bachiller técnico']) },
    { id: 'institucion', label: 'Institución', type: T },
    { id: 'ciudad', label: 'Ciudad', type: T },
    { id: 'anio', label: 'Año de grado', type: 'number', validate: [{ rule: 'year' }, { rule: 'notBefore', other: 'primariaAnio', otherLabel: 'el año de finalización de primaria', level: 'warn' }, { rule: 'afterBirth', years: 10 }] },
    { id: 'titulo', label: 'Título obtenido', type: T, certificate: true },
    { id: 'bachilleratoTipo', label: 'Tipo de bachillerato', type: 'select', options: sel(['Clásico', 'Técnico', 'Comercial', 'Otro']), showIf: { field: 'nivel', in: ['Bachiller básico', 'Bachiller académico', 'Bachiller técnico'] } },
    { id: 'aniosCursados', label: 'Años cursados (bachillerato)', type: 'number', validate: [{ rule: 'range', min: 0, max: 14 }], showIf: { field: 'nivel', in: ['Bachiller básico', 'Bachiller académico', 'Bachiller técnico'] } },
    { id: 'primariaInstitucion', label: 'Primaria: institución', type: T, showIf: { field: 'nivel', not: 'Primaria' } },
    { id: 'primariaCiudad', label: 'Primaria: ciudad', type: T, showIf: { field: 'nivel', not: 'Primaria' } },
    { id: 'primariaAnio', label: 'Primaria: año de finalización', type: 'number', validate: [{ rule: 'year' }, { rule: 'afterBirth', years: 5 }], showIf: { field: 'nivel', not: 'Primaria' } },
    { id: 'primariaAniosCursados', label: 'Primaria: años cursados', type: 'number', validate: [{ rule: 'range', min: 0, max: 8 }], showIf: { field: 'nivel', not: 'Primaria' } },
    { id: 'primariaTitulo', label: 'Primaria: título obtenido', type: T, showIf: { field: 'nivel', not: 'Primaria' } },
  ] },
  { id: 'superior', title: 'IV. Educación superior y postgrados', repeatable: true, certificate: true, fields: [
    { id: 'modalidad', label: 'Modalidad', type: 'select', options: sel(['Técnica', 'Tecnológica', 'Profesional', 'Especialización', 'Maestría', 'Doctorado']) },
    { id: 'programa', label: 'Programa / título', type: T, required: true },
    { id: 'institucion', label: 'Institución', type: T },
    { id: 'ciudad', label: 'Ciudad', type: T },
    { id: 'semestres', label: 'Semestres aprobados', type: 'number', validate: [{ rule: 'range', min: 0, max: 24 }], showIf: { field: 'graduado', not: true } },
    { id: 'aniosCursados', label: 'Años cursados', type: 'number', validate: [{ rule: 'range', min: 0, max: 14 }] },
    { id: 'graduado', label: 'Graduado', type: 'checkbox' },
    { id: 'fechaGrado', label: 'Fecha de grado / finalización', type: 'date', validate: [{ rule: 'notFuture', level: 'warn' }, { rule: 'afterBirth', years: 14 }, { rule: 'notBeforeRoot', section: 'basica', field: 'anio', otherLabel: 'tu año de grado de bachillerato' }], showIf: { field: 'graduado', equals: true } },
    { id: 'tarjetaProfesional', label: 'Tarjeta profesional No.', type: T, showIf: { field: 'graduado', equals: true } },
  ] },
  { id: 'cursos', title: 'IV. Otros: cursos, diplomados, seminarios', repeatable: true, certificate: true, fields: [
    { id: 'nombre', label: 'Curso / programa', type: T, required: true },
    { id: 'institucion', label: 'Institución', type: T },
    { id: 'horas', label: 'Intensidad (horas)', type: 'number', validate: [{ rule: 'range', min: 1, max: 5000 }] },
    { id: 'fecha', label: 'Fecha de finalización', type: 'date', validate: [{ rule: 'notFuture', level: 'warn' }, { rule: 'afterBirth', years: 5 }] },
  ] },
  { id: 'estudiosActuales', title: 'IV. Estudios actuales', fields: [
    yn('cursa', '¿Cursa estudios actualmente?'),
    { id: 'tipoEstudios', label: '¿Qué tipo de estudios?', type: T, showIf: { field: 'cursa', equals: 'Si' } },
    { id: 'duracion', label: 'Duración (años, semestres, meses)', type: T, showIf: { field: 'cursa', equals: 'Si' } },
    { id: 'anioSemestre', label: 'Año / semestre que cursa', type: T, showIf: { field: 'cursa', equals: 'Si' } },
    { id: 'institucion', label: 'Nombre de la institución', type: T, showIf: { field: 'cursa', equals: 'Si' } },
    { id: 'horario', label: 'Horario', type: 'select', options: sel(['Diurno', 'Nocturno', 'Fin de semana', 'A distancia']), showIf: { field: 'cursa', equals: 'Si' } },
  ] },
  { id: 'sistemas', title: 'IV. Otros conocimientos: sistemas', repeatable: true, fields: [
    { id: 'programa', label: 'Programa(s) que maneja', type: T, required: true },
    { id: 'nivel', label: 'Grado de dominio', type: 'select', options: RBMB },
  ] },
  { id: 'idiomas', title: 'IV. Idiomas', repeatable: true, certificate: true, fields: [
    { id: 'idioma', label: 'Idioma', type: T, required: true },
    ...['habla', 'lee', 'escribe'].map((k) => ({ id: k, label: k[0].toUpperCase() + k.slice(1), type: 'select', options: sel(['Bajo', 'Medio', 'Alto']) })),
  ] },
  { id: 'trayectoria', title: 'V. Trayectoria por empresas', fields: [
    { id: 'sectores', label: 'Clase de empresa(s) en las que ha trabajado', type: 'multiselect', options: opt(SECTORES) },
    { id: 'sectorIndustriaOtros', label: 'Industria: otros (¿cuáles?)', type: T, showIf: { field: 'sectores', includes: 'Industria: otros' } },
    { id: 'sectorOtros', label: 'Otros sectores (¿cuáles?)', type: T, showIf: { field: 'sectores', includes: 'OTROS SECTORES' } },
    { id: 'areas', label: 'Área(s) de la empresa en que se ha desempeñado', type: 'multiselect', options: opt(AREAS) },
    { id: 'areaOtras', label: 'Otras áreas (¿cuáles?)', type: T, showIf: { field: 'areas', includes: 'Otras áreas' } },
  ] },
  { id: 'experiencia', title: 'VI. Experiencia laboral', repeatable: true, certificate: true, fields: [
    { id: 'empresa', label: 'Empresa o entidad', type: T, required: true },
    { id: 'cargo', label: 'Cargo', type: T, required: true },
    { id: 'direccion', label: 'Dirección de la empresa', type: T, validate: ['direccion'] },
    { id: 'fechaInicio', label: 'Fecha de ingreso', type: 'date', validate: ['notFuture', { rule: 'afterBirth', years: 14 }, 'noOverlap'] },
    { id: 'actual', label: 'Es mi trabajo actual', type: 'checkbox', hint: 'Oculta la fecha y el motivo de retiro' },
    { id: 'fechaFin', label: 'Fecha de retiro', type: 'date', validate: [{ rule: 'notBefore', other: 'fechaInicio', otherLabel: 'la fecha de ingreso' }, { rule: 'notFuture', level: 'warn' }], showIf: { field: 'actual', not: true } },
    { id: 'tiempoServido', label: 'Total tiempo servido', type: T, hint: 'Si se deja vacío y hay ambas fechas se calcula' },
    { id: 'sueldoInicial', label: 'Sueldo inicial ($)', type: T },
    { id: 'sueldoFinal', label: 'Sueldo final o actual ($)', type: T },
    { id: 'cargosDesempenados', label: 'Cargo(s) desempeñado(s) por usted', type: T },
    { id: 'funciones', label: 'Funciones realizadas', type: 'textarea' },
    { id: 'logros', label: 'Logros obtenidos', type: 'textarea' },
    { id: 'contratoTermino', label: 'Tipo de contrato: término', type: 'select', options: sel(['Indefinido', 'Fijo']) },
    { id: 'contratoDuracion', label: 'Contrato: ¿cuánto tiempo?', type: T, showIf: { field: 'contratoTermino', equals: 'Fijo' } },
    { id: 'contratoVinculacion', label: 'Contrato: vinculación', type: 'select', options: sel([['Directo', 'Contrato directo con la empresa'], ['Agencia', 'Contrato por medio de agencia'], ['Otro', 'Otro']]) },
    { id: 'contratoOtro', label: 'Contrato otro: ¿cuál?', type: T, showIf: { field: 'contratoVinculacion', equals: 'Otro' } },
    { id: 'horario', label: 'Horario de trabajo', type: 'select', options: sel(['Tiempo completo', 'Medio tiempo', 'Por horas']) },
    { id: 'jornada', label: 'Jornada', type: 'select', options: sel(['Diurna', 'Nocturna', 'Otra jornada']) },
    { id: 'jefe', label: 'Jefe inmediato', type: T },
    { id: 'telefono', label: 'Teléfono de la empresa', type: 'tel', validate: ['telefono'] },
    { id: 'motivoRetiro', label: 'Motivo de retiro', type: T, showIf: { field: 'actual', not: true } },
  ] },
  { id: 'seguridadSocial', title: 'VI. Seguridad social', fields: [
    yn('eps', '¿Está afiliado a una EPS?'),
    { id: 'epsNombre', label: 'EPS: ¿cuál?', type: T, showIf: { field: 'eps', equals: 'Si' } },
    { id: 'epsFecha', label: 'EPS: fecha de afiliación', type: 'date', validate: [{ rule: 'notFuture', level: 'warn' }, { rule: 'afterBirth', years: 0 }], showIf: { field: 'eps', equals: 'Si' } },
    { id: 'epsTipo', label: 'EPS: afiliación', type: 'select', options: sel(['Cotizante', 'Beneficiario']), showIf: { field: 'eps', equals: 'Si' } },
    yn('pension', '¿Está afiliado a un fondo de pensiones?'),
    { id: 'pensionNombre', label: 'Pensiones: ¿cuál?', type: T, showIf: { field: 'pension', equals: 'Si' } },
    { id: 'pensionFecha', label: 'Pensiones: fecha de afiliación', type: 'date', validate: [{ rule: 'notFuture', level: 'warn' }, { rule: 'afterBirth', years: 0 }], showIf: { field: 'pension', equals: 'Si' } },
    yn('cesantias', '¿Está afiliado a un fondo de cesantías?'),
    { id: 'cesantiasNombre', label: 'Cesantías: ¿cuál?', type: T, showIf: { field: 'cesantias', equals: 'Si' } },
    { id: 'cesantiasFecha', label: 'Cesantías: fecha de afiliación', type: 'date', validate: [{ rule: 'notFuture', level: 'warn' }, { rule: 'afterBirth', years: 0 }], showIf: { field: 'cesantias', equals: 'Si' } },
  ] },
  { id: 'referencias', title: 'VII. Referencias personales y familiares', repeatable: true, fields: [
    { id: 'tipo', label: 'Tipo', type: 'select', options: sel(['Personal', 'Familiar']) },
    { id: 'nombre', label: 'Nombre completo', type: 'text', required: true },
    { id: 'parentesco', label: 'Parentesco / relación', type: T },
    { id: 'ocupacion', label: 'Ocupación', type: T },
    { id: 'direccion', label: 'Dirección', type: T, validate: ['direccion'] },
    { id: 'telefono', label: 'Teléfono', type: 'tel', validate: ['telefono'] },
  ] },
  { id: 'otros', title: 'Otros y autorización', fields: [
    { id: 'habilidades', label: 'Habilidades', type: 'textarea' },
    { id: 'disponibilidad', label: 'Disponibilidad', type: T },
    { id: 'autorizaConsulta', label: 'Autorizo pedir información de mi hoja de vida sin ninguna restricción', type: 'checkbox' },
  ] },
];

const documents = [
  doc('cedula', 'Cédula de ciudadanía (ambas caras)', 'Escaneo legible, frente y reverso'),
  doc('procuraduria', 'Antecedentes disciplinarios (Procuraduría)', 'Certificado vigente'),
  doc('contraloria', 'Antecedentes fiscales (Contraloría)', 'Certificado vigente'),
  doc('policia', 'Antecedentes judiciales (Policía Nacional)', 'Consulta con la cédula'),
  doc('rnmc', 'Registro Nacional de Medidas Correctivas', 'Certificado de la Policía Nacional'),
  doc('inhabilidades', 'Inhabilidades por delitos sexuales contra menores', 'Ley 1918 de 2018, Sistema de Consulta de Inhabilidades (lo consulta la entidad contratante)'),
  doc('libreta', 'Libreta militar', 'Si aplica'),
  doc('rut', 'RUT', 'Registro Único Tributario actualizado'),
  doc('eps', 'Certificación de afiliación a EPS', 'ADRES o EPS'),
  doc('pension', 'Certificación de fondo de pensión', ''),
  doc('sisben', 'SISBEN', 'Si aplica'),
  // Agregados con el registro de fuentes (docs/FUENTES-OFICIALES.md); no se muestran por defecto en Documentos.
  doc('redam', 'REDAM (deudores alimentarios morosos)', 'Certificado con código y fecha "Válida hasta"'),
  doc('bdme', 'BDME (deudores morosos del Estado)', 'Contaduría General de la Nación; si la convocatoria lo exige'),
  doc('vigenciacedula', 'Certificado de vigencia de la cédula', 'Registraduría; si la convocatoria lo exige'),
  doc('leyangel', 'Inhabilidades por delitos contra animales (Ley Ángel)', 'Solo si el cargo se relaciona con animales'),
];


// ---------- Render ----------
const secById = Object.fromEntries(sections.map((s) => [s.id, s]));
const has = (v) => !(v == null || v === '' || v === false || (Array.isArray(v) && !v.length));

const incSection = (t, id) => !t || t.include?.sections === undefined || t.include.sections[id] !== false;
const incItem = (t, id) => !t || t.include?.items?.[id] !== false;
const incField = (t, sec, f) => !t || t.include?.fields?.[`${sec}.${f}`] !== false;
const getFile = (files, id) => (files instanceof Map ? files.get(id) : files?.[id]);
const isImg = (f) => isAllowedImageType(f?.meta?.type) && !!f.dataUrl;

function fmtDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v || '';
}
const ymd = (v) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || ''); return m ? [m[3], m[2], m[1]] : ['', '', '']; };
function show(field, v) {
  if (field.type === 'checkbox') return v ? 'Sí' : '';
  if (!has(v)) return '';
  if (field.type === 'multiselect') return (Array.isArray(v) ? v : []).join(', ');
  if (field.type === 'date') return fmtDate(v);
  if (field.type === 'select') return (field.options || []).find((o) => o.value === v)?.label ?? v;
  return v;
}
const multi = (s) => esc(s).replace(/\r?\n/g, '<br>');

const visibleFields = (sec, t) => sec.fields.filter((f) => f.type !== 'photo' && incField(t, sec.id, f.id));
const itemsOf = (profile, id, t) => (Array.isArray(profile?.[id]) ? profile[id] : []).filter((it) => it && incItem(t, it.id));

function experienceOrder(a, b) {
  const end = (x) => x.fechaFin || '9999-99-99';
  return end(b).localeCompare(end(a)) || (b.fechaInicio || '').localeCompare(a.fechaInicio || '');
}

/** Certificados incluidos: [{title, id, file}] */
function certList(profile, t, files, off = new Set()) {
  const out = [];
  const push = (title, id) => { const file = getFile(files, id); if (file) out.push({ title, id, file }); };
  for (const sec of sections) {
    if (!incSection(t, sec.id) || off.has(sec.id)) continue;
    if (sec.repeatable) {
      if (!sec.certificate) continue;
      const list = itemsOf(profile, sec.id, t);
      if (sec.id === 'experiencia') list.sort(experienceOrder);
      for (const it of list) {
        const name = sec.fields.map((f) => it[f.id]).find((v) => typeof v === 'string' && v) || '';
        push(`${sec.title}${name ? ': ' + name : ''}`, `cert:${it.id}`);
      }
    } else {
      for (const f of sec.fields) if (f.certificate && incField(t, sec.id, f.id) && !off.has(`${sec.id}.${f.id}`)) push(`${sec.title}: ${f.label}`, `cert:${sec.id}:${f.id}`);
      if (sec.certificate) push(sec.title, `cert:${sec.id}`);
    }
  }
  return out;
}
// Documentos que la plantilla anexa (G27): sigue su selección explícita (aunque el documento esté oculto en Documentos);
// sin bandera explícita (plantillas anteriores) solo cuentan los mostrados. Un documento oculto y seleccionado se anexa si tiene archivos.
function docList(profile, t, files) {
  const shown = new Set(shownDocIds(profile, documents.map((x) => x.id)));
  const docs = documents.filter((d) => docSelected(t, d.id, shown));
  docs.sort((a, b) => (b.id === 'cedula') - (a.id === 'cedula')); // CC primero
  const out = [];
  for (const d of docs) {
    const ids = Array.isArray(profile?.documents?.[d.id]) ? profile.documents[d.id] : [];
    ids.forEach((id, i) => { const file = getFile(files, id); if (file) out.push({ title: ids.length > 1 ? `${d.label} (${i + 1}/${ids.length})` : d.label, id, file }); });
  }
  return out;
}

/** Perfil normalizado (N), copia solo con lo que aplica (P: sin campos ni secciones ocultos) y los ocultos de secciones simples (off). */
function prep(profile) {
  const N = normalizeProfile(profile, sections);
  const { profile: P, off } = pruneProfile(sections, N);
  return { N, P, off };
}

function missing(profile, template, files) {
  const { N, P, off } = prep(profile); // un perfil importado con tipos erróneos no debe romper la vista
  profile = P;
  const V = createVisibility(sections, N); // lo que no aplica según las respuestas no se exige
  const t = template || null, out = [];
  for (const sec of sections) {
    if (!incSection(t, sec.id) || !V.sectionVisible(sec)) continue;
    const req = sec.fields.filter((f) => f.required && incField(t, sec.id, f.id));
    if (!req.length) continue;
    const rows = sec.repeatable ? itemsOf(N, sec.id, t) : [N?.[sec.id] || {}];
    rows.forEach((r, i) => req.filter((f) => V.fieldVisible(sec, r, f)).forEach((f) => { if (!has(r[f.id])) out.push(`${sec.title}${sec.repeatable ? ' #' + (i + 1) : ''}: ${f.label}`); }));
  }
  if (t) {
    // Documentos que la plantilla pide de forma explícita y no tienen archivo (también los ocultos en Documentos).
    const shown = new Set(shownDocIds(profile, documents.map((x) => x.id)));
    const count = (id) => (Array.isArray(profile?.documents?.[id]) ? profile.documents[id] : []).filter((fid) => getFile(files, fid)).length;
    for (const id of docsMissing(t, documents.map((d) => d.id), count)) {
      out.push(`Documento: ${documents.find((d) => d.id === id).label}${shown.has(id) ? '' : ' (oculto en Documentos)'}`);
    }
    // Certificados de campos o secciones simples (libreta, licencia, título de bachiller) que la plantilla anexa y no existen (G06).
    for (const g of certGaps(sections, t, profile, (id) => !!getFile(files, id), ['field', 'section'])) { // profile ya sin los campos ocultos
      out.push(`Certificado sin archivo: ${g.title}${g.kind === 'field' ? ' · ' + g.label : ''}`);
    }
  }
  return out;
}

function annexes(profile, t, files, off) {
  const o = t?.options || {}, a = [];
  if (!t || o.attachCertificates) a.push(...certList(profile, t, files, off));
  if (t && o.attachDocuments) a.push(...docList(profile, t, files));
  return a;
}

// ---------- Mapa campo del formato -> perfil ----------
// Claves t#/c#/b# = campos del PDF por página (minerva-layout.js). Una casilla marcada dibuja una X.
const EXP = [
  { e: 't0', dir: 't1', tel: 't2', car: 't3', jef: 't4', ini: ['t5', 't6', 't43'], fin: ['t8', 't9', 't10'], tmp: 't11', si: 't12', sf: 't13', cgs: 't14', fun: ['t15', 't16'], log: 't17', ind: 'c0', fij: 'c1', dur: 't18', dir2: 'c2', age: 'c3', otr: 'c4', cua: 't7', com: 'c5', med: 'c6', hor: 'c7', diu: 'c8', noc: 'c9', oj: 'c10', mot: 't19' },
  { e: 't21', dir: 't41', tel: 't40', car: 't38', jef: 't39', ini: ['t37', 't36', 't42'], fin: ['t35', 't34', 't33'], tmp: 't32', si: 't31', sf: 't30', cgs: 't29', fun: ['t28', 't27'], log: 't26', ind: 'c21', fij: 'c20', dur: 't25', dir2: 'c19', age: 'c18', otr: 'c17', cua: 't24', com: 'c16', med: 'c15', hor: 'c14', diu: 'c13', noc: 'c12', oj: 'c11', mot: 't23' },
  { e: 't44', dir: 't65', tel: 't64', car: 't62', jef: 't63', ini: ['t61', 't60', 't59'], fin: ['t58', 't57', 't56'], tmp: 't55', si: 't54', sf: 't53', cgs: 't52', fun: ['t51', 't50'], log: 't49', ind: 'c32', fij: 'c31', dur: 't48', dir2: 'c30', age: 'c29', otr: 'c28', cua: 't47', com: 'c27', med: 'c26', hor: 'c25', diu: 'c24', noc: 'c23', oj: 'c22', mot: 't46' },
];
// Filas de la tabla de estudios: [año fin, años cursados, título, institución, ciudad]
const ROW = {
  prim: ['t22', 't23', 't24', 't25', 't26'], bach: ['t27', 't28', 't29', 't30', 't31'], tec: ['t52', 't51', 't50', 't49', 't33'],
  tecno: ['t34', 't45', 't46', 't47', 't48'], prof: ['t44', 't43', 't42', 't41', 't35'], post: ['t36', 't37', 't38', 't39', 't40'],
};
const MODAL = { Técnica: 'tec', Tecnológica: 'tecno', Profesional: 'prof', Especialización: 'post', Maestría: 'post', Doctorado: 'post' };
const MODAL_CHK = { tec: 'c5', tecno: 'c6', prof: 'c7' };
const SIST = [['t64', 'c17', 'c18', 'c19'], ['t65', 'c22', 'c20', 'c21'], ['t67', 'c28', 'c26', 'c25'], ['t66', 'c23', 'c27', 'c24']];
const IDIO = [
  { n: 't68', lee: ['c46', 'c45', 'c44'], esc: ['c40', 'c39', 'c38'], hab: ['c34', 'c33', 'c32'] },
  { n: 't69', lee: ['c41', 'c42', 'c43'], esc: ['c35', 'c36', 'c37'], hab: ['c30', 'c29', 'c31'] },
];
const NIVEL_IDX = { Bajo: 0, Medio: 1, Alto: 2 };
const SS = [
  { si: 'c33', no: 'c34', cua: 't66', fec: 't68', cot: 'c35', ben: 'c36' },
  { si: 'c38', no: 'c37', cua: 't67', fec: 't69' },
  { si: 'c40', no: 'c39', cua: 't71', fec: 't70' },
];
const REFS = [['t0', 't4', 't6', 't9'], ['t1', 't3', 't7', 't10'], ['t2', 't5', 't8', 't11']]; // nombre, ocupación, dirección, teléfono

// ---------- Capacidad de las casillas (aviso de texto largo en el formulario de Perfil) ----------
// 'seccion.campo' -> casillas del PDF donde se imprime (ver js/models/minerva-fit.js). Solo texto: fechas, números y listas no recortan.
const ln = (p, ...keys) => ({ mode: 'line', boxes: keys.map((k) => [p, k]) });
const FIT = {
  'solicitud.cargoInteres': ln(0, 't3'), 'solicitud.codigoCargo': ln(0, 't4'),
  'personales.apellidos': ln(0, 't5'), 'personales.nombres': ln(0, 't6'), 'personales.direccion': ln(0, 't7'), 'personales.ciudad': ln(0, 't8'),
  'personales.telefono': ln(0, 't9'), 'personales.celular': ln(0, 't10'), 'personales.correo': ln(0, 't11'), 'personales.nacionalidad': ln(0, 't12'),
  'personales.profesion': ln(0, 't13'), 'personales.aniosExperiencia': ln(0, 't15'), 'personales.expedidaEn': ln(0, 't17'),
  'personales.numeroDocumento': { mode: 'line', boxes: [[0, 't16'], [3, 't15']] },
  'personales.libretaMilitar': ln(0, 't19'), 'personales.distritoMilitar': ln(0, 't18'), 'personales.tarjetaProfesional': ln(0, 't20'),
  'personales.licenciaNumero': ln(0, 't21'), 'personales.licenciaConduccion': ln(0, 't22'),
  'personales.perfil': { mode: 'block', boxes: [[0, ['t46', 't47', 't48'], 24.25]] },
  'infopersonal.empresaActual': ln(0, 't23'), 'infopersonal.tipoContratoActual': ln(0, 't24'),
  'infopersonal.recomendadoNombre': ln(0, 't28'), 'infopersonal.recomendadoDependencia': ln(0, 't29'),
  'infopersonal.parientesNombre': ln(0, 't30'), 'infopersonal.parientesDependencia': ln(0, 't31'),
  'infopersonal.comoSupoOtro': { mode: 'rows', boxes: [[0, ['t32']]] },
  'infopersonal.ciudadVivida': ln(0, 't33'), 'infopersonal.ciudadesTrabajadas': ln(0, 't34'), 'infopersonal.tiempoResidencia': ln(0, 't35'),
  'infopersonal.arrendadorTelefono': ln(0, 't36'), 'infopersonal.arrendador': ln(0, 't37'), 'infopersonal.ingresoDescripcion': ln(0, 't38'),
  'infopersonal.obligacionesMensuales': ln(0, 't39'), 'infopersonal.aspiracionSalarial': ln(0, 't40'), 'infopersonal.ingresoConceptos': ln(0, 't41'),
  'infopersonal.aficiones': ln(0, 't42'), 'infopersonal.deporteCual': ln(0, 't43'), 'infopersonal.distincionesCual': ln(0, 't44'), 'infopersonal.asociacionCual': ln(0, 't45'),
  'familiar.conyugeNombre': ln(1, 't0'), 'familiar.conyugeProfesion': ln(1, 't1'), 'familiar.conyugeEmpresa': ln(1, 't2'), 'familiar.conyugeCargo': ln(1, 't3'),
  'familiar.conyugeDireccion': ln(1, 't4'), 'familiar.conyugeTelefono': ln(1, 't5'), 'familiar.conyugeCiudad': ln(1, 't6'),
  'familiar.parentescoDependientes': ln(1, 't8'), 'familiar.edadesDependientes': ln(1, 't9'),
  'familiar.padreNombre': ln(1, 't10'), 'familiar.padreProfesion': ln(1, 't11'), 'familiar.padreTelefono': ln(1, 't12'),
  'familiar.madreNombre': ln(1, 't16'), 'familiar.madreProfesion': ln(1, 't17'), 'familiar.madreTelefono': ln(1, 't13'),
  'hermanos.nombre': ln(1, 't18', 't21'), 'hermanos.profesion': ln(1, 't20', 't19'), 'hermanos.telefono': ln(1, 't14', 't15'),
  'basica.titulo': ln(1, ROW.bach[2], ROW.prim[2]), 'basica.institucion': ln(1, ROW.bach[3], ROW.prim[3]), 'basica.ciudad': ln(1, ROW.bach[4], ROW.prim[4]),
  'basica.primariaTitulo': ln(1, ROW.prim[2]), 'basica.primariaInstitucion': ln(1, ROW.prim[3]), 'basica.primariaCiudad': ln(1, ROW.prim[4]),
  'superior.programa': ln(1, ...['tec', 'tecno', 'prof', 'post'].map((r) => ROW[r][2])),
  'superior.institucion': ln(1, ...['tec', 'tecno', 'prof', 'post'].map((r) => ROW[r][3])),
  'superior.ciudad': ln(1, ...['tec', 'tecno', 'prof', 'post'].map((r) => ROW[r][4])),
  'superior.tarjetaProfesional': ln(0, 't20'),
  'cursos.nombre': ln(1, 't58'), 'cursos.institucion': ln(1, 't59'),
  'estudiosActuales.tipoEstudios': ln(1, 't60'), 'estudiosActuales.duracion': ln(1, 't61'), 'estudiosActuales.anioSemestre': ln(1, 't62'), 'estudiosActuales.institucion': ln(1, 't63'),
  'sistemas.programa': ln(1, ...SIST.map((x) => x[0])), 'idiomas.idioma': ln(1, ...IDIO.map((x) => x.n)),
  'trayectoria.sectorIndustriaOtros': ln(1, 't70'), 'trayectoria.sectorOtros': ln(1, 't72'), 'trayectoria.areaOtras': ln(1, 't74'),
  ...Object.fromEntries(Object.entries({ empresa: 'e', direccion: 'dir', telefono: 'tel', cargo: 'car', jefe: 'jef', tiempoServido: 'tmp', sueldoInicial: 'si', sueldoFinal: 'sf', cargosDesempenados: 'cgs', contratoDuracion: 'dur', contratoOtro: 'cua', motivoRetiro: 'mot' })
    .map(([f, k]) => ['experiencia.' + f, ln(2, ...EXP.map((x) => x[k]))])),
  'experiencia.funciones': { mode: 'rows', boxes: EXP.map((x) => [2, x.fun]) }, 'experiencia.logros': { mode: 'rows', boxes: EXP.map((x) => [2, [x.log]]) },
  'seguridadSocial.epsNombre': ln(2, SS[0].cua), 'seguridadSocial.pensionNombre': ln(2, SS[1].cua), 'seguridadSocial.cesantiasNombre': ln(2, SS[2].cua),
  'referencias.nombre': ln(3, ...REFS.map((r) => r[0])), 'referencias.ocupacion': ln(3, ...REFS.map((r) => r[1])),
  'referencias.direccion': ln(3, ...REFS.map((r) => r[2])), 'referencias.telefono': ln(3, ...REFS.map((r) => r[3])),
};
const fitCache = new Map();
/** Capacidad en caracteres del campo en el formulario PDF: { comfort, max, multi } o null (campo sin casilla de texto). */
function fitLimit(secId, fieldId) {
  const key = `${secId}.${fieldId}`;
  if (!fitCache.has(key)) fitCache.set(key, fitCapacity(FIT[key]));
  return fitCache.get(key);
}

/** Tamaño de letra que hace caber el texto (heurística determinista: ancho medio de glifo 0.5 em). */
function fitSize(text, w, h, { max = 9, min = 5, lh = 1.2, lines = 1, lhPt = 0 } = {}) {
  const s = String(text);
  for (let sz = max; sz >= min; sz -= 0.5) {
    const cpl = Math.max(1, Math.floor((w - 4) / (sz * 0.5)));
    const need = lines === 1 ? (s.length <= cpl ? 1 : 2) : s.split(/\r?\n/).reduce((n, p) => n + Math.max(1, Math.ceil(p.length / cpl)), 0);
    if (need * (lhPt || sz * lh) <= h + 0.5 && (lines !== 1 || need === 1)) return sz;
  }
  return min;
}
const num = (v) => String(+v.toFixed(2));

function renderForm(P, t, files) {
  const o = t?.options || {};
  const get = (sec, id) => (incSection(t, sec) && incField(t, sec, id) ? P?.[sec]?.[id] : undefined);
  const items = (sec) => (incSection(t, sec) ? itemsOf(P, sec, t) : []);
  const fv = (sec, it, id) => (incField(t, sec, id) ? it?.[id] : undefined);
  const pages = layout.pages.map((pg) => ({ pg, html: [], marks: [] }));
  const W = (i, k) => pages[i].pg.w[k];

  // Texto de una línea (o varias, con opts.rows) dentro de un campo del PDF.
  const text = (i, key, v, opts = {}) => {
    const r = W(i, key);
    if (!r || !has(v)) return;
    const s = String(v);
    const sz = opts.size || fitSize(s, r[2], r[3], { lines: 1 });
    pages[i].html.push(`<div class="mv-f" style="left:${r[0]}pt;top:${r[1]}pt;width:${r[2]}pt;height:${r[3]}pt;font-size:${sz}pt">${esc(s)}</div>`);
  };
  // Texto de varias líneas que ocupa la unión de varios campos.
  const block = (i, keys, v, lh) => {
    const rs = keys.map((k) => W(i, k)).filter(Boolean);
    if (!rs.length || !has(v)) return;
    const x0 = Math.min(...rs.map((r) => r[0])), y0 = Math.min(...rs.map((r) => r[1]));
    const x1 = Math.max(...rs.map((r) => r[0] + r[2])), y1 = Math.max(...rs.map((r) => r[1] + r[3]));
    const w = x1 - x0, hh = y1 - y0, s = String(v);
    const sz = fitSize(s, w, hh, { lines: 2, lhPt: lh || 0, max: 9 });
    const line = lh || sz * 1.2;
    pages[i].html.push(`<div class="mv-f mv-m" style="left:${x0}pt;top:${y0 - (lh ? (lh - rs[0][3]) / 2 : 0)}pt;width:${num(w)}pt;height:${num(hh + (lh ? lh - rs[0][3] : 0))}pt;font-size:${sz}pt;line-height:${num(line)}pt">${multi(s)}</div>`);
  };
  // Texto repartido en filas rotuladas (una por campo del PDF): cada fila admite 1 línea a 9 pt o varias a tamaño menor.
  const rows = (i, keys, v) => {
    const rs = keys.map((k) => W(i, k)).filter(Boolean);
    if (!rs.length || !has(v)) return;
    const words = String(v).trim().split(/\s+/);
    const w = rs[0][2] - 4;
    for (let sz = 9; sz >= 4.5; sz -= 0.5) {
      const cap = Math.max(1, Math.floor(14 / (sz * 1.15))), cpl = Math.floor(w / (sz * 0.5));
      const lines = [''];
      for (const wd of words) {
        const cur = lines[lines.length - 1];
        if (!cur) lines[lines.length - 1] = wd; else if ((cur + ' ' + wd).length <= cpl) lines[lines.length - 1] = cur + ' ' + wd; else lines.push(wd);
      }
      if (lines.length <= cap * rs.length || sz <= 4.5) {
        rs.forEach((r, n) => {
          const part = lines.slice(n * cap, (n + 1) * cap).join('\n');
          if (part) pages[i].html.push(`<div class="mv-f mv-r" style="left:${r[0]}pt;top:${r[1]}pt;width:${r[2]}pt;height:${r[3]}pt;font-size:${sz}pt;line-height:${num(sz * 1.15)}pt">${multi(part)}</div>`);
        });
        return;
      }
    }
  };
  const date = (i, keys, iso) => ymd(iso).forEach((p, n) => text(i, keys[n], p));
  const mark = (i, key, on = true) => {
    const r = W(i, key);
    if (!r || !on) return;
    const [x, y, w, hh] = r, d = 2;
    pages[i].marks.push(`<path d="M${num(x + d)} ${num(y + d)}L${num(x + w - d)} ${num(y + hh - d)}M${num(x + w - d)} ${num(y + d)}L${num(x + d)} ${num(y + hh - d)}"/>`);
  };
  const yesNo = (i, v, ks, kn) => { if (v === 'Si') mark(i, ks); else if (v === 'No') mark(i, kn); };
  const selLabel = (sec, id, v) => secById[sec].fields.find((f) => f.id === id)?.options?.find((x) => x.value === v)?.label ?? v;
  const overflow = []; // [{sec, list}] registros que no caben en el formato

  // ---- Página 1 ----
  const per = (id) => get('personales', id);
  const sol = (id) => get('solicitud', id);
  const today = new Date();
  const f0 = sol('fecha') || (incSection(t, 'solicitud') ? `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}` : '');
  date(0, ['t0', 't1', 't2'], f0);
  text(0, 't3', sol('cargoInteres')); text(0, 't4', sol('codigoCargo'));
  text(0, 't5', per('apellidos')); text(0, 't6', per('nombres'));
  text(0, 't7', per('direccion')); text(0, 't8', per('ciudad'));
  text(0, 't9', per('telefono')); text(0, 't10', per('celular'));
  text(0, 't11', per('correo')); text(0, 't12', per('nacionalidad'));
  text(0, 't13', per('profesion')); text(0, 't14', selLabel('personales', 'estadoCivil', per('estadoCivil')));
  text(0, 't15', per('aniosExperiencia'));
  text(0, 't16', per('numeroDocumento')); text(0, 't17', per('expedidaEn'));
  mark(0, 'c2', per('tipoDocumento') === 'CC'); mark(0, 'c3', per('tipoDocumento') === 'CE');
  text(0, 't19', per('libretaMilitar')); text(0, 't18', per('distritoMilitar'));
  mark(0, 'c0', per('claseLibreta') === 'Primera clase'); mark(0, 'c1', per('claseLibreta') === 'Segunda clase');
  const sup0 = items('superior').find((it) => fv('superior', it, 'tarjetaProfesional'));
  text(0, 't20', per('tarjetaProfesional') || (sup0 && fv('superior', sup0, 'tarjetaProfesional')));
  text(0, 't21', per('licenciaNumero')); text(0, 't22', per('licenciaConduccion'));
  yesNo(0, per('tieneVehiculo'), 'c4', 'c5');
  const ip = (id) => get('infopersonal', id);
  yesNo(0, ip('trabajaActualmente'), 'c6', 'c7'); text(0, 't23', ip('empresaActual'));
  mark(0, 'c8', ip('vinculacionActual') === 'Empleado'); mark(0, 'c9', ip('vinculacionActual') === 'Independiente');
  text(0, 't24', ip('tipoContratoActual'));
  yesNo(0, ip('trabajoAntes'), 'c10', 'c11'); yesNo(0, ip('solicitoAntes'), 'c12', 'c13');
  date(0, ['t25', 't26', 't27'], ip('fechaSolicitudAnterior'));
  yesNo(0, ip('recomendado'), 'c14', 'c15'); text(0, 't28', ip('recomendadoNombre')); text(0, 't29', ip('recomendadoDependencia'));
  yesNo(0, ip('parientes'), 'c16', 'c17'); text(0, 't30', ip('parientesNombre')); text(0, 't31', ip('parientesDependencia'));
  const cs = ip('comoSupo');
  mark(0, 'c18', cs === 'Anuncio'); mark(0, 'c20', cs === 'Amigo'); mark(0, 'c19', cs === 'Por medio de agencia'); mark(0, 'c21', cs === 'Otro');
  rows(0, ['t32'], ip('comoSupoOtro'));
  yesNo(0, ip('aceptaOtraCiudad'), 'c22', 'c23');
  text(0, 't33', ip('ciudadVivida')); text(0, 't34', ip('ciudadesTrabajadas'));
  mark(0, 'c26', ip('vivienda') === 'Propia'); mark(0, 'c24', ip('vivienda') === 'Familiar'); mark(0, 'c25', ip('vivienda') === 'Alquilada');
  text(0, 't37', ip('arrendador')); text(0, 't36', ip('arrendadorTelefono')); text(0, 't35', ip('tiempoResidencia'));
  yesNo(0, ip('ingresoAdicional'), 'c27', 'c28'); text(0, 't38', ip('ingresoDescripcion')); text(0, 't39', ip('obligacionesMensuales'));
  text(0, 't41', ip('ingresoConceptos')); text(0, 't40', ip('aspiracionSalarial'));
  text(0, 't42', ip('aficiones')); yesNo(0, ip('practicaDeporte'), 'c29', 'c30'); text(0, 't43', ip('deporteCual'));
  yesNo(0, ip('distinciones'), 'c31', 'c33'); text(0, 't44', ip('distincionesCual'));
  yesNo(0, ip('asociacion'), 'c32', 'c34'); text(0, 't45', ip('asociacionCual'));
  const objetivo = has(o.objective) && t ? o.objective : per('perfil');
  block(0, ['t46', 't47', 't48'], objetivo, 24.25);

  // Fotografía (opción showPhoto de la plantilla)
  const showPhoto = !t || o.showPhoto !== false;
  const photo = showPhoto ? getFile(files, 'photo') : null;
  if (isImg(photo)) pages[0].html.push(`<img class="mv-photo" src="${esc(photo.dataUrl)}" alt="Fotografía" style="left:495.9pt;top:148.1pt;width:85.1pt;height:113.4pt">`);

  // ---- Página 2 ----
  const fam = (id) => get('familiar', id);
  text(1, 't0', fam('conyugeNombre')); text(1, 't1', fam('conyugeProfesion')); text(1, 't2', fam('conyugeEmpresa'));
  text(1, 't3', fam('conyugeCargo')); text(1, 't4', fam('conyugeDireccion')); text(1, 't5', fam('conyugeTelefono')); text(1, 't6', fam('conyugeCiudad'));
  text(1, 't7', fam('personasACargo')); text(1, 't8', fam('parentescoDependientes')); text(1, 't9', fam('edadesDependientes'));
  text(1, 't10', fam('padreNombre')); text(1, 't11', fam('padreProfesion')); text(1, 't12', fam('padreTelefono'));
  text(1, 't16', fam('madreNombre')); text(1, 't17', fam('madreProfesion')); text(1, 't13', fam('madreTelefono'));
  const sibs = items('hermanos');
  [['t18', 't20', 't14'], ['t21', 't19', 't15']].forEach((ks, n) => {
    const it = sibs[n]; if (!it) return;
    text(1, ks[0], fv('hermanos', it, 'nombre')); text(1, ks[1], fv('hermanos', it, 'profesion')); text(1, ks[2], fv('hermanos', it, 'telefono'));
  });
  if (sibs.length > 2) overflow.push({ sec: 'hermanos', list: sibs.slice(2) });

  const eduRow = (row, d) => ROW[row].forEach((k, n) => text(1, k, d[n]));
  const bas = (id) => get('basica', id);
  const nivel = bas('nivel');
  const primOwn = ['primariaAnio', 'primariaAniosCursados', 'primariaTitulo', 'primariaInstitucion', 'primariaCiudad'].map(bas);
  if (primOwn.some(has)) eduRow('prim', primOwn);
  else if (nivel === 'Primaria') eduRow('prim', [bas('anio'), '', bas('titulo'), bas('institucion'), bas('ciudad')]);
  if (nivel !== 'Primaria') eduRow('bach', [bas('anio'), bas('aniosCursados'), bas('titulo'), bas('institucion'), bas('ciudad')]);
  const bt = bas('bachilleratoTipo') || ({ 'Bachiller técnico': 'Técnico', 'Bachiller académico': 'Clásico', 'Bachiller básico': 'Otro' }[nivel]);
  if (nivel !== 'Primaria' || bas('bachilleratoTipo')) { mark(1, 'c1', bt === 'Clásico'); mark(1, 'c3', bt === 'Técnico'); mark(1, 'c2', bt === 'Comercial'); mark(1, 'c4', bt === 'Otro'); }

  const used = new Set(), extraSup = [];
  for (const it of items('superior')) {
    const row = MODAL[fv('superior', it, 'modalidad')] || 'prof';
    if (used.has(row)) { extraSup.push(it); continue; }
    used.add(row);
    const sem = fv('superior', it, 'semestres');
    const anios = fv('superior', it, 'aniosCursados') ?? (has(sem) ? +(sem / 2).toFixed(1) : '');
    eduRow(row, [ymd(fv('superior', it, 'fechaGrado'))[2], anios, fv('superior', it, 'programa'), fv('superior', it, 'institucion'), fv('superior', it, 'ciudad')]);
    if (MODAL_CHK[row]) mark(1, MODAL_CHK[row]);
  }
  if (extraSup.length) overflow.push({ sec: 'superior', list: extraSup });
  const cur = items('cursos');
  if (cur[0]) { text(1, 't57', fv('cursos', cur[0], 'horas')); text(1, 't58', fv('cursos', cur[0], 'nombre')); text(1, 't59', fv('cursos', cur[0], 'institucion')); }
  if (cur.length > 1) overflow.push({ sec: 'cursos', list: cur.slice(1) });

  const ea = (id) => get('estudiosActuales', id);
  yesNo(1, ea('cursa'), 'c8', 'c9'); text(1, 't60', ea('tipoEstudios')); text(1, 't61', ea('duracion')); text(1, 't62', ea('anioSemestre')); text(1, 't63', ea('institucion'));
  mark(1, 'c0', ea('horario') === 'Diurno'); mark(1, 'c10', ea('horario') === 'Nocturno'); mark(1, 'c12', ea('horario') === 'Fin de semana'); mark(1, 'c11', ea('horario') === 'A distancia');

  const sis = items('sistemas');
  if (sis.length) mark(1, 'c13');
  sis.slice(0, 4).forEach((it, n) => {
    text(1, SIST[n][0], fv('sistemas', it, 'programa'));
    const lv = ['R', 'B', 'MB'].indexOf(fv('sistemas', it, 'nivel'));
    if (lv >= 0) mark(1, SIST[n][1 + lv]);
  });
  if (sis.length > 4) overflow.push({ sec: 'sistemas', list: sis.slice(4) });

  const idi = items('idiomas');
  if (incSection(t, 'idiomas') && idi.length) mark(1, 'c14');
  idi.slice(0, 2).forEach((it, n) => {
    text(1, IDIO[n].n, fv('idiomas', it, 'idioma'));
    [['lee', 'lee'], ['escribe', 'esc'], ['habla', 'hab']].forEach(([f, k]) => { const lv = NIVEL_IDX[fv('idiomas', it, f)]; if (lv !== undefined) mark(1, IDIO[n][k][lv]); });
  });
  if (idi.length > 2) overflow.push({ sec: 'idiomas', list: idi.slice(2) });

  const tr = (id) => get('trayectoria', id);
  const chosen = new Set([...(tr('sectores') || []), ...(tr('areas') || [])]);
  for (const [label, key] of [...SECTORES, ...AREAS]) mark(1, key, chosen.has(label));
  text(1, 't70', tr('sectorIndustriaOtros')); text(1, 't72', tr('sectorOtros')); text(1, 't74', tr('areaOtras'));

  // ---- Página 3: experiencia (3 bloques) ----
  const exp = items('experiencia').sort(experienceOrder);
  exp.slice(0, 3).forEach((it, n) => {
    const k = EXP[n], g = (id) => fv('experiencia', it, id);
    text(2, k.e, g('empresa')); text(2, k.dir, g('direccion')); text(2, k.tel, g('telefono'));
    text(2, k.car, g('cargo')); text(2, k.jef, g('jefe'));
    date(2, k.ini, g('fechaInicio')); date(2, k.fin, g('fechaFin'));
    let tmp = g('tiempoServido');
    const fin = g('fechaFin') || (g('actual') === true ? todayIso() : ''); // trabajo actual: el tiempo servido corre hasta hoy
    if (!has(tmp) && g('fechaInicio') && fin) {
      const a = ymd(g('fechaInicio')), b = ymd(fin);
      const m = Math.max(0, (b[2] - a[2]) * 12 + (b[1] - a[1]) + (b[0] >= a[0] ? 0 : -1));
      tmp = [m >= 12 ? `${Math.floor(m / 12)} año${m >= 24 ? 's' : ''}` : '', m % 12 ? `${m % 12} mes${m % 12 > 1 ? 'es' : ''}` : ''].filter(Boolean).join(' ') || '0 meses';
    }
    text(2, k.tmp, tmp); text(2, k.si, g('sueldoInicial')); text(2, k.sf, g('sueldoFinal')); text(2, k.cgs, g('cargosDesempenados'));
    rows(2, k.fun, g('funciones')); rows(2, [k.log], g('logros'));
    mark(2, k.ind, g('contratoTermino') === 'Indefinido'); mark(2, k.fij, g('contratoTermino') === 'Fijo'); text(2, k.dur, g('contratoDuracion'));
    mark(2, k.dir2, g('contratoVinculacion') === 'Directo'); mark(2, k.age, g('contratoVinculacion') === 'Agencia'); mark(2, k.otr, g('contratoVinculacion') === 'Otro');
    text(2, k.cua, g('contratoOtro'));
    mark(2, k.com, g('horario') === 'Tiempo completo'); mark(2, k.med, g('horario') === 'Medio tiempo'); mark(2, k.hor, g('horario') === 'Por horas');
    mark(2, k.diu, g('jornada') === 'Diurna'); mark(2, k.noc, g('jornada') === 'Nocturna'); mark(2, k.oj, g('jornada') === 'Otra jornada');
    text(2, k.mot, g('motivoRetiro'));
  });
  if (exp.length > 3) overflow.push({ sec: 'experiencia', list: exp.slice(3) });
  const ss = (id) => get('seguridadSocial', id);
  [['eps', 'epsNombre', 'epsFecha'], ['pension', 'pensionNombre', 'pensionFecha'], ['cesantias', 'cesantiasNombre', 'cesantiasFecha']].forEach(([a, b, c], n) => {
    yesNo(2, ss(a), SS[n].si, SS[n].no); text(2, SS[n].cua, ss(b)); text(2, SS[n].fec, fmtDate(ss(c)));
  });
  mark(2, 'c35', ss('epsTipo') === 'Cotizante'); mark(2, 'c36', ss('epsTipo') === 'Beneficiario');

  // ---- Página 4: referencias y autorización ----
  const refs = items('referencias');
  const pers = refs.filter((r) => fv('referencias', r, 'tipo') !== 'Familiar'), fam3 = refs.filter((r) => fv('referencias', r, 'tipo') === 'Familiar');
  const refRow = (n, it) => {
    const g = (id) => fv('referencias', it, id), par = g('parentesco');
    text(3, REFS[n][0], [g('nombre'), has(par) ? `(${par})` : ''].filter(Boolean).join(' '));
    text(3, REFS[n][1], g('ocupacion')); text(3, REFS[n][2], g('direccion')); text(3, REFS[n][3], g('telefono'));
  };
  pers.slice(0, 2).forEach((it, n) => refRow(n, it));
  if (fam3[0]) refRow(2, fam3[0]);
  const extraRef = [...pers.slice(2), ...fam3.slice(1)];
  if (extraRef.length) overflow.push({ sec: 'referencias', list: extraRef });
  mark(3, 'c0', get('otros', 'autorizaConsulta') === true);
  text(3, 't15', per('numeroDocumento'));

  return { pages, overflow };
}

// G08 (ATS): sombra de los rótulos de sección sin texto duplicado.
const TEXT_RE = /<text ([^>]*)>([^<]*)<\/text>/g;
const attrOf = (a, k) => (a.match(new RegExp(`${k}="([^"]*)"`)) || [])[1];
const SHADOW_STYLE = 'filter:opacity(.999)';
const cleanedSvg = new Map();
// Los rótulos de las barras de sección están dibujados dos veces en docs/minerva.pdf: texto blanco y, debajo, una copia azul oscura desplazada
// (~1 pt) que hace de sombra. Como texto real, la copia duplica el rótulo al extraerlo ("IV.IV. EDUCACIONEDUCACION"). Se conserva la sombra
// visual pero sin texto extraíble: la copia lleva un filtro CSS inocuo (opacity .999), y al imprimir Chromium rasteriza lo filtrado, así que en el
// PDF la sombra es una imagen (no texto) y el rótulo blanco sigue siendo el único texto. Verificado con tools/ats.mjs.
function markShadowText(svg) {
  if (cleanedSvg.has(svg)) return cleanedSvg.get(svg);
  const ts = [...svg.matchAll(TEXT_RE)].map((m) => ({ s: m[0], a: m[1], c: m[2], x: +attrOf(m[1], 'x'), y: +attrOf(m[1], 'y'), white: attrOf(m[1], 'fill') === '#ffffff' }));
  const out = ts.reduce((acc, p, i) => {
    if (p.white || !p.c.trim()) return acc;
    if (!ts.some((q, j) => j !== i && q.white && q.c === p.c && Math.abs(q.x - p.x) < 1.5 && Math.abs(q.y - p.y) < 1.5)) return acc;
    return acc.replace(p.s, `<text data-sh="1" style="${SHADOW_STYLE}" ${p.a}>${p.c}</text>`);
  }, svg);
  cleanedSvg.set(svg, out);
  return out;
}

// G08: alternativa lineal accesible de las hojas del formulario. Los rótulos viven en un SVG decorativo y los valores en <div> posicionados, así que un
// lector de pantalla leería valores sin rótulo. Las hojas del formulario van `aria-hidden` y este bloque (grupos con lista de definición: rótulo del
// schema -> valor) las sustituye. Oculto con estilos en línea (sin depender de CSS externo, también en el HTML autónomo y en la rasterización del
// paquete PDF) y con `display:none` al imprimir (print.css y export.js): no cambia la geometría ni añade texto al PDF. Lo que desborda va a la hoja
// de continuación (tablas reales), por eso aquí se omite.
const SR_STYLE = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap';
function a11yText(P, t, overflow) {
  const spill = new Set(overflow.flatMap((o) => o.list));
  const dl = (fs, rec) => {
    const rows = fs.map((f) => [f, show(f, rec?.[f.id])]).filter(([, v]) => has(v));
    return rows.length ? `<dl>${rows.map(([f, v]) => `<dt>${esc(f.label)}</dt><dd>${esc(String(v))}</dd>`).join('')}</dl>` : '';
  };
  const groups = [];
  for (const sec of sections) {
    if (!incSection(t, sec.id)) continue;
    const fs = visibleFields(sec, t);
    if (sec.repeatable) {
      const list = itemsOf(P, sec.id, t);
      if (sec.id === 'experiencia') list.sort(experienceOrder);
      list.filter((it) => !spill.has(it)).forEach((it, n, all) => {
        const d = dl(fs, it);
        if (d) groups.push(`<div role="group" aria-label="${esc(sec.title)}${all.length > 1 ? `, registro ${n + 1} de ${all.length}` : ''}">${d}</div>`);
      });
    } else {
      // El perfil profesional se imprime en la hoja solo si la plantilla no fija un objetivo (ver renderForm): el texto alternativo sigue lo impreso.
      const obj = sec.id === 'personales' && t && has(t.options?.objective) ? String(t.options.objective) : null;
      const rec = obj != null ? { ...P?.[sec.id], perfil: obj } : P?.[sec.id];
      const d = dl(obj != null ? [...fs.filter((f) => f.id !== 'perfil'), { id: 'perfil', label: 'Objetivo (según la plantilla)', type: 'textarea' }] : fs, rec);
      if (d) groups.push(`<div role="group" aria-label="${esc(sec.title)}">${d}</div>`);
    }
  }
  if (!groups.length) return '';
  return `<div class="hv-sr" role="group" aria-label="Contenido de la hoja de vida en lectura lineal" style="${SR_STYLE}">${groups.join('')}</div>`;
}

const sheet = (i, { pg, html, marks }) => `<div class="hv-sheet" aria-hidden="true"><div class="mv-page" data-page="${i + 1}">`
  + `<svg class="mv-bg" viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}pt" height="${layout.height}pt" aria-hidden="true" focusable="false">${markShadowText(pg.svg)}</svg>`
  + `${html.join('')}<svg class="mv-ov" viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}pt" height="${layout.height}pt" aria-hidden="true" focusable="false">${marks.join('')}</svg></div></div>`;

function continuation(overflow, t) {
  if (!overflow.length) return '';
  const body = overflow.map(({ sec, list }) => {
    const s = secById[sec], fs = visibleFields(s, t);
    if (!fs.length) return '';
    if (fs.length > 7) { // muchos campos: una ficha (campo / valor) por registro
      return `<section class="mv-cs"><h2>${esc(s.title)} (continuación)</h2>${list.map((it) => `<table class="hv-tbl hv-card"><tbody>${
        fs.filter((f) => has(it[f.id])).map((f) => `<tr><th>${esc(f.label)}</th><td>${multi(show(f, it[f.id]))}</td></tr>`).join('')}</tbody></table>`).join('')}</section>`;
    }
    return `<section class="mv-cs"><h2>${esc(s.title)} (continuación)</h2><table class="hv-tbl"><thead><tr>${fs.map((f) => `<th>${esc(f.label)}</th>`).join('')}</tr></thead><tbody>${
      list.map((it) => `<tr>${fs.map((f) => `<td>${multi(show(f, it[f.id]))}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`;
  }).join('');
  return `<div class="hv-page hv-cont"><h1>HOJA DE VIDA <small>información adicional</small></h1><p>Registros que exceden el espacio previsto en el formato (el formato indica utilizar una hoja por separado).</p>${body}</div>`;
}

function render(profile, template, files) {
  const t = template || null, { P, off } = prep(profile); // solo se imprime lo que aplica según las respuestas (js/conditions.js)
  const { pages, overflow } = renderForm(P, t, files);
  let html = a11yText(P, t, overflow) + pages.map((p, i) => sheet(i, p)).join('') + continuation(overflow, t);
  const loose = [];
  for (const a of annexes(P, t, files, off)) {
    if (isImg(a.file)) html += `<div class="hv-page hv-annex"><h2>Anexo · ${esc(a.title)}</h2><div class="hv-fit"><img src="${esc(a.file.dataUrl)}" alt="${esc(a.title)}"></div></div>`;
    else loose.push(a);
  }
  if (loose.length) {
    html += `<div class="hv-page hv-annex"><h2>Anexos · PDF no impresos</h2><p>Los siguientes archivos son PDF y no salen en esta impresión. Para tener la HV y estos anexos en un solo archivo use «Descargar paquete PDF» en Vista previa; si imprime, adjúntelos por separado:</p><ul>${
      loose.map((a) => `<li>${esc(a.title)} <span class="hv-l">— ${esc(a.file.meta?.name || a.id)}</span></li>`).join('')}</ul></div>`;
  }
  return `<div class="hv-doc">${html}</div>`;
}

// Stub que hace que certList/docList devuelvan TODOS los ids candidatos sin leer ningún archivo.
const ANY_FILE = new Proxy({}, { get: () => ({}) });

export default {
  id: 'minerva',
  name: 'Hoja de Vida para solicitud de empleo (Minerva)',
  schema: { sections, documents, photo: { aspect: '3:4', width: 600, height: 800 } },
  render,
  /** Capacidad de la casilla del PDF para un campo de texto: { comfort, max, multi } | null. Avisos de texto largo en Perfil. */
  fitLimit,
  /** Faltantes (campos obligatorios y documentos) para la plantilla dada: string[] */
  missing,
  /** Ids de archivo cuyo binario necesita render() para esta plantilla: foto (si se muestra) y anexos incluidos. Permite carga perezosa. */
  fileIds(profile, template) {
    const t = template || null, { P, off } = prep(profile);
    const ids = annexes(P, t, ANY_FILE, off).map((a) => a.id);
    if (!t || t.options?.showPhoto !== false) ids.push('photo');
    return ids;
  },
  /** Anexos en orden de aparición: [{ title, id, file:{meta} }] (certificados y luego documentos, CC primero). Lo usa el paquete PDF. */
  annexList(profile, template, files) {
    const { P, off } = prep(profile);
    return annexes(P, template || null, files, off);
  },
  /** Conteo de anexos: { images, others } */
  annexInfo(profile, template, files) {
    const { P, off } = prep(profile);
    const a = annexes(P, template || null, files, off);
    return { images: a.filter((x) => isImg(x.file)).length, others: a.filter((x) => !isImg(x.file)).length };
  },
};

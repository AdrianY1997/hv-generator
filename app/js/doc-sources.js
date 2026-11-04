// Registro de documentos de soporte (G18 + G07). Datos puros, sin DOM. ES LA ÚNICA FUENTE de ids, etiquetas, pistas, base legal y reglas de
// vigencia: los modelos (models/minerva.js; el Formato Único reutiliza esos mismos objetos) construyen su lista `documents` desde aquí.
// Fuentes: docs/FUENTES-OFICIALES.md (investigación del 2026-10-28) y docs/VERIFICACION-LEGAL.md (verificación legal del 2026-11-03).
// Solo se usan URLs allí verificadas o listadas; las no verificadas llevan `urlNota`. Nada de esto envía datos a terceros: son enlaces que el usuario abre.
//
// Reglas de evolución (para no romper datos guardados): los ids son ADITIVOS y nunca se renombran (los archivos viven en `doc:<id>[:n]` y la
// lista visible en profile.documentsShown). Si algún día un id cambiara de significado habría que añadir su equivalencia a `DOC_MIGRATE`
// (hoy vacío: ningún id cambió). Lo que sí cambia con la verificación legal es el CONJUNTO POR DEFECTO (DEFAULT_SHOWN); ver `shownDocIds`.
//
// Campos por fuente:
//   id            id del documento (igual que schema.documents)
//   label, hint   etiqueta y pista que muestra la lista (los modelos las copian a schema.documents)
//   nombre        nombre oficial / descriptivo
//   entidad       entidad que lo emite
//   verdict       'Asistido' (la app prepara, el usuario hace el paso en el sitio y sube el PDF) | 'Manual'
//   tier          'core' (visible por defecto) | 'optional' (se añade si la convocatoria lo exige) | 'otros' (oculto por defecto)
//   core/optional derivados de `tier` (core = visible por defecto; optional = no es del conjunto base)
//   url, urlNota  sitio oficial (urlNota = advertencia si no se verificó)
//   validatorUrl  verificador oficial del certificado, si existe
//   alt           [{label,url}] rutas alternativas (p. ej. Carpeta Ciudadana Digital)
//   email         correo oficial para solicitudes (solo Ley Ángel)
//   action        qué hará el usuario en el sitio (captcha, login, ...)
//   inputs        qué datos se piden
//   steps         pasos cortos
//   manualNote    explicación cuando es solo manual
//   vigencia      { tipo:'oficial'|'practica'|'ninguna', basis:'norma'|'criterio'|'practica'|'ninguna', dias, fuente, nota }
//                 oficial = límite fijado por una norma citada (una plantilla solo puede ACORTARLO, nunca alargarlo; se dice por qué); practica = sin vigencia legal,
//                 el usuario la ajusta (dias sugeridos); basis rotula de dónde sale la regla (VIGENCIA_BASIS)
//   cedulaCopy    true = mostrar "Copiar cédula"
//   legalBasis    [{ text, url }] cita corta y URL (de VERIFICACION-LEGAL.md). Vacío solo si legalStatus = 'sin_verificar'.
//   legalStatus   'verificado' | 'parcial' | 'sin_verificar' (estado de la verificación legal de lo que afirma el registro; debe coincidir con las
//                 etiquetas de docs/VERIFICACION-LEGAL.md: VERIFIED norma pero PARTIAL vigencia/reglamento = 'parcial'; 'sin_verificar' = no se
//                 identificó una norma específica, no es una alarma sobre el documento)
//   legalNote     (opcional) qué falta por verificar, se muestra en «Base legal»
//   employerMayRequire { value:'si'|'depende'|'no', confianza:'alta'|'media'|'baja', nota, chip? }  ¿puede un empleador exigirlo?
//   publicEntityNote   qué cambia si el empleador es una entidad pública

export const CARPETA = { label: 'Carpeta Ciudadana Digital (requiere cuenta propia)', url: 'https://carpetaciudadana.and.gov.co/' };
export const VIGENCIA_AVISO = 'La vigencia real la define la entidad que recibe el documento. Verifica con ella.';
export const POR_VENCER_DIAS = 15;

/** Texto de la regla de vigencia según su origen. */
export const VIGENCIA_BASIS = {
  norma: 'Norma citada (confirma que sigue vigente)',
  criterio: 'Criterio de la Función Pública (no es una norma expresa)',
  practica: 'Práctica de las empresas (sin vigencia legal)',
  ninguna: 'Sin vigencia legal',
};
/** Cómo se rotula si un empleador puede exigir el documento. */
export const EMPLOYER_LABEL = { si: 'Un empleador puede pedirlo', depende: 'Depende del cargo o de la convocatoria', no: 'Un empleador no puede exigirlo' };
export const EMPLOYER_CHIP_NO = 'Un empleador no puede exigirlo — es tu decisión compartirlo';
export const CONFIANZA_LABEL = { alta: 'confianza alta', media: 'confianza media', baja: 'confianza baja' };
export const LEGAL_STATUS_LABEL = { verificado: 'Verificado en fuentes oficiales (nov. 2026)', parcial: 'Verificación parcial (ver la nota)', sin_verificar: 'Sin norma específica identificada' };

/** Descargo orientativo (docs/VERIFICACION-LEGAL.md, sección 7). */
export const DISCLAIMER = {
  title: 'Información orientativa, no es asesoría jurídica.',
  body: 'La lista de documentos y las vigencias que ves aquí resumen normas y fuentes oficiales colombianas a noviembre de 2026 y pueden haber cambiado. Cada entidad o convocatoria define qué soportes exige y con qué antigüedad; verifica siempre con la entidad que te contrata. Algunas reglas son criterios o prácticas de mercado, no normas, y así se indican. Consultas como la de inhabilidades por delitos sexuales contra menores las hace la entidad contratante con tu autorización escrita; no se aportan por tu cuenta. Tus documentos se guardan solo en este navegador; entrégalos únicamente a quien tenga una finalidad legítima y te lo informe (Ley 1581 de 2012). Si crees que te exigen un documento que la ley no permite pedir, consulta al Ministerio del Trabajo o a un abogado.',
};

/** Conjunto visible por defecto (verificación legal 2026-11-03). El conjunto anterior se conserva para pruebas y para documentar la migración. */
export const DEFAULT_SHOWN = ['cedula', 'procuraduria', 'contraloria', 'policia', 'eps', 'pension'];
export const LEGACY_DEFAULT_SHOWN = ['cedula', 'policia', 'procuraduria', 'contraloria', 'rnmc', 'inhabilidades'];
/** Equivalencias id antiguo -> id actual. Vacío: ningún id se ha renombrado ni cambiado de significado. */
export const DOC_MIGRATE = {};

const none = { tipo: 'ninguna', basis: 'ninguna', dias: null, fuente: 'No se encontró una vigencia oficial.', nota: '' };

// Referencias legales reutilizadas (cita corta + URL leída en VERIFICACION-LEGAL.md).
const REF = {
  dl19: { text: 'Decreto-Ley 19 de 2012, arts. 93 y 94: sin certificado judicial en papel; consulta en línea', url: 'https://www.camarabaq.org.co/wp-content/uploads/2019/08/Decreto-ley-019-de-2012.pdf' },
  policiaFaq: { text: 'Policía Nacional, preguntas frecuentes: la consulta en línea no tiene vigencia', url: 'https://antecedentes.policia.gov.co:7005/WebJudicial/preguntas.xhtml' },
  concepto267521: { text: 'Función Pública, Concepto 267521 de 2021 (vigencia de antecedentes)', url: 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=171068' },
  res143: { text: 'Resolución PGN 143 de 2002, vigencia del certificado: 3 meses (art. 8 en el texto de la Alcaldía de Bogotá; Función Pública lo cita como art. 3)', url: 'https://www.alcaldiabogota.gov.co/sisjur/normas/Norma1.jsp?i=15057' },
  ley1952: { text: 'Ley 1952 de 2019, art. 238 (certificado de antecedentes, ordinario y especial)', url: 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=90324' },
  procuraduriaCert: { text: 'Procuraduría: certificado de antecedentes (ordinario y especial)', url: 'https://www.procuraduria.gov.co/Pages/certificado-antecedentes.aspx' },
  ley610: { text: 'Ley 610 de 2000, art. 60 (boletín trimestral de responsables fiscales)', url: 'https://www1.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=5725' },
  dur1083: { text: 'Decreto 1083 de 2015, arts. 2.2.5.1.4 y 2.2.5.1.5 (requisitos y verificación en la Rama Ejecutiva)', url: 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=62866' },
  ley1801: { text: 'Ley 1801 de 2016, art. 183 (consecuencias por no pagar multas); texto en el Concepto ICBF 4 de 2022', url: 'https://www.icbf.gov.co/sites/default/files/normatividad/concepto_4_de_2022.pdf' },
  rnmcFaq: { text: 'Policía Nacional, preguntas frecuentes del RNMC', url: 'https://srvcnpc.policia.gov.co/multimedia/formatos/PREGUNTAS_FRECUENTES_CNSCC_RNMC.pdf' },
  ley1918: { text: 'Ley 1918 de 2018, arts. 3 a 5 (registro de inhabilidades, autorización previa, reverificación cada 4 meses)', url: 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=87420' },
  dec753: { text: 'Decreto 753 de 2019, art. 2 par. 2 (autorización previa, expresa y escrita del aspirante)', url: 'https://apps.procuraduria.gov.co/gd_1952/docs/d0753019.htm' },
  c407: { text: 'Corte Constitucional, C-407 de 2020: inexequible el art. 2 de la Ley 1918 y la frase «por el ICBF» del art. 4', url: 'https://www.corteconstitucional.gov.co/relatoria/2020/C-407-20.htm' },
  ley2455: { text: 'Ley 2455 de 2025 («Ley Ángel»), art. 28 (registro de inhabilidades por delitos contra animales)', url: 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=259656' },
  ley2097: { text: 'Ley 2097 de 2021 (REDAM), art. 4 par. (validez de 3 meses) y art. 6 (no nombrar ni posesionar a reportados)', url: 'https://cancilleria.gov.co/sites/default/files/Normograma/docs/pdf/ley_2097_2021.pdf' },
  bdme: { text: 'Contaduría General de la Nación, ficha técnica del BDME (cortes 30 de mayo y 30 de noviembre)', url: 'https://www.contaduria.gov.co/documents/d/guest/fichatecnicaboletin44?download=true' },
  ley1861: { text: 'Ley 1861 de 2017, art. 42 (situación militar; no se puede exigir la tarjeta militar para ingresar a un empleo)', url: 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma_pdf.php?i=117498' },
  ley1581: { text: 'Ley 1581 de 2012, arts. 4 a 6 (finalidad informada y autorización; datos sensibles)', url: 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=49981' },
  res3941: { text: 'Resolución MinTrabajo 3941 de 1994: prohibida la prueba de embarazo salvo actividades de alto riesgo', url: 'https://cancilleria.gov.co/sites/default/files/Normograma/docs/resolucion_mintrabajo_3941_1994.htm' },
  dec2460: { text: 'Decreto 2460 de 2013 (RUT como mecanismo único de identificación tributaria)', url: 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=59604' },
};

const PUBLIC_VERIFIES = 'Una entidad de la Rama Ejecutiva verifica por sí misma los antecedentes fiscales, disciplinarios y judiciales y no puede exigirte documentos que ya reposen en ella (Decreto 1083 de 2015, art. 2.2.5.1.5); aun así, las convocatorias a veces los piden.';

const RAW = {
  cedula: {
    id: 'cedula', tier: 'core', label: 'Cédula de ciudadanía (ambas caras)', hint: 'Escaneo legible, frente y reverso',
    nombre: 'Cédula de ciudadanía', entidad: 'Registraduría Nacional (documento propio)', verdict: 'Manual',
    action: 'Escanear o fotografiar tu cédula', inputs: [],
    steps: ['Escanea o fotografía ambas caras con buena luz y sin recortes.', 'Súbela como imagen o PDF legible. Si tienes la cédula digital, descarga el PDF desde la app oficial.'],
    manualNote: 'Es tu propio documento: no hay sitio oficial al cual acudir.', vigencia: { ...none, fuente: 'La cédula no tiene fecha de vigencia propia.' }, cedulaCopy: false,
    legalBasis: [], legalStatus: 'sin_verificar',
    employerMayRequire: { value: 'si', confianza: 'alta', nota: 'Es el documento de identificación: se pide en prácticamente todos los procesos de selección.' },
    publicEntityNote: 'Las entidades públicas la piden para verificar tu identidad al vincularte.',
  },
  procuraduria: {
    id: 'procuraduria', tier: 'core', label: 'Certificado de antecedentes (Procuraduría)',
    hint: 'Ordinario (anotaciones vigentes) o especial (para cargos que exigen ausencia de antecedentes). Vigencia de 3 meses según la norma citada (Res. PGN 143/2002); confirma que sigue vigente.',
    nombre: 'Certificado de antecedentes disciplinarios', entidad: 'Procuraduría General de la Nación', verdict: 'Asistido',
    url: 'https://www.procuraduria.gov.co/Pages/certificado-antecedentes.aspx',
    validatorUrl: 'https://www.procuraduria.gov.co/Pages/Verificacion-de-certificado-de-antecedentes.aspx',
    alt: [CARPETA],
    action: 'Responder una pregunta aritmética anti-robot y descargar el PDF',
    inputs: ['Tipo y número de documento', 'Tipo de certificado: Ordinario o Especial', 'Pregunta de seguridad'],
    steps: ['Abre el sitio y pulsa "Generar".', 'Elige tipo de documento, pega tu cédula y el tipo de certificado (Ordinario).', 'Responde la pregunta de seguridad y descarga el PDF.', 'Arrastra el PDF aquí.'],
    notes: ['El certificado ordinario trae solo las anotaciones vigentes; el especial trae todas y lo piden los cargos que exigen ausencia de antecedentes (Ley 1952 de 2019, art. 238).'],
    vigencia: { tipo: 'oficial', basis: 'norma', dias: 90, fuente: '3 meses desde la expedición (Res. PGN 143/2002, art. 8 en el texto de la Alcaldía de Bogotá; la Función Pública lo cita como art. 3, Concepto 267521 de 2021). No se comprobó si hay un reglamento posterior.', nota: '' },
    cedulaCopy: true,
    legalBasis: [REF.procuraduriaCert, REF.ley1952, REF.res143, REF.concepto267521], legalStatus: 'parcial',
    legalNote: 'La existencia del certificado y sus dos tipos están verificadas en la Procuraduría y la Ley 1952. La vigencia de 3 meses está en la Res. PGN 143/2002 (texto de la Alcaldía de Bogotá), pero no se comprobó que siga vigente ni que no la haya reemplazado un reglamento posterior: confírmala con la entidad.',
    employerMayRequire: { value: 'depende', confianza: 'media', nota: 'No hay una obligación legal general de aportarlo a un empleador privado, aunque es una práctica muy común pedirlo. En el sector público la entidad lo consulta por sí misma.' },
    publicEntityNote: PUBLIC_VERIFIES + ' Para cargos con exigencia de «ausencia de antecedentes» se usa el certificado especial.',
  },
  contraloria: {
    id: 'contraloria', tier: 'core', label: 'Antecedentes fiscales (Contraloría)',
    hint: 'Certificado de la Contraloría. Los 3 meses de vigencia son un criterio de la Función Pública, no una norma expresa.',
    nombre: 'Certificado de antecedentes fiscales', entidad: 'Contraloría General de la República', verdict: 'Asistido',
    url: 'https://cfiscal.contraloria.gov.co/certificados/certificadopersonanatural.aspx',
    urlInfo: 'https://www.contraloria.gov.co/control-fiscal/responsabilidad-fiscal/certificado-de-antecedentes-fiscales',
    alt: [CARPETA],
    action: 'Resolver el reCAPTCHA de Google y descargar el PDF',
    inputs: ['Tipo y número de documento'],
    steps: ['Abre el formulario de persona natural.', 'Elige el tipo de documento y pega tu cédula.', 'Marca el reCAPTCHA y genera el certificado.', 'Arrastra el PDF aquí.'],
    notes: ['El PDF trae un "Código de Verificación" para constatar su autenticidad (la ruta exacta de verificación no se verificó).'],
    vigencia: { tipo: 'practica', basis: 'criterio', dias: 90, fuente: '3 meses desde la expedición: criterio de la Función Pública (Concepto 267521 de 2021), atado al boletín trimestral de responsables fiscales (Ley 610 de 2000, art. 60).', nota: 'No existe una norma expresa sobre su vigencia; la entidad receptora puede pedir otra antigüedad.' },
    cedulaCopy: true,
    legalBasis: [REF.ley610, REF.concepto267521], legalStatus: 'parcial',
    employerMayRequire: { value: 'depende', confianza: 'media', nota: 'La ley obliga a nominadores y representantes legales a abstenerse de nombrar o contratar a quienes figuren en el boletín de responsables fiscales; que debas aportar el certificado depende de la entidad.' },
    publicEntityNote: PUBLIC_VERIFIES,
  },
  policia: {
    id: 'policia', tier: 'core', label: 'Antecedentes judiciales (consulta en línea)',
    hint: 'El certificado en papel fue suprimido (Decreto 19 de 2012); tu empleador puede consultarlo él mismo. Sin vigencia legal.',
    nombre: 'Antecedentes judiciales (consulta en línea)', entidad: 'Policía Nacional', verdict: 'Asistido',
    url: 'https://antecedentes.policia.gov.co:7005/WebJudicial/',
    action: 'Aceptar términos y consultar; luego imprimir la página como PDF (puede pedir captcha: no verificado)',
    inputs: ['Número de cédula, sin puntos'],
    steps: ['Abre el sitio de la Policía y acepta los términos.', 'Pega tu cédula (sin puntos) y consulta.', 'Imprime la página y elige "Guardar como PDF".', 'Arrastra el PDF aquí.'],
    notes: ['La Policía indica que NO genera un PDF oficial: el resultado es la impresión de la consulta, sin código de verificación.', 'Sus términos limitan la consulta a tu propia información.', 'Para trámites en el exterior se necesita una constancia apostillada (preguntas frecuentes de la Policía).'],
    vigencia: { tipo: 'practica', basis: 'practica', dias: 30, fuente: 'La Policía y la Función Pública indican que la consulta en línea no tiene vigencia legal (la base se actualiza a diario). Muchas empresas piden una impresión de 30 a 90 días.', nota: 'Práctica de las empresas, no norma. Ajusta los días a lo que pida la entidad.' },
    cedulaCopy: true,
    legalBasis: [REF.dl19, REF.policiaFaq, REF.concepto267521], legalStatus: 'verificado',
    employerMayRequire: { value: 'no', confianza: 'alta', nota: 'Ninguna persona está obligada a presentar un documento que certifique sus antecedentes judiciales ante entidades públicas o privadas (Decreto-Ley 19 de 2012, art. 93). Las entidades y los particulares pueden consultarlos en línea (art. 94). En la práctica muchas empresas piden la impresión.' },
    publicEntityNote: PUBLIC_VERIFIES,
  },
  rnmc: {
    id: 'rnmc', tier: 'optional', label: 'Registro Nacional de Medidas Correctivas (RNMC)',
    hint: 'Muestra multas pendientes. La verifica la autoridad (art. 183 de la Ley 1801); no es antecedente penal. Sin vigencia legal.',
    nombre: 'Registro Nacional de Medidas Correctivas (RNMC)', entidad: 'Policía Nacional', verdict: 'Asistido',
    url: 'https://srvcnpc.policia.gov.co/PSC/frm_cnp_consulta.aspx',
    action: 'Consultar con tu cédula e imprimir el resultado como PDF',
    inputs: ['Consultar por (cédula de ciudadanía)', 'Número de identificación'],
    steps: ['Abre el portal y acepta el tratamiento de datos.', 'Elige "Cédula de ciudadanía" y pega tu número.', 'Consulta, imprime la página y guarda como PDF.', 'Arrastra el PDF aquí.'],
    manualNote: 'El art. 183 de la Ley 1801 no te obliga a presentar este certificado: sus consecuencias (no ser nombrado en cargo público, no contratar con el Estado) aplican solo a multas sin pagar tras seis meses, y las verifica la autoridad. Úsalo solo si la convocatoria lo pide.',
    vigencia: { tipo: 'practica', basis: 'practica', dias: 30, fuente: 'No existe una vigencia legal. Muchas empresas piden una impresión de 30 a 90 días.', nota: 'Práctica de las empresas, no norma. Ajusta los días a lo que pida la entidad.' },
    cedulaCopy: true,
    legalBasis: [REF.ley1801, REF.rnmcFaq], legalStatus: 'parcial',
    employerMayRequire: { value: 'depende', confianza: 'media', nota: 'No hay una exigencia legal de aportarlo. Una multa sin pagar solo inhabilita tras seis meses y la autoridad lo verifica; el al-día también se prueba con cualquier comprobante de pago.' },
    publicEntityNote: 'La autoridad verifica que estés al día en el pago de multas antes de nombrarte o contratarte (Ley 1801 de 2016, art. 183).',
  },
  inhabilidades: {
    id: 'inhabilidades', tier: 'otros', label: 'Inhabilidades por delitos sexuales contra menores (Ley 1918)',
    hint: 'La consulta la hace la entidad con tu autorización escrita, solo para cargos con trato directo y habitual con menores. No es un documento que debas aportar.',
    nombre: 'Sistema de Consulta de Inhabilidades por Delitos Sexuales (Ley 1918 de 2018)', entidad: 'Policía Nacional / DIJIN', verdict: 'Manual',
    url: 'https://inhabilidades.policia.gov.co:8080/',
    urlInfo: 'https://www.icbf.gov.co/atencion-y-servicios-ciudadania/sistema-de-consulta-de-inhabilidades-por-delitos-sexuales',
    action: 'Lo consulta la ENTIDAD contratante con tu autorización (reCAPTCHA); tú solo adjuntas lo que ella te entregue',
    inputs: ['Cédula', 'Fecha de expedición de la cédula', 'Nombre y NIT de la entidad que consulta'],
    steps: ['Pregunta a la entidad si exige este soporte para el cargo (solo aplica con contacto directo y habitual con menores).', 'Autoriza por escrito la consulta; la entidad la hace con su NIT.', 'Adjunta aquí el certificado que te entregue.'],
    manualNote: 'La consulta está diseñada para la entidad que contrata: exige el nombre y NIT de la empresa, la información es reservada y la entidad debe reverificarla cada 4 meses. La app no la automatiza ni la hace por ti.',
    notes: ['El nombre oficial es «Registro de Inhabilidades por delitos sexuales contra menores de edad» (Ley 1918, art. 3); el portal se llama «Sistema de Consulta de Inhabilidades por Delitos Sexuales».', 'La Corte Constitucional (C-407 de 2020) declaró inexequibles el art. 2 de la Ley 1918 (cargos definidos por el ICBF) y la frase «por el ICBF» del art. 4. La regla de reverificación cada cuatro meses se mantiene. La lista de cargos del Decreto 753 de 2019 queda con base debilitada: úsala solo como orientación.'],
    vigencia: { ...none, fuente: 'No hay vigencia del certificado; la entidad reverifica cada 4 meses durante la relación laboral (Ley 1918, art. 4).' },
    cedulaCopy: true,
    legalBasis: [REF.ley1918, REF.dec753, REF.c407], legalStatus: 'verificado',
    employerMayRequire: { value: 'depende', confianza: 'alta', nota: 'Solo para cargos con trato directo y habitual con menores, y la consulta la hace la entidad con tu autorización escrita; usar el resultado sin esa autorización no está permitido (Decreto 753 de 2019).' },
    publicEntityNote: 'Igual que en el sector privado: la entidad consulta con tu autorización escrita si el cargo implica trato habitual con menores.',
  },
  libreta: {
    id: 'libreta', tier: 'optional', label: 'Situación militar (tarjeta o certificación provisional)',
    hint: 'No pueden exigirte la tarjeta para ingresar a un empleo (Ley 1861, art. 42); sí que tengas la situación definida.',
    nombre: 'Situación militar (tarjeta o certificación provisional)', entidad: 'Ejército Nacional', verdict: 'Manual',
    url: 'https://www.libretamilitar.mil.co/',
    action: 'Iniciar sesión y resolver captcha en el portal; descargar el certificado',
    inputs: ['Cuenta del portal (registro propio)'],
    steps: ['Abre el portal y entra con tu usuario (o regístrate).', 'Usa "Consulta de situación militar" y descarga el certificado.', 'Súbelo aquí.'],
    manualNote: 'La situación militar se debe acreditar para ejercer cargos públicos, trabajar en el sector privado y celebrar contratos de prestación de servicios, pero las entidades no pueden exigir la tarjeta militar para ingresar a un empleo (Ley 1861 de 2017, art. 42). Quienes no son aptos, están exentos o superaron la edad tienen 18 meses para definirla y pueden usar la certificación provisional en línea.',
    vigencia: { ...none, fuente: 'No se encontró vigencia del certificado; la certificación provisional vale 18 meses (art. 42).' }, cedulaCopy: true,
    legalBasis: [REF.ley1861, REF.dur1083], legalStatus: 'verificado',
    employerMayRequire: { value: 'no', confianza: 'alta', chip: 'No pueden exigirte la tarjeta para ingresar — sí que tengas la situación definida', nota: 'Las entidades públicas o privadas no pueden exigir la presentación de la tarjeta militar para ingresar a un empleo (Ley 1861, art. 42); sí pueden pedir que tu situación militar esté definida o en certificación provisional.' },
    publicEntityNote: 'La Rama Ejecutiva exige «tener definida la situación militar, en los casos a que haya lugar» (Decreto 1083 de 2015, art. 2.2.5.1.4, num. 5); se admite la certificación provisional.',
  },
  rut: {
    id: 'rut', tier: 'optional', label: 'RUT', hint: 'Normalmente solo lo necesitan contratistas e independientes.',
    nombre: 'Registro Único Tributario (RUT)', entidad: 'DIAN', verdict: 'Manual',
    url: 'https://www.dian.gov.co/tramitesservicios/Tramites_Impuestos/RUT/Paginas/default.aspx', urlNota: 'Página de trámites del RUT; su contenido no se verificó.',
    alt: [CARPETA],
    action: 'Iniciar sesión con tu clave Muisca, o pedir la copia que llega al correo registrado en el RUT',
    inputs: ['Clave Muisca, o documento y correo registrado'],
    steps: ['Abre la página de trámites del RUT de la DIAN.', 'Descarga el PDF con tu clave, o solicita la copia a tu correo (según guías de terceros, no verificado).', 'Súbelo aquí.'],
    manualNote: 'No hay forma de automatizarlo: requiere tu acceso personal. Un asalariado normalmente no lo necesita, salvo ciertos umbrales (fuente secundaria); un contratista independiente sí debe inscribirse.',
    vigencia: { ...none, fuente: 'El RUT no vence; muchas entidades piden una copia reciente (práctica, sin norma).' }, cedulaCopy: true,
    legalBasis: [REF.dec2460], legalStatus: 'parcial',
    employerMayRequire: { value: 'depende', confianza: 'media', nota: 'Suele pedirse a contratistas e independientes. Para un trabajador asalariado no se encontró una norma que lo exija ni que lo prohíba.' },
    publicEntityNote: 'En entidades públicas se pide sobre todo a contratistas de prestación de servicios.',
  },
  eps: {
    id: 'eps', tier: 'core', label: 'Certificación de afiliación a EPS',
    hint: 'La afiliación la tramita el empleador; muchos piden el certificado de la EPS (ADRES o EPS).',
    nombre: 'Certificación de afiliación a EPS', entidad: 'ADRES (consulta BDUA) o tu EPS', verdict: 'Asistido',
    url: 'https://aplicaciones.adres.gov.co/bdua_internet/Pages/ConsultarAfiliadoWeb.aspx',
    action: 'Resolver un captcha de imagen de 5 caracteres e imprimir el resultado como PDF',
    inputs: ['Tipo y número de documento', 'Captcha de imagen'],
    steps: ['Abre la consulta de ADRES.', 'Elige tipo de documento, pega tu cédula y escribe el captcha.', 'Imprime el resultado como PDF.', 'Arrástralo aquí.'],
    manualNote: 'El resultado de ADRES no es un certificado firmado. Si la convocatoria pide el certificado formal, descárgalo desde el portal de tu EPS.',
    vigencia: { ...none, fuente: 'La BDUA se actualiza cada mes; no hay vigencia oficial del soporte.' }, cedulaCopy: true,
    legalBasis: [], legalStatus: 'sin_verificar',
    employerMayRequire: { value: 'depende', confianza: 'media', nota: 'La afiliación al sistema de salud la tramita el empleador; el trabajador solo elige entidad. Pedir el certificado al candidato es una práctica, no una obligación legal del candidato (norma no leída en esta ronda).' },
    publicEntityNote: 'La entidad pública tramita la afiliación al vincularte.',
  },
  pension: {
    id: 'pension', tier: 'core', label: 'Certificación de fondo de pensión',
    hint: 'La afiliación la tramita el empleador; muchos piden el certificado del fondo.',
    nombre: 'Certificación de fondo de pensión', entidad: 'RUAF / tu fondo o Colpensiones', verdict: 'Manual',
    url: 'https://ruaf.sispro.gov.co/',
    alt: [{ label: 'Colpensiones: certificados de afiliación', url: 'https://www.colpensiones.gov.co/pensiones/' }],
    action: 'Consultar (según terceros hay captcha) o pedir el certificado a tu fondo',
    inputs: ['Tipo y número de documento'],
    steps: ['Consulta tu afiliación en RUAF o descarga el certificado de tu fondo.', 'Súbelo aquí.'],
    manualNote: 'No hay API pública; cada fondo entrega su propio certificado.',
    vigencia: { ...none, fuente: 'No se encontró una norma de vigencia.' }, cedulaCopy: true,
    legalBasis: [], legalStatus: 'sin_verificar',
    employerMayRequire: { value: 'depende', confianza: 'media', nota: 'La afiliación al sistema de pensiones la tramita el empleador. Pedir el certificado al candidato es una práctica, no una obligación legal del candidato (norma no leída en esta ronda).' },
    publicEntityNote: 'La entidad pública tramita la afiliación al vincularte.',
  },
  sisben: {
    id: 'sisben', tier: 'otros', label: 'Consulta de grupo SISBÉN',
    hint: 'No se encontró una norma que lo exija; úsalo solo si la convocatoria lo pide.',
    nombre: 'Consulta de grupo Sisbén', entidad: 'Departamento Nacional de Planeación', verdict: 'Asistido',
    url: 'https://portal.sisben.gov.co/Paginas/consulta-tu-grupo.html', urlNota: 'Dirección según una fuente secundaria; el sitio no respondió en la prueba de verificación.',
    action: 'Consultar con tipo y número de documento y guardar como PDF',
    inputs: ['Tipo y número de documento', 'Validación de seguridad'],
    steps: ['Abre la consulta del Sisbén.', 'Pega tu cédula y consulta.', 'Guarda como PDF y súbelo aquí.'],
    manualNote: 'Solo si aplica a la convocatoria. No se encontró una norma que obligue al candidato a presentarlo ni que lo prohíba (sin verificar).',
    vigencia: { ...none, fuente: 'No se encontró vigencia.' }, cedulaCopy: true,
    legalBasis: [], legalStatus: 'sin_verificar',
    employerMayRequire: { value: 'depende', confianza: 'baja', nota: 'No se encontró una norma que lo exija ni que lo prohíba como filtro de selección. Sé prudente: comparte solo lo que la convocatoria justifique.' },
    publicEntityNote: 'No se encontró una exigencia para empleos públicos.',
  },
  redam: {
    id: 'redam', tier: 'optional', label: 'REDAM (deudores alimentarios morosos)',
    hint: 'Ley 2097 de 2021: no se puede nombrar ni posesionar en cargos públicos a los reportados; el certificado vale 3 meses según la norma citada ("Válida hasta"); confirma que sigue vigente.',
    nombre: 'Registro de Deudores Alimentarios Morosos (REDAM)', entidad: 'Consejo Superior de la Judicatura / Carpeta Ciudadana Digital', verdict: 'Manual',
    url: 'https://www.redam.gov.co/', validatorUrl: 'https://registro.redam.gov.co/validate-certificate/',
    alt: [CARPETA],
    action: 'Autenticarte con tu cuenta digital (según guías de terceros, la Carpeta Ciudadana es el único medio)',
    inputs: ['Cuenta de Carpeta Ciudadana Digital'],
    steps: ['Entra a tu Carpeta Ciudadana Digital y busca el certificado REDAM (portal no verificado a fondo).', 'Descarga el PDF.', 'Arrástralo aquí: la app lee "Válida hasta" y el código de verificación.'],
    manualNote: 'La ley prohíbe nombrar y posesionar en cargos públicos a las personas reportadas (Ley 2097 de 2021, art. 6); que debas presentar el certificado depende de la entidad, que está habilitada para verificarlo.',
    vigencia: { tipo: 'oficial', basis: 'norma', dias: 90, fuente: 'Validez de 3 meses según la Ley 2097 de 2021, art. 4, parágrafo (no se leyó el Decreto 1310 de 2022 que la desarrolla). El PDF imprime "Válida hasta"; si falta, la app usa 90 días desde la expedición.', nota: '' },
    cedulaCopy: true,
    legalBasis: [REF.ley2097], legalStatus: 'parcial',
    legalNote: 'La Ley 2097 de 2021 (validez de 3 meses, prohibición de nombrar y posesionar a los reportados) se leyó en el texto oficial. El Decreto 1310 de 2022, que reglamenta la obtención del certificado, no se leyó, y el portal no se verificó a fondo: confirma la vigencia con la entidad.',
    employerMayRequire: { value: 'depende', confianza: 'media', nota: 'Quien figure como reportado no puede ser nombrado ni posesionado en un cargo público; el reportado solo puede contratar con el Estado al ponerse a paz y salvo. En el sector privado no aplica salvo contratación con el Estado.' },
    publicEntityNote: 'Prohibición legal de nombrar o posesionar a los reportados (Ley 2097 de 2021, art. 6, num. 2).',
  },
  bdme: {
    id: 'bdme', tier: 'otros', label: 'BDME (deudores morosos del Estado)',
    hint: 'Contaduría General de la Nación; boletín semestral con cortes al 30 de mayo y al 30 de noviembre. Solo si la convocatoria lo exige.',
    nombre: 'Boletín de Deudores Morosos del Estado (BDME)', entidad: 'Contaduría General de la Nación', verdict: 'Manual',
    url: 'https://www.contaduria.gov.co/acerca-de-bdme',
    action: 'Registrarte como usuario con contraseña y consultar por número de identificación',
    inputs: ['Usuario y contraseña del portal'],
    steps: ['Abre la página del BDME y regístrate si no tienes cuenta.', 'Consulta por tu número de identificación y descarga el PDF.', 'Súbelo aquí.'],
    manualNote: 'Boletín semestral con cortes al 30 de mayo y al 30 de noviembre (ficha técnica de la Contaduría). La afirmación de que sea un «impedimento para contratar con el Estado» NO se pudo verificar: no se encontró una norma que lo exija para contratar o posesionarse. Úsalo solo si la convocatoria lo pide.',
    vigencia: { ...none, fuente: 'Boletín semestral; el certificado no indica vigencia.' }, cedulaCopy: true,
    legalBasis: [REF.bdme], legalStatus: 'parcial',
    employerMayRequire: { value: 'depende', confianza: 'baja', nota: 'No se encontró una exigencia de empleadores ni una norma que lo vuelva requisito (sin verificar).' },
    publicEntityNote: 'No se encontró una exigencia para empleos públicos (sin verificar).',
  },
  vigenciacedula: {
    id: 'vigenciacedula', tier: 'otros', label: 'Certificado de vigencia de la cédula',
    hint: 'Registraduría. No se encontró una norma que lo exija; úsalo solo si la convocatoria lo pide.',
    nombre: 'Certificado de vigencia de la cédula', entidad: 'Registraduría Nacional del Estado Civil', verdict: 'Manual',
    url: 'https://certvigenciacedula.registraduria.gov.co/',
    action: 'Superar el desafío anti-robot (Cloudflare) y descargar el certificado',
    inputs: ['Número de cédula', 'Fecha de expedición (según una guía de terceros)'],
    steps: ['Abre el sitio de la Registraduría.', 'Supera la verificación de conexión y llena tus datos.', 'Descarga el certificado y súbelo aquí.'],
    manualNote: 'Es el sitio más hostil a la automatización; hay que hacerlo a mano. No se encontró una norma que lo exija en procesos de selección (sin verificar).',
    vigencia: { ...none, fuente: 'No se encontró vigencia.' }, cedulaCopy: true,
    legalBasis: [], legalStatus: 'sin_verificar',
    employerMayRequire: { value: 'depende', confianza: 'baja', nota: 'No se encontró una norma que lo exija ni que lo prohíba en procesos de selección.' },
    publicEntityNote: 'No se encontró una exigencia para empleos públicos.',
  },
  leyangel: {
    id: 'leyangel', tier: 'otros', label: 'Inhabilidades por delitos contra animales (Ley Ángel)',
    hint: 'Solo si el cargo se relaciona con animales; lo solicita la entidad. No confundir con la Ley 2480 de 2025 («Ley Kiara»).',
    nombre: 'Inhabilidades por delitos contra animales (Ley 2455 de 2025, "Ley Ángel")', entidad: 'Policía Nacional / DIJIN', verdict: 'Manual',
    email: 'dijin.araic-atc@policia.gov.co',
    action: 'Enviar una solicitud firmada por correo (no hay portal)',
    inputs: ['Solicitud firmada', 'Copia de la cédula vigente'],
    steps: ['Redacta y firma una solicitud del certificado.', 'Envíala por correo con copia de tu cédula vigente (extranjeros: pasaporte y cédula de extranjería).', 'Adjunta aquí la respuesta.'],
    manualNote: 'Solo si el cargo se relaciona con animales: el certificado se expide a solicitud de entidades que desarrollen actividades relacionadas con animales (Ley 2455 de 2025, art. 28). Un tercero necesita autorización notariada o poder. La Ley 2480 de 2025 es la «Ley Kiara» (cuidado de animales de compañía) y no crea ningún certificado.',
    vigencia: { ...none, fuente: 'No se encontró vigencia.' }, cedulaCopy: false,
    legalBasis: [REF.ley2455], legalStatus: 'verificado',
    employerMayRequire: { value: 'depende', confianza: 'alta', nota: 'Solo lo solicitan entidades cuyo objeto se relaciona con animales.' },
    publicEntityNote: 'Igual que en el sector privado: solo entidades que desarrollen actividades relacionadas con animales.',
  },
  // ---- Agregados con la verificación legal del 2026-11-03 (ids nuevos, aditivos) ----
  autorizaciondatos: {
    id: 'autorizaciondatos', tier: 'optional', label: 'Autorización de tratamiento de datos personales',
    hint: 'La entidad debe informarte la finalidad y pedir tu autorización (Ley 1581 de 2012). Firma solo lo que entiendas.',
    nombre: 'Autorización de tratamiento de datos personales (Ley 1581 de 2012)', entidad: 'La entidad o empresa que te contrata', verdict: 'Manual',
    action: 'Leer, firmar y adjuntar el formato que te entregue la entidad',
    inputs: [],
    steps: ['Pide a la entidad su formato de autorización (debe indicar quién trata tus datos, para qué y cómo ejercer tus derechos).', 'Léelo completo y fírmalo si estás de acuerdo.', 'Escanéalo o fotografíalo y súbelo aquí.'],
    manualNote: 'No hay un sitio oficial ni un formato único: lo redacta cada entidad. Los datos sensibles (salud, vida sexual, biométricos, origen racial, religión, afiliación sindical) solo se pueden tratar con tu autorización explícita y una finalidad informada.',
    vigencia: { ...none, fuente: 'No aplica: es un documento firmado por ti.' }, cedulaCopy: false,
    legalBasis: [REF.ley1581], legalStatus: 'verificado',
    employerMayRequire: { value: 'si', confianza: 'alta', nota: 'La entidad que trata tus datos debe obtener tu autorización informada; es normal que te la pida para el proceso de selección.' },
    publicEntityNote: 'Aplica igual a entidades públicas.',
  },
  autorizacion1918: {
    id: 'autorizacion1918', tier: 'otros', label: 'Autorización escrita para consultar inhabilidades (Ley 1918)',
    hint: 'Solo para cargos con trato directo y habitual con menores. La entidad debe tenerla antes de consultar; guarda tu copia.',
    nombre: 'Autorización previa, expresa y escrita del aspirante (Ley 1918 de 2018, Decreto 753 de 2019)', entidad: 'La entidad que te contrata', verdict: 'Manual',
    action: 'Firmar la autorización que te entregue la entidad y conservar una copia',
    inputs: [],
    steps: ['La entidad te entrega su formato de autorización para consultar el registro de inhabilidades.', 'Fírmalo solo si el cargo implica trato directo y habitual con menores.', 'Conserva una copia aquí.'],
    manualNote: 'La entidad debe obtener tu autorización previa, expresa y escrita y guardarla en el proceso de selección; usar el resultado sin ella tiene sanciones (Decreto 753, art. 2 par. 2).',
    vigencia: { ...none, fuente: 'No aplica: es un documento firmado por ti.' }, cedulaCopy: false,
    legalBasis: [REF.dec753, REF.ley1918], legalStatus: 'verificado',
    employerMayRequire: { value: 'si', confianza: 'alta', nota: 'Solo si el cargo implica trato directo y habitual con menores: es la condición para que la entidad pueda hacer la consulta.' },
    publicEntityNote: 'Igual en entidades públicas.',
  },
  procuraduriaespecial: {
    id: 'procuraduriaespecial', tier: 'optional', label: 'Certificado de antecedentes especial (Procuraduría)',
    hint: 'Trae todas las anotaciones, no solo las vigentes. Lo piden los cargos que exigen ausencia de antecedentes.',
    nombre: 'Certificado de antecedentes especial (Procuraduría)', entidad: 'Procuraduría General de la Nación', verdict: 'Asistido',
    url: 'https://www.procuraduria.gov.co/Pages/certificado-antecedentes.aspx',
    validatorUrl: 'https://www.procuraduria.gov.co/Pages/Verificacion-de-certificado-de-antecedentes.aspx',
    alt: [CARPETA],
    action: 'Responder una pregunta aritmética anti-robot y descargar el PDF',
    inputs: ['Tipo y número de documento', 'Tipo de certificado: Especial', 'Pregunta de seguridad'],
    steps: ['Abre el sitio y pulsa "Generar".', 'Elige tipo de documento, pega tu cédula y el tipo de certificado (Especial).', 'Responde la pregunta de seguridad y descarga el PDF.', 'Arrastra el PDF aquí.'],
    notes: ['«El certificado de antecedente especial refleja todas las anotaciones que figuren en la base de datos» (Procuraduría).'],
    vigencia: { tipo: 'oficial', basis: 'norma', dias: 90, fuente: '3 meses desde la expedición (Res. PGN 143/2002, art. 8 en el texto de la Alcaldía de Bogotá; la Función Pública lo cita como art. 3).', nota: '' },
    cedulaCopy: true,
    legalBasis: [REF.procuraduriaCert, REF.ley1952, REF.res143], legalStatus: 'parcial',
    legalNote: 'El certificado especial está verificado (Procuraduría y Ley 1952, art. 238). Su vigencia de 3 meses viene de la Res. PGN 143/2002 y no se comprobó que siga vigente: confírmala con la entidad.',
    employerMayRequire: { value: 'depende', confianza: 'alta', nota: 'Se usa para nombramiento o posesión en cargos que exigen ausencia de antecedentes (Ley 1952, art. 238). Para el resto basta el certificado ordinario.' },
    publicEntityNote: 'Cargos con exigencia de «ausencia de antecedentes»: certificado especial (Ley 1952 de 2019, art. 238).',
  },
  bienesrentas: {
    id: 'bienesrentas', tier: 'optional', label: 'Declaración de bienes y rentas (SIGEP)',
    hint: 'Empleos públicos: se diligencia en el SIGEP o con el formato de Función Pública (Ley 190 de 1995, art. 13) antes de posesionarte. También sirve para el Formato Único.',
    nombre: 'Declaración juramentada de bienes y rentas y actividad económica privada', entidad: 'Función Pública (SIGEP) / entidad que te vincula', verdict: 'Manual',
    action: 'Diligenciar la declaración en el SIGEP o en el formato que indique la entidad y adjuntar el PDF',
    inputs: ['Usuario del SIGEP (lo habilita la entidad)'],
    steps: ['La entidad habilita tu usuario del SIGEP, o te entrega el formato de Función Pública.', 'Diligencia la declaración de bienes y rentas y la actividad económica privada.', 'Descarga o escanea el documento y súbelo aquí.'],
    manualNote: 'No hay una forma de automatizarlo: el SIGEP exige el usuario que habilita cada entidad. Es un requisito del empleo público, no de las empresas privadas (verificación parcial a partir del Decreto 1083).',
    vigencia: { ...none, fuente: 'No se encontró una vigencia; se actualiza al posesionarse y cada año.' }, cedulaCopy: true,
    legalBasis: [REF.dur1083], legalStatus: 'parcial',
    employerMayRequire: { value: 'depende', confianza: 'media', nota: 'Es un requisito de los empleos públicos; en el sector privado no aplica.' },
    publicEntityNote: 'Requisito del empleo público (Decreto 1083 de 2015); se declara en el SIGEP antes de posesionarse.',
  },
  examenmedico: {
    id: 'examenmedico', tier: 'optional', label: 'Examen médico de ingreso (certificado de aptitud)',
    hint: 'Lo ordena la entidad o el empleador. No pueden exigirte prueba de embarazo para ingresar (Res. 3941 de 1994), salvo actividades de alto riesgo.',
    nombre: 'Examen médico de ingreso / certificado médico de aptitud', entidad: 'La entidad o empresa que te contrata (IPS que ella indique)', verdict: 'Manual',
    action: 'Asistir a la IPS que indique la entidad y adjuntar el certificado de aptitud',
    inputs: [],
    steps: ['La entidad te indica a qué IPS ir y qué examen te corresponde.', 'Asiste con tu cédula.', 'Guarda aquí el certificado de aptitud que te entreguen.'],
    manualNote: 'En el sector privado el examen de ingreso es por cuenta del empleador. Tus datos de salud son sensibles: solo se tratan con tu autorización explícita y para la finalidad informada (Ley 1581 de 2012).',
    vigencia: { ...none, fuente: 'No se encontró una vigencia legal.' }, cedulaCopy: false,
    legalBasis: [REF.dur1083, REF.res3941, REF.ley1581], legalStatus: 'parcial',
    employerMayRequire: { value: 'si', confianza: 'media', nota: 'Lo ordena el empleador (en la Rama Ejecutiva, Decreto 1083 de 2015, art. 2.2.5.1.4, num. 6). Aun así, la prueba de embarazo como requisito de acceso está prohibida salvo actividades de alto riesgo (Res. 3941 de 1994).' },
    publicEntityNote: 'Requisito de la Rama Ejecutiva, ordenado por la entidad (Decreto 1083 de 2015, art. 2.2.5.1.4, num. 6).',
  },
};

for (const s of Object.values(RAW)) { s.core = s.tier === 'core'; s.optional = s.tier !== 'core'; }

export const SOURCES = RAW;

/** Orden de los documentos en las listas (los ids nuevos siempre al final: no mueve anexos ni archivos existentes). */
export const DOC_ORDER = ['cedula', 'procuraduria', 'contraloria', 'policia', 'rnmc', 'inhabilidades', 'libreta', 'rut', 'eps', 'pension', 'sisben', 'redam', 'bdme', 'vigenciacedula', 'leyangel',
  'autorizaciondatos', 'autorizacion1918', 'procuraduriaespecial', 'bienesrentas', 'examenmedico'];

/** Lista `schema.documents` de los modelos: { id, label, hint } desde este registro (un solo lugar para las etiquetas). */
export const registryDocuments = () => DOC_ORDER.map((id) => ({ id, label: SOURCES[id].label, hint: SOURCES[id].hint }));

export const sourceFor = (id) => SOURCES[id] || null;

/** Ids visibles en Documentos: profile.documentsShown si existe (una elección explícita se respeta tal cual); si no, el conjunto base más los
 *  que ya tienen archivos (un documento con archivos nunca desaparece cuando cambia el conjunto base). `allIds` = ids del esquema (descarta ids desconocidos). */
export function shownDocIds(profile, allIds) {
  const canon = (id) => DOC_MIGRATE[id] || id;
  const set = Array.isArray(profile?.documentsShown)
    ? new Set(profile.documentsShown.map(canon))
    : new Set([...DEFAULT_SHOWN, ...allIds.filter((id) => (profile?.documents?.[id] || []).length)]);
  return allIds.filter((id) => set.has(id));
}

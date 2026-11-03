// Registro de fuentes oficiales por documento requerido (G18). Datos puros, sin DOM.
// Fuente de cada dato: docs/FUENTES-OFICIALES.md (investigación del 2026-10-28). Solo se usan URLs allí verificadas
// o listadas; las no verificadas llevan `urlNota`. Nada de esto envía datos a terceros: son enlaces que el usuario abre.
//
// Campos por fuente:
//   id            id del documento (igual que schema.documents)
//   nombre        nombre oficial / descriptivo
//   entidad       entidad que lo emite
//   verdict       'Asistido' (la app prepara, el usuario hace el paso en el sitio y sube el PDF) | 'Manual'
//   core          true = se muestra por defecto en Documentos
//   optional      true = solo si el cargo o la convocatoria lo exige
//   url, urlNota  sitio oficial (urlNota = advertencia si no se verificó)
//   validatorUrl  verificador oficial del certificado, si existe
//   alt           [{label,url}] rutas alternativas (p. ej. Carpeta Ciudadana Digital)
//   email         correo oficial para solicitudes (solo Ley Ángel)
//   action        qué hará el usuario en el sitio (captcha, login, ...)
//   inputs        qué datos se piden
//   steps         pasos cortos
//   manualNote    explicación cuando es solo manual
//   vigencia      { tipo:'oficial'|'practica'|'ninguna', dias, fuente, nota }
//                 oficial = regla de una fuente oficial; practica = sin vigencia oficial, el usuario la ajusta (dias sugeridos)
//   cedulaCopy    true = mostrar "Copiar cédula"

export const CARPETA = { label: 'Carpeta Ciudadana Digital (requiere cuenta propia)', url: 'https://carpetaciudadana.and.gov.co/' };
export const VIGENCIA_AVISO = 'La vigencia real la define la entidad que recibe el documento. Verifica con ella.';
export const POR_VENCER_DIAS = 15;
export const DEFAULT_SHOWN = ['cedula', 'policia', 'procuraduria', 'contraloria', 'rnmc', 'inhabilidades'];

const none = { tipo: 'ninguna', dias: null, fuente: 'No se encontró una vigencia oficial.', nota: '' };

export const SOURCES = {
  cedula: {
    id: 'cedula', nombre: 'Cédula de ciudadanía', entidad: 'Registraduría Nacional (documento propio)', verdict: 'Manual', core: true,
    action: 'Escanear o fotografiar tu cédula', inputs: [],
    steps: ['Escanea o fotografía ambas caras con buena luz y sin recortes.', 'Súbela como imagen o PDF legible. Si tienes la cédula digital, descarga el PDF desde la app oficial.'],
    manualNote: 'Es tu propio documento: no hay sitio oficial al cual acudir.', vigencia: { ...none, fuente: 'La cédula no tiene fecha de vigencia propia.' }, cedulaCopy: false,
  },
  policia: {
    id: 'policia', nombre: 'Antecedentes judiciales (consulta en línea)', entidad: 'Policía Nacional', verdict: 'Asistido', core: true,
    url: 'https://antecedentes.policia.gov.co:7005/WebJudicial/',
    action: 'Aceptar términos y consultar; luego imprimir la página como PDF (puede pedir captcha: no verificado)',
    inputs: ['Número de cédula, sin puntos'],
    steps: ['Abre el sitio de la Policía y acepta los términos.', 'Pega tu cédula (sin puntos) y consulta.', 'Imprime la página y elige "Guardar como PDF".', 'Arrastra el PDF aquí.'],
    notes: ['La Policía indica que NO genera un PDF oficial: el resultado es la impresión de la consulta, sin código de verificación.', 'Sus términos limitan la consulta a tu propia información.'],
    vigencia: { tipo: 'practica', dias: 30, fuente: 'La Policía dice que la consulta en línea no tiene vigencia (se actualiza a diario). Muchas entidades piden 30 a 90 días.', nota: 'Práctica de mercado, no norma.' },
    cedulaCopy: true,
  },
  procuraduria: {
    id: 'procuraduria', nombre: 'Certificado de antecedentes disciplinarios', entidad: 'Procuraduría General de la Nación', verdict: 'Asistido', core: true,
    url: 'https://www.procuraduria.gov.co/Pages/certificado-antecedentes.aspx',
    validatorUrl: 'https://www.procuraduria.gov.co/Pages/Verificacion-de-certificado-de-antecedentes.aspx',
    alt: [CARPETA],
    action: 'Responder una pregunta aritmética anti-robot y descargar el PDF',
    inputs: ['Tipo y número de documento', 'Tipo de certificado: Ordinario o Especial', 'Pregunta de seguridad'],
    steps: ['Abre el sitio y pulsa "Generar".', 'Elige tipo de documento, pega tu cédula y el tipo de certificado (Ordinario).', 'Responde la pregunta de seguridad y descarga el PDF.', 'Arrastra el PDF aquí.'],
    vigencia: { tipo: 'oficial', dias: 90, fuente: '3 meses desde la expedición: Res. 143/2002 art. 3, citada por la Función Pública (Concepto 267521 de 2021).', nota: '' },
    cedulaCopy: true,
  },
  contraloria: {
    id: 'contraloria', nombre: 'Certificado de antecedentes fiscales', entidad: 'Contraloría General de la República', verdict: 'Asistido', core: true,
    url: 'https://cfiscal.contraloria.gov.co/certificados/certificadopersonanatural.aspx',
    urlInfo: 'https://www.contraloria.gov.co/control-fiscal/responsabilidad-fiscal/certificado-de-antecedentes-fiscales',
    alt: [CARPETA],
    action: 'Resolver el reCAPTCHA de Google y descargar el PDF',
    inputs: ['Tipo y número de documento'],
    steps: ['Abre el formulario de persona natural.', 'Elige el tipo de documento y pega tu cédula.', 'Marca el reCAPTCHA y genera el certificado.', 'Arrastra el PDF aquí.'],
    notes: ['El PDF trae un "Código de Verificación" para constatar su autenticidad (la ruta exacta de verificación no se verificó).'],
    vigencia: { tipo: 'oficial', dias: 90, fuente: '3 meses desde la expedición (criterio de la Función Pública, Concepto 267521 de 2021; boletín trimestral, Ley 610 de 2000 art. 60).', nota: 'Es un criterio interpretativo, no una norma expresa.' },
    cedulaCopy: true,
  },
  rnmc: {
    id: 'rnmc', nombre: 'Registro Nacional de Medidas Correctivas (RNMC)', entidad: 'Policía Nacional', verdict: 'Asistido', core: true,
    url: 'https://srvcnpc.policia.gov.co/PSC/frm_cnp_consulta.aspx',
    action: 'Consultar con tu cédula e imprimir el resultado como PDF',
    inputs: ['Consultar por (cédula de ciudadanía)', 'Número de identificación'],
    steps: ['Abre el portal y acepta el tratamiento de datos.', 'Elige "Cédula de ciudadanía" y pega tu número.', 'Consulta, imprime la página y guarda como PDF.', 'Arrastra el PDF aquí.'],
    vigencia: { tipo: 'practica', dias: 30, fuente: 'No se encontró una vigencia oficial. Muchas entidades piden 30 a 90 días.', nota: 'Práctica de mercado, no norma.' },
    cedulaCopy: true,
  },
  inhabilidades: {
    id: 'inhabilidades', nombre: 'Sistema de Consulta de Inhabilidades por Delitos Sexuales (Ley 1918 de 2018)', entidad: 'Policía Nacional / DIJIN', verdict: 'Manual', core: true,
    url: 'https://inhabilidades.policia.gov.co:8080/',
    urlInfo: 'https://www.icbf.gov.co/atencion-y-servicios-ciudadania/sistema-de-consulta-de-inhabilidades-por-delitos-sexuales',
    action: 'Lo consulta la ENTIDAD contratante con tu autorización (reCAPTCHA); tú solo adjuntas lo que ella te entregue',
    inputs: ['Cédula', 'Fecha de expedición de la cédula', 'Nombre y NIT de la entidad que consulta'],
    steps: ['Pregunta a la entidad si exige este soporte para el cargo (solo aplica con contacto directo y habitual con menores).', 'Autoriza expresamente la consulta; la entidad la hace con su NIT.', 'Adjunta aquí el certificado que te entregue.'],
    manualNote: 'La consulta está diseñada para la entidad que contrata: exige el nombre y NIT de la empresa, la información es reservada y la entidad debe reverificarla cada 4 meses. La app no la automatiza ni la hace por ti.',
    notes: ['El nombre oficial es "Sistema de Consulta de Inhabilidades por Delitos Sexuales"; la app decía antes "Registro RUD", nombre que no aparece en fuentes oficiales.', 'El Senado marca parte del art. 4 de la Ley 1918 como inexequible: confirma la versión vigente.'],
    vigencia: { ...none, fuente: 'No hay vigencia del certificado; la entidad reverifica cada 4 meses durante la relación laboral.' },
    cedulaCopy: true,
  },
  libreta: {
    id: 'libreta', nombre: 'Situación militar / libreta militar', entidad: 'Ejército Nacional', verdict: 'Manual', optional: true,
    url: 'https://www.libretamilitar.mil.co/',
    action: 'Iniciar sesión y resolver captcha en el portal; descargar el certificado',
    inputs: ['Cuenta del portal (registro propio)'],
    steps: ['Abre el portal y entra con tu usuario (o regístrate).', 'Usa "Consulta de situación militar" y descarga el certificado.', 'Súbelo aquí.'],
    manualNote: 'Solo si la convocatoria lo exige: las entidades no pueden exigir la libreta como requisito de empleo, pero sí que se defina la situación militar (fuente secundaria, sin confirmar en la ley).',
    vigencia: { ...none, fuente: 'No se encontró vigencia del certificado.' }, cedulaCopy: true,
  },
  rut: {
    id: 'rut', nombre: 'Registro Único Tributario (RUT)', entidad: 'DIAN', verdict: 'Manual',
    url: 'https://www.dian.gov.co/tramitesservicios/Tramites_Impuestos/RUT/Paginas/default.aspx', urlNota: 'Página de trámites del RUT; su contenido no se verificó.',
    alt: [CARPETA],
    action: 'Iniciar sesión con tu clave Muisca, o pedir la copia que llega al correo registrado en el RUT',
    inputs: ['Clave Muisca, o documento y correo registrado'],
    steps: ['Abre la página de trámites del RUT de la DIAN.', 'Descarga el PDF con tu clave, o solicita la copia a tu correo (según guías de terceros, no verificado).', 'Súbelo aquí.'],
    manualNote: 'No hay forma de automatizarlo: requiere tu acceso personal.',
    vigencia: { ...none, fuente: 'El RUT no vence; muchas entidades piden una copia reciente (práctica, sin norma).' }, cedulaCopy: true,
  },
  eps: {
    id: 'eps', nombre: 'Certificación de afiliación a EPS', entidad: 'ADRES (consulta BDUA) o tu EPS', verdict: 'Asistido',
    url: 'https://aplicaciones.adres.gov.co/bdua_internet/Pages/ConsultarAfiliadoWeb.aspx',
    action: 'Resolver un captcha de imagen de 5 caracteres e imprimir el resultado como PDF',
    inputs: ['Tipo y número de documento', 'Captcha de imagen'],
    steps: ['Abre la consulta de ADRES.', 'Elige tipo de documento, pega tu cédula y escribe el captcha.', 'Imprime el resultado como PDF.', 'Arrástralo aquí.'],
    manualNote: 'El resultado de ADRES no es un certificado firmado. Si la convocatoria pide el certificado formal, descárgalo desde el portal de tu EPS.',
    vigencia: { ...none, fuente: 'La BDUA se actualiza cada mes; no hay vigencia oficial del soporte.' }, cedulaCopy: true,
  },
  pension: {
    id: 'pension', nombre: 'Certificación de fondo de pensión', entidad: 'RUAF / tu fondo o Colpensiones', verdict: 'Manual',
    url: 'https://ruaf.sispro.gov.co/',
    alt: [{ label: 'Colpensiones: certificados de afiliación', url: 'https://www.colpensiones.gov.co/pensiones/' }],
    action: 'Consultar (según terceros hay captcha) o pedir el certificado a tu fondo',
    inputs: ['Tipo y número de documento'],
    steps: ['Consulta tu afiliación en RUAF o descarga el certificado de tu fondo.', 'Súbelo aquí.'],
    manualNote: 'No hay API pública; cada fondo entrega su propio certificado.',
    vigencia: { ...none, fuente: 'No se encontró una norma de vigencia.' }, cedulaCopy: true,
  },
  sisben: {
    id: 'sisben', nombre: 'Consulta de grupo Sisbén', entidad: 'Departamento Nacional de Planeación', verdict: 'Asistido', optional: true,
    url: 'https://portal.sisben.gov.co/Paginas/consulta-tu-grupo.html', urlNota: 'Dirección según una fuente secundaria; el sitio no respondió en la prueba de verificación.',
    action: 'Consultar con tipo y número de documento y guardar como PDF',
    inputs: ['Tipo y número de documento', 'Validación de seguridad'],
    steps: ['Abre la consulta del Sisbén.', 'Pega tu cédula y consulta.', 'Guarda como PDF y súbelo aquí.'],
    manualNote: 'Solo si aplica a la convocatoria.',
    vigencia: { ...none, fuente: 'No se encontró vigencia.' }, cedulaCopy: true,
  },
  redam: {
    id: 'redam', nombre: 'Registro de Deudores Alimentarios Morosos (REDAM)', entidad: 'Consejo Superior de la Judicatura / Carpeta Ciudadana Digital', verdict: 'Manual',
    url: 'https://www.redam.gov.co/', validatorUrl: 'https://registro.redam.gov.co/validate-certificate/',
    alt: [CARPETA],
    action: 'Autenticarte con tu cuenta digital (según guías de terceros, la Carpeta Ciudadana es el único medio)',
    inputs: ['Cuenta de Carpeta Ciudadana Digital'],
    steps: ['Entra a tu Carpeta Ciudadana Digital y busca el certificado REDAM (portal no verificado a fondo).', 'Descarga el PDF.', 'Arrástralo aquí: la app lee "Válida hasta" y el código de verificación.'],
    manualNote: 'Se exige para posesionarse en cargos públicos y contratar con el Estado (fuente secundaria).',
    vigencia: { tipo: 'oficial', dias: 90, fuente: 'El PDF imprime "Válida hasta" (verificado en un PDF de muestra: 90 días). Si falta, la app usa 90 días.', nota: '' },
    cedulaCopy: true,
  },
  bdme: {
    id: 'bdme', nombre: 'Boletín de Deudores Morosos del Estado (BDME)', entidad: 'Contaduría General de la Nación', verdict: 'Manual', optional: true,
    url: 'https://www.contaduria.gov.co/acerca-de-bdme',
    action: 'Registrarte como usuario con contraseña y consultar por número de identificación',
    inputs: ['Usuario y contraseña del portal'],
    steps: ['Abre la página del BDME y regístrate si no tienes cuenta.', 'Consulta por tu número de identificación y descarga el PDF.', 'Súbelo aquí.'],
    manualNote: 'Impedimento para contratar con el Estado. El boletín es semestral y las fechas de corte publicadas se contradicen.',
    vigencia: { ...none, fuente: 'Boletín semestral; el certificado no indica vigencia.' }, cedulaCopy: true,
  },
  vigenciacedula: {
    id: 'vigenciacedula', nombre: 'Certificado de vigencia de la cédula', entidad: 'Registraduría Nacional del Estado Civil', verdict: 'Manual', optional: true,
    url: 'https://certvigenciacedula.registraduria.gov.co/',
    action: 'Superar el desafío anti-robot (Cloudflare) y descargar el certificado',
    inputs: ['Número de cédula', 'Fecha de expedición (según una guía de terceros)'],
    steps: ['Abre el sitio de la Registraduría.', 'Supera la verificación de conexión y llena tus datos.', 'Descarga el certificado y súbelo aquí.'],
    manualNote: 'Es el sitio más hostil a la automatización; hay que hacerlo a mano.',
    vigencia: { ...none, fuente: 'No se encontró vigencia.' }, cedulaCopy: true,
  },
  leyangel: {
    id: 'leyangel', nombre: 'Inhabilidades por delitos contra animales (Ley 2455 de 2025, "Ley Ángel")', entidad: 'Policía Nacional / DIJIN', verdict: 'Manual', optional: true,
    email: 'dijin.araic-atc@policia.gov.co',
    action: 'Enviar una solicitud firmada por correo (no hay portal)',
    inputs: ['Solicitud firmada', 'Copia de la cédula vigente'],
    steps: ['Redacta y firma una solicitud del certificado.', 'Envíala por correo con copia de tu cédula vigente (extranjeros: pasaporte y cédula de extranjería).', 'Adjunta aquí la respuesta.'],
    manualNote: 'Solo si el cargo se relaciona con animales. Un tercero necesita autorización notariada o poder.',
    vigencia: { ...none, fuente: 'No se encontró vigencia.' }, cedulaCopy: false,
  },
};

export const sourceFor = (id) => SOURCES[id] || null;

/** Ids visibles en Documentos: profile.documentsShown si existe; si no, el conjunto base más los que ya tienen archivos.
 *  `allIds` = ids del esquema (descarta ids desconocidos). */
export function shownDocIds(profile, allIds) {
  const set = Array.isArray(profile?.documentsShown)
    ? new Set(profile.documentsShown)
    : new Set([...DEFAULT_SHOWN, ...allIds.filter((id) => (profile?.documents?.[id] || []).length)]);
  return allIds.filter((id) => set.has(id));
}

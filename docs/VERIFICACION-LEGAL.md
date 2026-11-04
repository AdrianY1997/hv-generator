# Verificación legal de la lista de documentos de soporte (cierre de G07)

Fecha: 2026-11-03. Alcance: contrastar con la norma colombiana vigente y con fuentes oficiales lo que la app afirma sobre cada soporte de la hoja de vida (`app/js/models/minerva.js` -> `documents`, `app/js/doc-sources.js`, `docs/FUENTES-OFICIALES.md`). No se tocó código de la app.

**Etiquetas.** **VERIFIED** = leí el texto oficial (o la reproducción de una entidad oficial) y cito URL y frase (máx. 25 palabras). **PARTIAL** = hay base, pero no pude leer el texto completo/primario o la norma tiene matices abiertos. **UNVERIFIED** = no encontré norma ni fuente oficial; es práctica o inferencia. Confianza: Alta / Media / Baja.

**Límites del método.** `secretariasenado.gov.co` rechazó la conexión (ECONNREFUSED) y varios sitios gubernamentales tienen certificado TLS incompleto; leí con GET de solo lectura (curl `-k`) las páginas públicas de Función Pública, Alcaldía de Bogotá (SISJUR), Cancillería (normograma), Procuraduría, Policía, ICBF, Contaduría y Corte Constitucional. No se envió ningún dato personal a ningún sitio. No pude leer: el texto de la Circular 0039 de 2021 de MinTrabajo, la página de la Contraloría (reCAPTCHA), el formulario RNMC, SISBÉN ni Registraduría (Cloudflare). Esto no es asesoría jurídica.

---

## 1. Resumen ejecutivo (lo que cambia respecto de lo que la app dice hoy)

1. **Ley "2480/2025" no es la Ley Ángel.** La Ley 2480 de 2025 es la "Ley Kiara" (servicios de cuidado de animales de compañía) y no crea ningún certificado. La Ley Ángel es la **Ley 2455 de 2025** (art. 28: registro de inhabilidades por delitos contra animales). La app ya usa 2455: correcto.
2. **El certificado de antecedentes judiciales no puede exigirse en papel** (Decreto-Ley 19 de 2012, art. 93, suprimido; art. 94, consulta en línea). Lo que la app llama "consulta con la cédula" es exacto; falta advertirlo.
3. **Ley 1801/2016 art. 183 no obliga al ciudadano a presentar un "certificado RNMC".** Sus consecuencias (no ser nombrado en cargo público, no contratar con el Estado, etc.) aplican solo a multas sin pagar tras seis meses, y la verificación la hace la autoridad. El RNMC debe ser opcional, no "núcleo".
4. **Ley 1918/2018:** la consulta la hace la entidad (pública o privada) con autorización escrita del aspirante, solo para cargos con trato directo y habitual con menores; la Corte Constitucional (C-407/2020) tumbó el art. 2 (lista de cargos del ICBF) y la frase "por el ICBF" del art. 4. La regla de reverificación cada cuatro meses se mantiene. No debe mostrarse por defecto como documento que el candidato aporta.
5. **Libreta militar:** el art. 42 de la Ley 1861/2017 dice a la vez que la situación militar "se deberá acreditar" y que nadie puede exigir **la tarjeta militar** para ingresar a un empleo. Se puede exigir tener la situación definida (o certificación provisional), no la libreta física.
6. **Vigencias:** 3 meses para el certificado disciplinario (Res. PGN 143/2002) y 3 meses para REDAM (Ley 2097/2021, art. 4 par.) son norma expresa; los 3 meses de fiscales son criterio de Función Pública; judiciales y RNMC no tienen vigencia legal (30 a 90 días es práctica).
7. **Entidades públicas de la Rama Ejecutiva verifican por sí mismas** antecedentes fiscales, disciplinarios y judiciales y **no pueden exigir** al aspirante documentos que reposen en la entidad (Decreto 1083/2015, art. 2.2.5.1.5). Para empleos públicos el aspirante muchas veces no necesita adjuntarlos, aunque las convocatorias suelen pedirlos.

---

## 2. Verificación por documento

### 2.1 Antecedentes disciplinarios (Procuraduría)

| Afirmación | Estado | Evidencia | Confianza |
|---|---|---|---|
| El certificado lo expide gratis en línea la Procuraduría y existen dos tipos: ordinario (solo anotaciones vigentes) y especial (todas, para cargos que exigen ausencia de antecedentes) | VERIFIED | https://www.procuraduria.gov.co/Pages/certificado-antecedentes.aspx : "El certificado de antecedente especial, refleja todas las anotaciones que figuren en la base de datos" | Alta |
| Fundamento: Ley 1952/2019 art. 238 (modificada por Ley 2094/2021); el ordinario solo trae anotaciones vigentes; para nombramiento o posesión en cargos que exigen ausencia de antecedentes se certifican todas | VERIFIED | https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=90324 : "La certificación de antecedentes deberá contener las anotaciones de las sanciones o inhabilidades que se encuentren vigentes." | Alta |
| Vigencia de 3 meses desde la expedición | VERIFIED (norma) / PARTIAL (sigue vigente) | https://www.alcaldiabogota.gov.co/sisjur/normas/Norma1.jsp?i=15057 (Res. PGN 143/2002, "Vigencia del certificado"): "tendrá vigencia de tres (3) meses contados a partir de la fecha de su expedición". Nota: en el texto de Bogotá es el **art. 8**; Función Pública (Concepto 267521/2021) lo cita como art. 3. No comprobé derogatorias posteriores. | Media-Alta |
| Función Pública aplica los 3 meses a la consulta previa al nombramiento | VERIFIED | https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=171068 : "tendrá una vigencia de tres (03) meses desde la fecha de expedición del certificado" | Alta |
| El certificado incluye también sanciones penales, inhabilidades contractuales, fallos de responsabilidad fiscal y pérdida de investidura | VERIFIED | Ley 1952 art. 238 (misma URL): registro en la División de Registro y Control "para efectos de la expedición del certificado de antecedentes" | Media (no sustituye en la práctica al certificado de la Contraloría) |

### 2.2 Antecedentes fiscales (Contraloría)

| Afirmación | Estado | Evidencia | Confianza |
|---|---|---|---|
| La Contraloría publica un boletín **trimestral** de responsables fiscales; nominadores y representantes legales deben abstenerse de nombrar, posesionar o contratar a quienes figuren | VERIFIED | https://www1.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=5725 (Ley 610/2000 art. 60): "deberán abstenerse de nombrar, dar posesión o celebrar cualquier tipo de contrato con quienes aparezcan en el boletín de responsables" | Alta |
| Vigencia 3 meses | PARTIAL (criterio, no norma expresa) | https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=171068 : "no existe norma expresa que trate de su vigencia, debe entenderse atada a la periodicidad de publicación del boletín, es decir, tres (3) meses." | Media |
| El sitio oficial es `cfiscal.contraloria.gov.co/certificados/...` con reCAPTCHA | PARTIAL | Verificado el 2026-10-28 en `docs/FUENTES-OFICIALES.md`; hoy el GET devolvió solo 923 bytes (sin texto útil) | Media |

La app marca esta vigencia como "oficial": conviene rotularla "criterio de Función Pública" (la nota actual ya lo reconoce).

### 2.3 Antecedentes judiciales (Policía Nacional)

| Afirmación | Estado | Evidencia | Confianza |
|---|---|---|---|
| El certificado judicial en papel fue suprimido; ninguna persona está obligada a presentar documento que certifique sus antecedentes judiciales ante entidades públicas o privadas | VERIFIED | Decreto-Ley 19/2012 art. 93, texto en https://www.camarabaq.org.co/wp-content/uploads/2019/08/Decreto-ley-019-de-2012.pdf (OCR degradado; sentido leído: "Ninguna persona está obligada a presentar un documento que certifique sus antecedentes judiciales"). Confirmado por la Policía: https://antecedentes.policia.gov.co:7005/WebJudicial/preguntas.xhtml "El certificado o pasado judicial fue eliminado por medio del artículo 93 del Decreto 19 del 10 de enero de 2012" | Alta |
| Entidades y particulares consultan en línea (art. 94) | VERIFIED | Decreto 19/2012 art. 94 (mismo PDF): las entidades públicas o los particulares "podrán consultarlos en línea"; Decreto 753/2019 lo recoge (https://apps.procuraduria.gov.co/gd_1952/docs/d0753019.htm) | Alta |
| La consulta no tiene vigencia | VERIFIED | Policía (misma URL de preguntas): "La consulta en línea de antecedentes judiciales no tiene vigencia, debido a que diariamente se actualiza la información" | Alta |
| Función Pública: verificar en fecha previa y cercana al nombramiento | VERIFIED | Concepto 267521/2021: "La consulta de estos antecedentes no tiene vigencia alguna ya que la base que la sustenta se encuentra en constante actualización" | Alta |
| No genera PDF oficial ni código | VERIFIED | Policía FAQ: pregunta "¿Por qué la consulta de antecedentes no se genera en formato PDF?" | Alta |
| Práctica: empleadores piden impresión de ≤30 días | UNVERIFIED | Sin norma; práctica de mercado | Baja |

**Práctica vs ley:** muchos empleadores privados piden la impresión; la ley dice que no pueden exigir un "certificado" en papel, pero sí consultar ellos mismos en línea. Para trámites en el exterior se requiere constancia apostillada (Policía FAQ).

### 2.4 RNMC (Ley 1801 de 2016)

| Afirmación | Estado | Evidencia | Confianza |
|---|---|---|---|
| El art. 183 impone al ciudadano presentar un certificado RNMC para contratar con el Estado o posesionarse | **No respaldada** | El art. 183 es "Consecuencias por el no pago de multas": tras seis meses sin pagar no se puede, entre otros, "Ser nombrado o ascendido en cargo público" ni "Contratar o renovar contrato con cualquier entidad del Estado" (texto reproducido en https://www.icbf.gov.co/sites/default/files/normatividad/concepto_4_de_2022.pdf). Y: "deberán verificar que la persona que solicita el trámite se encuentra al día en el pago de las multas" (la verifica la autoridad). | Alta |
| El al-día se puede probar por el RNMC "o cualquier otro medio que demuestre el pago" | VERIFIED (vía reproducción oficial del Decreto 1066/2015, art. 2.2.8.3.1 par. 2) | misma URL ICBF; Policía: "El ciudadano que no cancele la multa, estará inmerso en las consecuencias contempladas en el Artículo 183" (https://srvcnpc.policia.gov.co/multimedia/formatos/PREGUNTAS_FRECUENTES_CNSCC_RNMC.pdf) | Media-Alta |
| Un reporte RNMC no es por sí mismo inhabilidad | PARTIAL | Colombia Compra Eficiente (resumen de búsqueda; no abrí el concepto) y ICBF Concepto 4/2022: la inhabilitación "únicamente se configura en el caso de multas no pagadas" | Media |
| Vigencia del soporte | UNVERIFIED | Ninguna norma; el certificado RNMC no trae vigencia | Alta (de que no hay) |

### 2.5 Ley 1918 de 2018, Decreto 753 de 2019 (delitos sexuales contra menores)

| Afirmación | Estado | Evidencia | Confianza |
|---|---|---|---|
| Nombre correcto: "Registro de Inhabilidades por delitos sexuales contra menores de edad" (Policía lo administra). El portal se llama "Sistema de Consulta de Inhabilidades por Delitos Sexuales" (verificado el 2026-10-28). "Registro RUD" no existe | VERIFIED | https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=87420 art. 3: "Registro de Inhabilidades por delitos sexuales contra menores de edad" | Alta |
| Solo se expide a entidades, no al aspirante | VERIFIED | Ley 1918 art. 3: "a solicitud de las entidades públicas o privadas obligadas previa y expresamente autorizadas por el Instituto Colombiano de Bienestar Familiar" | Alta |
| Requisitos de la solicitud: identificación del solicitante, naturaleza del cargo, autorización previa del aspirante, juramento de uso exclusivo | VERIFIED | misma norma, art. 3: "Autorización previa del aspirante al cargo para ser consultado en las bases de datos." | Alta |
| Autorización "previa, expresa y escrita" del aspirante, que debe reposar en el proceso de selección | VERIFIED | Decreto 753/2019 art. 2 par. 2 (https://apps.procuraduria.gov.co/gd_1952/docs/d0753019.htm): "obtener la autorización previa, expresa y escrita del aspirante al cargo, u oficio" | Alta |
| Solo para cargos con relación "directa y habitual" con menores; el Decreto 753 enumera 13 categorías (docentes, transporte escolar, salud de atención directa, seguridad, etc.) | PARTIAL | Decreto 753 art. 1. Pero C-407/2020 declaró **inexequible el art. 2 de la Ley 1918** (definición de cargos por el ICBF): https://www.corteconstitucional.gov.co/relatoria/2020/C-407-20.htm "Declarar INEXEQUIBLE el artículo 2 de Ley 1918 de 2018." La lista del decreto queda con base debilitada; úsese como orientación | Media |
| Reverificación cada cuatro meses tras el inicio de la relación | VERIFIED | Ley 1918 art. 4: "Dicha verificación, deberá actualizarse cada cuatro meses después del inicio de la relación contractual, laboral o reglamentaria." C-407/2020 solo excluyó la expresión "por el Instituto Colombiano de Bienestar Familiar" del art. 4 | Alta |
| Sanción a la entidad que no verifica: multa de 50 a 500 SMMLV; falta gravísima para el servidor público | VERIFIED | Ley 1918 art. 5 y art. 4 par. 1 | Alta |

La nota de la app "El Senado marca parte del art. 4 como inexequible" queda resuelta: es solo la frase del ICBF (C-407/2020).

### 2.6 Ley Ángel (Ley 2455 de 2025) y "Ley 2480 de 2025"

| Afirmación | Estado | Evidencia | Confianza |
|---|---|---|---|
| Existe la Ley 2455/2025 (Ley Ángel), expedida y vigente desde el 18 de abril de 2025 | VERIFIED | https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=259656 : "Fecha de Expedición: 18 de abril de 2025" | Alta |
| Art. 28: la Policía administra el registro; el certificado de antecedentes judiciales tiene sección reservada; el certificado se expide a solicitud de entidades que desarrollen actividades relacionadas con animales | VERIFIED | misma URL: "a solicitud de las entidades públicas o privadas que dentro de su objeto desarrollen actividades relacionadas con animales" | Alta |
| El trámite es por solicitud firmada de la entidad al correo de la DIJIN | VERIFIED | Policía FAQ: "deberán presentar solicitud formal firmada al correo" (https://antecedentes.policia.gov.co:7005/WebJudicial/preguntas.xhtml) | Alta |
| "Ley 2480 de 2025" | VERIFIED (distinta) | Título: "por medio de la cual se regulan los servicios de cuidado para animales de compañía" (Ley Kiara), https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=260800 (título confirmado en resultados de búsqueda de vLex/UNEP/Función Pública; no abrí la página). No es un documento de hoja de vida | Alta |

Es irrelevante para la mayoría de los usuarios: solo cargos relacionados con animales, y lo pide la entidad. Mantener oculto por defecto.

### 2.7 REDAM (Ley 2097 de 2021)

| Afirmación | Estado | Evidencia | Confianza |
|---|---|---|---|
| El certificado REDAM es gratuito, en línea, con validez de **3 meses** | VERIFIED | https://cancilleria.gov.co/sites/default/files/Normograma/docs/pdf/ley_2097_2021.pdf art. 4 par.: "tendrán una validez de tres (3) meses" | Alta |
| No se puede nombrar ni posesionar en cargo público a los reportados | VERIFIED | art. 6 num. 2: "No se podrá nombrar ni posesionar en cargos públicos ni de elección popular a las personas reportadas" | Alta |
| El reportado solo puede contratar con el Estado al ponerse a paz y salvo | VERIFIED | art. 6 num. 1: "solo podrá contratar con el Estado una vez se ponga a paz y salvo con sus obligaciones alimentarias" | Alta |
| Vía de obtención (Carpeta Ciudadana Digital) | PARTIAL | Decreto 1310/2022 (DUR 1078, art. 2.2.23.10) referido como concordancia; no leído | Media |

La app dice "se exige para posesionarse (fuente secundaria)": ahora hay fuente primaria. Matiz: la ley **prohíbe** nombrar a reportados; que el aspirante deba presentar el certificado depende de la entidad (la ley la habilita a verificar).

### 2.8 BDME (Boletín de Deudores Morosos del Estado)

| Afirmación | Estado | Evidencia | Confianza |
|---|---|---|---|
| Boletín **semestral** con cortes al 30 de mayo y 30 de noviembre | VERIFIED | https://www.contaduria.gov.co/documents/d/guest/fichatecnicaboletin44?download=true : "fechas de corte al 30 de mayo y al 30 de noviembre de cada vigencia" (resuelve la contradicción de fechas que anotaba la app) | Alta |
| Base: Ley 716/2001 art. 4 par. 3, modif. Ley 901/2004; Decreto 3361/2004; Ley 1066/2006 art. 2 | VERIFIED | misma ficha; el efecto directo documentado es abstenerse de celebrar acuerdos de pago con reportados | Alta |
| Existe un certificado del BDME que expide la Contaduría | VERIFIED | misma ficha: "Certificado del Boletín de Deudores Morosos del Estado: Documento escrito donde se constata si una persona ... se encuentra reportada" | Alta |
| Es "impedimento para contratar con el Estado" (texto actual de la app) | UNVERIFIED | No hallé norma que lo diga para contratación o posesión; no encontré exigencia de empleador | Baja |

Recomendación: texto "si la convocatoria lo exige" (ya está así), quitar o suavizar "impedimento para contratar".

### 2.9 Libreta / situación militar (Ley 1861 de 2017, art. 42)

| Afirmación | Estado | Evidencia | Confianza |
|---|---|---|---|
| La situación militar se debe acreditar para cargos públicos, trabajo privado y contratos de prestación de servicios con entidades públicas | VERIFIED | Art. 42 transcrito en https://www.funcionpublica.gov.co/eva/gestornormativo/norma_pdf.php?i=117498 (Concepto 12051/2020): "La situación militar se deberá acreditar para ejercer cargos públicos, trabajar en el sector privado y celebrar contratos de prestación de servicios" | Alta |
| Las entidades no pueden exigir la **tarjeta militar** para ingresar a un empleo | VERIFIED | mismo art. 42: "las entidades públicas o privadas no podrán exigir al ciudadano, la presentación de la tarjeta militar para ingresar a un empleo" | Alta |
| No aptos, exentos o mayores de la edad máxima pueden entrar a trabajar y tienen 18 meses para definir la situación, con certificación provisional en línea | VERIFIED | mismo art. 42: "tendrán un lapso de dieciocho (18) meses para definir su situación militar" | Alta |
| Rama Ejecutiva: requisito "Tener definida la situación militar, en los casos a que haya lugar" | VERIFIED | Decreto 1083/2015 art. 2.2.5.1.4 num. 5, https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=62866 | Alta |
| MinTrabajo, Circular 0039 de 2021 (13 jul. 2021): no se exige la libreta para contratar | PARTIAL | Solo prensa/gremios (INCP, Semana, Blu); no pude leer el texto. https://www.mintrabajo.gov.co/prensa/comunicados/2021/julio/tarjeta-militar-no-es-requisito-para-contratar-jovenes (título leído, cuerpo no) | Media |
| Reforma de 2024 (PL 033/2024 Cámara) elimina la acreditación | UNVERIFIED | Hallé el proyecto; no hallé ley sancionada | Baja |
| Colombia Compra Eficiente: el beneficio de los 18 meses no cubre contratos de prestación de servicios con el Estado | PARTIAL | Resúmenes de búsqueda; no abrí el concepto | Media |

Resultado: el texto actual de la app ("las entidades no pueden exigir la libreta, pero sí que se defina la situación militar (fuente secundaria, sin confirmar)") es **correcto y ahora tiene fuente primaria**. Cambiar la etiqueta a "Situación militar (tarjeta o certificación provisional)" y aclarar que la tarjeta física no puede ser requisito de ingreso.

### 2.10 Certificado de vigencia de la cédula (Registraduría), SISBÉN, RUT, EPS, pensión, ARL

| Documento | Estado | Evidencia / razón | Confianza |
|---|---|---|---|
| Vigencia de cédula | UNVERIFIED | Ninguna norma que lo exija en procesos de selección. La Procuraduría menciona "estado de vigencia de la cédula" en su FAQ (corrección de datos), sin relación con empleo | Baja |
| SISBÉN | UNVERIFIED | No hallé norma que obligue al candidato a presentarlo. Hay un proyecto de resolución de MinSalud que reglamenta el art. 65 de la Ley 2466 de 2025 (permanencia temporal en régimen subsidiado de afiliados SISBÉN A-C que se vinculen laboralmente), solo borrador (PARTIAL, sin URL oficial leída) | Baja |
| RUT | PARTIAL | Decreto 2460/2013 (reglamenta ET art. 555-2): "constituye el mecanismo único para identificar, ubicar y clasificar a los sujetos de obligaciones administradas" (https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=59604, citado por snippet). Un asalariado normalmente no necesita RUT salvo umbrales (fuente secundaria: colombiatramita.co); un contratista independiente sí debe inscribirse. No leí el art. 5 completo | Media-Baja |
| Afiliación EPS / pensión | PARTIAL | La afiliación al sistema es obligación del empleador (y del contratante en riesgos laborales, Ley 1562/2012 art. 2 según snippet; texto no leído). El trabajador solo elige entidad. Exigir "certificado" al candidato es práctica | Media-Baja |
| ARL | PARTIAL | La afiliación a ARL la hace el empleador/contratante (Ley 1562/2012). No es un soporte que el candidato deba adjuntar | Media-Baja |

---

## 3. Qué pueden y qué no pueden exigir los empleadores

### 3.1 Documentos que el empleador NO puede exigir (para advertir al usuario)

| Exigencia | Fundamento | Estado | Confianza |
|---|---|---|---|
| Certificado judicial en papel | Decreto-Ley 19/2012 art. 93-94 | VERIFIED | Alta |
| Tarjeta/libreta militar como condición de ingreso | Ley 1861/2017 art. 42 inc. 2 | VERIFIED | Alta |
| Prueba de embarazo como requisito de acceso (salvo actividades de alto riesgo) | Res. MinTrabajo 3941/1994: "Queda prohibida la práctica de la prueba de embarazo para actividades diferentes de las descritas" (https://cancilleria.gov.co/sites/default/files/Normograma/docs/resolucion_mintrabajo_3941_1994.htm) | VERIFIED | Alta |
| (Entidad pública) Documentos o certificaciones que ya reposen en la entidad; y los antecedentes fiscales/disciplinarios/judiciales, que la entidad verifica por sí misma | Decreto 1083/2015 art. 2.2.5.1.5 par. 1: "No se podrán exigir al aspirante constancias, certificaciones o documentos para el cumplimiento de los requisitos que reposen en la respectiva entidad." y num. 2 "Verificar directamente los antecedentes fiscales, disciplinarios y judiciales del aspirante" | VERIFIED (Rama Ejecutiva) | Alta |
| (Trámites ante la administración) documentos que ya reposan en la misma entidad | Decreto-Ley 19/2012 art. 9 | PARTIAL (texto OCR degradado) | Media |
| Resultado de la consulta Ley 1918 sin autorización escrita del aspirante | Decreto 753/2019 art. 2 par. 2 (sanción SIC, Ley 1581) | VERIFIED | Alta |
| Datos sensibles (salud, vida sexual, biométricos, origen racial, religión, afiliación sindical) sin autorización explícita y finalidad informada | Ley 1581/2012 arts. 5-6: "Se prohíbe el Tratamiento de datos sensibles, excepto cuando" hay autorización explícita (https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=49981) | VERIFIED (regla general; no hay lista de "preguntas prohibidas" en hoja de vida) | Media |
| SISBÉN, RUT (asalariado), certificado de vigencia de cédula, EPS/pensión/ARL como filtro de selección | No hallé norma que los prohíba ni que los exija | UNVERIFIED | Baja |

Nota: el tratamiento de la foto, estado civil y datos de la familia no tiene prohibición expresa que yo haya encontrado; se rige por finalidad y autorización (Ley 1581 art. 4: "El Tratamiento debe obedecer a una finalidad legítima ... la cual debe ser informada al Titular"). No afirmar que "está prohibido pedir foto".

### 3.2 Público vs privado

| Documento | Empleador público (Rama Ejecutiva, Decreto 1083/2015) | Empleador privado |
|---|---|---|
| Cédula (copia) | Sí (identificación) | Sí (práctica) |
| Antecedentes disciplinarios / fiscales / judiciales | La entidad los verifica directamente (art. 2.2.5.1.5); el aspirante no está obligado; las convocatorias a veces los piden. Cargos con "ausencia de antecedentes": certificado especial (Ley 1952 art. 238) | No hay obligación legal; práctica de pedir disciplinarios/judiciales (y a veces fiscales) con ≤30 a 90 días |
| REDAM | Prohibición legal de nombrar/posesionar reportados | No aplica salvo contratación con el Estado |
| RNMC | La autoridad verifica multas impagas (Ley 1801 art. 183) | No hay exigencia legal |
| Situación militar | Debe estar definida (art. 2.2.5.1.4 num. 5), se admite certificación provisional | Puede pedirse que esté definida, no la tarjeta |
| Ley 1918 | Entidad consulta con autorización escrita si el cargo implica trato habitual con menores | Igual |
| Declaración de bienes y rentas (SIGEP) y examen médico de ingreso | Requisitos del empleo público (Decreto 1083; la declaración se declara en SIGEP antes de posesionarse) | Examen médico de ingreso por cuenta del empleador |
| EPS, pensión, ARL | Afiliación la tramita la entidad | La afiliación la tramita el empleador |
| RUT | Solo contratistas | Solo contratistas/independientes |

---

## 4. Vigencias y prácticas (resumen)

| Soporte | Regla legal | Base | Práctica | `vigencia.tipo` sugerido |
|---|---|---|---|---|
| Disciplinarios | 3 meses desde expedición | Res. PGN 143/2002 (art. 8 en texto Bogotá) | Muchas entidades piden ≤30 días | `oficial`, 90 |
| Fiscales | 3 meses (criterio) | Concepto FP 267521/2021; Ley 610 art. 60 | Idem | `practica` con nota "criterio de Función Pública" (hoy dice `oficial`) |
| Judiciales | Ninguna | Policía FAQ; Concepto FP 267521/2021 | 30 a 90 días | `ninguna` con nota de práctica (hoy `practica` 30: aceptable) |
| RNMC | Ninguna | No hay norma | 30 a 90 días | `ninguna`/`practica` |
| REDAM | 3 meses | Ley 2097/2021 art. 4 par. | Usar "Válida hasta" del PDF | `oficial`, 90 (citar la ley, no "PDF de muestra") |
| Ley 1918 | N/A (no es soporte del candidato); reverificación cada 4 meses por la entidad | Ley 1918 art. 4 | N/A | `ninguna` |
| BDME | Boletín semestral, cortes 30 may / 30 nov | Ficha técnica CGN | N/A | `ninguna` |
| Libreta / certificación provisional | Certificación provisional vale 18 meses (art. 42) | Ley 1861 art. 42 | N/A | `ninguna` (anotar 18 meses solo en la provisional) |

---

## 5. Correcciones recomendadas a la app

| # | Cambio | Tipo | Confianza |
|---|---|---|---|
| 1 | `policia`: etiqueta "Antecedentes judiciales (consulta en línea)" y pista "El certificado en papel fue suprimido (Decreto 19/2012); tu empleador puede consultarlo él mismo. Sin vigencia legal". | etiqueta/pista | Alta |
| 2 | `procuraduria`: renombrar a "Certificado de antecedentes (Procuraduría)"; pista "Ordinario (anotaciones vigentes) o especial (para cargos que exigen ausencia de antecedentes). Vigencia 3 meses (Res. PGN 143/2002)" | etiqueta/pista | Alta |
| 3 | `contraloria`: mantener; marcar vigencia como "criterio de Función Pública (3 meses)" y no `oficial` | vigencia | Media |
| 4 | `rnmc`: pasar de núcleo a **opcional**; pista "Muestra multas pendientes. La ley (art. 183 Ley 1801) la verifica la autoridad; no es antecedente penal. Sin vigencia legal" | por defecto/pista | Alta |
| 5 | `inhabilidades` (Ley 1918): **opcional/oculto por defecto**; pista "La consulta la hace la entidad con tu autorización escrita, solo para cargos con trato directo y habitual con menores. No es un documento que debas aportar" | por defecto/pista | Alta |
| 6 | `libreta`: ya opcional. Etiqueta "Situación militar (tarjeta o certificación provisional)" y pista "No pueden exigirte la tarjeta para ingresar a un empleo (Ley 1861 art. 42); sí que tengas la situación definida". Quitar "(fuente secundaria, sin confirmar)" | etiqueta/pista | Alta |
| 7 | `redam`: dejar opcional; pista citando la ley ("Se prohíbe nombrar/posesionar reportados, art. 6 Ley 2097; certificado válido 3 meses") y marcar vigencia `oficial` por el art. 4 par. | pista/vigencia | Alta |
| 8 | `bdme`: quitar "Impedimento para contratar con el Estado" (no verificado); indicar cortes 30 may / 30 nov | pista | Media |
| 9 | `leyangel`: mantener oculto; confirmar que no se confunda con la Ley 2480 (Ley Kiara) | pista | Alta |
| 10 | `rut`: opcional; pista "Normalmente solo contratistas/independientes" | por defecto/pista | Media |
| 11 | `sisben`, `vigenciacedula`: ocultos por defecto; pista "No hallé norma que lo exija; úsalo solo si la convocatoria lo pide" | por defecto | Media |
| 12 | `eps`, `pension`: mantener visibles por práctica, pero pista "La afiliación la tramita el empleador; muchos piden el certificado de la EPS/AFP" (no afirmar obligación legal del candidato) | pista | Media |
| 13 | `doc-sources.js`: la nota "revisar inexequibilidad parcial" de Ley 1918 se resuelve con C-407/2020 (art. 2 inexequible; frase "por el ICBF" del art. 4 inexequible) | nota | Alta |
| 14 | `doc-sources.js`: la cita "Res. 143/2002 art. 3" aparece como art. 8 ("Vigencia del certificado") en el texto de la Alcaldía de Bogotá; citar "Res. PGN 143/2002 (art. 8; Función Pública lo cita como art. 3)" | cita | Media |

**Visibles por defecto sugeridos:** cédula, procuraduría, contraloría, policía, EPS, pensión. **Opcionales ("si la convocatoria lo exige"):** RNMC, RUT, situación militar, REDAM. **Ocultos:** Ley 1918, SISBÉN, BDME, vigencia de cédula, Ley Ángel.

## 6. Documentos que faltan

| Documento | Para quién | Estado | Confianza |
|---|---|---|---|
| Autorización de tratamiento de datos / consulta (Ley 1581) y autorización escrita Ley 1918 (modelo para firmar) | Todos | VERIFIED (exigible al empleador, Decreto 753 art. 2 par. 2; Ley 1581) | Alta |
| Declaración de bienes y rentas (SIGEP) y hoja de vida SIGEP | Empleos públicos | PARTIAL (Decreto 1083; texto leído por snippet de compilación) | Media |
| Certificado médico de aptitud / examen médico de ingreso | Empleos públicos y privados | VERIFIED para Rama Ejecutiva (Decreto 1083 art. 2.2.5.1.4 num. 6); lo ordena la entidad | Media-Alta |
| Certificado de antecedentes **especial** (Procuraduría) | Cargos que exigen ausencia de antecedentes | VERIFIED (Procuraduría + Ley 1952 art. 238) | Alta |
| Tarjeta profesional / registro (p. ej. SIRNA abogados) | Profesiones reguladas | UNVERIFIED en esta ronda (ya listado en `FUENTES-OFICIALES.md` como "No aplica salvo abogados") | Baja |
| Certificación de afiliación a caja de compensación | Nadie (la tramita el empleador) | UNVERIFIED | Baja |

## 7. Descargo para la interfaz (texto listo, español)

> **Información orientativa, no es asesoría jurídica.** La lista de documentos y las vigencias que ves aquí resumen normas y fuentes oficiales colombianas a noviembre de 2026 y pueden haber cambiado. Cada entidad o convocatoria define qué soportes exige y con qué antigüedad; verifica siempre con la entidad que te contrata. Algunas reglas son criterios o prácticas de mercado, no normas, y así se indican. Consultas como la de inhabilidades por delitos sexuales contra menores las hace la entidad contratante con tu autorización escrita; no se aportan por tu cuenta. Tus documentos se guardan solo en este navegador; entrégalos únicamente a quien tenga una finalidad legítima y te lo informe (Ley 1581 de 2012). Si crees que te exigen un documento que la ley no permite pedir, consulta al Ministerio del Trabajo o a un abogado.

## 8. Pendiente por verificar

- Texto de la Circular 0039 de 2021 de MinTrabajo (libreta): leer en mintrabajo.gov.co/Normatividad/Circulares.
- Si PL 033/2024 Cámara (reforma del art. 42 Ley 1861) fue sancionado.
- Vigencia actual de la Res. PGN 143/2002 (¿hay reglamento posterior?) y número exacto del artículo.
- Ley 1562/2012 art. 2 (afiliación ARL), Decreto 2460/2013 art. 5 (RUT), Decreto 1310/2022 (REDAM): leer el texto primario.
- Si SISBÉN o vigencia de cédula tienen norma sectorial; Ley 2466/2025 art. 65 y su resolución de MinSalud.
- Alcance exacto de C-407/2020 sobre la lista de cargos del Decreto 753 art. 1.
- No encontré ninguna norma específica sobre pruebas de embarazo distinta de la Res. 3941/1994 que sea verificable; la Sentencia T-305/2020 aparece en búsquedas pero no la abrí (no se cita).

## 9. Cómo se refleja en la app (`legalStatus`, quinta auditoría 2026-11-04)

Este informe sigue siendo la fuente de verdad; `app/js/doc-sources.js` solo lo copia, y `app/tests/doc-registry.test.mjs` lo comprueba.

- `verificado`: la afirmación del registro está VERIFIED en las secciones 2 y 4 (norma leída y vigente según la fuente).
- `parcial`: hay etiqueta PARTIAL en algo que el registro afirma. Casos que importan: **`procuraduria` y `procuraduriaespecial`** (la norma de la vigencia de 3 meses, Res. PGN 143/2002, está VERIFIED como texto, pero «sigue vigente» es PARTIAL: sección 2.1 y sección 8) y **`redam`** (Ley 2097 VERIFIED; el Decreto 1310/2022 y la vía por Carpeta Ciudadana siguen sin leer: sección 2.7). La app lo dice en «Base legal» (`legalNote`) y redacta la pista y la vigencia como «según la norma citada; confirma que sigue vigente».
- `sin_verificar`: no se identificó una norma específica (cédula, EPS, pensión, SISBÉN, vigencia de cédula). La app muestra «Sin norma específica identificada», sin tono de alarma: no significa que el documento no se pueda pedir, sino que este informe no encontró una norma que lo exija.
- `vigencia.tipo: 'oficial'` solo se usa cuando una norma citada fija el plazo; una plantilla puede **acortarlo** pero no alargarlo, y la app explica por qué cuando una plantilla pedía más (`computeVigencia`, campo `normaLimita`).
- Conjunto visible por defecto (sección 5): `DEFAULT_SHOWN`. Quien ya usaba la app conserva el anterior (`LEGACY_DEFAULT_SHOWN`) mediante la migración v3 de `app/js/migrate.js`.

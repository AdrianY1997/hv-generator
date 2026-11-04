# Fuentes oficiales de certificados para la hoja de vida (Colombia): qué se puede automatizar desde una app estática

Fecha de la investigación: 2026-10-28. Alcance: obtener ("Obtener" con un clic) los certificados/consultas de inhabilidad y soporte de una HV desde una web estática en GitHub Pages (solo navegador, sin backend).

**Cómo leer este documento.** Cada afirmación lleva una etiqueta de evidencia:

- **[V]** verificada por mí el 2026-10-28 con peticiones GET a la página oficial, lectura de su HTML/cabeceras o lectura de un PDF de muestra (certificados reales publicados por una entidad en un expediente público; no se reproducen datos personales aquí).
- **[F]** texto de una fuente oficial/normativa leído directamente (cita la URL).
- **[S]** solo fuente secundaria (prensa, blogs de trámites, guías). No tratar como cierta sin comprobar.
- **[N]** no verificado / inferencia mía.

**No se envió ningún dato personal a ningún sitio.** Solo GET de páginas públicas. Un intento de simular el paso "Aceptar términos" de la Policía (POST AJAX sin datos personales) fue denegado por el sistema de permisos y no se repitió, por eso la pantalla de captcha de antecedentes judiciales queda como [N]/[S].


> **Correcciones del 2026-11-03.** `docs/VERIFICACION-LEGAL.md` contrasta este documento con la norma y **prevalece donde se contradigan**. Cambios que afectan lo que dice abajo: (1) la Ley "2480/2025" no es la Ley Angel (es la Ley Kiara, cuidado de animales de compania); la Ley Angel es la **Ley 2455 de 2025** (art. 28). (2) El certificado judicial en papel esta suprimido (Decreto-Ley 19/2012, art. 93) y la consulta en linea no tiene vigencia legal (30 a 90 dias es practica). (3) El art. 183 de la Ley 1801/2016 no obliga al ciudadano a presentar un certificado RNMC: sus consecuencias aplican a multas sin pagar tras seis meses y las verifica la autoridad; el RNMC es opcional. (4) Ley 1918/2018: la consulta la hace la entidad con autorizacion escrita del aspirante; la Corte Constitucional (C-407/2020) declaro inexequibles el art. 2 y la frase "por el ICBF" del art. 4 (la nota de "revisar inexequibilidad parcial" queda resuelta); la reverificacion cada 4 meses se mantiene; no es un documento que el candidato aporte. (5) Vigencias: disciplinarios 3 meses (Res. PGN 143/2002, art. 8 en el texto de Bogota, art. 3 segun Funcion Publica) y REDAM 3 meses (Ley 2097, art. 4 par.) son norma; fiscales 3 meses es criterio de Funcion Publica; judiciales y RNMC no tienen vigencia legal. (6) BDME: boletin semestral con cortes al **30 de mayo y 30 de noviembre** (ficha tecnica de la Contaduria), lo que resuelve las "fechas contradictorias"; "impedimento para contratar con el Estado" no esta verificado. (7) Libreta: se puede exigir la situacion militar definida (o certificacion provisional), no la tarjeta fisica (Ley 1861, art. 42; ya con fuente primaria). (8) "Registro RUD" ya no existe en la app. (9) Las entidades de la Rama Ejecutiva verifican por si mismas antecedentes fiscales, disciplinarios y judiciales (Decreto 1083/2015, art. 2.2.5.1.5).

---

## 1. Veredicto en una tabla

Categorías: **Factible** = la app puede hacerlo sola; **Asistido** = la app prepara y el usuario hace el paso en el sitio oficial (captcha/clic/descarga) y la app ingiere el PDF; **Manual** = no hay forma legítima ni técnica de acercarlo más que con enlace + instrucciones.

| # | Documento | Entidad / URL oficial | Veredicto | Obstáculo principal |
|---|---|---|---|---|
| 1 | Antecedentes judiciales | Policía Nacional, `antecedentes.policia.gov.co:7005/WebJudicial/` | Asistido | Sin API; página JSF con ViewState; la Policía dice que NO genera PDF ni código; captcha reportado por terceros [S] |
| 2 | Antecedentes disciplinarios | Procuraduría, `procuraduria.gov.co/Pages/certificado-antecedentes.aspx` | Asistido (el mejor candidato) | Sin API ni CORS; pregunta aritmética anti-bot (no reCAPTCHA) [V]; sesión ASP.NET atada a la ventana |
| 3 | Antecedentes fiscales | Contraloría, `cfiscal.contraloria.gov.co/certificados/certificadopersonanatural.aspx` | Asistido | reCAPTCHA de Google [V]; sin CORS |
| 4 | RNMC (medidas correctivas) | Policía, `srvcnpc.policia.gov.co/PSC/frm_cnp_consulta.aspx` | Asistido | Formulario ASP.NET sin captcha visible en el HTML [V], pero sin CORS ni parámetros por URL; resultado = página impresa |
| 5 | Inhabilidades delitos sexuales contra menores (Ley 1918/2018) | Policía/DIJIN, `inhabilidades.policia.gov.co:8080/` | Manual (y conceptualmente es consulta de la entidad contratante) | reCAPTCHA [V]; exige empresa y NIT; uso reservado [F] |
| 5b | Inhabilidades por delitos contra animales (Ley 2455/2025, "Ley Ángel") | Policía/DIJIN (solicitud por correo) | Manual | Se pide por correo firmado, sin portal [F] |
| 6 | Libreta / situación militar | Ejército, `libretamilitar.mil.co` → `definicion.libretamilitar.mil.co` | Manual | Captcha activado por configuración [V], login, API no documentada |
| 7 | RUT | DIAN (Muisca) / Carpeta Ciudadana Digital | Manual | Login (clave Muisca) o copia al correo del RUT [S]; sin API pública para terceros |
| 8 | Afiliación a EPS | ADRES BDUA, `aplicaciones.adres.gov.co/bdua_internet/...` | Asistido (consulta) / Manual (certificado formal: EPS) | Captcha de imagen de 5 caracteres [V]; el resultado de ADRES no es un certificado firmado [F] |
| 9 | Pensión (afiliación) | RUAF/SISPRO `ruaf.sispro.gov.co`; Colpensiones | Manual | Captcha según terceros [S]; no se puede enmarcar (frame-ancestors 'self') [V] |
| 10 | Sisbén | DNP, `portal.sisben.gov.co/Paginas/consulta-tu-grupo.html` | Asistido | Host inaccesible desde mi red durante la prueba [N]; tipo+número y "validación de seguridad" [S] |
| 11 | Registraduría (vigencia de cédula) | `certvigenciacedula.registraduria.gov.co` | Manual | Cloudflare (desafío anti-robot) y `X-Frame-Options: DENY` [V] |
| 12 | Seguridad social (planilla PILA) | Operador PILA del usuario (Mi Planilla, Aportes en Línea, SOI...) | Manual | Es del operador, no hay fuente única; login del usuario |
| 13 | SIRNA (Registro Nacional de Abogados) | Rama Judicial | No aplica salvo abogados | Solo para inscritos [S] |
| + | REDAM (deudores alimentarios) **falta en la app** | `redam.gov.co` + Carpeta Ciudadana Digital | Manual (autenticación digital) | Solo por Carpeta Ciudadana según guías [S]; su PDF sí trae vigencia legible [V] |
| + | BDME (deudores morosos del Estado) **falta en la app** | Contaduría, `contaduria.gov.co` | Manual | Requiere registro de usuario y clave [F] |

**Conclusión técnica corta.** Ninguno de los 14 sitios ofrece una API pública, sandbox ni servicio web para que una app de un ciudadano obtenga el certificado. Ninguno admite parámetros de URL para precargar la cédula [V: formularios POST con ViewState]. Ninguno envía cabeceras CORS que permitan `fetch` desde `*.github.io` [V]. Cuatro de ellos tienen captcha de Google o de imagen [V]. Lo máximo legítimo y estable es: **abrir el sitio oficial + copiar la cédula + recibir el PDF (arrastrar/soltar o carpeta) + leer fecha/código/vigencia y avisar vencimientos.**

---

## 2. Hallazgos medidos (cabeceras y formularios, 2026-10-28)

| Sitio | Tecnología | Captcha / anti-bot | CORS (`Access-Control-Allow-Origin`) | Iframe (`X-Frame-Options` / `frame-ancestors`) | Cookies |
|---|---|---|---|---|---|
| Policía antecedentes (`:7005/WebJudicial/`) | JSF/PrimeFaces 7.0, `javax.faces.ViewState`; términos con radio "Acepto" + AJAX → `antecedentes.xhtml` → resultado `formAntecedentes.xhtml` | No hay captcha en la página de términos [V]. Pantalla de consulta no vista [N]. Guías de terceros dicen que hay captcha [S]; guías de Bogotá y MinJusticia no lo mencionan [S] | Ninguna | La 302 de `antecedentes.xhtml` trae `X-Frame-Options: DENY`; el 200 de `index.xhtml` no trae cabecera de frame | `JSESSIONID` HttpOnly |
| Procuraduría (`apps.procuraduria.gov.co/webcert/`) | ASP.NET WebForms. `inicio.aspx?tpo=2` redirige (302) a `Certificado.aspx?t=<token cifrado>&tpo=2` | Pregunta aritmética en texto (ej. "¿Cuánto es 2 X 3?") + campo oculto `txtEmail` (honeypot). No hay reCAPTCHA | Ninguna | Sin XFO ni `frame-ancestors`; la propia `procuraduria.gov.co` embebe la app en un `<iframe>` (src=`apps.procuraduria.gov.co/webcert/inicio.aspx?tpo=2`). CSP de la app está mal formada (`default-src ‘self` con comilla tipográfica) | `ASP.NET_SessionId` con **SameSite=Lax** |
| Procuraduría validar (`.../webcert/validar.aspx`) | Campos: tipo ID, número ID, **número de certificado**, pregunta de seguridad | Pregunta aritmética | Ninguna | Igual que arriba | Igual |
| Contraloría (`cfiscal.contraloria.gov.co/certificados/certificadopersonanatural.aspx`) | ASP.NET WebForms. Campos: tipo documento (CC, CE, TI, pasaporte, PEP, PPT, matrícula mercantil, certificado de origen) + número | `g-recaptcha` (texto: "haga clic sobre el siguiente recuadro" = v2 casilla) | Ninguna en `cfiscal`. En `www.contraloria.gov.co` solo `https://api.contraloria.gov.co` | `cfiscal`: sin cabecera; `www`: SAMEORIGIN | `ASP.NET_SessionId` Lax |
| Contraloría `www.contraloria.gov.co` | Liferay tras Azure Application Gateway | Responde **403** al cliente por defecto (curl) y 200 con User-Agent de navegador: filtro anti-bot básico [V] | - | SAMEORIGIN | - |
| RNMC (`srvcnpc.policia.gov.co/PSC/frm_cnp_consulta.aspx`) | ASP.NET. Campos: "Consultar por" (comparendo/expediente, NIT, CC, CE, pasaporte, TI...) + "N° identificación, comparendo o expediente" | No se encontró captcha en el HTML servido [V] (puede cargarse por script; no probé el envío) | Ninguna | Sin cabecera de frame | - |
| Inhabilidades (`inhabilidades.policia.gov.co:8080`) | Java; `POST /consulta`; campos `nuip`, `fechaExpNuip`, `nombreEmpresa`, `nitEmpresa`, casilla de condiciones | **Google reCAPTCHA** (`google.com/recaptcha/api.js`, `g-recaptcha`) | Ninguna | Sin cabecera de frame | `JSESSIONID` |
| ADRES `www.adres.gov.co/consulte-su-eps` | Página informativa SharePoint; la consulta real vive en `aplicaciones.adres.gov.co/bdua_internet/Pages/ConsultarAfiliadoWeb.aspx` | **Captcha de imagen de 5 caracteres** (`Capcha$CaptchaTextBox`, `maxlength=5`) en la app BDUA | Ninguna | `www`: SAMEORIGIN y `frame-ancestors` que permiten a `aplicaciones.adres.gov.co`; la app BDUA no trae cabecera | - |
| RUAF (`ruaf.sispro.gov.co`) | - | No detectado en el HTML inicial [V]; terceros dicen captcha [S] | Ninguna | `X-Frame-Options: SAMEORIGIN`, CSP `frame-ancestors 'self'` | - |
| Colpensiones `www.colpensiones.gov.co` | - | - | `Access-Control-Allow-Origin: *.colpensiones.gov.co` (valor no válido para otros orígenes) | SAMEORIGIN | - |
| Libreta militar (`incorporacion.` / `definicion.libretamilitar.mil.co`) | SPA React/Vite. `env-config.js` expone `VITE_ENABLE_CAPTCHA: "true"`, `VITE_ENABLE_AUTH_BEARER: "true"`, rutas `/consulta-estado-situacion-militar` y `/validar-tarjeta-militar-digital`, llave pública para cifrar el login, API en `api.libretamilitar.mil.co` | Captcha habilitado (proveedor no identificado) [V parcial] | `www.libretamilitar.mil.co` devuelve `ACAO: *` solo en la redirección 301; no hay evidencia de que la API lo haga [N] | No medido | Token Bearer |
| Registraduría (`www.` y `certvigenciacedula.registraduria.gov.co`) | - | **Cloudflare** "Verifiquemos tu conexión... no provenga de un robot" (403 a curl; luego 429) | - | `X-Frame-Options: DENY` en el sitio del certificado | - |
| DIAN `www.dian.gov.co` | SharePoint | No medido | - | SAMEORIGIN + `frame-ancestors` | - |
| Carpeta Ciudadana (`carpetaciudadana.and.gov.co`) | - | - | `ACAO: *` en la portada, pero es página estática | `X-Frame-Options: SAMEORIGIN`, CSP `frame-ancestors 'self' https://*.and.gov.co` | - |
| Contaduría (BDME) | - | `recaptcha/api.js` cargado en el sitio | - | SAMEORIGIN | - |
| **datos.gov.co (Socrata, API abierta)** | `https://www.datos.gov.co/resource/<id>.json` | Sin captcha; límite sin token compartido [S] | **`ACAO: *` verificado** | - | - |

Notas clave de estas mediciones:

1. **CORS: ningún sitio oficial de trámite permite `fetch` desde `github.io`.** Solo datos.gov.co lo permite, pero sus conjuntos son agregados o parciales (sección 4).
2. **Iframe: probablemente roto aunque la cabecera lo permita.** Las cookies de sesión de la Procuraduría y la Contraloría son `SameSite=Lax`; dentro de un iframe de otro sitio (`github.io`) el navegador no las envía, y el formulario ASP.NET pierde su sesión/ViewState. Una **ventana emergente o pestaña nueva** (navegación de primer nivel) sí conserva la sesión. [N: inferencia por reglas de SameSite; se confirma con el spike G23.]
3. **El origen de la Procuraduría usa un token cifrado en la URL (`?t=...`) que cambia por sesión.** No se puede construir un deep link que ya salga rellenado. [V]
4. **Servidores con anti-bot (Cloudflare en Registraduría, WAF en Contraloría) rechazan clientes sin navegador.** Un proxy serverless o un `curl` no es una opción realista. [V desde mi equipo]

---

## 3. Ficha por documento

Convención de las fichas: **Vigencia** = qué dice la fuente oficial y qué hace la práctica; **Salida** = qué entrega el sitio.

### 3.1 Antecedentes judiciales (Policía Nacional)

| Campo | Detalle |
|---|---|
| URLs | `https://antecedentes.policia.gov.co:7005/WebJudicial/` (términos), `.../antecedentes.xhtml`, `.../formAntecedentes.xhtml` (resultado, según pie de página del PDF de muestra), `.../preguntas.xhtml` (FAQ) [V] |
| API / datos abiertos | Ninguna oficial. No hay conjunto en datos.gov.co con antecedentes por cédula (búsqueda en el catálogo Socrata: sin resultados relevantes) [V] |
| Entradas | Aceptar términos; número de cédula sin puntos [S: bogota.gov.co]. Sin fecha de expedición [S] |
| Captcha | No en la página de términos [V]. Pantalla de consulta: no verificada. Terceros la describen con captcha [S: eltiempo, colombiatramita...]; otras guías no lo mencionan [S: bogota.gov.co] |
| Salida | Página con leyenda ("NO TIENE ASUNTOS PENDIENTES CON LAS AUTORIDADES JUDICIALES") que el usuario imprime. La Policía dice textualmente que **no se genera en PDF** porque el certificado judicial fue eliminado por el art. 93 del Decreto 19 de 2012 y reemplazado por consulta en línea (art. 94) [F: `preguntas.xhtml`]. El PDF de muestra es una impresión de navegador: sin código de verificación ni firma [V]. Trae la hora y fecha de la consulta en texto ("siendo las 07:43:24 PM horas del 25/03/2026") |
| CORS / iframe | Sin CORS. Iframe incierto (la 302 trae `DENY`) |
| ToS / legal | Los 7 términos limitan el uso a la **propia información**; consultar a otro o usar la información con ánimo de lucro es irregular; la Policía "puede bloquear el acceso por cualquier uso que considere irregular" [F: WebFetch de la página de términos]. SU-458 de 2012 (Corte Constitucional): nadie está obligado a presentar un certificado de antecedentes judiciales; la entidad los verifica directamente [S: resumen de búsqueda; ver https://www.corteconstitucional.gov.co/relatoria/2012/su458-12.htm] |
| Vía gubernamental legítima | Carpeta Ciudadana Digital: guías de terceros dicen que incluye antecedentes judiciales [S]; no lo confirmé en una fuente oficial. No existe una API para integrarse (sección 5) |
| Vigencia | Policía: "La consulta en línea de antecedentes judiciales **no tiene vigencia**, debido a que diariamente se actualiza" [F]. Práctica: muchas entidades piden 30 a 90 días [S]. |
| Veredicto | **Asistido**: abrir, copiar cédula, el usuario consulta e imprime a PDF, la app lee el texto del PDF (fecha/hora) y calcula antigüedad. |

### 3.2 Antecedentes disciplinarios (Procuraduría)

| Campo | Detalle |
|---|---|
| URLs | Portada: `https://www.procuraduria.gov.co/Pages/certificado-antecedentes.aspx`. Botones: Consultar (`/Pages/Consulta-de-Antecedentes.aspx`), **Generar** (`/Pages/Generacion-de-antecedentes.aspx`, iframe a `https://apps.procuraduria.gov.co/webcert/inicio.aspx?tpo=2`), **Verificar** (`/Pages/Verificacion-de-certificado-de-antecedentes.aspx`, iframe a `.../webcert/validar.aspx`) [V] |
| API / datos abiertos | Sin API. Conjunto abierto **"Antecedentes de SIRI"** (`datos.gov.co/resource/iaeu-rcn6.json`, CC BY-SA 4.0, ~42.242 filas, actualizado el 2026-10-28, columnas `NUMERO_IDENTIFICACION`, `TIPO_INHABILIDAD`, `SANCIONES`...) con `ACAO: *` [V]. Contiene "sanciones disciplinarias certificables"; **no está demostrado que sea completo**, y la ausencia de filas NO equivale a "no registra". Solo sirve como pista informativa, nunca como certificado |
| Entradas | Tipo de identificación (CC, PEP, NIT, CE, PPT), número, **tipo de certificado: Ordinario / Especial**, pregunta de seguridad. No pide fecha de expedición [V] |
| Captcha | No es reCAPTCHA: pregunta aritmética en texto; honeypot oculto [V]. Aun así es un control anti-robot y resolverlo por código para saltarlo es una zona legal gris (sección 7) |
| Salida | PDF "CERTIFICADO ORDINARIO No. <n>" con fecha "Bogotá DC, 25 de marzo del 2026", texto "NO REGISTRA SANCIONES NI INHABILIDADES VIGENTES", jefe de división, aviso de 1 hoja [V: PDF de muestra]. Verificación en línea (`validar.aspx`) con tipo+número de ID + **número del certificado** [V]. La página dice "Verificar certificado: valide autenticidad y vigencia" [V] |
| CORS / iframe | Sin CORS. Sin cabecera de frame, y la propia Procuraduría usa iframe; pero `SameSite=Lax` probablemente rompe la sesión en iframe de otro sitio [N] |
| ToS / legal | No localicé términos específicos. Ley 1238 de 2008 faculta a entidades a consultar antecedentes de quien va a posesionarse o contratar [F: portada] |
| Vía gubernamental | Carpeta Ciudadana Digital incluye "Certificado de Antecedentes Disciplinarios" [F: MinTIC https://www.mintic.gov.co/portal/715/w3-article-398882.html]; requiere cuenta |
| Vigencia | **3 meses desde la expedición**: el art. 3 de la Resolución 143 de 2002 de la Procuraduría, citado por la Función Pública [F: Concepto 267521 de 2021, https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=171068] |
| Veredicto | **Asistido** (el más prometedor para ingesta: tiene número de certificado, fecha, texto estable y validador) |

### 3.3 Antecedentes fiscales (Contraloría)

| Campo | Detalle |
|---|---|
| URLs | Información: `https://www.contraloria.gov.co/control-fiscal/responsabilidad-fiscal/certificado-de-antecedentes-fiscales`. Persona natural: `https://cfiscal.contraloria.gov.co/certificados/certificadopersonanatural.aspx` [V] |
| API / datos abiertos | Sin API. El conjunto "Responsabilidad Fiscal" (`jr8e-e8tu`) en datos.gov.co tiene solo 60 filas: no es el boletín completo [V] |
| Entradas | Tipo de documento + número. Sin fecha de expedición [V] |
| Captcha | Google reCAPTCHA v2 (casilla) [V] |
| Salida | PDF "LA CONTRALORÍA DELEGADA PARA RESPONSABILIDAD FISCAL... CERTIFICA: Que una vez consultado el SIBOR, hoy miércoles 25 de marzo de 2026, a las 19:46:13...", con **Código de Verificación**, "Generó: WEB", firma mecánica válida por Decreto 2150/1995 y Resolución 220 de 2004 [V: PDF de muestra]. No es firma digital certificada |
| Verificación | "Con el Código de Verificación puede constatar la autenticidad" [V]; la ruta exacta ("Consulta Código de Verificación") solo en guías [S] |
| CORS / iframe | Sin CORS; el sitio principal devuelve 403 a clientes sin User-Agent de navegador [V] |
| ToS / legal | Servicio gratuito [F]. Embajadas/consulados: trámite presencial con firma original [F] |
| Vigencia | La Contraloría dice que la información es "en tiempo real" desde 2012 y que el boletín se publica trimestralmente (Ley 610 de 2000, art. 60) [F]. La Función Pública fija **3 meses desde la expedición** para la consulta previa al nombramiento (criterio interpretativo, no norma expresa) [F: Concepto 267521 de 2021] |
| Veredicto | **Asistido** |

### 3.4 Registro Nacional de Medidas Correctivas (RNMC, Policía)

| Campo | Detalle |
|---|---|
| URLs | `https://srvcnpc.policia.gov.co/PSC/frm_cnp_consulta.aspx` (Portal de Servicios al Ciudadano PSC) [V]. Guía: `https://www.vue.gov.co/tramites-y-consultas/consulta-de-medidas-correctivas` [S] |
| API / datos abiertos | Ninguna. No hallé conjunto abierto por persona |
| Entradas | Tipo ("Consultar por") + número de identificación, comparendo o expediente; aviso de tratamiento de datos que se acepta [V][S] |
| Captcha | No hallé en el HTML [V]. Si existe, se carga dinámicamente [N] |
| Salida | Es una página que el usuario imprime (pie "Nueva Búsqueda / Imprimir"); leyenda "NO TIENE MEDIDAS CORRECTIVAS PENDIENTES POR CUMPLIR", fecha y hora ("25/03/2026 07:44:53 p. m."), "Registro interno de validación No. <n>". Verificación: en `policia.gov.co` → ciudadanos → consulta medidas correctivas, con el documento y su fecha de expedición [V: PDF de muestra] |
| CORS / iframe | Sin CORS ni cabecera de frame |
| ToS / legal | Ley 1801 de 2016 (Código de Seguridad y Convivencia) [V: texto del PDF]. No localicé términos de uso específicos |
| Vigencia | No hallé vigencia oficial [N]. Práctica 30 a 90 días [S] |
| Veredicto | **Asistido**. Es el único donde un ayudante local (sección 6.7) podría automatizar sin captcha, pero con riesgo de términos de uso |

### 3.5 Inhabilidades por delitos sexuales contra menores de 18 años (Ley 1918/2018, Decreto 753/2019)

| Campo | Detalle |
|---|---|
| Nombre oficial | "Sistema de Consulta de Inhabilidades por Delitos Sexuales" / "Registro de Inhabilidades" (la app usaba "Registro RUD": no existe en fuentes oficiales; corregido el 2026-11-03) [F: https://www.icbf.gov.co/atencion-y-servicios-ciudadania/sistema-de-consulta-de-inhabilidades-por-delitos-sexuales y la página de la Policía] |
| URL | `https://inhabilidades.policia.gov.co:8080/` (consulta en `/consulta`) [V] |
| API / datos abiertos | Ninguna |
| Entradas | Tipo y número de documento, **fecha de expedición**, **nombre de la empresa o entidad consultante**, **NIT**, casilla de términos, **reCAPTCHA** [V] |
| Quién puede consultar | "Solo entidades públicas o privadas que el aspirante haya autorizado expresamente", para procesos de selección con contacto directo y habitual con menores; el aspirante da autorización previa; información reservada; prohibido el lucro; la entidad debe reverificar cada cuatro meses [F: página de la Policía]. El Senado marca parte del art. 4 como inexequible: verificar la versión vigente [S: secretariasenado.gov.co] |
| Salida | Certificado en PDF o impresión [S: El Espectador] |
| Veredicto | **Manual**, y no debe presentarse como documento que "obtiene el candidato por su cuenta": la consulta está diseñada para la entidad contratante. La app solo debe enlazar, explicar y permitir adjuntar lo que la entidad entregue. No automatizar (reCAPTCHA + términos de uso reservado) |
| Vigencia | Reverificación cada 4 meses por la entidad durante la relación laboral [F] |

**5b. Inhabilidades por delitos contra animales (Ley 2455 de 2025, "Ley Ángel")** — *falta en la app.* La FAQ de la Policía indica que el titular solicita el certificado con una **solicitud firmada** al correo `dijin.araic-atc@policia.gov.co`, con copia de la cédula vigente (extranjeros: pasaporte y cédula de extranjería); terceros necesitan autorización notariada o poder; las entidades presentan solicitud formal con consentimiento [F: `preguntas.xhtml`]. Es una sección reservada del certificado de antecedentes judiciales [S]. Aplica solo a cargos relacionados con animales. **Manual** (correo).

### 3.6 Situación militar / libreta

| Campo | Detalle |
|---|---|
| URL | `https://www.libretamilitar.mil.co/` → `https://incorporacion.libretamilitar.mil.co/` y `https://definicion.libretamilitar.mil.co/` [V]. Rutas: `/consulta-estado-situacion-militar`, `/validar-tarjeta-militar-digital` |
| Servicios | Registro, login, estado del trámite, consulta de situación militar, certificado de tarjeta militar, constancia de reservista en el exterior [F: https://www.ejercito.mil.co/libreta-militar-634744] |
| API | Existe `api.libretamilitar.mil.co`, no documentada para terceros; usarla sería ingeniería inversa [V parcial] |
| Captcha / login | `VITE_ENABLE_CAPTCHA: "true"`; el flujo de login usa clave pública para cifrar credenciales; token Bearer [V] |
| Salida | Certificado en PDF sin costo; "no reemplaza la tarjeta militar" [S: canalinstitucional, notaría 19] |
| Legal | Ley 1861 de 2017: definir la situación militar de los 18 a los 50 años; las entidades no pueden exigir la libreta como requisito de empleo pero sí que se defina la situación [S: notaría 19 de Bogotá; no lo confirmé en el texto de la ley] |
| Vigencia | No hallé vigencia del certificado [N]. La tarjeta militar no expira de por sí. La app tiene `claseLibreta` y `distritoMilitar` ya como datos |
| Veredicto | **Manual**: enlace + instrucciones + subida del PDF |

### 3.7 RUT (DIAN)

| Campo | Detalle |
|---|---|
| URLs | Trámites RUT: `https://www.dian.gov.co/tramitesservicios/Tramites_Impuestos/RUT/Paginas/default.aspx`. Copia sin clave: `https://www.gov.co/tramites-y-servicios/obtener-copia-rut` y `.../dian.gov.co/tramitesservicios/Paginas/RUT-sin-correo-electronico` [S: ambas citadas por Infobae; no abiertas por mí] |
| API | Ninguna pública para terceros que yo haya encontrado [N] |
| Entradas | Con clave: usuario y contraseña de Muisca [S]. Sin clave (desde 2023): tipo y número de documento + verificación anti-robot; el PDF llega al **correo registrado en el RUT** [S: Infobae https://www.infobae.com/colombia/2026/04/17/descargar-el-rut-sin-contrasena-sera-mas-facil-en-2026-conozca-las-opciones-disponibles/] |
| Salida | PDF con código QR y fecha de generación [S] |
| Vía gubernamental | Carpeta Ciudadana Digital ofrece "copia del RUT" [F: MinTIC https://www.mintic.gov.co/portal/715/w3-article-398882.html] |
| Vigencia | El RUT no vence; las entidades piden una copia reciente (práctica 30 a 90 días [N]). No hallé norma |
| Veredicto | **Manual** (bandeja de correo del usuario como intermediario; imposible de automatizar) |

### 3.8 Afiliación a EPS (ADRES / BDUA)

| Campo | Detalle |
|---|---|
| URLs | Informativa: `https://www.adres.gov.co/tramites/ciudadania/consulta-afiliacion` ("Iniciar trámite" → `/consulte-su-eps`). Consulta: `https://aplicaciones.adres.gov.co/bdua_internet/Pages/ConsultarAfiliadoWeb.aspx` [V] |
| API / datos abiertos | Datos abiertos agregados: "BDUA régimen contributivo" (`tq4m-hmg2`) y "subsidiado" (`d7a5-cnra`), 14 columnas por departamento/municipio/grupo etario, sin cédula [V]. No sirven para certificar a una persona |
| Entradas | Tipo y número de documento + captcha de imagen [V] |
| Salida | Pantalla con EPS, régimen, estado y fecha de afiliación; actualización mensual de la BDUA; se guarda con "Imprimir → PDF". ADRES no describe un certificado oficial firmado [F: página de ADRES]. El certificado formal lo da la **EPS** (portal propio de cada una) [S] |
| Vigencia | Datos actualizados mensualmente [F]. Práctica 30 días [N] |
| Veredicto | **Asistido** para el soporte "informativo" ; **Manual** si la convocatoria exige certificado de la EPS |

### 3.9 Pensión (RUAF / Colpensiones)

| Campo | Detalle |
|---|---|
| URLs | RUAF: `https://ruaf.sispro.gov.co/`; Colpensiones: `https://www.colpensiones.gov.co/pensiones/` (certificados de afiliación) [V][F] |
| API | Ninguna pública. RUAF no admite iframe (`frame-ancestors 'self'`) [V] |
| Entradas | RUAF: tipo y número de documento, captcha [S]. Colpensiones: formulario de certificados con validaciones [S] |
| Salida | Reporte en pantalla/PDF; fondo, régimen y fecha de vinculación [S] |
| Vigencia | No hallé norma [N]. Práctica 30 a 90 días [N] |
| Veredicto | **Manual** |

### 3.10 Sisbén

| Campo | Detalle |
|---|---|
| URL | `https://portal.sisben.gov.co/Paginas/consulta-tu-grupo.html` [S: Noticias Caracol]. El host `www.sisben.gov.co` y `reportes.sisben.gov.co` no respondieron desde mi red el 2026-10-28 [V] |
| API / datos abiertos | "DNP - Sisbén Personas" (`hq2v-5umk`, 4,46 millones de filas) es una **muestra anonimizada de marzo de 2022**; no sirve para consultar a una persona [V] |
| Entradas | Tipo y número de documento; validación de seguridad [S]. Sin registro ni clave [S] |
| Salida | Pantalla; "Guardar como PDF" desde imprimir [S] |
| Vigencia | No hallé [N]. Solo "si aplica" |
| Veredicto | **Asistido/manual** |

### 3.11 Registraduría (vigencia de la cédula)

| Campo | Detalle |
|---|---|
| URL | `https://certvigenciacedula.registraduria.gov.co/` (según una guía, pide número y fecha de expedición [S]); el enlace antiguo `wsp.registraduria.gov.co/certificado/` da 404 [V] |
| Anti-bot | Cloudflare "Verifiquemos tu conexión" y `X-Frame-Options: DENY` [V]. Es el sitio más hostil a la automatización |
| Salida | Certificado gratuito en línea; estados: vigente, cancelada por muerte, pérdida de derechos políticos... [S] |
| Nota | La Procuraduría usa la Registraduría para actualizar nombres y estado de la cédula (una vez por día) [F: portada de la Procuraduría]. Si el certificado de antecedentes sale con el estado de cédula equivocado, ese es el camino |
| Veredicto | **Manual** |

### 3.12 Seguridad social: planilla PILA

No hay fuente única: el soporte lo da el **operador PILA** que usó el aportante (Mi Planilla, Aportes en Línea, SOI, Simple, Enlace Operativo, Asopagos) [S: El Tiempo, Infobae, ayuda.miplanilla.com]. Un independiente descarga su certificado con login en el operador; un dependiente depende de su empleador [S]. El comprobante suele traer periodo, IBC, entidades, valores, número de planilla, fecha y código de verificación [S: El Diario]. **Manual**. Vigencia: por periodo cotizado.

### 3.13 SIRNA (Registro Nacional de Abogados, Rama Judicial)

Solo relevante para abogados: "Certificado de vigencia" y "Certificado de vigencia con direcciones", gratis, 24/7 en `sirna.ramajudicial.gov.co` o app TPA-Digital; hay servicio de verificación de autenticidad [S: ramajudicial.gov.co]. **No incluir** salvo perfil de abogado; si se incluye, es **Manual**.

### 3.14 Documentos que faltan en la lista de la app

| Documento | Por qué importa | Fuente | Veredicto |
|---|---|---|---|
| **REDAM** (Registro de Deudores Alimentarios Morosos, Ley 2097/2021, Decreto 1310/2022) | Condición para posesionarse en cargos públicos y contratar con el Estado [S: gerencie, El Diario, bogota.gov.co] | `https://www.redam.gov.co/` (SPA). El portal indica que la **Carpeta Ciudadana Digital es el único medio** de consulta y descarga [S: la página no la pude leer; WebFetch devolvió solo el título] | Manual (autenticación digital). **Su PDF es el mejor de todos para ingesta**: trae "Código Verificación: ..." y "**Válida hasta: dd/mm/aaaa**" (expedido 16/03/2026, válido hasta 14/06/2026: 90 días) y validador en `https://registro.redam.gov.co/validate-certificate/` [V: PDF de muestra] |
| **BDME** (Boletín de Deudores Morosos del Estado, Ley 901 de 2004) | Impedimento para contratar con el Estado (NO verificado el 2026-11-03) | `https://www.contaduria.gov.co/acerca-de-bdme`. Requiere registrarse como usuario con contraseña; consulta por número de identificación; descarga PDF [F]. Boletín semestral con cortes publicados de forma contradictoria (resuelto el 2026-11-03: cortes al 30 de mayo y 30 de noviembre, ficha técnica de la Contaduría) (la página dice 30 de julio y 31 de enero; una nota de prensa dice 31 de mayo y 30 de noviembre) [F][S] | Manual |
| Certificado de vigencia de cédula | Ver 3.11 | | Manual |
| Certificado de inhabilidad por animales (5b) | Cargos con animales | | Manual |
| Certificados específicos por profesión (Junta Central de Contadores, COPNIA, etc.) | Solo si el cargo los exige | No investigado | Fuera de alcance |

**Un hallazgo sobre la lista actual:** la app dice "Libreta militar... Si aplica" y "SISBEN... Si aplica": coherente con que ni libreta ni Sisbén son exigibles de forma general [S]. Revisar con la convocatoria (G07).

---

## 4. Vigencia: tabla para la app (`vigenciaDias`)

"Fuente" indica en qué se basa. El campo propuesto es el máximo de antigüedad a partir del cual la app muestra "vencido". Todo es configurable por plantilla/convocatoria porque **la entidad receptora manda**.

| Documento | Vigencia oficial | `vigenciaDias` sugerido (por defecto) | Fuente / certeza |
|---|---|---|---|
| Disciplinarios | 3 meses desde la expedición | 90 | [F] Res. 143/2002 art. 3, vía Concepto Función Pública 267521/2021 |
| Fiscales | 3 meses (criterio de Función Pública; boletín trimestral) | 90 | [F] mismo concepto; Ley 610/2000 art. 60 |
| REDAM | 3 meses calendario; el PDF trae "Válida hasta" | usar la fecha del PDF; si falta, 90 | [V] PDF de muestra; [S] guías |
| Judiciales | La Policía: la consulta no tiene vigencia | 30 (configurable; práctica 30 a 90) | [F] FAQ Policía; práctica [S] |
| RNMC | No hallada | 30 | [N]; práctica [S]. Corregido el 2026-11-03: sin vigencia legal, solo práctica |
| Inhabilidades Ley 1918 | Reverificación cada 4 meses por la entidad | 120 | [F] página de la Policía; inexequibilidad parcial resuelta el 2026-11-03 (C-407/2020, solo la frase "por el ICBF" del art. 4) |
| EPS (ADRES) | BDUA se actualiza cada mes | 30 | [F] ADRES; el 30 es práctica [N] |
| Pensión, Sisbén, RUT, cédula, libreta | Sin norma hallada | 90 (o "sin vencimiento": RUT/libreta) | [N] |
| PILA | Por periodo cotizado | por periodo | [S] |
| BDME | Boletín semestral | 180 | [F] página de la Contaduría; certificado sin vigencia indicada |

Aviso para la UI: "La vigencia depende de la entidad que recibe el documento. Verifique con ella".

---

## 5. ¿Existe una vía de integración legítima del Estado?

**Carpeta Ciudadana Digital (Servicios Ciudadanos Digitales, SCD).**

- Es el servicio por el cual el ciudadano consulta sus datos que custodian las entidades; lo prestan el Articulador (Agencia Nacional Digital) y los prestadores conectados a la plataforma de interoperabilidad [F: Decreto 620 de 2020, https://normograma.mintic.gov.co/mintic/compilacion/docs/decreto_0620_2020.htm].
- Portal: `https://carpetaciudadana.and.gov.co/`. Registro con cédula, fecha de expedición, nombre, correo y celular [F: MinTIC]. Más de 100 trámites, entre ellos REDAM, copia del RUT, antecedentes disciplinarios, antecedentes de responsabilidad fiscal, consulta de tarjeta militar [F/S: MinTIC, Enter.co]. Las guías de terceros añaden antecedentes judiciales y datos de ADRES [S, no confirmado].
- **No encontré API pública ni sandbox** para que una app de ciudadano lea la carpeta. La integración es de entidades y de **prestadores privados, que deben ser personas jurídicas con requisitos financieros** (índice de liquidez ≥ 1,5, endeudamiento ≤ 0,50, capital de trabajo ≥ 1, estados financieros, requisitos técnicos), autenticación por **OpenID Connect** y habilitación coordinada por la Agencia Nacional Digital [F: Guía de integración de prestadores privados, https://www.mintic.gov.co/portal/715/articles-178590_recurso_2.pdf]. Para una app personal esto no es viable.
- El portal no se puede enmarcar (`frame-ancestors 'self' https://*.and.gov.co`) [V].
- El usuario puede **entrar él mismo** a la Carpeta y descargar los PDF; es una vía legítima (autenticación suya) para REDAM, disciplinarios, fiscales y RUT, y evita el captcha de cada sitio. La app puede recomendarla.

**Otros nombres de su lista.**

- **Mi Carpeta / AgentesID / "GOV.CO":** no encontré documentación pública de una API de ciudadano con esos nombres. `gov.co` es el portal único de trámites (enlaces). [N]
- **SIGEP / SIGEP II (Función Pública):** es el lugar donde se registra la hoja de vida de servidores y contratistas. Usuario = número de documento; la entidad habilita el usuario y la clave; soportes PDF/JPG de hasta 1 MB [S: preguntas frecuentes de Función Pública]. No hallé API pública ni acceso por Clave de Ciudadano Digital. Útil como destino de la HV (modelo "Formato Único", G02), no como fuente de certificados.
- **datos.gov.co (Socrata):** única API abierta con CORS `*` [V]. Sin conjuntos de certificados individuales; solo los parciales ya citados (SIRI, BDUA agregada, Sisbén muestreado, responsabilidad fiscal con 60 filas).

---

## 6. Evaluación de opciones

Resumen: ✔ factible por sí sola, ◐ solo con interacción del usuario, ✘ no factible o desaconsejado.

| # | Opción | Estado | Evidencia y condiciones |
|---|---|---|---|
| 6.1 | **Enlace directo** (`<a target="_blank" rel="noopener">`) | ✔ | Abrir el sitio oficial siempre funciona. **Prellenado por URL: ✘** (formularios POST con ViewState; la Procuraduría usa token de sesión en la URL) [V]. |
| 6.2 | **Copiar al portapapeles + abrir** (copy-assist) | ✔ | `navigator.clipboard.writeText` con clic del usuario (contexto seguro). Mostrar también la fecha de expedición para ADRES/Inhabilidades. Es la mejora de "un clic" realista. |
| 6.3 | **Iframe con el sitio oficial dentro de la app** | ✘ en general | Registraduría `DENY`; Carpeta Ciudadana `frame-ancestors`; DIAN/RUAF/Colpensiones/ADRES-www `SAMEORIGIN` [V]. Procuraduría y Contraloría no lo prohíben, pero sus cookies `SameSite=Lax` probablemente rompen la sesión en iframe de otro sitio [N]. Además la app no puede leer el contenido (política de mismo origen). |
| 6.4 | **Ventana emergente / pestaña con el captcha resuelto por el usuario** | ◐ | Es el modo real: el usuario resuelve el captcha en el sitio oficial (primer nivel, cookies OK) y guarda el PDF. La app no puede leer nada de esa pestaña. |
| 6.5 | **Bookmarklet** | ◐ | Puede rellenar el campo de cédula en una página que el usuario ya abrió (la cédula vendría del portapapeles; leer exige permiso). No resolver captchas ni la pregunta aritmética. Posible bloqueo por CSP en algunos sitios [N: no probado]. Los formularios ASP.NET con `__doPostBack` complican el autollenado. Esfuerzo bajo, valor bajo. |
| 6.6 | **Userscript (Tampermonkey) o extensión MV3 opcional** | ◐ | Mayor control: rellenar campos, detectar la descarga y **enviar el PDF a la app** (mensajería `externally_connectable` con el origen de Pages) [N: no probado]. Puede saltarse CORS con `host_permissions` usando la sesión del propio usuario, pero el captcha sigue siendo humano. Coste: empaquetar, tienda de extensiones, mantenimiento cuando cambien los sitios. Opcional "modo avanzado". |
| 6.7 | **Ayudante local (Node + Playwright) que el usuario ejecuta** | ◐ / riesgo | Abre un navegador visible, rellena la cédula, **espera a que el humano resuelva el captcha** y guarda el PDF en una carpeta que la app vigila. Sin captcha (RNMC) podría ser totalmente automático. Riesgos: términos de uso de la Policía ("uso irregular"), huella de robot (Cloudflare en Registraduría, WAF en Contraloría [V]), mantenimiento. Resolver la pregunta aritmética de la Procuraduría por código equivale a saltar un control anti-robot: no recomendado. Si se hace, solo con los datos del propio usuario y con aviso legal. |
| 6.8 | **Proxy serverless propio** | ✘ | Los sitios no envían CORS, tienen captcha/WAF, la sesión ASP.NET/JSF depende del navegador, y un tercero procesaría cédulas ajenas (Ley 1581 de 2012; términos de la Policía limitan el uso a la propia información [F]). Rompe además el diseño "100% local" y el cumplimiento de privacidad (G05). Desaconsejado. |
| 6.9 | **API de pago de terceros** | ✘ (para este caso) | **Verifik** (`docs.verifik.co`, endpoint de antecedentes policiales por tipo+número; precio no publicado [S]); **Truora** (por cotización [S: mediasource]); **tusdatos.co** (un blog comercial, HunterX, cita ~COP 610/consulta en paquete de 1.000 y COP 1.800 en cumplimiento de 400; cifras de tercero, no verificadas [S]). Necesitan clave secreta (backend), base legal/consentimiento del titular, y devuelven JSON propio, no el PDF oficial. Útiles para empresas que verifican candidatos, no para que un candidato arme su HV. |
| 6.10 | **Ingesta del PDF descargado** (arrastrar y soltar) | ✔ | `<input type=file>` / drag-drop funciona en todos los navegadores. Extraer texto con pdf.js; los PDF de muestra son texto extraíble [V]. Leer fecha de emisión, número de certificado/código de verificación, cédula, estado (sin registro / con registro) y, en REDAM, "Válida hasta". Calcular vigencia y avisar. Si es imagen escaneada, hace falta OCR (tesseract.js). |
| 6.11 | **Vigilar la carpeta Descargas** (File System Access API) | ◐ (solo Chromium) | `showDirectoryPicker` está en Chrome/Edge 86+; Firefox y Safari no [F: developer.chrome.com, MDN]. Requiere contexto seguro (Pages es HTTPS) y gesto del usuario; el permiso no siempre persiste entre sesiones [F]. **No hay API de observación**: hay que sondear con `dir.values()`. Los PDF nombrados por la web ("consulta", "certificado") hay que clasificarlos por contenido. Alternativa universal: arrastrar y soltar (6.10). |
| 6.12 | **Pre-chequeo con datos abiertos** (SIRI en datos.gov.co) | ◐, no recomendado por defecto | Posible por CORS `*` [V], pero incompleto/sin garantía de cobertura y envía la cédula a un tercero (Socrata/AWS). Riesgo de falsa tranquilidad. Si se hace: rotulado como "pista informativa" y opt-in. |

### 6.A Clasificación final

**Factible (sin intervención, sin nada del lado del servidor):**
- Enlaces oficiales por documento, instrucciones, copiar cédula, mostrar fecha de expedición.
- Ingesta de PDF por arrastre, extracción de fecha/código/estado/vigencia, alertas de vencimiento, validación cruzada cédula/nombre.
- Enlaces a validadores oficiales (Procuraduría `validar.aspx`, REDAM `validate-certificate`, Contraloría código de verificación, RNMC "Validar Policía").

**Factible solo con el usuario presente:**
- Obtención en el sitio oficial (captcha/clic/descarga) en pestaña nueva; detección en carpeta (Chromium); extensión/ayudante local opcional que ahorra pasos pero no el captcha; entrada en Carpeta Ciudadana Digital.

**No factible (y por qué):**
- "Obtener" con un clic sin intervención: reCAPTCHA (Contraloría, Inhabilidades), captcha de imagen (ADRES), pregunta anti-robot (Procuraduría), Cloudflare (Registraduría), login (Libreta, DIAN, Colpensiones, BDME, REDAM).
- `fetch` desde Pages a los sitios: sin CORS [V].
- Prellenado por URL: no soportado [V].
- Iframe: bloqueado o con sesión rota.
- Proxy serverless: bloqueos técnicos, protección de datos y términos de uso.
- Obtener por la Carpeta Ciudadana o SCD desde la app: sin API pública; solo prestadores personas jurídicas habilitadas [F].

---

## 7. Aspectos legales y de términos (no es asesoría jurídica)

- **Policía (verificado):** el uso está limitado a información propia; consultar a terceros o usar con lucro es irregular; la Policía puede bloquear el acceso [F]. Una herramienta que automatice consultas de la cédula propia del usuario ya es zona gris; de terceros, no.
- **Datos personales:** Ley 1581 de 2012 (habeas data) citada por la Policía [F]. La cédula y los antecedentes son datos personales; la app los guarda solo en el navegador del usuario (ver G05). Un proxy o API externa cambiaría eso.
- **Delitos informáticos:** la Ley 1273 de 2009 tipifica acceso abusivo a sistemas y violación de datos personales; no la verifiqué aquí. Saltarse controles anti-robot por código aumenta el riesgo. [N]
- **Sentencia SU-458 de 2012 y Función Pública:** la verificación de antecedentes judiciales/disciplinarios/fiscales la hace la **entidad** directamente; el aspirante no está obligado a presentar el judicial [S/F]. Conviene que la app diga "si la entidad lo solicita" y no marque como obligatorios estos documentos.
- **Términos de Procuraduría, Contraloría, ADRES, DIAN y otros:** no los localicé ni los leí. Pendiente de revisar si se avanza hacia automatización más allá de la ingesta.

---

## 8. Arquitectura recomendada

Principio: **la app nunca habla con los sitios oficiales; el usuario sí.** La app es el "cuaderno de a bordo": sabe qué documento falta, lleva al usuario al sitio correcto con la cédula lista, recibe el PDF y calcula la vigencia.

1. **Registro de fuentes** (`app/js/sources.js`, un objeto por documento): `{ id, nombre oficial, url, urlValidador, entradas ('cedula','fechaExp','empresa+NIT'), captcha ('aritmetica'|'recaptcha'|'imagen'|'login'|'cloudflare'|'ninguno'), vigenciaDias, vigenciaFuente, notas legales, pasos[3-4], parser }`. Alimenta `models/minerva.js` (`documents`) en lugar de las pistas de texto de hoy.
2. **Tarjeta por documento** en la vista Documentos: botones **[Abrir sitio oficial]** (pestaña nueva) y **[Copiar cédula]** (y fecha de expedición si aplica), pasos cortos, advertencia del captcha, y zona **[Soltar el PDF aquí]**.
3. **Ingesta de PDF**: pdf.js vendorizado (en `app/vendor/`, junto con el trabajo de pdf-lib de G01), extractor por documento con expresiones regulares basadas en los textos reales vistos (Policía: "siendo las HH:MM:SS ... del dd/mm/aaaa"; RNMC: "Que a la fecha, dd/mm/aaaa hh:mm"; Procuraduría: "CERTIFICADO ORDINARIO No. n" + "Bogotá DC, d de mes del aaaa"; Contraloría: "hoy día, d de mes de aaaa, a las HH:MM:SS" + "Código de Verificación"; REDAM: "Código Verificación" + "Válida hasta"). Guardar con el archivo: `emitidoEn`, `vencimiento`, `codigo`, `estado` y cédula leída.
4. **Semáforo de vigencia** (vigente / por vencer en 15 días / vencido / desconocido) en Documentos, en Plantillas (warnings) y en la Vista previa. Mensaje: "depende de la entidad".
5. **Detección de descargas (opcional, Chromium)**: botón "Vigilar mi carpeta de descargas" con `showDirectoryPicker`, sondeo cada pocos segundos, clasificación por contenido; fallback a arrastrar y soltar.
6. **Capa opcional "modo avanzado"** (después, no antes): extensión MV3 o ayudante local que *entrega el PDF a la app* y rellena la cédula; el usuario sigue resolviendo captcha. Revisión legal previa.
7. **Descartado**: proxy serverless, APIs de pago, ingeniería inversa de APIs internas (libreta militar, etc.), resolución automática de captchas o de la pregunta aritmética.

Privacidad: la cédula nunca se envía a terceros desde la app; los PDF se guardan en IndexedDB como hoy.

---

## 9. Backlog propuesto (esfuerzo S / M / L)

Los IDs de esta tabla son locales. En `docs/GAPS.md` se consolidaron así: G18 (aquí G18+G25), G19 (G19+G24), G20 (G20+G21), G21 (G22), G22 (G23), G23 (G26+G27); G28 (pista con datos abiertos) no se añadió por no recomendarse.

| ID | Ítem | Esfuerzo | Notas |
|---|---|---|---|
| G18 | Registro de fuentes oficiales por documento (`sources.js`) con URL, validador, captcha, `vigenciaDias`, pasos; botones "Abrir sitio oficial" y "Copiar cédula" | M | Incluye corregir nombres (no "RUD"), añadir REDAM, BDME (opcional), vigencia de cédula, inhabilidad por animales; base de G07 |
| G19 | Ingesta de PDF con pdf.js: leer fecha/código/estado/vencimiento por documento | L | Vendorizar pdf.js; parsers y pruebas con PDF de muestra anonimizados; coordinar con pdf-lib de G01 |
| G20 | Semáforo de vigencia y avisos de vencimiento (Documentos, Plantillas, Vista previa) | S | Depende de G18; ver también G07 |
| G21 | Validación cruzada: cédula/nombre del PDF contra el perfil; avisar si no coinciden | S | Depende de G19 |
| G22 | Vigilar carpeta de descargas (File System Access, solo Chromium) | M | Sondeo, permiso por sesión, fallback drag-drop |
| G23 | Spike de verificación en navegador real: iframe vs ventana, cookies `SameSite=Lax`, deep links, bookmarklet bajo CSP, pantalla de captcha de Policía | S | Cierra los [N] de este documento; sin enviar datos reales |
| G24 | OCR opcional (tesseract.js) para PDF escaneados o fotos | M | Peso grande; solo bajo demanda |
| G25 | Enlaces a validadores y a Carpeta Ciudadana Digital como ruta alternativa | S | Incluible en G18 |
| G26 | Extensión MV3 opcional (rellenar cédula + entregar PDF a la app) | L | Revisión legal previa; mantenimiento por cambios de los sitios |
| G27 | Ayudante local Node/Playwright opcional con espera de captcha humano | L | Solo si G26 no basta; riesgo de términos de uso (Policía) |
| G28 | Pista informativa con datos abiertos (SIRI en datos.gov.co) | S | No recomendado por defecto: cobertura no demostrada y envía la cédula a un tercero |

---

## 10. Qué queda sin verificar (honestidad)

- Pantalla de captcha de antecedentes judiciales (Policía): no vista.
- Captcha en RNMC al ejecutar la consulta; Sisbén (host inaccesible); RUAF y Colpensiones al consultar; DIAN (páginas de copia sin clave no abiertas).
- Texto de términos de uso de Procuraduría, Contraloría, ADRES, DIAN, Registraduría.
- Que `SameSite=Lax` rompa el iframe (inferencia); comportamiento de bookmarklets bajo CSP.
- La página `redam.gov.co` es una SPA que no se pudo leer; lo del "único medio: Carpeta Ciudadana" viene de guías que citan al portal.
- Las vigencias de RNMC, ADRES, RUT, pensión, Sisbén y libreta no tienen norma hallada.
- Precios de APIs de terceros: solo cifras de un blog comercial.

---

## 11. Fuentes

Oficiales y normativas leídas o consultadas:
- Policía, antecedentes judiciales: https://antecedentes.policia.gov.co:7005/WebJudicial/ y FAQ https://antecedentes.policia.gov.co:7005/WebJudicial/preguntas.xhtml
- Policía, inhabilidades Ley 1918: https://inhabilidades.policia.gov.co:8080/
- Policía, RNMC: https://srvcnpc.policia.gov.co/PSC/frm_cnp_consulta.aspx
- ICBF, sistema de consulta de inhabilidades: https://www.icbf.gov.co/atencion-y-servicios-ciudadania/sistema-de-consulta-de-inhabilidades-por-delitos-sexuales
- Ley 1918 de 2018 (Senado): http://www.secretariasenado.gov.co/senado/basedoc/ley_1918_2018.html ; Función Pública: https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=87420
- Ley 2455 de 2025: https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=259656
- Procuraduría: https://www.procuraduria.gov.co/Pages/certificado-antecedentes.aspx ; app: https://apps.procuraduria.gov.co/webcert/inicio.aspx?tpo=2 y https://apps.procuraduria.gov.co/webcert/validar.aspx
- Contraloría: https://www.contraloria.gov.co/control-fiscal/responsabilidad-fiscal/certificado-de-antecedentes-fiscales ; https://cfiscal.contraloria.gov.co/certificados/certificadopersonanatural.aspx
- Función Pública, Concepto 267521 de 2021 (vigencia 3 meses disciplinarios y fiscales): https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=171068
- Corte Constitucional SU-458 de 2012: https://www.corteconstitucional.gov.co/relatoria/2012/su458-12.htm
- ADRES: https://www.adres.gov.co/tramites/ciudadania/consulta-afiliacion ; https://aplicaciones.adres.gov.co/bdua_internet/Pages/ConsultarAfiliadoWeb.aspx
- Ejército, libreta militar: https://www.ejercito.mil.co/libreta-militar-634744 ; https://definicion.libretamilitar.mil.co/
- Contaduría, BDME: https://www.contaduria.gov.co/acerca-de-bdme
- REDAM: https://www.redam.gov.co/ ; validador visto en PDF: https://registro.redam.gov.co/validate-certificate/
- Carpeta Ciudadana Digital: https://carpetaciudadana.and.gov.co/ ; MinTIC: https://www.mintic.gov.co/portal/715/w3-article-398882.html ; Decreto 620/2020: https://normograma.mintic.gov.co/mintic/compilacion/docs/decreto_0620_2020.htm ; Guía de prestadores privados: https://www.mintic.gov.co/portal/715/articles-178590_recurso_2.pdf
- datos.gov.co: catálogo Socrata `https://api.us.socrata.com/api/catalog/v1?domains=www.datos.gov.co`; conjuntos `iaeu-rcn6` (SIRI), `tq4m-hmg2` y `d7a5-cnra` (BDUA), `hq2v-5umk` (Sisbén), `jr8e-e8tu` (responsabilidad fiscal)
- Web: https://developer.chrome.com/docs/capabilities/web-apis/file-system-access ; https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker

PDF de muestra leído (estructura, sin reproducir datos): https://operaciones.colombiacompra.gov.co/sites/cce_public/files/documentos_adicionales_oc/21._antecedentes_6.pdf (contiene RNMC, judicial, REDAM, Procuraduría y Contraloría del 25/03/2026).

Secundarias (usar con cautela): bogota.gov.co (guías de antecedentes), El Tiempo, El Espectador, Infobae (RUT sin clave), Noticias Caracol (Sisbén), Enter.co, El Diario, gerencie.com, ayuda.miplanilla.com, docs.verifik.co, mediasource.mx (Truora), hunterx.com.co (precios).

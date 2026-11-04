# Formato Único de Hoja de Vida – Persona Natural: especificación extraída del PDF oficial

## Fuente

| | |
|---|---|
| Documento | "Formato Único Hoja de Vida – Persona Natural (Leyes 190 de 1995, 489 y 443 de 1998)", Departamento Administrativo de la Función Pública (DAFP) |
| Página oficial | https://www1.funcionpublica.gov.co/formato-unico-de-hoja-de-vida-persona-natural ("Formato Único de Hoja de vida para descargar en pdf") |
| URL del PDF | https://www1.funcionpublica.gov.co/documents/418537/28811162/formato-unico-de-hoja-de-vida-persona-natural.pdf/ |
| Copia local | `docs/models/formato-unico/formato-unico-hoja-de-vida-persona-natural.pdf` (114 579 bytes, SHA-256 `e6ce85b72c8f8d4c6964c5c2fbf1980b4332db6b0a58d6e0854eba82e75cdc3c`) |
| Versión | Metadatos del PDF: creado 2009-11-23 (PDFescape), modificado 2020-11-18 (`Last-Modified` del servidor: 18-11-2020). Código del instructivo: "FORMATO FUHVPN 001". Descargado el 2026-11-03. |
| Instructivo | https://www1.funcionpublica.gov.co/documents/418537/28811162/Instructivo_Formato+HV+personal+natural.pdf/44240875-6ca2-4c0a-b37b-3a35928c1e11 → `docs/models/formato-unico/instructivo-formato-hv-persona-natural.pdf` (SHA-256 `d60a61fb…294d`, 2011-03-23) |
| Estado legal | Formato oficial de una entidad pública, publicado para que cualquier aspirante a un empleo público o a un contrato de prestación de servicios lo descargue y diligencie (Ley 190 de 1995, art. 1; Decreto 1083 de 2015). La página no declara licencia: se reproduce sin cambiar su contenido y solo para diligenciarlo, que es su uso previsto; no se redistribuye como obra propia. El escudo de Colombia va porque forma parte del formato; no se usa fuera de él. |

Los archivos descargados se tratan como datos externos: se leen con `python -I` y nada de ellos se ejecuta.

Se eligió este PDF y no el SIGEP: el SIGEP II es un formulario en línea (con cuenta) que genera su propia hoja; el PDF de libre descarga es el que las entidades aceptan diligenciado a mano o a máquina y es reproducible 1:1.

## Página y tipografía
- 3 páginas Carta (612 × 792 pt), sin rotación ni campos AcroForm (solo un widget sin uso en la hoja 3). Las cajas de los campos se midieron sobre los trazados: `docs/design/formato-unico-fields.json`.
- Fuentes: Arial (ArialMS normal, negrita, cursiva, negrita cursiva; "Arial-BoldMT" en el pie de la hoja 3) y Verdana cursiva ("Ciudad y fecha de diligenciamiento", "Ciudad y fecha"). Rótulos 6-8 pt; títulos de sección 10 pt negrita blanca sobre píldora negra con número en círculo; "HOJA DE VIDA" 20 pt (hoja 1) / 15 pt (hojas 2-3).
- Colores: paneles `#f2fafc` con sombra negra desplazada (≈ 2-4 pt abajo a la derecha), cabeceras de tabla `#d9f1f6`, filete turquesa `#02a0c6` junto al número de sección; trazos 0.24 pt (tablas), 0.48 pt (píldoras), 1.02 pt (paneles), 0.72 pt (líneas de firma).
- Imagen: escudo de Colombia (PNG 128 × 119, 20 575 bytes) en x 97.85, y 34, 66 × 84.35 pt. Se incrusta tal cual como data URI.
- El PDF trae un texto viejo tapado por un rectángulo blanco (pie de la hoja 3: "LÍNEA GRATUITA DE ATENCIÓN AL CLIENTE… www.dafp.gov.co"): el extractor respeta el orden de pintado y no emite el texto tapado. "LINEA GRATUITA NACIONAL…" está dos veces en el mismo sitio y "IDIOMA" dos veces a 0.1 pt: se emiten una vez.

## Estructura (orden exacto) y correspondencia con el perfil
- Encabezado (hoja 1): **ENTIDAD RECEPTORA** → `solicitud.entidadReceptora`.
- **1 Datos personales**: primer apellido / segundo apellido (o de casada) / nombres (`personales.primerApellido`, `segundoApellido`, `nombres`); documento C.C ○ C.E ○ PAS ○ No. (`tipoDocumento` CC/CE/Pasaporte; TI, PEP o PPT se escriben delante del número); sexo F ○ M ○ (`sexo`); nacionalidad COL. ○ EXTRANJERO ○ + país (`nacionalidad`: "Colombiana" marca COL.; `paisNacionalidad`, o la nacionalidad si es extranjera); libreta militar primera ○ / segunda clase ○, número, D.M (`claseLibreta`, `libretaMilitar`, `distritoMilitar`; ocultos con sexo F); fecha de nacimiento DÍA/MES/AÑO en celdas (`fechaNacimiento`); país, depto, municipio de nacimiento (`nacimientoPais`, `nacimientoDepto`, `nacimientoMunicipio`); dirección de correspondencia, país, depto, municipio, teléfono, email (`direccion`, `residencia*`, `telefono` o `celular`, `correo`).
- **2 Formación académica**: educación básica y media: X en el último grado aprobado 1.º-11.º (`basica.ultimoGrado`), título obtenido (`basica.titulo`), fecha de grado MES/AÑO (`basica.mesGrado`, `basica.anio`). Educación superior: 5 filas con modalidad (TC, TL, TE, UN, ES, MG, DOC), semestres aprobados, graduado SÍ/NO, nombre de los estudios o título, terminación MES/AÑO y No. de tarjeta profesional (`superior[]`: `modalidad`, `semestres`, `graduado`, `programa`, `fechaGrado`, `tarjetaProfesional`). Idiomas: 2 filas, lo habla / lo lee / lo escribe R, B, MB (`idiomas[]`: Bajo = R, Medio = B, Alto = MB).
- **3 Experiencia laboral** (hoja 2): 4 bloques. El primero, "EMPLEO ACTUAL O CONTRATO VIGENTE", solo con un registro marcado `actual`; los otros tres, "EMPLEO O CONTRATO ANTERIOR", del más reciente al más antiguo (instructivo: "en estricto orden cronológico empezando por el más reciente o actual"). Cada bloque: empresa o entidad, pública ○ privada ○, país, departamento, municipio, correo electrónico entidad, teléfonos, fecha de ingreso y de retiro DÍA/MES/AÑO, cargo o contrato, dependencia, dirección. "NOTA: si requiere adicionar más experiencia laboral, imprima nuevamente esta hoja": con más registros la hoja 2 se repite (3 anteriores por hoja; un segundo trabajo actual va en el bloque superior de la copia siguiente).
- **4 Tiempo total de experiencia** (hoja 3): años y meses por ocupación (servidor público, empleado del sector privado, trabajador independiente) y total. Automático: unión de periodos por ocupación (lo simultáneo cuenta una vez), meses de 30 días, un trabajo actual corre hasta la fecha de impresión; ocupación de cada registro = `experiencia.ocupacion` o, si falta, entidad pública = servidor público y privada = sector privado. Manual: `tiempoExperiencia.calculo = 'manual'` y los seis campos de años/meses.
- **5 Firma del servidor público o contratista**: "manifiesto bajo la gravedad del juramento que SÍ ○ NO ○ me encuentro dentro de las causales de inhabilidad e incompatibilidad…" (`declaracion.inhabilidad`); "Ciudad y fecha de diligenciamiento" (`solicitud.ciudadDiligenciamiento` o el municipio de correspondencia + `solicitud.fecha` o la fecha de impresión). La firma se pone a mano.
- **6 Observaciones del jefe de recursos humanos y/o contratos**: de uso exclusivo de la entidad; se deja en blanco.
- Lo que no cabe en las filas de la hoja 1 (más de 5 estudios o de 2 idiomas) va a una hoja de continuación con tablas reales (el instructivo: "utilice una hoja en blanco").
- No hay casilla de foto ni de objetivo: el modelo no pide foto (`schema.photo` ausente) y Plantillas no ofrece esas opciones (`features`).

## Cómo se reproduce
```
python -I docs/design/model-extract.py docs/models/formato-unico/formato-unico-hoja-de-vida-persona-natural.pdf app/js/models/formato-unico-layout.js --fields docs/design/formato-unico-fields.json
```
`model-extract.py` (PyMuPDF) emite por página un SVG con trazados, la imagen y el texto estático en el orden de pintado del PDF (con `textLength` medido de glifo a glifo) y las cajas de campos. `app/js/models/formato-unico.js` superpone los valores del perfil (HTML escapado), un carácter por celda en las fechas y X en casillas y círculos, con las clases de `app/css/paper.css` (sin cambios). El mismo extractor con `--legacy` reproduce `app/js/models/minerva-layout.js` byte a byte.

## Fidelidad
Hojas en blanco dibujadas por Chromium (96 dpi, antialias en gris) contra el PDF dibujado por MuPDF a 96 dpi (`docs/models/<modelo>/ref-96dpi-<n>.png`, generadas con `python -I docs/design/model-compare.py refs …`), diferencia media por píxel con el mejor desplazamiento de ±1 px (`tests-e2e/specs/modelos-fidelidad.spec.mjs`, umbral 3.5):

| Modelo | Hoja 1 | Hoja 2 | Hoja 3 | Hoja 4 |
|---|---|---|---|---|
| Formato Único | 3.23 | 2.79 | 2.90 | – |
| Minerva (referencia) | 2.62 | 2.83 | 2.64 | 2.67 |

Solo difiere el antialias del texto y de las líneas finas (mapa de diferencias revisado a ojo: sin desplazamientos ni piezas faltantes). Con el antialias subpíxel de pantalla las cifras suben a ~4.1 / 3.6 / 3.6 (Minerva ~3.3-3.6). pdf.js no sirve de referencia para este PDF: dibuja las líneas de 0.24 pt a 1 px negro y él mismo difiere de MuPDF en 5.8 / 5.8 / 4.0.

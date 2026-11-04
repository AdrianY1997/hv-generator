# Impresión y paginación (G14)

Verificación del 2026-10-29 con Playwright 1.64.1: Chromium 156 (PDF real con `page.pdf`), Firefox 157 y WebKit 27.2 (medio `print` emulado). Todo es repetible con `npm run test:print` en `tests-e2e/` (spec `tests-e2e/specs/print.spec.mjs`); el CI sube los PDF generados como artefacto `impresion-pdf`.

## Cómo se mide

Para cada combinación de **escenario x papel (Carta / A4)** el spec abre la vista previa, elige el papel, pulsa "Imprimir" (con `window.print` sustituido: así se inyecta el `@page` real de `export.js`) y activa el medio `print`.

| Escenario | Datos |
|---|---|
| vacío | perfil sin datos |
| completo | todas las secciones, 2 registros por sección repetible |
| desborde | 14 trabajos, 12 hermanos, 6 estudios superiores, 8 cursos, 6 referencias (fuerza hoja de continuación) |
| plantilla con secciones excluidas | el perfil de desborde, con una plantilla que excluye experiencia, hermanos, cursos, referencias y estudios superiores |
| valores largos | todos los campos de texto con 12 repeticiones del valor (informativo: mide recortes) |

Comprobaciones en **los tres navegadores** (DOM con medio `print`):

- 4 hojas del formulario siempre; la hoja de continuación existe solo cuando corresponde (vacío y plantilla excluida: no; completo y desborde: sí).
- Ancho de la hoja = ancho de la página (816 px Carta, 793,7 px A4) y alto <= alto de la página.
- Ningún elemento hijo de una hoja (`.mv-f`, foto, capas SVG) sobresale del cuadro de su hoja (tolerancia 0,75 px).
- En la hoja de continuación (con el viewport al ancho útil, página menos márgenes de 0,5 in): el ancho coincide, ninguna tabla sobresale y ninguna celda corta texto.
- La interfaz (barra, avisos, controles) queda oculta y el fondo es blanco.

Solo en **Chromium** (PDF real, leído con el pdf.js que ya trae la app):

- Número de páginas, tamaño de cada página (Carta 612 x 792 pt, A4 594,96 x 841,92 pt), ninguna página sin texto, ningún texto fuera de la página (incluido el pie vertical "© LIBRE", cuyo ancho se mide sobre el eje Y) y ningún título "(continuación)" solo al pie de una página.

## Resultados

| Escenario | Papel | Páginas PDF (Chromium) | Hoja de continuación (secciones / filas) | Páginas de continuación (estimado DOM: Chromium / Firefox / WebKit) |
|---|---|---|---|---|
| vacío | Carta | 4 | no | - |
| vacío | A4 | 4 | no | - |
| completo | Carta | 5 | 2 secciones / 9 filas | 1 / 1 / 1 |
| completo | A4 | 5 | 2 / 9 | 1 / 1 / 1 |
| desborde | Carta | 12 | 5 / 281 | 8 / 8 / 8 |
| desborde | A4 | 11 | 5 / 281 | 7 / 7 / 7 |
| plantilla con secciones excluidas | Carta | 4 | no | - |
| plantilla con secciones excluidas | A4 | 4 | no | - |
| valores largos | Carta / A4 | 4 | no | - |

El estimado de páginas de continuación es `ceil(altura de la hoja de continuación / (alto de página - 1 in))`; en Chromium coincide con el PDF real (12 - 4 = 8; 11 - 4 = 7). Todas las páginas de Chromium miden exactamente el papel elegido; ninguna tiene texto fuera de la página ni quedó en blanco (tras los reintentos descritos abajo).

Las alturas de la continuación difieren menos de 0,1 % entre navegadores (6952 px Chromium, 6955 Firefox, 6947 WebKit en el escenario de desborde): las tablas se reparten igual.

## Por navegador

- **Chromium (completo).** Es el único con PDF real. Carta: las hojas del formulario ocupan exactamente la página (612 x 792 pt) y no generan páginas de más. A4: las hojas se escalan a 0,97273 (ancho 595,3 pt) y dejan ~72 pt libres al pie (diseño: el formato es Carta; no se estira). Las hojas de flujo (continuación, anexos) tienen su zona segura de 0,5 in como relleno interno (ver «Una sola página para todo»).
- **Firefox.** Medio `print` emulado: la geometría de las hojas es idéntica (ancho de A4: 793,8 px frente a 793,7 de Chromium por redondeo). Sin `page.pdf` no se verificó el corte real de página ni los saltos (`break-after`, `break-inside`); eso queda por comprobar a mano con "Imprimir > Guardar como PDF".
- **WebKit (Playwright).** Igual que Firefox. Además: el WebKit de Playwright usa una sesión efímera que **no puede guardar `Blob`/`File` en IndexedDB** ("Error preparing Blob/File data to be stored in object store"), así que los casos con archivos adjuntos (foto, certificados, anexos) no se ejecutan ahí; en Safari real sí funcionan. El `filter: opacity(.999)` de la sombra de los rótulos (ver abajo) no se pudo comprobar en un PDF de Safari/Firefox.
- **No verificado:** Safari de escritorio real, Edge, impresoras físicas, el diálogo de impresión del sistema (márgenes y encabezados/pies que el usuario activa en el diálogo; la hoja del formulario no tiene margen y esos pies se pintarían encima), "Imprimir fondos" desactivado (la hoja fuerza `print-color-adjust:exact`, pero Firefox permite al usuario anularlo).

## Errores encontrados y corregidos

1. **Título "(continuación)" huérfano** (Chromium, Carta, desborde): `VI. Experiencia laboral (continuación)` quedaba como último renglón de una página con su tabla en la siguiente. Corregido en `app/css/print.css` (`.hv-cont h1, .hv-cont > p, .mv-cs h2 { break-after: avoid }`). El test lo vigila.
2. **Sombra de los rótulos de sección** (G08, ver `docs/ACCESIBILIDAD.md`): la copia oscura desplazada era texto y duplicaba el rótulo en el PDF; se había quitado y la HV perdía la sombra del original. Ahora la copia lleva `filter: opacity(.999)`, lo que hace que Chromium la rasterice al imprimir (11 imágenes por documento, 300 dpi): visualmente igual que `docs/minerva.pdf` y sin texto duplicado. Diferencia media con el PDF original (blanco, 2x, PyMuPDF): 1,51/255 con la sombra frente a 1,57 sin ella; en la banda del título de la página 1: 6,4 frente a 9,2.
3. (Accesibilidad, hallado por axe 4.11 al montar el CI) casilla de archivo huérfano de Ajustes con 23,2 px de espacio útil (< 24, WCAG 2.5.8): margen superior de la lista en `styles.css`.

## Diferencias y límites residuales

- **Valores largos se recortan en el formulario.** Los campos de una línea (`.mv-f`, `white-space:nowrap; overflow:hidden`) cortan el texto que no cabe: con valores de ~1000 caracteres, 94 casillas recortan texto en las 4 hojas (el texto sigue en el PDF, pero no se ve). La continuación solo cubre registros repetibles que no caben, no valores demasiado largos de una casilla. No se tocó (es la geometría del formato). Perfil ya avisa al escribir un valor que no cabe (contador y aviso sin bloquear, ver G30 y `docs/CONDICIONALES.md`); sigue pendiente avisar en la vista previa cuando una casilla recorte, o repartir el valor en la hoja de continuación.
- **PDF con una primera página vacía de más, sin explicar.** Con 8 workers de Playwright (CPU saturada) se observó 1 PDF de cada ~150 con una página inicial vacía; el mismo documento, sin carga, dio 150/150 PDF de página exacta (`page.pdf` en bucle) y no hay diferencia en el DOM. Se sospecha de una carrera de impresión de Chromium headless, no de la app. El spec (helper `printPdf`, usado también por los casos de anexos) reintenta hasta 4 veces si la primera página no tiene texto (en el Linux del CI, primera ejecución con las acciones nuevas, 4 casos de impresión necesitaron el reintento del test: la página vacía de más aparece allí mucho más que en Windows) y registra los reintentos (`retries` en `out/<ejecución>/print-chromium.jsonl`; `out/print-chromium.jsonl` si se corre sin el ejecutor); el CI usa 2 workers y 1 reintento del test. Cierre 2026-10-29: no se reprodujo en las ejecuciones completas de la suite de esa pasada (4 workers, máquina de desarrollo: 0 reintentos del PDF en los jsonl de cada ejecución) y el DOM no difiere; se deja como límite conocido de Chromium headless bajo carga. El reintento acotado es contención, no un parche que lo oculte: queda anotado y, si persiste tras los reintentos, la prueba falla. Si alguien ve una página en blanco al imprimir en un navegador real, hay que reabrir esto.
- **Cuatro hojas de formulario siempre**, incluso con el perfil vacío (es el formato). Las páginas de continuación y anexos solo aparecen cuando hay contenido.
- **A4**: la hoja del formulario mide 595,3 pt de ancho sobre una página de 594,96 pt (0,34 pt de más). No produce página extra ni recorte visible en Chromium; no verificado en los demás.
- **PDF de anexos**: no salen al imprimir (aviso en la vista previa); usar el paquete PDF. El paquete rasteriza la HV (G01).
- `zoom` CSS de la vista previa (no estándar) no afecta a la impresión: `print.css` lo fuerza a 1.

## Una sola página para todo (2026-11-04)

Reporte desde la app en vivo: al imprimir con «Márgenes: ninguno» (necesario para que el formulario salga entero) las hojas añadidas (continuación y anexos) quedaban pegadas al borde. Causa: las hojas del formulario usaban `@page form{margin:0}` y las de flujo heredaban el `@page{margin:.5in}` de `export.js`; el diálogo de Chromium con «Ninguno» anula los márgenes CSS, así que las de flujo perdían el suyo.

- Ahora hay UNA sola regla de página (`printCss` en `app/js/export.js`): `@page{size:Letter|A4;margin:0}`. La Vista previa la deja puesta al final del `<head>` en cuanto se monta y al cambiar el papel (también vale para Ctrl+P sin pulsar Imprimir) y la quita al salir (`clearPrintPage`, junto con la clase `body.pv-on`); el HTML autónomo la incrusta. `css/print.css` YA NO lleva `@page` (quinta auditoría, abajo).
- La hoja de continuación y los anexos llevan `padding:.5in` en CADA elemento `.hv-page` (quinta auditoría: ya no se confía en `box-decoration-break:clone`, que queda solo como red de seguridad). El ancho útil sigue siendo 7,5 in (Carta) / 210 mm - 1 in (A4): la paginación de la continuación no cambió (mismas páginas que en la tabla de arriba).
- Anexos: título + imagen dentro de la zona segura, centrada y sin recortar (`.hv-fit` = alto del papel - 1 in - 0,75 in para el título). Los PDF anexos ahora se imprimen: sus primeras 10 páginas se convierten a JPEG con el pdf.js de la app (`app/js/pdf-raster.js`; topes vigentes en «Quinta auditoría»). Lo que no se pudo incluir (PDF protegido, dañado, tope alcanzado) va en una hoja final con el motivo y en el resumen de la Vista previa. El paquete PDF no cambia: quita esas hojas y une los PDF originales con pdf-lib.
- Verificado con `page.pdf({ preferCSSPageSize: true })` en Chromium 156 (`tests-e2e/specs/print.spec.mjs`, casos «anexos de documentos ... sin plantilla» para Minerva y Formato Único, Carta y A4, y los escenarios de siempre): cada página mide exactamente el papel, ningún texto de continuación o anexo cae fuera de la zona de 36 pt, la continuación tiene relleno de 0,5 in en los cuatro lados y cada imagen de anexo queda a >= 0,5 in de los bordes y centrada. Revisión visual con PyMuPDF de los PDF generados.
- Límites: `box-decoration-break:clone` en bloques partidos lo cumplen Chromium y Firefox, pero WebKit/Safari no lo aplica a bloques: por eso la quinta auditoría reparte la continuación en elementos `.hv-page` propios y ya no depende de él (no se verificó en Safari real). Las impresoras sin impresión a borde completo recortan lo que caiga en su margen físico: las hojas del formulario llegan hasta el borde por diseño (igual que antes).

## Quinta auditoría (2026-11-04): anexos y página propia por fragmento

**Conversión de PDF anexos (`app/js/pdf-raster.js`).**
- Nunca se espera `destroy()` de pdf.js (ni del documento ni de la tarea): manda «Terminate» al worker y espera la respuesta, y un PDF hostil que lo deja ocupado no contesta, así que `pdfToImages` no volvía y la Vista previa se quedaba en «Preparando los anexos…». Ahora se dispara sin esperar (el rechazo se descarta), se cancela la renderización en curso y los lienzos se ponen a 0 también al fallar. A los 30 s `pdfToImages` rechaza con «el PDF tardó demasiado en convertirse» y la Vista previa lo muestra para ese documento. Probado con un pdf.js falso cuyo worker no responde (`tests/audit5.test.mjs`).
- Topes: PDF de más de 25 MB se rechaza antes de leerlo (mensaje con la alternativa «Descargar paquete PDF»); `getDocument` recibe `maxImageSize` de 16 Mpíxeles; lado mayor de la página <= 1800 px, JPEG calidad 0,8; 10 páginas por documento. El **presupuesto combinado** de una impresión es 60 páginas Y 60 Mpíxeles decodificados (~240 MB RGBA en memoria): casi siempre manda el de píxeles (una Carta a 1800 px son ~2,5 Mpíxeles, así que caben unas 24 páginas de PDF por impresión). Se gasta en el ORDEN DE IMPRESIÓN (certificados, luego cédula y los demás documentos: el de `model.fileIds`), no en el del almacén. Lo que se corta se dice por documento y con su motivo, en el resumen («De «X» se imprimen las primeras N de M páginas (tope …)») y en la nota de la última página del anexo.
- Los fallos y los tiempos agotados NO se guardan en la caché de la vista (solo los éxitos): se reintentan en la siguiente carga y con el botón «Reintentar» del resumen. Al salir de la vista se vacían la caché, `files` y el HTML pintado.

**Una página por fragmento.** Ya no se confía en `box-decoration-break: clone` (WebKit no lo aplica a bloques; queda solo como red de seguridad). La continuación (`sheet-kit.js`, `continuation`, común a Minerva y al Formato Único) se parte en elementos `.hv-page` propios en límites de fila (o de ficha), repitiendo el título de la sección y el encabezado de la tabla; la lista de «anexos que no salen» también se reparte. El alto es una estima conservadora (690 pt útiles, la menor de Carta; A4 es más alta) y cada elemento lleva su propio relleno de 0,5 in. `@page{margin:0}` no cambia.

**Página de anexo con imagen** (`[data-annex=img]`, `printCss`): columna de alto exacto (papel - 0,02 in); el título se limita a 2 líneas (`line-clamp`, con el texto completo en `title`), la nota (7,5 pt) se encoge y la imagen ocupa exactamente lo que queda (posición absoluta dentro de `.hv-fit`, sin porcentajes de alto). Medido con `page.pdf` en Letter y A4, Minerva y Formato Único (`print.spec.mjs`, «anexo con título largo y nota»): un título de ~400 caracteres y una nota de PDF truncado no dejan páginas en blanco (páginas del PDF = hojas + continuación + anexos), la imagen queda dentro de la zona segura y el área de la imagen conserva >= página - 1 in - 1 in.

**Ctrl+P en otras vistas.** `css/print.css` ya no tiene `@page` (una regla `@page` no se puede acotar a una vista y se habría heredado en Perfil, Documentos…). El papel y el margen 0 los pone solo la Vista previa mientras está montada (`applyPrintPage`) y los quita al salir (`clearPrintPage`: borra `#pv-pagesize` y la clase `pv-on` del `<body>`); las reglas propias de la HV de `print.css` van bajo `body.pv-on`.

**Decisión registrada: los documentos adjuntos van por omisión.** Sin plantilla (o con una que los pida) se anexan los documentos mostrados con archivo (cédula, antecedentes, EPS…) porque la persona reportó expresamente que faltaban. Para que no sea sorpresa, el resumen de la Vista previa dice «Se incluyen N documentos de identidad/salud en esta vista y en el HTML descargable» con el interruptor «Incluir documentos adjuntos» pegado al texto. **El HTML autónomo incrusta los adjuntos** (imágenes y páginas de PDF como data URL): quien lo reciba los tiene; hay que desmarcar el interruptor antes de descargarlo si no deben ir.

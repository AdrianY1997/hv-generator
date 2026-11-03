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

- **Chromium (completo).** Es el único con PDF real. Carta: las hojas del formulario ocupan exactamente la página (612 x 792 pt, `@page form{margin:0}`) y no generan páginas de más. A4: las hojas se escalan a 0,97273 (ancho 595,3 pt) y dejan ~72 pt libres al pie (diseño: el formato es Carta; no se estira). Las hojas de flujo (continuación, anexos) usan el margen de 0,5 in.
- **Firefox.** Medio `print` emulado: la geometría de las hojas es idéntica (ancho de A4: 793,8 px frente a 793,7 de Chromium por redondeo). Sin `page.pdf` no se verificó el corte real de página ni los saltos (`break-after`, `break-inside`); eso queda por comprobar a mano con "Imprimir > Guardar como PDF".
- **WebKit (Playwright).** Igual que Firefox. Además: el WebKit de Playwright usa una sesión efímera que **no puede guardar `Blob`/`File` en IndexedDB** ("Error preparing Blob/File data to be stored in object store"), así que los casos con archivos adjuntos (foto, certificados, anexos) no se ejecutan ahí; en Safari real sí funcionan. El `filter: opacity(.999)` de la sombra de los rótulos (ver abajo) no se pudo comprobar en un PDF de Safari/Firefox.
- **No verificado:** Safari de escritorio real, Edge, impresoras físicas, el diálogo de impresión del sistema (márgenes y encabezados/pies que el usuario activa en el diálogo; la hoja del formulario no tiene margen y esos pies se pintarían encima), "Imprimir fondos" desactivado (la hoja fuerza `print-color-adjust:exact`, pero Firefox permite al usuario anularlo).

## Errores encontrados y corregidos

1. **Título "(continuación)" huérfano** (Chromium, Carta, desborde): `VI. Experiencia laboral (continuación)` quedaba como último renglón de una página con su tabla en la siguiente. Corregido en `app/css/print.css` (`.hv-cont h1, .hv-cont > p, .mv-cs h2 { break-after: avoid }`). El test lo vigila.
2. **Sombra de los rótulos de sección** (G08, ver `docs/ACCESIBILIDAD.md`): la copia oscura desplazada era texto y duplicaba el rótulo en el PDF; se había quitado y la HV perdía la sombra del original. Ahora la copia lleva `filter: opacity(.999)`, lo que hace que Chromium la rasterice al imprimir (11 imágenes por documento, 300 dpi): visualmente igual que `docs/minerva.pdf` y sin texto duplicado. Diferencia media con el PDF original (blanco, 2x, PyMuPDF): 1,51/255 con la sombra frente a 1,57 sin ella; en la banda del título de la página 1: 6,4 frente a 9,2.
3. (Accesibilidad, hallado por axe 4.11 al montar el CI) casilla de archivo huérfano de Ajustes con 23,2 px de espacio útil (< 24, WCAG 2.5.8): margen superior de la lista en `styles.css`.

## Diferencias y límites residuales

- **Valores largos se recortan en el formulario.** Los campos de una línea (`.mv-f`, `white-space:nowrap; overflow:hidden`) cortan el texto que no cabe: con valores de ~1000 caracteres, 94 casillas recortan texto en las 4 hojas (el texto sigue en el PDF, pero no se ve). La continuación solo cubre registros repetibles que no caben, no valores demasiado largos de una casilla. No se tocó (es la geometría del formato). Perfil ya avisa al escribir un valor que no cabe (contador y aviso sin bloquear, ver G30 y `docs/CONDICIONALES.md`); sigue pendiente avisar en la vista previa cuando una casilla recorte, o repartir el valor en la hoja de continuación.
- **PDF con una primera página vacía de más, sin explicar.** Con 8 workers de Playwright (CPU saturada) se observó 1 PDF de cada ~150 con una página inicial vacía; el mismo documento, sin carga, dio 150/150 PDF de página exacta (`page.pdf` en bucle) y no hay diferencia en el DOM. Se sospecha de una carrera de impresión de Chromium headless, no de la app. El spec reintenta hasta 2 veces si hay una página sin texto y registra los reintentos (`retries` en `out/<ejecución>/print-chromium.jsonl`; `out/print-chromium.jsonl` si se corre sin el ejecutor); el CI usa 2 workers y 1 reintento del test. Cierre 2026-10-29: no se reprodujo en las ejecuciones completas de la suite de esa pasada (4 workers, máquina de desarrollo: 0 reintentos del PDF en los jsonl de cada ejecución) y el DOM no difiere; se deja como límite conocido de Chromium headless bajo carga. El reintento acotado es contención, no un parche que lo oculte: queda anotado y, si persiste tras 2 reintentos, la prueba falla. Si alguien ve una página en blanco al imprimir en un navegador real, hay que reabrir esto.
- **Cuatro hojas de formulario siempre**, incluso con el perfil vacío (es el formato). Las páginas de continuación y anexos solo aparecen cuando hay contenido.
- **A4**: la hoja del formulario mide 595,3 pt de ancho sobre una página de 594,96 pt (0,34 pt de más). No produce página extra ni recorte visible en Chromium; no verificado en los demás.
- **PDF de anexos**: no salen al imprimir (aviso en la vista previa); usar el paquete PDF. El paquete rasteriza la HV (G01).
- `zoom` CSS de la vista previa (no estándar) no afecta a la impresión: `print.css` lo fuerza a 1.

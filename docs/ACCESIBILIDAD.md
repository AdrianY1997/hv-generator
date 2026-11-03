# Accesibilidad y lectura ATS (G08)

Auditoría del 2026-10-29. Alcance: WCAG 2.2 AA (con las pruebas de 2.0/2.1 incluidas) sobre toda la interfaz, y lectura por ATS de la HV impresa. Herramientas en `tools/` (ver `tools/README.md`); nada de ellas se despliega.

## Resultado

| Comprobación | Antes | Después |
|---|---|---|
| axe-core, 28 vistas/estados x 4 configuraciones (claro/oscuro, 1280 y 375 px) = 112 auditorías | 2 serious (contraste de cabeceras de tabla de la hoja; región desplazable de la vista previa sin foco), 1 moderate (orden de encabezados, 3 nodos) | **0 violaciones** (critical, serious, moderate y minor) |
| Objetivos táctiles >= 24 px (WCAG 2.5.8) en las 5 vistas | enlace de la marca de 22 px de alto | sin hallazgos |
| Reflujo a 320 y 640 px (= 200 % de zoom en 1280), sin scroll horizontal de página | sin hallazgos | sin hallazgos |
| `prefers-reduced-motion` | la regla no cubría `::before/::after` (revisión de código) | ninguna animación/transición activa |
| Recorrido solo con teclado (`tools/keyboard.mjs`) | (guion escrito tras las correcciones; por código, el foco se perdía en `<body>` tras adjuntar/quitar archivo, guardar o cancelar una plantilla y al cambiar de vista) | 41/41 pasos correctos |
| ATS (`tools/ats.mjs`, PDF de `page.pdf()` + PyMuPDF; y `tests-e2e/specs/ats.spec.mjs` con pdf.js) | rótulos de sección duplicados ("IV.IV. EDUCACIONEDUCACION"); aviso de privacidad impreso como primera página | valores y rótulos como texto real, cada título de sección una sola vez, sin aviso, con la sombra original conservada (ver abajo); además el paquete PDF (hojas rasterizadas + capa de texto invisible) con nombre, correo, empresa y cargo una sola vez |
| Errores de consola | 0 | 0 |

Vistas y estados cubiertos: Perfil (las 16 secciones, con dos registros por sección repetible), diálogo del editor de foto, Documentos (vacío, con un PDF y una imagen adjuntos, selector "Documentos de tu lista"), Plantillas (lista, editor, nueva), Vista previa (y diálogo de importar), Ajustes (archivos huérfanos, diálogo de borrar todo).

## Correcciones aplicadas

Contraste y color
- Cabeceras de tabla de la hoja de continuación: `#144a7d` sobre `#75bee9` daba 4,47:1 (< 4,5). Se oscurece a `#12467a` (4,72:1) con una regla en `css/print.css` (`.hv-doc .hv-tbl th`); `paper.css` no se tocó. El HTML autónomo exportado (`export.js`, `standaloneHtml`) y la rasterización del paquete PDF (`pdf-package.js`, `FLOW_CSS`) llevan la misma regla como ajuste propio, también sin tocar `paper.css`: `tests-e2e/specs/a11y-hoja.spec.mjs` descarga el HTML autónomo con una hoja de continuación y axe (`color-contrast`) da 0 violaciones.
- Los tokens (`tokens.css`) no se cambiaron: ya cumplían (ver `docs/design/design.md`, sección 2) y axe lo confirmó en ambos temas. El color nunca es el único portador de significado: insignias con texto e icono, errores con icono y texto, página activa con peso y filete.

Estructura, nombres y roles
- Jerarquía de encabezados: Documentos y Plantillas saltaban de `h1` a `h3`; ahora las filas de documento y las tarjetas de plantilla son `h2` (`emptyState` admite `level`).
- Nombres únicos: los botones de cada tarjeta de plantilla (Editar, Duplicar, Vista previa, Imprimir, Eliminar) y los "Todo / Ninguno" de cada sección del editor llevan el nombre de la plantilla o sección en `aria-label` (el texto visible va primero, WCAG 2.5.3).
- Insignia de campos obligatorios pendientes en las pestañas del Perfil: ahora tiene texto para lector de pantalla ("(2 campo(s) obligatorio(s) pendiente(s))"); antes solo `title`.
- Editor de foto: el escenario de encuadre (que ya se movía con flechas y +/-) tiene `role="group"`, nombre y descripción con las instrucciones.
- Avisos persistentes: etiquetas distintas ("Aviso de privacidad", "Aviso de respaldo") para que los puntos de referencia no se repitan.
- `.pv-stage` (vista previa, región con scroll): `tabindex="0"`, `role="region"` y nombre, declarados por `views/vista-previa.js` (antes un parche en `js/a11y.js`, ya retirado).
- Campo Nombre del editor de plantilla enlazado a su mensaje de error (`aria-describedby`).

Foco
- Al cambiar de vista el foco pasa al `h1` (no en la carga inicial ni al cambiar de modelo); el título de la ventana ya cambiaba. Antes quien navegaba con teclado o lector seguía en el menú sin aviso. `pageHead` pone `tabindex="-1"` al `h1`.
- Tras guardar, cancelar, duplicar o eliminar una plantilla el foco vuelve al título (antes se perdía en `<body>`).
- Adjuntos (`fileSlot`): tras adjuntar, reemplazar o quitar un archivo el foco pasa al primer botón del adjunto si lo tenía dentro (antes se perdía al reconstruir el DOM). Esto también cubre el retorno del foco tras el editor de foto.
- Verificado sin cambios: retorno del foco al cerrar el editor de foto y el selector de documentos, foco atrapado en ambos diálogos (nativos con `showModal`), Esc, enlace "Saltar al contenido", foco visible de 2 px en todos los controles (incluido el halo de campos y los controles del editor), orden de tabulación lógico.

Regiones vivas
- Perfil: el estado de guardado ya no es una región viva que anuncia "Guardando…" tras cada tecla; la insignia visual es `aria-hidden` y una región `role="status"` oculta solo anuncia el resultado ("Guardado 10:32:05" o el error).

Movimiento
- `prefers-reduced-motion` ahora cubre `::before/::after`, fuerza una sola iteración y `scroll-behavior:auto`.

Objetivos táctiles
- La marca "HV Minerva" mide la altura de la cabecera (antes 22 px). Los botones densos `.mn-btn--sm` (y su variante de icono) pasan de 32 a **44 px** (`tokens.css`, 2,75 rem: objetivo preferido de WCAG 2.5.5), igual que las pestañas del Perfil, el selector de modelo, el botón de tema y los plegables Cómo obtenerlo (`styles.css`); el resto de botones y campos siguen en 40 px y la navegación móvil en 44 px. El mínimo AA de 24 px se cumple en todos los controles medidos. Ver el punto 5 de pendientes para lo que sigue bajo 44 px.

Impresión y ATS
- `css/print.css` oculta `.notices`: el aviso de privacidad se imprimía como primera página del PDF.
- `models/minerva.js` (`markShadowText`): los rótulos de las barras de sección están dibujados dos veces en `docs/minerva.pdf` (texto blanco y una copia azul oscura desplazada ~1 pt que hace de sombra). Como texto real, la copia duplicaba el rótulo al extraerlo ("III.III. INFORMACIÓNINFORMACIÓN"). Primera solución (descartar la copia) quitaba la sombra y alejaba la HV del original; ahora la copia se conserva con `filter: opacity(.999)` inline: Chromium rasteriza al imprimir lo que lleva filtro, así que en el PDF la sombra es una imagen (11 por documento, ~300 dpi) y el rótulo blanco es el único texto. Medido contra `docs/minerva.pdf` (HV en blanco, 2x, PyMuPDF): diferencia media por página 1,5/255 (1,57 sin sombra) y en la banda del título 6,4 (9,2 sin sombra). Aplica también al HTML autónomo. Limitación: si un navegador no aplica el filtro al elemento SVG (Safari), la copia seguiría siendo texto al imprimir; no verificado ahí.

## ATS: cómo expone el texto la HV impresa

- La HV es una réplica del formulario Minerva, pero **el texto no son contornos**: los rótulos fijos son `<text>` SVG reales (591 elementos) y los valores del perfil son `<div class="mv-f">` con texto. Al imprimir con "Guardar como PDF" (Chromium) todo queda como texto seleccionable y buscable.
- Comprobado con `page.pdf()` + PyMuPDF: "Ana María", "Pérez Gómez", la cédula y el correo salen en el texto del PDF; la hoja de continuación (registros que no caben) es HTML con tablas `hv-tbl` y también se extrae (cabecera + valor por fila).
- **Orden de lectura**: en el flujo de contenido del PDF van primero todos los rótulos de la hoja y después los valores, así que un extractor que lee en orden de flujo ve "Apellido(s) del aspirante ... Nombre(s) del aspirante" y mucho más abajo "Pérez Gómez / Ana María". Los extractores que ordenan por posición (PyMuPDF `sort=True`, `pdftotext -layout`, la mayoría de ATS comerciales) ponen cada valor justo debajo de su rótulo (el formulario tiene el rótulo arriba y la casilla debajo). La asociación depende por completo de la posición; no hay estructura semántica (no hay `h1/h2` ni listas en las hojas del formulario, solo en la hoja de continuación).
- Texto blanco: 16 fragmentos blancos sobre las barras azules de sección (visibles, no ocultos); un ATS que descarte "texto blanco" podría omitir los títulos de sección.
- **Paquete PDF** ("Descargar paquete PDF"): las hojas de la HV se rasterizan a 200 dpi (G01), pero desde 2026-10-29 llevan encima una **capa de texto invisible** (modo de texto 3, Helvetica estándar) con cada palabra en su posición real, leída del DOM maquetado (rótulos `<text>` SVG y valores `.mv-f`; la sombra `data-sh` no se duplica). Así el paquete también se lee por ATS, búsqueda y selección. En orden de lectura (arriba-abajo, izquierda-derecha) cada valor queda en la línea de su rótulo o justo debajo. Se comprueba con PyMuPDF (`node tools/ats.mjs`) y con pdf.js (`tests-e2e/specs/ats.spec.mjs`). Límites: los **anexos de imagen no llevan texto** (solo su rótulo "Anexo · ..."; un PDF anexo conserva el suyo), no hay estructura semántica y la posición depende de que el navegador use la misma fuente (Arial/Liberation Sans) en la medición y en la imagen.

## Pendientes y limitaciones

1. ~~`views/vista-previa.js` debía declarar la región con scroll~~: hecho (2026-10-29); se eliminó `SCROLL_REGIONS`/`enhanceScrollRegions` de `js/a11y.js` y de `main.js`.
2. ~~**Hoja de vida para lector de pantalla**~~: hecho (2026-10-29). Las hojas del formulario (SVG de rótulos + valores `.mv-f` posicionados) van `aria-hidden` y `models/minerva.js` (`a11yText`) añade, como primer hijo de `.hv-doc`, un bloque `.hv-sr` con un grupo por sección o registro y una lista de definición rótulo del schema -> valor (solo lo que la plantilla incluye y las respuestas condicionales dejan visible; lo que desborda queda en las tablas de continuación, que ya eran accesibles). Está oculto con estilos en línea (1 px recortado, fuera del flujo: no cambia la geometría) y con `display:none` al imprimir (`print.css`, y `export.js` para el HTML autónomo), así que no añade texto al PDF ni a la extracción ATS; el paquete PDF lo ignora (solo recorre hojas y páginas de flujo). Verificado: PDF de impresión de Chromium del perfil vacío y del completo, Carta y A4, a 96 dpi y comparado con el generado antes del cambio: **0 píxeles distintos** en las 4 y 5 páginas; `tests-e2e/specs/a11y-hoja.spec.mjs` (rótulo y valor emparejados, árbol de accesibilidad, 1x1 px, misma geometría de hojas con y sin el bloque, `display:none` en print) y axe en todas las vistas. **No** se probó con NVDA/VoiceOver/TalkBack: es la lectura que esperamos (grupo con nombre y pares término/definición), no una verificación con lector real.
3. ~~**Texto de la HV en el paquete PDF** (ATS)~~: hecho (2026-10-29), capa de texto invisible con pdf-lib (ver arriba). Queda, como mejora, una variante de una columna "para ATS" (secciones `h2` y listas) con estructura semántica real, y probar con un ATS comercial.
4. **No se probó con lectores de pantalla reales** (NVDA, VoiceOver, TalkBack) ni con Lighthouse; axe cubre solo una parte de WCAG. axe y el recorrido de teclado solo corren en Chromium; Firefox y WebKit (Playwright) ejecutan únicamente el humo y la impresión (`docs/IMPRESION.md`); Safari real no se probó. Dudas por comprobar con lector: el contenedor `#toasts` es `aria-live` y sus hijos `role="status"` (posible doble anuncio) y el anuncio de los avisos de campo (`aria-live` por campo).
5. Objetivos de 44 px (parcial): los botones `.mn-btn--sm`, las pestañas del Perfil, el selector de modelo, el botón de tema y los plegables "Cómo obtenerlo" ya miden 44 px (medido con Playwright en las 5 vistas a 1280 y 375 px). Quedan por debajo del tamaño preferido, siempre >= 24 px (mínimo AA): los botones normales (`.mn-btn`, 40 px) y los campos de texto, fecha y selects (40 a 42 px), porque subirlos desplaza la maqueta de todos los formularios y cabeceras (no se hizo); el enlace "Saltar al contenido" (solo visible con foco) y los `input[type=file]` ocultos (su botón visible es de 44 px).
6. ~~El HTML autónomo exportado conservaba el contraste 4,47:1 de las cabeceras de la hoja de continuación~~: corregido con un ajuste propio de `export.js` (ver Correcciones aplicadas); `paper.css` sigue sin tocarse.
7. Contraste medido por axe sobre colores calculados: no ve el `filter: brightness(.94)` con que la vista previa atenúa el papel en tema oscuro (solo pantalla; texto negro sobre papel casi blanco, sin riesgo real).

## Cómo repetir

En el repo (recomendado): `cd tests-e2e && npm ci && npx playwright install chromium && npm run a11y` (axe sobre las vistas principales, claro/oscuro y 375 px; corre también en CI) y `npm run test:e2e` (todo). Las herramientas sueltas de abajo cubren más estados (28 x 4) y el recorrido de teclado:

```
npm i --prefix <carpeta-temporal> axe-core playwright
python -m pip install pymupdf
node tools/a11y.mjs    --deps <carpeta-temporal>     # axe + objetivos + reflujo + movimiento reducido
node tools/keyboard.mjs --deps <carpeta-temporal>    # recorrido solo teclado
node tools/ats.mjs     --deps <carpeta-temporal>     # PDF impreso + extracción de texto
```

Detalles y opciones en `tools/README.md`. Antes de publicar cambios de interfaz conviene repetir los tres.

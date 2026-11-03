# tools/ (solo desarrollo, no se despliega)

Auditorías automáticas de accesibilidad y de lectura ATS. Nada de esto vive en `app/` ni lo carga la aplicación: la app sigue siendo estática, sin build y sin dependencias.

## Instalar las dependencias (fuera del proyecto)

axe-core y Playwright **no** se instalan dentro del repo. Instálalos en una carpeta temporal cualquiera y pásala con `--deps` (o con la variable `A11Y_DEPS`):

```
npm i --prefix <carpeta-temporal> axe-core playwright
npx --prefix <carpeta-temporal> playwright install chromium     # solo si no tienes ya un Chromium de Playwright
python -m pip install pymupdf                                    # solo para tools/ats.mjs
```

Los scripts resuelven `axe-core` y `playwright` desde esa carpeta, levantan `app/` en un puerto local libre (servidor Node propio, sin service worker) y lo apagan al terminar.

Atajo: si ya hiciste `npm ci` en `tests-e2e/`, esa carpeta sirve como `--deps` (`node tools/a11y.mjs --deps tests-e2e`): trae `playwright` y `axe-core`. La versión reproducible y con CI de estas auditorías vive en `tests-e2e/` (ver el README de la raíz); estos scripts siguen siendo útiles para el volcado completo (28 estados x 4 configuraciones), el recorrido de teclado y la comprobación con PyMuPDF.

## Scripts

| Comando | Qué hace | Sale con 1 si |
|---|---|---|
| `node tools/a11y.mjs --deps <carpeta>` | axe-core (WCAG 2.0/2.1/2.2 A y AA + buenas prácticas) sobre cada vista y estado, en claro y oscuro, escritorio (1280) y 375 px: las 16 secciones del Perfil, diálogo de foto, Documentos (vacío, con archivos, selector), Plantillas (lista, editor, nueva), Vista previa (y diálogo de importar), Ajustes (huérfanos, borrar). Además: objetivos táctiles < 24 px, scroll horizontal a 320 y 640 px (reflujo / zoom 200 %) y `prefers-reduced-motion`. | hay violaciones critical/serious, hallazgos propios o errores de consola |
| `node tools/keyboard.mjs --deps <carpeta>` | Recorrido solo con teclado (41 pasos): enlace de salto, orden de cabecera, foco visible, secciones, alta/baja de registros, editor de foto (foco atrapado, Esc, retorno del foco), selector de documentos, adjuntar/quitar, plantillas, vista previa. | algún paso falla |
| `node tools/ats.mjs --deps <carpeta> [--out hv.pdf]` | Genera el PDF de la HV con `page.pdf()` (medio print) y extrae el texto con PyMuPDF: comprueba que los valores del formulario salen como texto, que los rótulos no salen duplicados y que la interfaz no se imprime. Además genera el **paquete PDF** con el botón real (`--pkg paquete.pdf`) y comprueba la capa de texto invisible: nombre, correo, empresa y cargo una vez, cédula una vez por hoja, títulos una vez y todo el texto dentro de la página. `--overlay <carpeta>` guarda un PNG por hoja con las cajas de palabras extraídas para revisarlas a ojo. | alguna comprobación falla |

Opciones de `a11y.mjs`: `--only perfil,documentos,plantillas,vista-previa,ajustes` (solo esas vistas, sin las comprobaciones propias) y `--json salida.json` (volcado completo).

`_lib.mjs` es el código común (carga de dependencias, servidor estático, datos de prueba).

## Datos de prueba

Los scripts siembran `localStorage` (`hv.profile`, `hv.templates`) en un contexto de navegador nuevo y desechable; no tocan los datos de ningún navegador real. El perfil de prueba tiene dos registros por sección repetible y la persona "Ana María Pérez Gómez".

## Notas

- Las comprobaciones de axe cubren solo una parte de WCAG (aprox. un tercio de los criterios son automatizables). `docs/ACCESIBILIDAD.md` lista lo que se revisó a mano y lo que queda pendiente (lector de pantalla real).
- Si `keyboard.mjs` se queda esperando un `filechooser`, repite el script: la interceptación del selector de archivos de Playwright es asíncrona (el guion espera 250 ms antes de pulsar).

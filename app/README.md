# HV Minerva

Generador estático de Hoja de Vida (formato Minerva, Colombia). Sin build, sin dependencias: HTML + CSS + módulos ES. Funciona en GitHub Pages (rutas relativas, bajo `/<repo>/`) y sin conexión (service worker `sw.js`, solo en https o localhost; ver Despliegue).

## Uso

1. **Perfil**: complete los datos por sección (se guardan solos). Las secciones repetibles (educación superior, cursos, idiomas, experiencia, referencias) usan `+ Agregar`. La foto pasa por un editor (carnet 3x4 por defecto, o pasaporte/visa 35x45, cuadrada 1:1 y medidas propias, con peso máximo opcional en KB; zoom, mover, girar, voltear, brillo/contraste). El formulario es **condicional**: pregunta solo lo que aplica según las respuestas anteriores (por ejemplo, si no trabaja actualmente se ocultan empresa, vinculación y contrato; el cónyuge solo con estado civil casado o unión libre); lo que se oculta se conserva, no se valida y no se imprime (`docs/CONDICIONALES.md`). Los campos avisan de formatos dudosos (cédula, celular, correo, fechas incoherentes) y de textos que no caben en la casilla del PDF, sin impedir guardar. Los certificados (PDF o imagen, máx. 5 MB) se adjuntan por registro.
2. **Documentos**: cargue los documentos requeridos (varias páginas/caras por documento). Cada uno trae **Abrir sitio oficial** (pestaña nueva), **Copiar cédula** (al portapapeles, con la cédula del perfil), un bloque plegable **Cómo obtenerlo** y, si solo puede hacerse a mano (p. ej. Ley 1918: la consulta es de la entidad contratante), una nota que lo explica. La app nunca envía datos a esos sitios. Al adjuntar un PDF se lee **en este equipo** (pdf.js): fecha de expedición, "válida hasta", código, estado y cédula (avisa si no coincide con el perfil) y se muestra un chip de vigencia (Vigente / Vence en N días / Vencido / Sin vigencia oficial / No se pudo leer). La fecha se puede corregir a mano, y en imágenes o PDF escaneados se escribe. **Añadir documento** elige cuáles se muestran (por defecto: cédula, judiciales, disciplinarios, fiscales, RNMC y Ley 1918); **Quitar** oculta un documento sin borrar sus archivos. La vigencia real la define la entidad que recibe el documento.
3. **Plantillas**: cree una por tipo de cargo y elija secciones, registros, campos, documentos, foto, anexos y un objetivo propio. La lista de documentos muestra todos los disponibles (los que no están en su lista de Documentos llevan «oculto en Documentos»; si los marca, se anexan cuando tengan archivos y se avisa si no los tienen). Puede fijar una **antigüedad máxima** (30/60/90 días u otro valor) para los documentos con vigencia, que usan el semáforo y los avisos; el editor y la Vista previa también avisan de certificados prometidos que no están cargados.
4. **Vista previa**: elija plantilla (o la HV completa), papel Carta/A4 y zoom. `Imprimir` / `Descargar PDF` (diálogo del navegador, "Guardar como PDF"), `Descargar HTML autónomo` (un solo archivo con CSS e imágenes incrustados), exportar plantilla o datos, e `Importar JSON`.
5. **Ajustes**: privacidad, medidor de almacenamiento (y pedir almacenamiento persistente), último respaldo y descarga, **Revisar archivos huérfanos** (lista los archivos sin referencia y borra solo los que marques, tras confirmar) y **Borrar todos mis datos** (pide escribir BORRAR; elimina `hv.*` de localStorage/sessionStorage e IndexedDB). Al abrir la app por primera vez se muestra un aviso de privacidad descartable, y un aviso si nunca hubo respaldo o el último tiene más de 30 días.

**Paquete PDF**: `Descargar paquete PDF` genera un solo PDF con las hojas de la HV (dibujadas a 200 dpi desde la misma vista previa; sobre cada hoja va una capa de texto invisible —Helvetica, modo de texto 3— con las palabras en su posición, para ATS, búsqueda y selección; los anexos de imagen no llevan texto) seguidas de los anexos de la plantilla: imágenes como páginas y PDF unidos página por página (certificados y luego documentos, cédula primero; Carta/A4). `Solo anexos en un PDF` une solo los anexos. Al imprimir, las imágenes se anexan pero los PDF no (ver `docs/GAPS.md`, G01).

Probar en local: `python -m http.server` dentro de `app/` y abrir `http://localhost:8000` (los módulos ES no funcionan en `file://`).

## Respaldo y restauración

- Exportar: Ajustes > `Descargar respaldo`, el aviso de respaldo o Vista previa > `Exportar datos JSON` abren un diálogo: sin marcar nada se descarga `hv-datos.json` (perfil, plantillas y archivos en base64) **en claro**; con **Proteger con contraseña** (confirmación, indicador de fortaleza, mínimo 10 caracteres al crearla; al abrir un respaldo se acepta cualquier largo) se descarga `hv-datos-cifrado.json`: PBKDF2-SHA-256 (600 000 iteraciones) -> AES-256-GCM con WebCrypto, sal e IV aleatorios (`js/backup-crypto.js`). **Una contraseña perdida no se puede recuperar** (no hay clave de rescate). El cifrado cubre solo el archivo de respaldo, no los datos locales del navegador.
- Restaurar: Vista previa > `Importar JSON`. Con un respaldo (`app: "hv-minerva"`) se abre un diálogo con el resumen (fecha, versión de datos, conteos y qué cambia) y dos opciones: **Combinar** (recomendada: completa campos vacíos, agrega registros/plantillas/archivos que faltan, conserva lo actual y, con «Preferir el respaldo», toma el del respaldo) o **Reemplazar todo**. Antes de escribir se descarga una copia de tus datos actuales; un respaldo inválido o de una versión de datos más nueva que la app se rechaza entero. Un JSON de plantilla exportada se agrega como plantilla nueva con id nuevo. Un respaldo cifrado (`format: "hv-minerva-enc"`) primero pide la contraseña en un diálogo (se puede reintentar; una contraseña incorrecta o un archivo alterado no cambian ningún dato; un sobre con KDF degradado se rechaza sin pedirla) y el texto descifrado sigue el mismo flujo de validar/combinar/reemplazar. La copia de seguridad previa a importar va **sin cifrar** por omisión; el diálogo ofrece cifrarla con una contraseña propia.
- Todo vive en el navegador (localStorage + IndexedDB); borrar datos del sitio lo elimina. Haga respaldos periódicos.

## Arquitectura

- `index.html`: shell (encabezado, selector de modelo, navegación, tema).
- `js/main.js`: arranque; conecta registro de modelos, router y vistas.
- `js/router.js`: router por hash (`#/perfil`, `#/documentos`, `#/plantillas`, `#/vista-previa`).
- `js/views/*.js`: cada vista exporta `mount(el, ctx)` con `ctx = { model, store, router }`; puede devolver una función de limpieza.
- `js/store.js`: perfil (`localStorage` `hv.profile`), plantillas (`hv.templates`), archivos en IndexedDB (`hv`/`files`: `putFile/getFile/deleteFile/listFiles`), `exportBackup/importBackup` (JSON, archivos en base64), `subscribe(fn)` para cambios.
- `js/models/`: modelos de HV (declarativos). `index.js` es el registro.
- `js/doc-sources.js`: registro de fuentes oficiales por documento (URL, validador, pasos, regla de vigencia, veredicto Asistido/Manual) y `shownDocIds`. `js/doc-parse.js`: lectura heurística del texto de un certificado y cálculo de vigencia (funciones puras, con pruebas). `js/pdf-ingest.js`: extracción de texto con pdf.js (carga perezosa desde `vendor/pdfjs/`, Apache-2.0; ver su README).
- `js/ui.js`: helpers DOM (`h`, `escapeHtml`, `toast`, `toastAction`, ...).
- `js/migrate.js`: migración PURA del perfil por versión (`hv.version`; `store.migrate()` la corre al arrancar y `importBackup` antes de escribir). Para cambiar el formato: subir `CURRENT_VERSION` y añadir un paso a `STEPS` (idempotente, con prueba).
- `js/backup-crypto.js`: cifrado PURO del respaldo (WebCrypto: `encryptBackup`, `decryptBackup`, `validateEnvelope`, `isEncryptedEnvelope`, `passphraseStrength`; rechaza KDF degradado; con pruebas en `tests/backup-crypto.test.mjs`). `store.exportBackupEncrypted`; los diálogos (`openExportDialog`, `openPassphraseDialog`, `downloadBackupFlow`) viven en `js/import-dialog.js`.
- `js/backup-merge.js`: fusión PURA de respaldos (`mergeBackup`, `prepareBackup` = validar + versión + migrar; con pruebas en `tests/backup-merge.test.mjs`). `js/import-dialog.js` (+ `css/import-dialog.css`): diálogo `<dialog>` de importación. Registra módulos nuevos también en `MORE` de `sw.js`.
- `js/orphans.js`: cálculo puro de archivos huérfanos. `js/notices.js`: avisos globales (privacidad, respaldo, almacenamiento lleno). `js/views/ajustes.js`: vista Ajustes.
- `store.js` además: `StorageError` (cuota u otro fallo de escritura, con `userMessage` en español; `onStorageError(fn)`), `storageEstimate`, `requestPersist`, `lastBackupAt`, `deleteFiles`, `wipeAll`.
- `sw.js` + `js/sw-register.js`: modo sin conexión (ver Despliegue).
- `js/conditions.js`: condiciones de visibilidad `showIf` (puras, sin `eval`): `evalCond`, `createVisibility` (campo/sección visible, por registro), `pruneProfile` (copia sin lo que no aplica, la que se valida e imprime) y `checkSchemaConditions`. Las usan `forms`/`perfil` (ocultar con `hidden`), `validators.validateProfile`, el `render`/`missing` del modelo y `plantillas`. `js/models/minerva-fit.js`: capacidad de las casillas del PDF para el aviso de texto largo (`model.fitLimit`).
- `js/a11y.js`: accesibilidad transversal (foco al título al cambiar de vista; la región con scroll de la vista previa se declara en su propia vista). Auditoría y guiones de prueba (axe, teclado, ATS) en `docs/ACCESIBILIDAD.md` y `tools/`.
- `js/forms.js`: controles de campo (con las reglas `validate` del schema), `fileSlot` (adjuntos), `certFileId`. `js/validators.js`: validadores puros declarados en el schema (`validate: ['celular', { rule: 'notBefore', other: 'fechaInicio' }]`; errores y avisos, nunca bloquean). `js/photo-editor.js`: editor de foto (`openPhotoEditor(file, { spec })`) y `js/photo-spec.js` (formatos, peso máximo, búsqueda de calidad). `js/template-check.js`: selección de documentos de una plantilla y certificados prometidos sin archivo. `js/template-model.js`: `newTemplate`. `js/export.js`: imprimir, HTML autónomo, descargas, `loadFiles` (carga perezosa: solo codifica las imágenes que la plantilla usa). `js/pdf-package.js` + `js/package-plan.js`: paquete PDF (pdf-lib vendorizado en `vendor/pdf-lib/`, MIT, carga perezosa; helpers puros con pruebas).

## Forma del modelo

```js
{ id, name,
  schema: { sections: [{ id, title, repeatable?, certificate?, fields: [{ id, label, type, required?, options?, hint?, certificate?, validate?, showIf? }], showIf? }],
            documents: [{ id, label, hint }],
            photo?: { aspect, width, height, maxKB } },
  render(profile, template, files) -> string HTML }
```

Perfil: `profile[sectionId][fieldId]` para secciones simples y `profile[sectionId] = [ {...}, ... ]` para repetibles (convención sugerida; la fijan las vistas).


## Formas de datos

Perfil (`localStorage` `hv.profile`):

```js
{ personales: { nombres, apellidos, ..., foto: 'photo' },       // sección simple: objeto
  superior: [ { id, programa, ... } ],                           // sección repetible: arreglo (cada ítem con id uuid)
  documents: { cedula: ['doc:cedula', 'doc:cedula:2'], ... } }  // ids de archivo por documento requerido
```

Plantilla (`localStorage` `hv.templates`, arreglo):

```js
{ id, name, modelId, jobType, createdAt, updatedAt,
  include: { sections: {secId: bool}, items: {itemId: bool}, fields: {'secId.fieldId': bool}, documents: {docId: bool} },
  options: { showPhoto, attachCertificates, attachDocuments, objective, maxAgeDays? } }
```

Ausente en `include` = incluido (salvo que `include.sections` no exista, que el render trata como "todo"). Para documentos, una bandera booleana explícita manda (aunque el documento esté oculto en Documentos); sin bandera, solo cuenta si el documento está mostrado. `options.maxAgeDays` (1 a 365, opcional) es la antigüedad máxima, desde la expedición, de los documentos con vigencia.

Archivos (IndexedDB `hv` / `files`, registro `{ id, blob, meta{name,type,size,label} }`):

| id | contenido |
|---|---|
| `photo` | fotografía (JPEG 600x800 tras el editor) |
| `cert:<item.id>` | certificado de un ítem de sección repetible |
| `cert:<secId>:<fieldId>` | certificado de un campo con `certificate` en sección simple |
| `cert:<secId>` | certificado de una sección simple con `certificate` |
| `doc:<docId>`, `doc:<docId>:<n>` | documento requerido y sus páginas adicionales |

Meta de un archivo de documento (solo se agregan claves; las anteriores no cambian): `name, type, size, label` y, tras leer un PDF, `lectura` (`auto|manual|fallo`), `motivo`, `emitidoEn` (AAAA-MM-DD), `fechaConfianza`, `fechaManual`, `validaHasta`, `codigo`, `estado` (`sin_registros|registra`), `estadoTexto`, `cedulasLeidas[]`, `vigenciaDias` (solo documentos con vigencia configurable). El estado de vigencia se calcula al mostrarlo, no se guarda.

Perfil: además de `documents`, la clave opcional `documentsShown: [docId]` fija qué documentos se muestran (ausente = conjunto base más los que ya tienen archivos).

Respaldo: `{ app:'hv-minerva', version:1, exportedAt, profile, templates, files:[{id, meta, data(base64)}] }`. Respaldo cifrado: `{ app:'hv-minerva', format:'hv-minerva-enc', v:1, cipher:'AES-256-GCM', kdf:{name:'PBKDF2', hash:'SHA-256', iterations}, salt, iv, ciphertext }` (base64; el texto claro es el JSON de arriba).

Versión de datos: `localStorage` `hv.version` (entero; 0/ausente = anterior a la migración). Respaldo: además `schemaVersion`. Otras claves: `hv.lastBackup` (ms), `hv.privacy.ack`.

Preferencias: `localStorage` `hv.model`, `hv.theme`; `sessionStorage` `hv.pv.zoom`, `hv.pv.paper`, `hv.perfil.sec`, `hv.photo.spec` (último formato de foto), `hv.docs.tpl` (plantilla con la que Documentos evalúa la vigencia).

## Pruebas

`node --test "tests/*.test.mjs"` desde `app/` (sin dependencias): lectura de certificados con textos sintéticos, vigencia y selección de documentos, helpers del paquete PDF (paginación, orden/selección de anexos, límites), validación de respaldos, migración de datos (`migrate.test.mjs`), archivos huérfanos y recordatorio de respaldo, validadores (`validators.test.mjs`), condiciones de visibilidad, datos ocultos no impresos y capacidad de las casillas (`conditions.test.mjs`), formatos de foto y búsqueda de calidad (`photo-spec.test.mjs`), selección de documentos, certificados faltantes y vigencia por plantilla (`template-check.test.mjs`, `minerva-templates.test.mjs`).

Desde la raíz del repo: `npm test` (las mismas unitarias). Pruebas de extremo a extremo, accesibilidad e impresión (Playwright, en `tests-e2e/`, fuera de `app/`): ver el README de la raíz. `tests/sw-precache.test.mjs` falla si añades un archivo a `js/`, `css/` o `fonts/` y no lo registras en `sw.js` (`MORE`).

## Agregar un modelo

1. Crear `js/models/<id>.js` con `export default { id, name, schema, render }`.
2. Importarlo y añadirlo a la lista en `js/models/index.js`. El selector del encabezado lo muestra automáticamente.

Contrato de `render(profile, template, files)`: `template` puede ser `null` (HV completa); `files` es `{ [id]: { meta, dataUrl } }`. Opcionales: `fitLimit(secId, fieldId) -> { comfort, max, multi } | null` (caracteres que caben en la casilla del PDF; avisos de texto largo en Perfil), `missing(profile, template, files) -> string[]`, `annexInfo(...) -> { images, others }`, `fileIds(profile, template) -> string[]` (ids cuyo binario necesita el render: habilita la carga perezosa; sin él se cargan todas las imágenes) y `annexList(profile, template, files) -> [{title,id,file}]` (anexos en orden, para el paquete PDF). Los ids de certificado deben seguir la tabla de arriba (`certFileId` en `js/forms.js`). Para modelos adicionales (p. ej. Función Pública/SIGEP) vea `docs/GAPS.md`.

## Despliegue

`.github/workflows/pages.yml` publica `app/` en GitHub Pages en cada push a `main` (`.nojekyll` incluido). No use URLs con `/` inicial: la app vive bajo `/<repo>/`.

**Service worker (`sw.js`)**: precachea el shell y guarda en caché (cache-first) todo GET del mismo origen, incluidos `vendor/*` la primera vez que se usan. El workflow reemplaza `__BUILD__` por el SHA del commit (nombre de caché `hv-app-<sha>`; las anteriores se borran); al desplegar, quien tenga la app abierta ve "Nueva versión disponible. Recargar". En local `__BUILD__` queda sin sustituir y el worker va red primero (no sirve código viejo mientras se desarrolla). Si agrega módulos JS nuevos, añádalos a `MORE` en `sw.js` para que estén disponibles sin conexión desde la primera visita.

## Pendientes

Ver [`../docs/GAPS.md`](../docs/GAPS.md).

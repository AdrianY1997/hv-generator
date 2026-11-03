# pdf.js (vendored)

## Procedencia exacta

| Dato | Valor |
|---|---|
| Paquete | `pdfjs-dist@4.10.38` (npm; el propio `pdf.min.js` declara `"4.10.38"`) |
| Build | `legacy/build/` (`pdf.min.mjs` y `pdf.worker.min.mjs`), sin cambios de contenido |
| Archivos | `pdf.min.js`, `pdf.worker.min.js`, `LICENSE` |
| Licencia | Apache-2.0, Copyright Mozilla Foundation y colaboradores (ver `LICENSE`) |
| SHA-256 `pdf.min.js` | `44ec6f011027ee77791386b66c14876a5fc29e20bf0433c07c6726fff7212b72` |
| SHA-256 `pdf.worker.min.js` | `bd88805178a26c729db8c0107a5b630cb900ec070f4d8c7529a3e45530afd41d` |
| SHA-256 `LICENSE` | `0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594` |
| Origen | `npm pack pdfjs-dist@4.10.38` en un directorio temporal fuera de `app/`; solo se copiaron estos archivos |

Para comprobar que no se alteraron: `sha256sum pdf.min.js pdf.worker.min.js LICENSE` y comparar con la tabla.

## Por que `.js` y no `.mjs` (nota para servidores)

Los archivos del build son modulos ES con extension `.mjs`. Aqui se renombraron a `.js` (la sintaxis sigue siendo de modulo ES) porque algunos servidores estaticos (p. ej. `python -m http.server` en Windows, que lee el tipo MIME del registro) sirven `.mjs` como `text/plain` y el navegador rechaza el modulo ("Expected a JavaScript module script"). GitHub Pages si sirve `.mjs` como JavaScript, pero la app no depende de eso.

- Con los `.js` no hace falta configurar nada en el servidor.
- Si se prefiere conservar los `.mjs` originales, el servidor debe responder `Content-Type: text/javascript` para `.mjs` (nginx: `types { text/javascript mjs; }`; Apache: `AddType text/javascript .mjs`) y hay que actualizar las dos rutas en `js/pdf-ingest.js` (el `import(...)` y `workerSrc`).

## Uso en la app

Carga perezosa desde `js/pdf-ingest.js`: `import('../vendor/pdfjs/pdf.min.js')` y `GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.js', import.meta.url)`. La app funciona sin estos archivos (solo se pierde la lectura automatica de PDF). Sin conexion: no se precachean en el service worker (`sw.js`); se guardan en la cache de ejecucion la primera vez que se abre un PDF con red (cache-first de GET del mismo origen).

Limitaciones: no se incluyen `cmaps/` ni `standard_fonts/` (suficiente para el texto de certificados generados digitalmente; un PDF con fuentes CJK o sin fuentes embebidas puede dar texto incompleto, y la app lo trata como "No se pudo leer" o lectura manual).

## Como actualizar

1. En un directorio temporal fuera de `app/`: `npm pack pdfjs-dist@<version>` y extraer el `.tgz`.
2. Copiar `package/legacy/build/pdf.min.mjs` a `app/vendor/pdfjs/pdf.min.js` y `package/legacy/build/pdf.worker.min.mjs` a `app/vendor/pdfjs/pdf.worker.min.js`; copiar `package/LICENSE` si cambio.
3. Verificar que `pdf.min.js` contiene la nueva version (buscar el texto `"4.x.y"`) y actualizar en esta tabla la version y los SHA-256.
4. Si el nuevo build referencia otros archivos `.mjs`, buscar `.mjs` dentro de los archivos copiados y ajustar las rutas.
5. Probar: adjuntar un PDF de certificado en Documentos (la fecha y el estado deben leerse) y ejecutar `node --test "tests/*.test.mjs"`.
6. No hace falta tocar el `VERSION` del service worker: el workflow de Pages lo estampa con el SHA del commit, lo que invalida la cache offline.

# pdf-lib (vendored)

- Paquete: `pdf-lib@1.17.1` (MIT, Andrew Dillon; ver `LICENSE`), archivo `dist/pdf-lib.min.js` (UMD, expone `window.PDFLib`), copiado SIN cambios.
- Origen: `npm pack pdf-lib@1.17.1` en un directorio temporal fuera de `app/`; solo se copiaron `pdf-lib.min.js` y la licencia.
- Uso: carga perezosa con un `<script>` clasico desde `js/pdf-package.js` (`loadPdfLib`) solo al pulsar "Descargar paquete PDF". Funciona sin red. Si falta, el resto de la app no se afecta.
- Para actualizar: repetir `npm pack`, reemplazar el archivo y este numero de version.

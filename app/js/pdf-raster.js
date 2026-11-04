// Páginas de un PDF anexo como imágenes, para que salgan al IMPRIMIR y en el HTML autónomo (el navegador no puede imprimir un PDF incrustado
// dentro de la HV). Usa el pdf.js vendorizado (carga perezosa, el mismo de pdf-ingest.js). Nada sale del equipo.
// Acotado por documento (PDF_PRINT.maxPages páginas, archivo <= maxBytes, ~150 dpi con lado mayor <= maxSide px, JPEG) y, en export.js, por un
// presupuesto combinado de la impresión (páginas Y píxeles decodificados). El documento completo y con su texto original va en
// «Descargar paquete PDF» (pdf-package.js lo une con pdf-lib, sin convertirlo a imagen).
import { loadPdfjs } from './pdf-ingest.js';

export const PDF_PRINT = Object.freeze({
  maxPages: 10,                  // por documento
  maxTotal: 60,                  // páginas de PDF por impresión (todas las del presupuesto)
  maxTotalPixels: 60e6,          // píxeles decodificados por impresión (~240 MB de memoria RGBA): el tope que casi siempre manda
  maxImagePixels: 16777216,      // pdf.js `maxImageSize`: una imagen incrustada mayor no se decodifica
  maxBytes: 25 * 1048576,        // un PDF mayor se rechaza antes de leerlo
  dpi: 150, maxSide: 1800, quality: 0.8, timeoutMs: 30000,
});

const userError = (msg) => Object.assign(new Error(msg), { userMessage: msg });
/** Llama a `fn` y descarta su rechazo: la limpieza de pdf.js NUNCA se espera (un worker atascado no contesta y colgaría la impresión). */
const quiet = (fn) => { try { const r = fn(); if (r && typeof r.catch === 'function') r.catch(() => {}); } catch { /* ya destruido */ } };

/** Escala de pdf.js (1 = 72 dpi) para `dpi`, limitada para que el lado mayor no pase de `maxSide` px. */
export function rasterScale(wPt, hPt, dpi = PDF_PRINT.dpi, maxSide = PDF_PRINT.maxSide) {
  const s = dpi / 72, big = Math.max(wPt, hPt) * s;
  return big > maxSide ? maxSide / Math.max(wPt, hPt) : s;
}

/**
 * PDF (Blob) -> { pages: [dataUrl JPEG], sizes: [píxeles de cada página], total, limited } con las primeras `maxPages` páginas, sin pasar de
 * `maxPixels` píxeles entre todas (`limited` = 'pixeles' si ese tope cortó antes que `maxPages`). Lanza Error con `userMessage` legible si no se
 * puede (muy grande, protegido, dañado, sin pdf.js o demasiado lento). Si vence `timeoutMs` devuelve el control de inmediato: la limpieza de
 * pdf.js se dispara sin esperarla. `opts.pdfjs` y `opts.makeCanvas` solo existen para las pruebas.
 */
export async function pdfToImages(blob, { maxPages = PDF_PRINT.maxPages, dpi = PDF_PRINT.dpi, maxSide = PDF_PRINT.maxSide, quality = PDF_PRINT.quality,
  timeoutMs = PDF_PRINT.timeoutMs, maxBytes = PDF_PRINT.maxBytes, maxPixels = PDF_PRINT.maxTotalPixels, pdfjs: injected = null,
  makeCanvas = () => document.createElement('canvas') } = {}) {
  if (blob?.size > maxBytes) throw userError(`el PDF pesa ${(blob.size / 1048576).toFixed(0)} MB y el máximo para imprimir es ${Math.round(maxBytes / 1048576)} MB (use «Descargar paquete PDF»)`);
  let pdfjs = injected;
  if (!pdfjs) { try { pdfjs = await loadPdfjs(); } catch { throw userError('no se pudo cargar el lector de PDF de la app'); } }
  const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false, maxImageSize: PDF_PRINT.maxImagePixels });
  let timer, doc = null, cancelled = false, renderTask = null;
  const work = (async () => {
    doc = await task.promise;
    const total = doc.numPages, n = Math.min(total, Math.max(0, maxPages)), pages = [], sizes = [];
    let used = 0, limited = '';
    for (let i = 1; i <= n && !cancelled; i++) {
      const page = await doc.getPage(i);
      let canvas = null;
      try {
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: rasterScale(base.width, base.height, dpi, maxSide) });
        const w = Math.ceil(viewport.width), hh = Math.ceil(viewport.height);
        if (used + w * hh > maxPixels) { limited = 'pixeles'; break; }
        canvas = makeCanvas();
        canvas.width = w; canvas.height = hh;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, hh);
        renderTask = page.render({ canvasContext: ctx, viewport });
        await renderTask.promise;
        if (cancelled) break;
        pages.push(canvas.toDataURL('image/jpeg', quality));
        sizes.push(w * hh); used += w * hh;
      } finally {
        renderTask = null;
        if (canvas) canvas.width = canvas.height = 0; // también si falló o se canceló: suelta el bitmap
        quiet(() => page.cleanup?.());
      }
    }
    if (!pages.length && n > 0) throw userError('las páginas del PDF son demasiado grandes para imprimirlas (use «Descargar paquete PDF»)');
    return { pages, sizes, total, limited };
  })();
  work.catch(() => {}); // si gana el tiempo límite, el rechazo tardío de `work` no queda sin manejar
  try {
    return await Promise.race([work, new Promise((_, rej) => { timer = setTimeout(() => rej(userError('el PDF tardó demasiado en convertirse')), timeoutMs); })]);
  } catch (e) {
    if (e?.userMessage) throw e;
    const msg = String(e?.name || '') + ' ' + String(e?.message || e);
    throw userError(/password/i.test(msg) ? 'el PDF está protegido con contraseña' : 'el PDF está dañado o no se pudo leer');
  } finally {
    clearTimeout(timer);
    cancelled = true;
    quiet(() => renderTask?.cancel?.());
    // Nunca `await`: pdf.js manda «Terminate» al worker y espera su respuesta; un PDF hostil que lo deja ocupado no contesta (docs/IMPRESION.md).
    quiet(() => doc?.destroy?.());
    quiet(() => task.destroy?.());
  }
}

// Ingesta local de PDF (G19): extrae el texto con pdf.js (vendorizado, carga perezosa) y aplica las heurísticas de doc-parse.js.
// Nada sale del navegador. Si pdf.js no carga, la app sigue funcionando y el usuario escribe la fecha a mano.
import { analyzeText, pickPages, pageCharCap } from './doc-parse.js';

let pdfjsP = null;
/** pdf.js perezoso y compartido (también lo usa pdf-raster.js para imprimir los anexos PDF). */
export function loadPdfjs() {
  pdfjsP ??= import('../vendor/pdfjs/pdf.min.js').then((m) => {
    // El worker se carga por URL del MISMO ORIGEN (CSP: worker-src 'self'); no lo cambies a blob: ni a un CDN. Lo guarda tests/csp.test.mjs.
    m.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.js', import.meta.url).href;
    return m;
  }).catch((e) => { pdfjsP = null; throw e; });
  return pdfjsP;
}

/** Texto de las primeras `head` y las últimas `tail` páginas (G19: la fecha o el código de verificación pueden estar al final; ver `pickPages`),
 *  con tope de caracteres por página. Lanza si no se puede leer.
 *  `hold` (opcional): recibe `hold.task` (loadingTask de pdf.js) para que quien llama pueda destruirlo, p. ej. en un timeout. */
export async function extractPdfText(blob, { head = 4, tail = 2 } = {}, hold = {}) {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await blob.arrayBuffer());
  const task = pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true });
  hold.task = task;
  let doc = null;
  try {
    doc = await task.promise;
    let text = '';
    const picks = pickPages(doc.numPages, head, tail), cap = pageCharCap(picks.length);
    for (const i of picks) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let pt = '';
      for (const it of content.items) { pt += it.str + (it.hasEOL ? '\n' : ' '); if (pt.length > cap) break; }
      text += pt.slice(0, cap) + '\n';
    }
    return text;
  } finally {
    quietDestroy(doc);
    quietDestroy(task); // nunca `await`: un worker atascado no contesta al «Terminate» (docs/IMPRESION.md)
  }
}

/** destroy() sin esperar: si el worker está atascado nunca resuelve y colgaría la ingesta más allá de su timeout. */
export function quietDestroy(obj) {
  try { Promise.resolve(obj?.destroy?.()).catch(() => {}); } catch { /* ya destruido */ }
}

/** Analiza un archivo adjuntado a un documento -> parche para el meta del archivo (siempre incluye `lectura`). */
export async function analyzeFile(file, docId, profileCedula = '') {
  if (file.type !== 'application/pdf') return { lectura: 'fallo', motivo: 'imagen' };
  let text;
  const hold = {};
  let timer;
  try {
    text = await Promise.race([extractPdfText(file, { head: 4, tail: 2 }, hold), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), 20000); })]);
  } catch (e) {
    console.warn('No se pudo leer el PDF:', e?.message || e);
    return { lectura: 'fallo', motivo: 'error_pdf' };
  } finally {
    clearTimeout(timer);
    quietDestroy(hold.task); // libera worker y memoria tras el timeout, sin esperar su respuesta
  }
  return analyzeText(text, docId, profileCedula);
}

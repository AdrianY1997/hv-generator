// Exportación / impresión de la HV renderizada.
import { isAllowedImageType } from './backup-validate.js';
export const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'hv';

export function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

export function fileToDataUrl(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

/**
 * Carga perezosa de archivos para el render: { id: { meta, dataUrl, pages?, pageTotal?, truncReason?, pdfError? } }.
 * Devuelve el `meta` de todos los registros (el render lo usa para saber qué existe) pero SOLO codifica como data URL las imágenes
 * cuyo id esté en `wantIds` (Set|Array). Sin `wantIds` se codifican todas las imágenes (compatibilidad) y ningún PDF.
 * `opts.pdf` (con `wantIds`): los PDF pedidos se convierten a imágenes de página (pdf-raster.js, carga perezosa de pdf.js) para que salgan al
 * imprimir: `pages` = [dataUrl], `pageTotal` = páginas del PDF, `truncReason` = por qué se imprimen menos; si no se puede, `pdfError` dice por qué.
 * El presupuesto de impresión (PDF_PRINT: páginas Y píxeles en total) se gasta en el ORDEN DE IMPRESIÓN, que es el de `wantIds`
 * (`model.fileIds`: certificados, cédula, demás documentos), no en el del almacén: la cédula nunca queda sin páginas por culpa de otro anexo.
 * `opts.cache` (Map, opcional): conserva las páginas ya convertidas entre recargas de la misma vista (clave: nombre, tamaño, tipo). Solo se
 * guardan los éxitos: un fallo o un tiempo agotado se reintenta en la siguiente carga (botón «Reintentar» de la Vista previa).
 */
export async function loadFiles(store, wantIds, { pdf = false, cache = null, raster: injected = null } = {}) { // `raster`: solo para pruebas
  const want = wantIds ? new Set(wantIds) : null;
  const out = {};
  let raster = injected, budget = null;
  const listed = await store.listFiles();
  for (const { id, meta } of listed) out[id] = { meta, dataUrl: '' };
  const order = want ? [...want].filter((id) => Object.hasOwn(out, id)) : listed.map((x) => x.id);
  for (const id of order) {
    const meta = out[id].meta;
    if (pdf && want && meta?.type === 'application/pdf') {
      raster ??= await import('./pdf-raster.js').catch(() => null);
      if (!raster) { out[id].pdfError = 'no se pudo cargar el lector de PDF de la app'; continue; }
      budget ??= { pages: raster.PDF_PRINT.maxTotal, pixels: raster.PDF_PRINT.maxTotalPixels };
      const r = await pdfPagesOf(store, id, meta, raster, cache, budget);
      Object.assign(out[id], r);
      const used = r.pages?.length || 0;
      budget.pages -= used;
      budget.pixels -= (r.sizes || []).slice(0, used).reduce((a, b) => a + b, 0);
      continue;
    }
    if (!isAllowedImageType(meta?.type)) continue; // nada que no sea imagen permitida llega a un src
    const rec = await store.getFile(id);
    // Solo las imágenes permitidas se incrustan: nada con tipo ajeno llega a un src.
    if (rec && isAllowedImageType(rec.blob?.type)) out[id] = { meta: rec.meta, dataUrl: await fileToDataUrl(rec.blob) };
  }
  return out;
}

/**
 * Páginas de un PDF como imágenes (con caché por vista de los éxitos). `budget` = { pages, pixels } que quedan del tope de la impresión
 * (<= 0: no se convierte). Devuelve { pages, sizes, pageTotal, truncReason? } o { pdfError }.
 */
async function pdfPagesOf(store, id, meta, raster, cache, budget) {
  const P = raster.PDF_PRINT;
  const spent = `ya se alcanzó el tope de anexos PDF de la impresión (${P.maxTotal} páginas o ${Math.round(P.maxTotalPixels / 1e6)} Mpíxeles de imagen) con los documentos anteriores`;
  if (budget.pages <= 0 || budget.pixels <= 0) return { pdfError: spent };
  const key = `${meta?.name}|${meta?.size}|${meta?.type}`;
  const hit = cache?.get(id);
  let r = hit && hit.key === key ? hit.value : null;
  if (!r) {
    try {
      const rec = await store.getFile(id);
      if (!rec?.blob || rec.blob.type !== 'application/pdf') throw Object.assign(new Error('x'), { userMessage: 'el archivo no es un PDF' });
      const { pages, sizes, total, limited } = await raster.pdfToImages(rec.blob);
      r = { pages, sizes, pageTotal: total, limited };
      cache?.set(id, { key, value: r }); // solo los éxitos
    } catch (e) {
      if (!e?.userMessage) console.error(e);
      return { pdfError: e?.userMessage || 'el PDF no se pudo convertir' };
    }
  }
  let n = 0, px = 0, why = '';
  while (n < r.pages.length) {
    if (n >= budget.pages) { why = `tope de ${P.maxTotal} páginas de anexos PDF por impresión`; break; }
    if (px + (r.sizes?.[n] || 0) > budget.pixels) { why = `tope de memoria de imágenes de la impresión (${Math.round(P.maxTotalPixels / 1e6)} Mpíxeles)`; break; }
    px += r.sizes?.[n] || 0; n++;
  }
  if (!n) return { pdfError: spent };
  if (!why && r.pageTotal > r.pages.length) why = r.limited === 'pixeles' ? 'tope de memoria de imágenes por documento' : `tope de ${P.maxPages} páginas por documento`;
  return { pages: n < r.pages.length ? r.pages.slice(0, n) : r.pages, sizes: r.sizes, pageTotal: r.pageTotal, ...(why ? { truncReason: why } : {}) };
}

/** Ids cuyo binario necesita el render para (perfil, plantilla): foto + anexos incluidos. Usa `model.fileIds` si existe; si no, null (= todas las imágenes). */
export function neededFileIds(model, profile, template, opts = {}) {
  try { return model?.fileIds ? model.fileIds(profile, template || null, opts) : null; } catch (e) { console.error(e); return null; }
}

/**
 * CSS de impresión de TODAS las páginas (docs/IMPRESION.md): una sola regla @page con margen 0 y el papel elegido, para que el resultado no
 * dependa del margen del diálogo de impresión («Ninguno» o «Predeterminado»). Las hojas del formulario ya ocupan la página entera; la hoja de
 * continuación y los anexos llevan su propia zona segura de 0,5 in como relleno interno de CADA elemento .hv-page (el JS ya reparte la
 * continuación y la lista de anexos en una página por elemento: sheet-kit.js); `box-decoration-break: clone` queda solo como red de seguridad
 * donde un bloque aún se parta (Chromium/Firefox), no como mecanismo. Lo usan la impresión (applyPrintPage) y el HTML autónomo.
 * Anexo con imagen (`[data-annex=img]`): página de alto exacto en columna; el título se limita a 2 líneas, la nota se encoge y la imagen
 * ocupa EXACTAMENTE lo que queda (posición absoluta dentro de .hv-fit, sin porcentajes de alto), así nunca desborda ni deja una página en blanco.
 * Va DESPUÉS de paper.css (cuyas reglas de impresión dejaban el margen a la página): no toca la geometría de las hojas.
 */
export function printCss(paper = 'letter') {
  return `@media print{@page{size:${paper === 'a4' ? 'A4' : 'Letter'};margin:0}`
    + '.hv-doc{--pm:.5in;--pw:8.5in;--ph:11in}.hv-a4 .hv-doc{--pm:.5in;--pw:210mm;--ph:297mm}'
    + '.hv-page{width:auto;min-height:0;margin:0;padding:var(--pm);box-shadow:none;-webkit-box-decoration-break:clone;box-decoration-break:clone}'
    + '.hv-annex[data-annex=img]{display:flex;flex-direction:column;height:calc(var(--ph) - .02in);overflow:hidden;break-inside:avoid}'
    + '.hv-annex[data-annex=img]>h2{flex:none;margin:0 0 6pt;font-size:12pt;line-height:1.2;max-height:2.4em;overflow:hidden;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2}'
    + '.hv-annex[data-annex=img] .hv-fit{flex:1 1 0;min-height:0;height:auto;position:relative;display:block}'
    + '.hv-annex[data-annex=img] .hv-fit img{position:absolute;left:0;top:0;width:100%;height:100%;max-width:none;max-height:none;object-fit:contain}'
    + '.hv-annex__note{flex:none;margin:4pt 0 0;font-size:7.5pt;line-height:1.2}}';
}

/** Deja puesta la regla de impresión del papel elegido (también para Ctrl+P sin pasar por el botón Imprimir). Solo mientras Vista previa esté montada. */
export function applyPrintPage(paper = 'letter') {
  document.body.classList.add('pv-on');
  let st = document.getElementById('pv-pagesize');
  if (!st) { st = document.createElement('style'); st.id = 'pv-pagesize'; }
  if (st !== document.head.lastElementChild) document.head.append(st); // al final: gana a paper.css con la misma especificidad
  const css = printCss(paper);
  if (st.textContent !== css) st.textContent = css;
}

/** Quita lo que dejó applyPrintPage: al salir de Vista previa, Ctrl+P en otra vista no hereda papel ni márgenes de la HV. */
export function clearPrintPage() {
  document.getElementById('pv-pagesize')?.remove();
  document.body.classList.remove('pv-on');
}

/** HTML autónomo (CSS del documento incrustado, sin dependencias). */
export async function standaloneHtml(docHtml, title, paper = 'letter') {
  let css = '';
  try { css = await (await fetch(new URL('../css/paper.css', import.meta.url))).text(); } catch (e) { console.error(e); }
  // Ajustes propios del HTML autónomo (no tocan paper.css): contraste AA en las cabeceras de la hoja de continuación (G08) y la lectura lineal para
  // lector de pantalla no se imprime. Mismos valores que css/print.css. La página (margen 0, zona segura interna) sale de printCss.
  const extra = '.hv-doc .hv-tbl th{color:#12467a}.hv-annex__note{font-size:8pt}@media print{.hv-sr{display:none!important}}';
  const safe = title.replace(/[<>&"]/g, '');
  return `<!doctype html>\n<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${safe}</title>\n<style>${css}\n${extra}\n${printCss(paper)}</style></head>\n<body class="hv-standalone ${paper === 'a4' ? 'hv-a4' : ''}">${docHtml}</body></html>`;
}

export function downloadHtml(html, name) { download(name, new Blob([html], { type: 'text/html;charset=utf-8' })); }
export function downloadJson(obj, name) { download(name, new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })); }

/** Imprime con título de documento temporal (sugiere el nombre del PDF). */
export function printWithTitle(title, paper = 'letter') {
  const prev = document.title;
  applyPrintPage(paper);
  document.title = title;
  const restore = () => { document.title = prev; removeEventListener('afterprint', restore); };
  addEventListener('afterprint', restore);
  window.print();
}

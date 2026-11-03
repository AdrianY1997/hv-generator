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
 * Carga perezosa de archivos para el render: { id: { meta, dataUrl } }.
 * Devuelve el `meta` de todos los registros (el render lo usa para saber qué existe) pero SOLO codifica como data URL las imágenes
 * cuyo id esté en `wantIds` (Set|Array). Los PDF nunca se convierten a data URL. Sin `wantIds` se codifican todas las imágenes (compatibilidad).
 * Nada se cachea aquí: al soltar el objeto devuelto, los data URL quedan libres para el recolector.
 */
export async function loadFiles(store, wantIds) {
  const want = wantIds ? new Set(wantIds) : null;
  const out = {};
  for (const { id, meta } of await store.listFiles()) {
    out[id] = { meta, dataUrl: '' };
    if (want && !want.has(id)) continue;
    if (!isAllowedImageType(meta?.type)) continue; // los PDF no se renderizan en la vista previa (ahorra memoria)
    const rec = await store.getFile(id);
    // Solo las imágenes permitidas se incrustan: nada con tipo ajeno llega a un src.
    if (rec && isAllowedImageType(rec.blob?.type)) out[id] = { meta: rec.meta, dataUrl: await fileToDataUrl(rec.blob) };
  }
  return out;
}

/** Ids cuyo binario necesita el render para (perfil, plantilla): foto + anexos incluidos. Usa `model.fileIds` si existe; si no, null (= todas las imágenes). */
export function neededFileIds(model, profile, template) {
  try { return model?.fileIds ? model.fileIds(profile, template || null) : null; } catch (e) { console.error(e); return null; }
}

/** HTML autónomo (CSS del documento incrustado, sin dependencias). */
export async function standaloneHtml(docHtml, title, paper = 'letter') {
  let css = '';
  try { css = await (await fetch(new URL('../css/paper.css', import.meta.url))).text(); } catch (e) { console.error(e); }
  const size = paper === 'a4' ? 'A4' : 'Letter';
  // Ajustes propios del HTML autónomo (no tocan paper.css): contraste AA en las cabeceras de la hoja de continuación (G08) y la lectura lineal para
  // lector de pantalla no se imprime. Mismos valores que css/print.css.
  const extra = '.hv-doc .hv-tbl th{color:#12467a}@media print{.hv-sr{display:none!important}}';
  const safe = title.replace(/[<>&"]/g, '');
  return `<!doctype html>\n<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${safe}</title>\n<style>${css}\n${extra}\n@media print{@page{size:${size};margin:.5in}}</style></head>\n<body class="hv-standalone ${paper === 'a4' ? 'hv-a4' : ''}">${docHtml}</body></html>`;
}

export function downloadHtml(html, name) { download(name, new Blob([html], { type: 'text/html;charset=utf-8' })); }
export function downloadJson(obj, name) { download(name, new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })); }

/** Imprime con título de documento temporal (sugiere el nombre del PDF). */
export function printWithTitle(title, paper = 'letter') {
  const prev = document.title;
  let st = document.getElementById('pv-pagesize');
  if (!st) { st = document.createElement('style'); st.id = 'pv-pagesize'; document.head.append(st); }
  st.textContent = `@media print{@page{size:${paper === 'a4' ? 'A4' : 'Letter'};margin:.5in}}`;
  document.title = title;
  const restore = () => { document.title = prev; removeEventListener('afterprint', restore); };
  addEventListener('afterprint', restore);
  window.print();
}

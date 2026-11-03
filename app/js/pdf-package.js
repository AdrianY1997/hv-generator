// "Paquete PDF": un solo PDF con las hojas de la HV (rasterizadas a ~200 dpi desde el mismo HTML de la vista previa)
// seguidas de los anexos (imágenes como páginas, PDF unidos página por página). 100% en el cliente, con pdf-lib vendorizado.
// Rasterización: cada hoja se serializa a un SVG con <foreignObject> (HTML+CSS de paper.css), se dibuja en un canvas y se incrusta como PNG.
// Las páginas de la HV son imagen, pero cada una lleva encima una capa de texto INVISIBLE (modo de texto 3, Helvetica estándar) con las palabras
// del HTML en su posición real: así un ATS, el buscador o la selección del visor leen el texto (G08). Los anexos de imagen no llevan texto.
// Ver docs/GAPS.md (G01, G08).
import { paperPt, planAnnexes, checkLimits, paginate, fitRect, scaleDown, winAnsi, clipText, checkImagePixels, checkPdfAppend, layoutTextLayer, mergeWords, LIMITS } from './package-plan.js';

const DPI = 200, PX_PER_IN = 96, K = DPI / PX_PER_IN;
let libP = null;

/** Carga perezosa de pdf-lib (script clásico, funciona sin red). */
export function loadPdfLib() {
  if (globalThis.PDFLib) return Promise.resolve(globalThis.PDFLib);
  if (libP) return libP;
  libP = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = new URL('../vendor/pdf-lib/pdf-lib.min.js', import.meta.url).href;
    s.onload = () => (globalThis.PDFLib ? res(globalThis.PDFLib) : rej(new Error('pdf-lib no expuso PDFLib')));
    s.onerror = () => rej(new Error('No se pudo cargar pdf-lib (vendor/pdf-lib/pdf-lib.min.js).'));
    document.head.append(s);
  }).catch((e) => { libP = null; throw e; });
  return libP;
}

const userError = (msg, cause) => Object.assign(new Error(msg), { userMessage: msg, cause });
const xmlText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const FLOW_CSS = '.hv-doc{--pm:0in}.hv-page{width:100%;min-height:0;margin:0;padding:0;box-shadow:none}.hv-sheet{margin:0;box-shadow:none}.hv-doc .hv-tbl th{color:#12467a}';

async function paperCss() {
  try { const r = await fetch(new URL('../css/paper.css', import.meta.url)); if (r.ok) return await r.text(); } catch (e) { console.error(e); }
  throw userError('No se pudo leer css/paper.css para dibujar las hojas.');
}

/** SVG(foreignObject) -> PNG (Uint8Array). `inner`: HTML (string XHTML) dentro de .hv-doc. */
async function svgToPng(inner, wPx, hPx, css, a4) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${wPx}" height="${hPx}" viewBox="0 0 ${wPx} ${hPx}"><foreignObject x="0" y="0" width="${wPx}" height="${hPx}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" class="${a4 ? 'hv-a4' : ''}" style="margin:0;padding:0;background:#fff"><style>${xmlText(css + FLOW_CSS)}</style><div class="hv-doc">${inner}</div></div></foreignObject></svg>`;
  const img = new Image();
  img.decoding = 'async';
  const loaded = new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(userError('El navegador no pudo dibujar la hoja (SVG foreignObject).')); });
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await loaded;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(wPx * K); canvas.height = Math.ceil(hPx * K);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  let blob;
  try { blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/png')); }
  catch (e) { throw userError('Este navegador no permite convertir las hojas a imagen (canvas bloqueado). Use Imprimir y luego "Combinar solo anexos".', e); }
  canvas.width = canvas.height = 0;
  return new Uint8Array(await blob.arrayBuffer());
}

/** Giro del texto SVG en la pantalla, en grados ANTIHORARIOS múltiplos de 90 (0 si no está girado o el giro no es recto). Notas verticales al margen. */
function quarterTurns(el) {
  try {
    const m = el.getScreenCTM();
    if (!m) return 0;
    const ang = (Math.atan2(m.b, m.a) * 180) / Math.PI, q = Math.round(ang / 90) * 90;
    return Math.abs(ang - q) < 5 ? ((-q % 360) + 360) % 360 : 0; // la pantalla tiene la y hacia abajo: un giro horario ahí es antihorario en PDF al revés
  } catch { return 0; }
}

/**
 * Palabras de `root` (texto del DOM ya maquetado) con su caja en px CSS relativa a `origin` (DOMRect) -> ejecuciones [{text,x,y,w,h}].
 * Los rótulos SVG (<text>) salen enteros (una ejecución por elemento); el resto, palabra a palabra (Range) para conservar las líneas.
 * Se omite la copia oscura de los rótulos (data-sh): es solo sombra visual y duplicaría el título.
 */
function collectRuns(root, origin) {
  const words = [];
  try {
    const seen = new Set(), range = document.createRange();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const p = n.parentElement;
      if (!p || p.closest('style,script,title,noscript,[data-sh]')) continue;
      const svgText = p.closest('text');
      if (svgText) {
        if (seen.has(svgText)) continue;
        seen.add(svgText);
        const r = svgText.getBoundingClientRect(), text = svgText.textContent.replace(/\s+/g, ' ').trim();
        if (text && r.width > 0 && r.height > 0) words.push({ text, x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height, rot: quarterTurns(svgText) });
        continue;
      }
      for (const m of n.nodeValue.matchAll(/\S+/g)) {
        range.setStart(n, m.index); range.setEnd(n, m.index + m[0].length);
        const r = range.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) words.push({ text: m[0], x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height });
      }
    }
  } catch (e) { console.error(e); return []; }
  return mergeWords(words);
}

/** Hojas de la HV -> [{png, wPt, hPt, kind:'sheet'|'flow', runs}]. Descarta los anexos del HTML (se arman desde el store). */
async function rasterizeHv(html, paper) {
  const a4 = paper === 'a4';
  const page = paperPt(paper);
  const css = await paperCss();
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none';
  host.className = a4 ? 'hv-a4' : '';
  const st = document.createElement('style');
  st.textContent = FLOW_CSS;
  host.append(st);
  const box = document.createElement('div');
  box.innerHTML = html;
  host.append(box);
  document.body.append(host);
  const ser = new XMLSerializer();
  const out = [];
  try {
    const doc = box.querySelector('.hv-doc');
    if (!doc) throw userError('No hay hojas de la HV para exportar.');
    doc.querySelectorAll('.hv-annex').forEach((n) => n.remove());
    const flowW = Math.round((page.w - 72) / 0.75), flowH = Math.floor((page.h - 72) / 0.75); // área útil con margen de .5in
    for (const el of [...doc.children]) {
      if (el.classList.contains('hv-sheet')) {
        const r = el.getBoundingClientRect();
        const w = Math.round(r.width * 100) / 100, h = Math.round(r.height * 100) / 100;
        const runs = collectRuns(el, r); // antes de serializar: el DOM sigue maquetado
        out.push({ kind: 'sheet', png: await svgToPng(ser.serializeToString(el), w, h, css, a4), wPt: w * 0.75, hPt: h * 0.75, runs });
      } else if (el.classList.contains('hv-page')) {
        // Hoja de flujo (continuación): se mide a ancho de página útil y se corta en límites de bloque.
        el.style.width = flowW + 'px';
        const top0 = el.getBoundingClientRect().top, total = Math.ceil(el.getBoundingClientRect().height);
        const tops = [];
        el.querySelectorAll('tr, .hv-card, .mv-cs, p, h1').forEach((n) => {
          if (n.tagName === 'TR') { const rows = n.closest('table')?.rows; if (rows && (n === rows[0] || n === rows[1])) return; }
          tops.push(Math.round(n.getBoundingClientRect().top - top0));
        });
        const starts = paginate(tops, total, flowH);
        const flowRuns = collectRuns(el, el.getBoundingClientRect()); // con el ancho de página aplicado, igual que la imagen
        el.style.width = '';
        const html1 = ser.serializeToString(el);
        for (let i = 0; i < starts.length; i++) {
          const end = i + 1 < starts.length ? starts[i + 1] : total, h = Math.max(1, end - starts[i]);
          const inner = `<div class="hv-doc-flow" style="position:relative;width:${flowW}px;height:${h}px;overflow:hidden"><div style="position:absolute;left:0;top:${-starts[i]}px;width:${flowW}px">${html1}</div></div>`;
          const runs = flowRuns.filter((q) => q.y + q.h / 2 >= starts[i] && q.y + q.h / 2 < end).map((q) => ({ ...q, y: q.y - starts[i] }));
          out.push({ kind: 'flow', png: await svgToPng(inner, flowW, h, css, a4), wPt: flowW * 0.75, hPt: h * 0.75, runs });
        }
      }
    }
  } finally { host.remove(); }
  if (!out.length) throw userError('No hay hojas de la HV para exportar.');
  return out;
}

/**
 * Dibuja `runs` como texto invisible (Tr 3) sobre la página `pg`. `box`: esquina superior izquierda (pt, desde arriba) de la imagen en la página.
 * Fuente estándar Helvetica (WinAnsi): acentos, ñ, ¿ y ¡ se codifican tal cual; lo no representable se translitera solo en esta capa.
 * Cada ejecución lleva su escala horizontal (Tz) para que la selección cubra el ancho real de la palabra. Devuelve cuántas ejecuciones dibujó.
 */
export function drawTextLayer(lib, pg, font, glyphs, runs, box, page) {
  const { pushGraphicsState, popGraphicsState, setTextRenderingMode, TextRenderingMode, PDFOperator, PDFNumber } = lib;
  const items = layoutTextLayer(runs, { box, page, font: { has: (ch) => glyphs.has(ch.codePointAt(0)), width: (t, sz) => font.widthOfTextAtSize(t, sz) } });
  if (!items.length) return 0;
  pg.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Invisible));
  try {
    for (const it of items) {
      pg.pushOperators(PDFOperator.of('Tz', [PDFNumber.of(it.tz)]));
      pg.drawText(it.text, { x: it.x, y: it.y, size: it.size, font, ...(it.rot ? { rotate: lib.degrees(it.rot) } : {}) });
    }
  } finally {
    pg.pushOperators(popGraphicsState()); // q/Q siempre balanceado, aunque drawText falle
  }
  return items.length;
}

/** Imagen (Blob) -> JPEG bytes con orientación EXIF aplicada y lado mayor limitado. */
async function imageToJpeg(blob) {
  // Antes de decodificar: las dimensiones se leen de la cabecera y una imagen gigante (bomba de píxeles) se rechaza sin tocar el decodificador.
  const px = checkImagePixels(new Uint8Array(await blob.arrayBuffer()));
  if (!px.ok) throw Object.assign(userError(px.reason === 'grande' ? 'imagen demasiado grande' : 'imagen ilegible'), { skipReason: px.reason === 'grande' ? `imagen demasiado grande (${px.w}×${px.h} px; máximo ${LIMITS.maxImagePixels / 1e6} megapíxeles)` : 'imagen ilegible' });
  let bmp;
  try { bmp = await createImageBitmap(blob); } catch (e) { throw userError('imagen ilegible', e); }
  try {
    const { w, h } = scaleDown(bmp.width, bmp.height, LIMITS.maxImageSide);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    const jb = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/jpeg', 0.92));
    c.width = c.height = 0;
    return { bytes: new Uint8Array(await jb.arrayBuffer()), w, h };
  } finally { bmp.close?.(); }
}

/**
 * Construye el paquete. opts: { html, paper, title, annexList, getFile(id)->Promise<{blob,meta}>, withHv=true, onProgress }
 * `textLayer` (true): capa de texto invisible sobre las hojas de la HV (ATS/búsqueda). Devuelve { blob, pages, hvPages, annexPages, textRuns, skipped:[{title,reason}] }. Lanza Error con userMessage ante límites o fallos globales.
 */
export async function buildPackage({ html, paper = 'letter', title = 'HV', annexList = [], getFile, withHv = true, textLayer = true, onProgress = () => {} }) {
  const plan = planAnnexes(annexList);
  const lim = checkLimits(plan);
  if (!lim.ok) throw userError(lim.error);
  if (!withHv && !plan.some((p) => p.kind !== 'skip')) throw userError('No hay anexos (imagen o PDF) para combinar con esta plantilla.');
  onProgress('Cargando pdf-lib...');
  const lib = await loadPdfLib();
  const { PDFDocument, StandardFonts, rgb } = lib;
  const page = paperPt(paper);
  const out = await PDFDocument.create();
  out.setTitle(title); out.setCreator('HV Minerva'); out.setProducer('HV Minerva (pdf-lib)');
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  let hvPages = 0, annexPages = 0, textRuns = 0;
  const skipped = [];
  const guard = () => { if (out.getPageCount() > LIMITS.maxPages) throw userError(`El paquete supera ${LIMITS.maxPages} páginas. Quita anexos o genera el paquete por partes.`); };

  if (withHv) {
    onProgress('Dibujando las hojas de la HV...');
    const sans = textLayer ? await out.embedFont(StandardFonts.Helvetica) : null;
    const glyphs = textLayer ? new Set(sans.getCharacterSet()) : null;
    for (const s of await rasterizeHv(html, paper)) {
      const png = await out.embedPng(s.png);
      const pg = out.addPage([page.w, page.h]);
      const box = s.kind === 'sheet' ? { x: 0, y: 0 } : { x: 36, y: 36 };
      pg.drawImage(png, { x: box.x, y: page.h - box.y - s.hPt, width: s.wPt, height: s.hPt });
      if (textLayer) {
        try { textRuns += drawTextLayer(lib, pg, sans, glyphs, s.runs || [], box, page); }
        catch (e) { console.error('capa de texto', e); } // la imagen ya está: el paquete sigue siendo válido sin la capa
      }
      hvPages++;
    }
  }

  let n = 0;
  for (const p of plan) {
    n++;
    if (p.kind === 'skip') { skipped.push({ title: p.title, reason: 'tipo de archivo no admitido' }); continue; }
    onProgress(`Anexo ${n} de ${plan.length}: ${p.title}`);
    try {
      const rec = await getFile(p.id);
      if (!rec?.blob) throw new Error('archivo no encontrado');
      if (p.kind === 'pdf') {
        const bytes = new Uint8Array(await rec.blob.arrayBuffer());
        const src = await PDFDocument.load(bytes, { updateMetadata: false });
        // PDF hostil: se mira el número de páginas ANTES de copiar nada.
        const chk = checkPdfAppend(out.getPageCount(), src.getPageCount());
        if (!chk.ok && chk.reason === 'total') throw userError(`El paquete supera ${LIMITS.maxPages} páginas. Quita anexos o genera el paquete por partes.`);
        if (!chk.ok) throw Object.assign(new Error('demasiadas páginas'), { skipReason: `PDF con demasiadas páginas (máximo ${LIMITS.maxPagesPerFile} por archivo)` });
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((pg) => out.addPage(pg));
        annexPages += pages.length;
      } else {
        const img = await imageToJpeg(rec.blob);
        const emb = await out.embedJpg(img.bytes);
        const pg = out.addPage([page.w, page.h]);
        const m = 36, headH = 28;
        const head = clipText(winAnsi(`Anexo · ${p.title}`), page.w - 2 * m, (s) => bold.widthOfTextAtSize(s, 12));
        pg.drawText(head, { x: m, y: page.h - m - 10, size: 12, font: bold, color: rgb(0, 0, 0) });
        const bw = page.w - 2 * m, bh = page.h - 2 * m - headH;
        // pt por px: la imagen se muestra a su tamaño en 96 dpi como máximo (igual que la vista previa: sin ampliar).
        const f = fitRect(img.w * 0.75, img.h * 0.75, bw, bh);
        pg.drawImage(emb, { x: m + f.x, y: m + f.y, width: f.w, height: f.h });
        annexPages++;
      }
      guard();
    } catch (e) {
      if (e?.userMessage && /supera/.test(e.userMessage)) throw e;
      console.error(e);
      const msg = String(e?.message || e);
      skipped.push({ title: p.title, reason: e?.skipReason || (/encrypt/i.test(msg) ? 'PDF protegido con contraseña' : /imagen ilegible/.test(msg) ? 'imagen ilegible' : 'no se pudo leer') });
    }
  }
  guard();
  if (!out.getPageCount()) throw userError('El paquete quedó vacío: ningún anexo se pudo leer.');
  onProgress('Generando el archivo...');
  const bytes = await out.save();
  return { blob: new Blob([bytes], { type: 'application/pdf' }), pages: out.getPageCount(), hvPages, annexPages, textRuns, skipped };
}

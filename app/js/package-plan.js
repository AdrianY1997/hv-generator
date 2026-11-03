// Helpers PUROS (sin DOM) del "paquete PDF": papel, paginación de hojas de flujo, selección y orden de anexos,
// encaje de imágenes y límites. Probado en tests/package-plan.test.mjs.

/** Tamaño de página en puntos PDF. */
export const PAPER_PT = { letter: { w: 612, h: 792 }, a4: { w: 595.28, h: 841.89 } };
export const paperPt = (paper) => PAPER_PT[paper === 'a4' ? 'a4' : 'letter'];

/** Límites del paquete (memoria del navegador). */
export const LIMITS = { maxInputBytes: 60 * 1024 * 1024, maxAnnexFiles: 120, maxPages: 400, maxPagesPerFile: 150, maxImageSide: 3000, maxImagePixels: 40e6 };

/**
 * Dimensiones (px) leídas de la CABECERA de un PNG, JPEG o WebP, sin decodificar la imagen. `b`: Uint8Array con el archivo (o su inicio).
 * Devuelve {w, h} o null si no es una imagen reconocible / la cabecera está truncada. Sirve para rechazar "bombas de píxeles" antes de createImageBitmap.
 */
export function imageDimensions(b) {
  if (!b || b.length < 24) return null;
  const u16 = (i) => (b[i] << 8) | b[i + 1];
  const u32 = (i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  // PNG: firma + chunk IHDR (ancho y alto a 32 bits big-endian en 16..23).
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return b[12] === 0x49 && b[13] === 0x48 && b[14] === 0x44 && b[15] === 0x52 ? { w: u32(16), h: u32(20) } : null;
  // WebP: RIFF....WEBP + VP8 (con pérdida) | VP8L (sin pérdida) | VP8X (extendido).
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const t = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (t === 'VP8X' && b.length >= 30) return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    if (t === 'VP8L' && b.length >= 25 && b[20] === 0x2f) return { w: 1 + (b[21] | ((b[22] & 0x3f) << 8)), h: 1 + (((b[22] >> 6) | (b[23] << 2) | ((b[24] & 0x0f) << 10)) & 0x3fff) };
    if (t === 'VP8 ' && b.length >= 30 && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) return { w: (b[26] | (b[27] << 8)) & 0x3fff, h: (b[28] | (b[29] << 8)) & 0x3fff };
    return null;
  }
  // JPEG: recorrer marcadores hasta el primer SOFn (C0-CF salvo C4, C8, CC).
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: u16(i + 7), h: u16(i + 5) };
      const len = u16(i + 2);
      if (len < 2) return null;
      i += 2 + len;
    }
  }
  return null;
}

/** ¿Cabe la imagen en el presupuesto de píxeles? {ok:true,w,h} | {ok:false, reason:'ilegible'|'grande', w?, h?}. Dimensión 0 o desconocida = ilegible. */
export function checkImagePixels(b, maxPixels = LIMITS.maxImagePixels) {
  const d = imageDimensions(b);
  if (!d || !(d.w > 0) || !(d.h > 0)) return { ok: false, reason: 'ilegible' };
  if (d.w * d.h > maxPixels) return { ok: false, reason: 'grande', w: d.w, h: d.h };
  return { ok: true, w: d.w, h: d.h };
}

/**
 * ¿Se puede anexar un PDF de `add` páginas a un paquete que ya tiene `have`? {ok:true} | {ok:'file'|'total'...}.
 * 'file': el PDF supera el tope por archivo (hostil o enorme: se omite y se nombra); 'total': el paquete superaría maxPages (se detiene).
 */
export function checkPdfAppend(have, add, limits = LIMITS) {
  if (!(add >= 0)) return { ok: false, reason: 'ilegible' };
  if (add > limits.maxPagesPerFile) return { ok: false, reason: 'file' };
  if (have + add > limits.maxPages) return { ok: false, reason: 'total' };
  return { ok: true };
}

/**
 * Clasifica los anexos del modelo ([{title,id,file:{meta}}], en el orden del modelo: certificados y luego documentos con CC primero)
 * en lo que el paquete incrusta. Conserva el orden. kind: 'pdf' | 'image' | 'skip' (tipo no admitido).
 */
export function planAnnexes(list) {
  return (Array.isArray(list) ? list : []).map((a) => {
    const t = a?.file?.meta?.type || '';
    const kind = t === 'application/pdf' ? 'pdf' : /^image\/(jpeg|png|webp)$/.test(t) ? 'image' : 'skip';
    return { id: a.id, title: String(a.title || a.id), name: a?.file?.meta?.name || a.id, size: Number(a?.file?.meta?.size) || 0, kind };
  });
}

/** Valida tamaño total / cantidad. Devuelve { ok:true } o { ok:false, error } (mensaje para el usuario). */
export function checkLimits(plan, limits = LIMITS) {
  const items = plan.filter((p) => p.kind !== 'skip');
  if (items.length > limits.maxAnnexFiles) return { ok: false, error: `Hay ${items.length} anexos y el paquete admite hasta ${limits.maxAnnexFiles}. Quita anexos de la plantilla o genera el paquete por partes.` };
  const total = items.reduce((s, p) => s + p.size, 0);
  if (total > limits.maxInputBytes) return { ok: false, error: `Los anexos pesan ${(total / 1048576).toFixed(0)} MB y el paquete admite hasta ${limits.maxInputBytes / 1048576} MB. Quita anexos o genera el paquete por partes.` };
  return { ok: true, total };
}

/**
 * Cortes de página para una hoja de flujo alta. `tops`: posiciones Y (px) donde es seguro cortar (inicio de filas/bloques);
 * `total`: alto total; `pageH`: alto útil de página. Devuelve los desplazamientos de inicio de cada página.
 * Corta en el último punto seguro que cabe; si un bloque supera la página, corta duro en `pageH`.
 */
export function paginate(tops, total, pageH) {
  const starts = [0];
  if (!(pageH > 0) || !(total > pageH)) return starts;
  const cand = [...new Set(tops.filter((y) => y > 0 && y < total))].sort((a, b) => a - b);
  let s = 0, guard = 0;
  while (total - s > pageH + 0.5 && guard++ < 10000) {
    let cut = -1;
    for (const y of cand) { if (y - s > 1 && y - s <= pageH + 0.5) cut = y; else if (y - s > pageH) break; }
    if (cut < 0) cut = s + pageH;
    starts.push(cut);
    s = cut;
  }
  return starts;
}

/** Encaja una imagen (iw x ih) dentro de una caja (bw x bh) sin ampliarla; centrada. Devuelve {x,y,w,h} relativo a la caja. */
export function fitRect(iw, ih, bw, bh) {
  if (!(iw > 0) || !(ih > 0)) return { x: 0, y: 0, w: 0, h: 0 };
  const k = Math.min(bw / iw, bh / ih, 1);
  const w = iw * k, h = ih * k;
  return { x: (bw - w) / 2, y: (bh - h) / 2, w, h };
}

/** Reduce (sw x sh) para que el lado mayor no pase de `max`. */
export function scaleDown(sw, sh, max) {
  const k = Math.min(1, max / Math.max(sw, sh));
  return { w: Math.max(1, Math.round(sw * k)), h: Math.max(1, Math.round(sh * k)) };
}

/** Texto apto para las fuentes estándar de pdf-lib (WinAnsi): sustituye lo no representable. */
export function winAnsi(s) {
  return String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/[‐-―]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[^ -~¡-ÿ€•…]/g, '?');
}

/** Recorta un texto a un ancho máximo con puntos suspensivos (medida con `measure(str)`). */
export function clipText(str, maxW, measure) {
  if (measure(str) <= maxW) return str;
  let s = str;
  while (s.length > 1 && measure(s + '...') > maxW) s = s.slice(0, -1);
  return s + '...';
}

// ---------- Capa de texto invisible de las hojas rasterizadas (ATS / búsqueda / selección) ----------
// El DOM entrega palabras con su caja ({text,x,y,w,h} en px CSS relativos a la hoja); estas funciones PURAS las agrupan en líneas,
// las ordenan como se lee (arriba-abajo, izquierda-derecha) y las convierten a puntos PDF. Probado en tests/package-plan.test.mjs.

/** Tope de ejecuciones de texto por página (un DOM hostil no puede inflar el PDF). */
export const TEXT_LAYER = { maxRunsPerPage: 6000, maxChars: 400000 };

/**
 * Texto para la capa invisible con una fuente WinAnsi: lo representable se conserva (acentos, ñ, ¿, ¡, comillas...); el resto se translitera
 * (NFD sin marcas: "ō" -> "o", "ﬁ" -> "fi") y lo que no tiene equivalente se omite. `hasGlyph(char)` dice si la fuente lo codifica.
 * Esto SOLO afecta al texto invisible: la imagen de la hoja no cambia.
 */
export function layerText(s, hasGlyph) {
  let out = '';
  for (const ch of String(s ?? '').replace(/[  -   　]/g, ' ').replace(/[​-‏⁠﻿­]/g, '').replace(/[\r\n\t\f\v]+/g, ' ')) {
    if (ch === ' ' || hasGlyph(ch)) { out += ch; continue; }
    const t = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
    for (const c of t) if (c === ' ' || hasGlyph(c)) out += c;
  }
  return out.replace(/ {2,}/g, ' ').trim();
}

/**
 * Une palabras consecutivas (orden del DOM) en ejecuciones: misma línea (centros verticales a menos de media altura) y hueco corto
 * (menos de ~una altura de letra; una columna distinta queda como otra ejecución). El texto girado (`rot` != 0) nunca se une. words: [{text,x,y,w,h,rot?}] -> [{text,x,y,w,h,rot?}].
 */
export function mergeWords(words, gapFactor = 0.9) {
  const out = [];
  for (const w of words) {
    if (!w || !w.text || !(w.w >= 0) || !(w.h > 0)) continue;
    const p = out[out.length - 1];
    if (p && !p.rot && !w.rot && Math.abs((p.y + p.h / 2) - (w.y + w.h / 2)) <= 0.5 * Math.min(p.h, w.h) && w.x >= p.x + p.w - 0.5 * w.h && w.x - (p.x + p.w) <= gapFactor * w.h) {
      p.text += ' ' + w.text;
      const right = Math.max(p.x + p.w, w.x + w.w), bottom = Math.max(p.y + p.h, w.y + w.h), top = Math.min(p.y, w.y);
      p.w = right - p.x; p.h = bottom - top; p.y = top;
    } else out.push({ text: w.text, x: w.x, y: w.y, w: w.w, h: w.h, rot: w.rot || 0 });
  }
  return out;
}

/**
 * Ordena ejecuciones en orden de lectura: líneas de arriba a abajo (tolerancia de media altura) y, dentro de la línea, de izquierda a derecha.
 * El texto girado (notas al margen) va al final, de izquierda a derecha.
 */
export function readingOrder(runs) {
  const ok = runs.filter((r) => r && r.text && r.h > 0);
  const side = ok.filter((r) => r.rot).sort((a, b) => a.x - b.x || a.y - b.y);
  const rs = ok.filter((r) => !r.rot).map((r) => ({ ...r, cy: r.y + r.h / 2 })).sort((a, b) => a.cy - b.cy || a.x - b.x);
  const lines = [];
  for (const r of rs) {
    const l = lines[lines.length - 1];
    if (l && Math.abs(r.cy - l.cy) <= 0.5 * Math.min(r.h, l.h)) { l.items.push(r); l.cy = (l.cy * (l.items.length - 1) + r.cy) / l.items.length; l.h = Math.min(l.h, r.h); }
    else lines.push({ cy: r.cy, h: r.h, items: [r] });
  }
  return [...lines.flatMap((l) => l.items.sort((a, b) => a.x - b.x).map(({ cy, ...r }) => r)), ...side];
}

/**
 * Ejecuciones en px CSS -> instrucciones en puntos PDF para una página. `box`: {x,y} (pt) donde queda la esquina superior izquierda del
 * contenido en la página (y desde ARRIBA), `pxToPt`: 0.75; `page`: {w,h} pt; `font`: { has(char), width(str,size) }.
 * Devuelve [{text, x, y (origen de la línea base, pt desde ABAJO), size, tz (escala horizontal %), rot (grados antihorarios: 0, 90, 180, 270)}] en orden de lectura;
 * descarta lo vacío o fuera de la página. Un rectángulo alto y estrecho con varias letras se toma como texto girado 90° (la caja lo delata).
 */
export function layoutTextLayer(runs, { box = { x: 0, y: 0 }, pxToPt = 0.75, page, font, limits = TEXT_LAYER }) {
  const out = [];
  let chars = 0;
  for (const r of readingOrder(runs)) {
    if (out.length >= limits.maxRunsPerPage || chars >= limits.maxChars) break;
    const text = layerText(r.text, font.has);
    if (!text) continue;
    let rot = ((Math.round((r.rot || 0) / 90) * 90) % 360 + 360) % 360;
    if (!rot && text.length >= 4 && r.h > 2 * r.w) rot = 90;
    const quarter = rot === 90 || rot === 270;
    const wt = r.w * pxToPt, ht = r.h * pxToPt;
    const x0 = box.x + r.x * pxToPt, top = box.y + r.y * pxToPt;
    if (x0 >= page.w || top >= page.h || x0 + wt <= 0 || top + ht <= 0) continue;
    // Largo (a lo largo de la línea) y grosor (alto de la letra). Caja de contenido de Arial/Helvetica: ~1.117 em; línea base a ~0.81 desde "arriba" de la letra.
    const len = quarter ? ht : wt, thick = quarter ? wt : ht;
    const size = Math.max(1, thick / 1.117);
    const natural = font.width(text, size);
    let tz = natural > 0 && len > 0 ? (len / natural) * 100 : 100;
    tz = Math.min(400, Math.max(25, tz));
    if (Math.abs(tz - 100) < 2) tz = 100;
    const th = rot * Math.PI / 180, dir = [Math.cos(th), Math.sin(th)], up = [-Math.sin(th), Math.cos(th)];
    const cx = x0 + wt / 2, cy = page.h - (top + ht / 2); // centro de la caja, y desde abajo
    const x = cx - dir[0] * len / 2 - up[0] * 0.31 * thick, y = cy - dir[1] * len / 2 - up[1] * 0.31 * thick;
    chars += text.length;
    out.push({ text, x, y, size, tz, rot });
  }
  return out;
}

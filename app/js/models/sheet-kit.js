// Piezas comunes del render de un formulario reproducido (hojas .hv-sheet con SVG de fondo + valores posicionados), para los modelos
// que se agreguen después de Minerva (hoy: formato-unico.js). Mismo contrato y mismas reglas que minerva.js, que conserva su copia
// propia de las hojas para no cambiar su salida (ver docs/MODELOS.md, «Agregar un modelo»; los anexos, annexHtml/annexFlags/annexSummary,
// sí son comunes a los dos): escape de todo valor, solo lo que aplica (pruneProfile),
// selección de la plantilla (include.*), lectura lineal accesible (.hv-sr), hoja de continuación y anexos.
import { escapeHtml as esc } from '../ui.js';
import { isAllowedImageType } from '../backup-validate.js';
import { shownDocIds } from '../doc-sources.js';
import { docSelected, fieldIncluded } from '../template-check.js';

export { esc };
export const has = (v) => !(v == null || v === '' || v === false || (Array.isArray(v) && !v.length));
export const incSection = (t, id) => !t || t.include?.sections === undefined || t.include.sections[id] !== false;
export const incItem = (t, id) => !t || t.include?.items?.[id] !== false;
/**
 * ¿La plantilla incluye este campo? UNA sola regla (template-check.js, fieldIncluded): la bandera propia manda y, sin ella, un campo con
 * `replaces` usa la del campo al que reemplaza. `f` = definición del campo (con `replaces`) o solo su id; con el id hace falta el esquema:
 * `incFieldIn(secById)` lo busca ahí. Sin esquema, un id suelto no sabe de `replaces`.
 */
export const incFieldIn = (secById) => (t, sec, f) => fieldIncluded(t, sec, typeof f === 'string' ? secById?.[sec]?.fields.find((x) => x.id === f) || { id: f } : f);
export const incField = incFieldIn(null);
export const getFile = (files, id) => (files instanceof Map ? files.get(id) : files?.[id]);
export const isImg = (f) => isAllowedImageType(f?.meta?.type) && !!f.dataUrl;
export const num = (v) => String(+v.toFixed(2));
export const multi = (s) => esc(s).replace(/\r?\n/g, '<br>');

export function fmtDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v || '';
}
/** 'AAAA-MM-DD' -> ['DD', 'MM', 'AAAA'] (vacíos si no es fecha). */
export const ymd = (v) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || ''); return m ? [m[3], m[2], m[1]] : ['', '', '']; };

/** Valor legible de un campo (etiqueta de la opción, fecha DD/MM/AAAA, listas unidas). */
export function show(field, v) {
  if (field.type === 'checkbox') return v ? 'Sí' : '';
  if (!has(v)) return '';
  if (field.type === 'multiselect') return (Array.isArray(v) ? v : []).join(', ');
  if (field.type === 'date') return fmtDate(v);
  if (field.type === 'select') return (field.options || []).find((o) => o.value === v)?.label ?? v;
  return v;
}

export const visibleFields = (sec, t) => sec.fields.filter((f) => f.type !== 'photo' && incField(t, sec.id, f));
export const itemsOf = (profile, id, t) => (Array.isArray(profile?.[id]) ? profile[id] : []).filter((it) => it && typeof it === 'object' && incItem(t, it.id));

/**
 * Más reciente primero: el trabajo marcado como actual va SIEMPRE arriba; luego los que no tienen fecha de retiro (perfiles anteriores a la
 * casilla «actual», donde eso significaba vigente) y después los terminados, del retiro más reciente al más antiguo; a igualdad, el ingreso más reciente.
 */
export function experienceOrder(a, b) {
  const rank = (x) => (x.actual === true ? 2 : x.fechaFin ? 0 : 1);
  const end = (x) => x.fechaFin || '9999-99-99';
  return rank(b) - rank(a) || end(b).localeCompare(end(a)) || (b.fechaInicio || '').localeCompare(a.fechaInicio || '');
}

/** ¿El registro tiene algún dato? Un registro vacío (se pulsó «Agregar» y no se escribió nada) no ocupa un bloque del formato ni se lee. */
export const filled = (sec) => (it) => !!it && sec.fields.some((f) => f.type !== 'photo' && has(it[f.id]));

/** Tamaño de letra que hace caber el texto (heurística determinista: ancho medio de glifo 0.5 em). Igual que minerva.js. */
export function fitSize(text, w, h, { max = 9, min = 5, lh = 1.2, lines = 1, lhPt = 0 } = {}) {
  const s = String(text);
  for (let sz = max; sz >= min; sz -= 0.5) {
    const cpl = Math.max(1, Math.floor((w - 4) / (sz * 0.5)));
    const need = lines === 1 ? (s.length <= cpl ? 1 : 2) : s.split(/\r?\n/).reduce((n, p) => n + Math.max(1, Math.ceil(p.length / cpl)), 0);
    if (need * (lhPt || sz * lh) <= h + 0.5 && (lines !== 1 || need === 1)) return sz;
  }
  return min;
}

/** Certificados incluidos: [{title, id, file}]. `order` = { secId: comparador } para ordenar los registros. */
export function certList(sections, profile, t, files, off = new Set(), order = {}) {
  const out = [];
  const push = (title, id) => { const file = getFile(files, id); if (file) out.push({ title, id, file }); };
  for (const sec of sections) {
    if (!incSection(t, sec.id) || off.has(sec.id)) continue;
    if (sec.repeatable) {
      if (!sec.certificate) continue;
      const list = itemsOf(profile, sec.id, t);
      if (order[sec.id]) list.sort(order[sec.id]);
      for (const it of list) {
        const name = sec.fields.map((f) => it[f.id]).find((v) => typeof v === 'string' && v) || '';
        push(`${sec.title}${name ? ': ' + name : ''}`, `cert:${it.id}`);
      }
    } else {
      for (const f of sec.fields) if (f.certificate && incField(t, sec.id, f) && !off.has(`${sec.id}.${f.id}`)) push(`${sec.title}: ${f.label}`, `cert:${sec.id}:${f.id}`);
      if (sec.certificate) push(sec.title, `cert:${sec.id}`);
    }
  }
  return out;
}

/** Documentos que la plantilla anexa (misma regla que minerva.js, G27): cédula primero. */
export function docList(documents, profile, t, files) {
  const shown = new Set(shownDocIds(profile, documents.map((x) => x.id)));
  const docs = documents.filter((d) => docSelected(t, d.id, shown));
  docs.sort((a, b) => (b.id === 'cedula') - (a.id === 'cedula'));
  const out = [];
  for (const d of docs) {
    const ids = Array.isArray(profile?.documents?.[d.id]) ? profile.documents[d.id] : [];
    ids.forEach((id, i) => { const file = getFile(files, id); if (file) out.push({ title: ids.length > 1 ? `${d.label} (${i + 1}/${ids.length})` : d.label, id, file }); });
  }
  return out;
}

/**
 * ¿Qué anexos lleva la vista? Con plantilla, sus opciones (attachCertificates / attachDocuments); sin plantilla, certificados Y documentos
 * (los mostrados en Documentos que tengan archivo, cédula primero). `ov` = { certificates?, documents? }: lo que la persona activó o
 * desactivó en la Vista previa para esta vista (manda sobre lo anterior; no se guarda en la plantilla).
 */
export function annexFlags(t, ov = {}) {
  const o = t?.options || {};
  return {
    certificates: typeof ov?.certificates === 'boolean' ? ov.certificates : !t || !!o.attachCertificates,
    documents: typeof ov?.documents === 'boolean' ? ov.documents : !t || !!o.attachDocuments,
  };
}

export function annexes(schema, P, t, files, off, order, ov) {
  const on = annexFlags(t, ov), a = [];
  if (on.certificates) a.push(...certList(schema.sections, P, t, files, off, order));
  if (on.documents) a.push(...docList(schema.documents, P, t, files));
  return a;
}

const isPdf = (f) => f?.meta?.type === 'application/pdf';
/** Páginas de un PDF anexo ya convertidas a imagen para imprimir (export.js, loadFiles): [dataUrl] o null. */
const pdfPages = (f) => {
  const ok = isPdf(f) && Array.isArray(f.pages) ? f.pages.filter((u) => typeof u === 'string' && /^data:image\/(jpeg|png);/.test(u)) : [];
  return ok.length ? ok : null; // solo data URL de imagen JPEG/PNG llegan a un src
};
/** Por qué un anexo no sale en la impresión (o '' si sale). */
function looseReason(f) {
  if (isPdf(f)) return f.pdfError || 'el PDF todavía se está preparando o no se pudo convertir';
  return 'tipo de archivo que no se puede imprimir';
}

/**
 * Resumen de los anexos que salen al imprimir: { items, pages, images, pdfs, pdfPages, loose:[{title, reason, retry?}], truncated:[{title, shown, total, reason?}] }.
 * `retry` = un PDF que no se convirtió (se puede volver a intentar); `reason` de `truncated` = qué tope cortó las páginas.
 * `items` = archivos anexados que salen (al menos una página); `pages` = páginas de anexo impresas (sin la hoja de avisos).
 * Conserva `images` y `others` (PDF y demás que NO salen) por compatibilidad.
 */
export function annexSummary(list) {
  const out = { items: 0, pages: 0, images: 0, pdfs: 0, pdfPages: 0, loose: [], truncated: [], others: 0 };
  for (const a of list) {
    const pp = pdfPages(a.file);
    if (isImg(a.file)) { out.items++; out.pages++; out.images++; }
    else if (pp) {
      out.items++; out.pdfs++; out.pages += pp.length; out.pdfPages += pp.length;
      if (a.file.pageTotal > pp.length) out.truncated.push({ title: a.title, shown: pp.length, total: a.file.pageTotal, ...(a.file.truncReason ? { reason: a.file.truncReason } : {}) });
    } else { out.loose.push({ title: a.title, reason: looseReason(a.file), ...(isPdf(a.file) ? { retry: true } : {}) }); out.others++; }
  }
  return out;
}

/**
 * Anexos como páginas (imágenes y páginas de PDF convertidas a imagen) y, al final, una hoja que lista lo que NO se pudo incluir y por qué.
 * Mismo HTML para los dos modelos. Las hojas .hv-annex no entran en el paquete PDF (lo arma pdf-package.js desde los archivos originales).
 */
export function annexHtml(list) {
  let html = '';
  const loose = [];
  // Cada anexo es SU PROPIA página .hv-page con su relleno (zona segura de 0,5 in): no depende de que el navegador lo repita al partir un bloque.
  // El título se limita a 2 líneas y la imagen ocupa lo que queda (css de impresión en export.js: printCss).
  const page = (title, src, alt, note = '') => `<div class="hv-page hv-annex" data-annex="img"><h2 title="${esc(title)}">Anexo · ${esc(title)}</h2><div class="hv-fit"><img src="${esc(src)}" alt="${esc(alt)}"></div>${note}</div>`;
  for (const a of list) {
    const pp = pdfPages(a.file);
    if (isImg(a.file)) html += page(a.title, a.file.dataUrl, a.title);
    else if (pp) {
      const total = Math.max(pp.length, a.file.pageTotal || 0);
      pp.forEach((src, i) => {
        const label = pp.length > 1 || total > 1 ? `${a.title} (pág. ${i + 1} de ${total})` : a.title;
        const why = a.file.truncReason ? ` (${esc(a.file.truncReason)})` : '';
        const note = i === pp.length - 1 && total > pp.length ? `<p class="hv-annex__note">Se incluyen las primeras ${pp.length} de ${total} páginas${why}. El documento completo va en «Descargar paquete PDF».</p>` : '';
        html += page(label, src, label, note);
      });
    } else loose.push(a);
  }
  if (loose.length) {
    // La lista puede ser larga: se reparte en páginas propias (cada una con su relleno), con un tope de alto estimado por página.
    const intro = 'Los siguientes archivos no se pudieron incluir. Para tenerlos junto con la HV use «Descargar paquete PDF» en Vista previa; si imprime, adjúntelos por separado:';
    const items = loose.map((a) => {
      const text = `${a.title} — ${a.file?.meta?.name || a.id}: ${looseReason(a.file)}`;
      return { h: 22 + 13 * Math.ceil(text.length / 75), html: `<li>${esc(a.title)} <span class="hv-l">— ${esc(a.file?.meta?.name || a.id)}: ${esc(looseReason(a.file))}</span></li>` };
    });
    const chunks = [[]];
    let used = 90; // título + párrafo
    for (const it of items) {
      if (used + it.h > LIST_PAGE_PT && chunks.at(-1).length) { chunks.push([]); used = 40; }
      chunks.at(-1).push(it); used += it.h;
    }
    chunks.forEach((c, i) => {
      html += `<div class="hv-page hv-annex"><h2>Anexos que no salen en esta impresión${i ? ' (continuación)' : ''}</h2>${i ? '' : `<p>${intro}</p>`}<ul>${c.map((x) => x.html).join('')}</ul></div>`;
    });
  }
  return html;
}
const LIST_PAGE_PT = 640; // alto útil conservador de una página (Carta: 720 pt) para la lista de anexos que no salen

// G08: lectura lineal accesible (las hojas van aria-hidden). Oculta con estilos en línea; print.css y export.js la quitan al imprimir.
export const SR_STYLE = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap';
export const dl = (fs, rec) => {
  const rows = fs.map((f) => [f, show(f, rec?.[f.id])]).filter(([, v]) => has(v));
  return rows.length ? `<dl>${rows.map(([f, v]) => `<dt>${esc(f.label)}</dt><dd>${esc(String(v))}</dd>`).join('')}</dl>` : '';
};
/**
 * Bloque .hv-sr: un grupo por sección (o por registro). `spill` = registros que van a la hoja de continuación (ahí son tablas reales).
 * `custom(sec)` -> HTML de un grupo propio (o null para el comportamiento normal); `order` = comparadores por sección repetible.
 */
export function a11yBlock(sections, P, t, { spill = new Set(), custom = () => null, order = {} } = {}) {
  const groups = [];
  for (const sec of sections) {
    if (!incSection(t, sec.id)) continue;
    const own = custom(sec);
    if (own != null) { if (own) groups.push(own); continue; }
    const fs = visibleFields(sec, t);
    if (sec.repeatable) {
      const list = itemsOf(P, sec.id, t).filter(filled(sec));
      if (order[sec.id]) list.sort(order[sec.id]);
      list.filter((it) => !spill.has(it)).forEach((it, n, all) => {
        const d = dl(fs, it);
        if (d) groups.push(`<div role="group" aria-label="${esc(sec.title)}${all.length > 1 ? `, registro ${n + 1} de ${all.length}` : ''}">${d}</div>`);
      });
    } else {
      const d = dl(fs, P?.[sec.id]);
      if (d) groups.push(`<div role="group" aria-label="${esc(sec.title)}">${d}</div>`);
    }
  }
  if (!groups.length) return '';
  return `<div class="hv-sr" role="group" aria-label="Contenido de la hoja de vida en lectura lineal" style="${SR_STYLE}">${groups.join('')}</div>`;
}

// Reparto de la continuación en páginas. El alto es una ESTIMA por filas (ancho medio de glifo 0,56 em, columnas iguales: pesimista para el
// texto largo) con un tope conservador por página: el reparto no conoce el papel y Carta (720 pt útiles) es la menor. Cada fragmento es su propio
// .hv-page, así que su relleno no depende de que el navegador lo repita (box-decoration-break). Si la estima se queda corta, el navegador parte
// la página y el CSS de impresión (printCss) aún repite el relleno donde puede (Chromium/Firefox).
const CONT_PAGE_PT = 690, CONT_W = 540, CONT_SAFETY = 1.08;
const textLines = (s, widthPt, sizePt) => String(s).split(/\r?\n/).reduce((n, p) => n + Math.max(1, Math.ceil((p.length * sizePt * 0.56) / Math.max(24, widthPt))), 0);

/**
 * Hoja(s) de continuación (registros que no caben en el formato): tablas reales, mismas clases que minerva.js. Parte en páginas, en límites de
 * fila (o de ficha), repitiendo el título de la sección y el encabezado de la tabla en cada una. `pagePt` solo existe para las pruebas.
 */
export function continuation(secById, overflow, t, { title, note, pagePt = CONT_PAGE_PT }) {
  if (!overflow.length) return '';
  const pages = [{ html: '', used: 56 + textLines(note, CONT_W, 8) * 10.4 + 10, has: false }]; // título + párrafo de la primera
  for (const { sec, list } of overflow) {
    const s = secById[sec], fs = visibleFields(s, t);
    if (!fs.length) continue;
    const card = fs.length > 7, colW = CONT_W / fs.length;
    const head = `<section class="mv-cs"><h2>${esc(s.title)} (continuación)</h2>`;
    const thead = card ? '' : `<thead><tr>${fs.map((f) => `<th>${esc(f.label)}</th>`).join('')}</tr></thead>`;
    const fixed = 26 + 12 + (card ? 0 : Math.max(...fs.map((f) => textLines(f.label, colW - 9, 6.5))) * 8.45 + 8);
    const rows = list.map((it) => {
      if (card) {
        const shown = fs.filter((f) => has(it[f.id]));
        const h = shown.reduce((n, f) => n + Math.max(textLines(f.label, CONT_W * 0.34 - 9, 7) * 9.1, textLines(show(f, it[f.id]), CONT_W * 0.66 - 9, 8) * 10.4) + 7.6, 0) + 8;
        return { h: h * CONT_SAFETY, html: `<table class="hv-tbl hv-card"><tbody>${shown.map((f) => `<tr><th>${esc(f.label)}</th><td>${multi(show(f, it[f.id]))}</td></tr>`).join('')}</tbody></table>` };
      }
      const h = Math.max(...fs.map((f) => textLines(show(f, it[f.id]), colW - 9, 8))) * 10.4 + 7.6;
      return { h: h * CONT_SAFETY, html: `<tr>${fs.map((f) => `<td>${multi(show(f, it[f.id]))}</td>`).join('')}</tr>` };
    });
    const wrap = (items) => card ? `${head}${items.map((r) => r.html).join('')}</section>` : `${head}<table class="hv-tbl">${thead}<tbody>${items.map((r) => r.html).join('')}</tbody></table></section>`;
    let buf = [], used = fixed;
    const flush = () => { if (!buf.length) return; const cur = pages.at(-1); cur.html += wrap(buf); cur.used += used; cur.has = true; buf = []; used = fixed; };
    for (const r of rows) {
      const cur = pages.at(-1);
      if (cur.used + used + r.h > pagePt && (buf.length || cur.has)) { flush(); pages.push({ html: '', used: 0, has: false }); }
      buf.push(r); used += r.h;
    }
    flush();
  }
  const out = pages.filter((p) => p.html);
  return out.map((p, i) => `<div class="hv-page hv-cont">${i ? '' : `<h1>${title}</h1><p>${esc(note)}</p>`}${p.html}</div>`).join('');
}

/**
 * Escritor de valores sobre una hoja del layout. Devuelve { html, marks, text, digits, mark, rect }.
 *   text(key, v, {align:'center'|'left', size})  una línea en la caja (letra que cabe, de 9 a 5 pt)
 *   digits(key, v, n)                            un carácter por celda (cajas DÍA/MES/AÑO con separadores)
 *   mark(key, on)                                X dentro de la caja (casilla o círculo)
 */
export function sheetWriter(page) {
  const html = [], marks = [];
  const rect = (key) => page.w[key];
  const text = (key, v, opts = {}) => {
    const r = rect(key);
    if (!r || !has(v)) return;
    const s = String(v);
    const sz = opts.size || fitSize(s, r[2], r[3], { lines: 1 });
    const al = opts.align === 'center' ? ';justify-content:center;text-align:center' : '';
    html.push(`<div class="mv-f" style="left:${r[0]}pt;top:${r[1]}pt;width:${r[2]}pt;height:${r[3]}pt;font-size:${sz}pt${al}">${esc(s)}</div>`);
  };
  const digits = (key, v, n) => {
    const r = rect(key);
    if (!r || !has(v)) return;
    const s = String(v).slice(0, n), w = r[2] / n;
    [...s].forEach((ch, i) => html.push(`<div class="mv-f" style="left:${num(r[0] + i * w)}pt;top:${r[1]}pt;width:${num(w)}pt;height:${r[3]}pt;font-size:8pt;padding:0;justify-content:center">${esc(ch)}</div>`));
  };
  const mark = (key, on = true) => {
    const r = rect(key);
    if (!r || !on) return;
    const side = Math.min(r[2], r[3], 11), x = r[0] + (r[2] - side) / 2, y = r[1] + (r[3] - side) / 2, d = 2;
    marks.push(`<path d="M${num(x + d)} ${num(y + d)}L${num(x + side - d)} ${num(y + side - d)}M${num(x + side - d)} ${num(y + d)}L${num(x + d)} ${num(y + side - d)}"/>`);
  };
  return { html, marks, text, digits, mark, rect };
}

/** HTML de una hoja: fondo SVG generado (de confianza) + valores + marcas. */
export function sheetHtml(layout, pageIndex, w, attrs = '') {
  const W = layout.width, H = layout.height;
  return `<div class="hv-sheet" aria-hidden="true"><div class="mv-page" data-page="${pageIndex + 1}"${attrs}>`
    + `<svg class="mv-bg" viewBox="0 0 ${W} ${H}" width="${W}pt" height="${H}pt" aria-hidden="true" focusable="false">${layout.pages[pageIndex].svg}</svg>`
    + `${w.html.join('')}<svg class="mv-ov" viewBox="0 0 ${W} ${H}" width="${W}pt" height="${H}pt" aria-hidden="true" focusable="false">${w.marks.join('')}</svg></div></div>`;
}

// Lectura heurística de certificados (texto ya extraído) y cálculo de vigencia. Funciones puras: sin DOM ni red.
// Los patrones salen de los textos reales descritos en docs/FUENTES-OFICIALES.md; cualquier resultado es una PISTA
// que el usuario debe poder corregir (la fecha detectada con `fechaConfianza:'baja'` es solo el primer dato con forma de fecha).
import { SOURCES, POR_VENCER_DIAS } from './doc-sources.js';

const MONTHS = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const pad = (n) => String(n).padStart(2, '0');
const noAccent = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Normaliza el texto extraído: espacios y saltos a un solo espacio, sin NBSP ni caracteres de control. */
/** Páginas a leer de un PDF de `numPages` (G19): las primeras `head` y las últimas `tail` (la fecha de expedición o el código de verificación
 *  suelen ir al pie de la última página). Si caben todas, todas. Números de página 1-based, ascendentes y sin repetir. */
export function pickPages(numPages, head = 4, tail = 2) {
  const n = Math.max(0, Math.floor(Number(numPages) || 0)), h = Math.max(0, Math.floor(head)), t = Math.max(0, Math.floor(tail));
  if (n <= h + t) return Array.from({ length: n }, (_, i) => i + 1);
  const out = [];
  for (let i = 1; i <= h; i++) out.push(i);
  for (let i = n - t + 1; i <= n; i++) out.push(i);
  return out;
}
/** Tope de caracteres por página para que un PDF enorme no haga lento el análisis: reparte `budget` entre las páginas leídas (mínimo `floor` c/u). */
export const pageCharCap = (count, budget = 120000, floor = 4000) => Math.max(floor, Math.floor(budget / Math.max(1, count)));

export function normalizeText(s = '') {
  return String(s).replace(/[\u00a0\u2007\u202f\u200b]/g, ' ').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
}

function isoOrNull(y, m, d) {
  y = +y; m = +m; d = +d;
  if (!(y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

// Fecha escrita: "25 de marzo del 2026" | "25/03/2026" | "25-03-2026" | "2026-03-25"
const DATE_SRC = '(?:\\d{1,2}\\s+de\\s+[a-záéíóúA-ZÁÉÍÓÚ]+\\s+(?:de(?:l)?\\s+)?\\d{4}|\\d{1,2}[/\\-.]\\d{1,2}[/\\-.]\\d{4}|\\d{4}-\\d{2}-\\d{2})';

/** Primera fecha que aparezca en `s` (ISO AAAA-MM-DD) o null. */
export function parseDate(s = '') {
  const t = noAccent(String(s).toLowerCase());
  let m = /(\d{1,2})\s+de\s+([a-z]+)\s+(?:de(?:l)?\s+)?(\d{4})/.exec(t);
  if (m && MONTHS[m[2]]) { const r = isoOrNull(m[3], MONTHS[m[2]], m[1]); if (r) return r; }
  m = /(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/.exec(t);
  if (m) { const r = isoOrNull(m[3], m[2], m[1]); if (r) return r; }
  m = /(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return isoOrNull(m[1], m[2], m[3]);
  return null;
}

/** Todas las fechas con su posición: [{iso, index}]. */
export function findDates(text = '') {
  const out = [];
  const re = new RegExp(DATE_SRC, 'gi');
  let m;
  while ((m = re.exec(text))) { const iso = parseDate(m[0]); if (iso) out.push({ iso, index: m.index }); }
  return out;
}

// Fecha que sigue a una etiqueta, dentro de `span` caracteres.
function dateAfter(text, labelRe, span = 60) {
  const re = new RegExp(labelRe.source, labelRe.flags.includes('g') ? labelRe.flags : labelRe.flags + 'g');
  let m;
  while ((m = re.exec(text))) {
    const chunk = text.slice(m.index + m[0].length, m.index + m[0].length + span);
    const iso = parseDate(chunk);
    if (iso) return iso;
  }
  return null;
}

const LABELS_ISSUE = /(?:fecha\s+de\s+(?:expedici[oó]n|generaci[oó]n|emisi[oó]n|consulta)|expedid[oa](?:\s+el)?|generad[oa](?:\s+el)?|emitid[oa](?:\s+el)?)\s*[:\-]?/i;
const PER_KIND_ISSUE = {
  policia: [/horas\s+del\s+(?=\d)/i, /siendo\s+las\s+[\d:]+\s*(?:[ap]\.?\s?m\.?)?\s*horas\s+del\s+/i],
  rnmc: [/que\s+a\s+la\s+fecha,?\s*/i, /(?=\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2})/i],
  procuraduria: [/bogot[aá],?\s*(?:d\.?\s?c\.?,?)?\s*/i],
  contraloria: [/\bhoy\b[^0-9]{0,40}?(?=\d{1,2}\s+de\s)/i, /\bhoy\b\s*,?\s*/i],
  redam: [LABELS_ISSUE],
};

const first = (text, re, group = 1) => { const m = re.exec(text); return m ? m[group] : null; };

/** Fecha de expedición/generación. -> { iso, confianza:'alta'|'baja' } | null.  `exclude` = fechas ya usadas (p. ej. "válida hasta"). */
export function extractIssueDate(text, docId, exclude = []) {
  for (const re of PER_KIND_ISSUE[docId] || []) {
    const iso = dateAfter(text, re, 40);
    if (iso && !exclude.includes(iso)) return { iso, confianza: 'alta' };
  }
  const gen = dateAfter(text, LABELS_ISSUE, 40);
  if (gen && !exclude.includes(gen)) return { iso: gen, confianza: 'alta' };
  const any = findDates(text).find((d) => !exclude.includes(d.iso));
  return any ? { iso: any.iso, confianza: 'baja' } : null;
}

/** "Válida hasta: dd/mm/aaaa" (también "válido hasta", "vigente hasta"). */
export function extractValidUntil(text) {
  return dateAfter(text, /v[aá]lid[oa]\s+hasta\s*[:\-]?\s*/i, 30) || dateAfter(text, /vigente\s+hasta\s*[:\-]?\s*/i, 30);
}

const CODE_TOKEN = '([A-Za-z0-9\\-]{0,24}\\d[A-Za-z0-9\\-]{0,24})';
const CODE_RES = [
  new RegExp('c[oó]digo\\s+de\\s+verificaci[oó]n\\s*[:\\-]?\\s*' + CODE_TOKEN, 'i'),
  new RegExp('c[oó]digo\\s+verificaci[oó]n\\s*[:\\-]?\\s*' + CODE_TOKEN, 'i'),
  new RegExp('certificado\\s+(?:ordinario|especial)?\\s*no\\.?\\s*' + CODE_TOKEN, 'i'),
  new RegExp('registro\\s+interno\\s+de\\s+validaci[oó]n\\s+no\\.?\\s*' + CODE_TOKEN, 'i'),
  new RegExp('n[uú]mero\\s+de\\s+certificado\\s*[:\\-]?\\s*' + CODE_TOKEN, 'i'),
];
/** Código de verificación o número de certificado, o null. */
export function extractCode(text) {
  for (const re of CODE_RES) { const c = first(text, re); if (c && c.length >= 3) return c; }
  return null;
}

/** Estado: 'sin_registros' | 'registra' | null, con el fragmento hallado. */
export function extractState(text) {
  const re = /(\bno\s+)?(registra(?![a-zñ])(?:\s+(?:sanciones|antecedentes|inhabilidades|medidas))?|tiene\s+(?:asuntos|medidas(?:\s+correctivas)?)\s+pendientes|se\s+encuentra\s+(?:reportad[oa]|registrad[oa]|inscrit[oa]))/gi;
  let m, clean = null, dirty = null;
  while ((m = re.exec(text))) {
    const frag = text.slice(m.index, m.index + m[0].length + 40).trim();
    if (m[1]) clean ||= frag; else dirty ||= frag;
  }
  if (dirty) return { estado: 'registra', texto: dirty };
  if (clean) return { estado: 'sin_registros', texto: clean };
  return { estado: null, texto: '' };
}

/** Solo dígitos. */
export const normCedula = (s) => String(s ?? '').replace(/\D/g, '');

/** Números de identificación hallados junto a palabras como "cédula", "C.C.", "identificación" (solo dígitos, sin duplicados, máx. 4). */
export function extractCedulas(text) {
  const re = /(?:c[eé]dula(?:\s+de\s+(?:ciudadan[ií]a|extranjer[ií]a))?|\bc\.?\s?[ce]\.?|identificaci[oó]n|documento(?:\s+de\s+identidad)?|nuip|nit)[^0-9]{0,40}?(\d{1,3}(?:[.\s]\d{3}){1,3}|\d{6,11})(?!\d)/gi;
  const out = [];
  let m;
  while ((m = re.exec(text))) {
    const n = normCedula(m[1]);
    if (n.length >= 6 && n.length <= 11 && !out.includes(n)) out.push(n);
    if (out.length >= 4) break;
  }
  return out;
}

/** true = coincide, false = el PDF trae otro número, null = no se puede saber. */
export function cedulaMatch(leidas, profileCedula) {
  const c = normCedula(profileCedula);
  if (!c || !Array.isArray(leidas) || !leidas.length) return null;
  return leidas.includes(c);
}

/** Texto del PDF -> parches para meta del archivo. `now` solo para pruebas. */
export function analyzeText(rawText, docId, profileCedula = '') {
  const text = normalizeText(rawText);
  if (text.replace(/\s/g, '').length < 20) return { lectura: 'fallo', motivo: 'sin_texto' };
  const validaHasta = extractValidUntil(text);
  const issue = extractIssueDate(text, docId, validaHasta ? [validaHasta] : []);
  const st = extractState(text);
  const cedulasLeidas = extractCedulas(text);
  const out = {
    lectura: issue || validaHasta ? 'auto' : 'fallo',
    emitidoEn: issue?.iso || null,
    fechaConfianza: issue?.confianza || null,
    validaHasta: validaHasta || null,
    codigo: extractCode(text),
    estado: st.estado,
    estadoTexto: st.texto || null,
    cedulasLeidas,
  };
  if (out.lectura === 'fallo') out.motivo = 'sin_fecha';
  return out;
}

// ---------- Fechas y vigencia ----------
const DAY = 86400000;
const utcMs = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const todayMs = (now = new Date()) => Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (iso, n) => isoOf(utcMs(iso) + n * DAY);
export const fmtDMY = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
export const fmtLong = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${+m[3]} de ${MESES[+m[2] - 1]} de ${m[1]}` : ''; };

export const STATE_LABEL = { vigente: 'Vigente', por_vencer: 'Vence pronto', vencido: 'Vencido', sin_vigencia: 'Sin vigencia oficial', no_leido: 'No se pudo leer' };

/** Máximo de días válido (entero 1 a 365) o null. */
export const validMaxAge = (v) => (Number.isFinite(Number(v)) && v !== '' && v !== null && Math.floor(Number(v)) >= 1 && Math.floor(Number(v)) <= 365 ? Math.floor(Number(v)) : null);

/** Vigencia de un archivo.
 *  opts.maxAgeDays: antigüedad máxima que exige una plantilla (G20), desde la expedición. En documentos con regla "práctica"
 *  (judiciales, RNMC) sustituye la regla del registro y la del archivo; en los de regla "oficial" (disciplinarios, fiscales, REDAM)
 *  es un límite adicional: nunca alarga la vigencia oficial ni la fecha "válida hasta" impresa. Sin fecha de expedición no aplica.
 *  Los documentos sin vigencia en el registro (cédula, RUT...) no se evalúan.
 *  -> { state, daysLeft, expiresAt, issuedAt, dias, porPlantilla, label, detail } */
export function computeVigencia(source, meta, now = new Date(), opts = {}) {
  const rule = source?.vigencia;
  if (!rule || rule.tipo === 'ninguna') return { state: 'sin_vigencia', label: STATE_LABEL.sin_vigencia, detail: rule?.fuente || '' };
  const m = meta || {};
  const dias = Number(m.vigenciaDias) > 0 ? Math.floor(Number(m.vigenciaDias)) : rule.dias;
  const issuedAt = /^\d{4}-\d{2}-\d{2}$/.test(m.emitidoEn || '') ? m.emitidoEn : null;
  const validaHasta = /^\d{4}-\d{2}-\d{2}$/.test(m.validaHasta || '') ? m.validaHasta : null;
  let expiresAt = validaHasta || (issuedAt ? addDays(issuedAt, dias) : null);
  const maxAge = validMaxAge(opts?.maxAgeDays);
  let porPlantilla = false;
  if (maxAge && issuedAt) {
    const cap = addDays(issuedAt, maxAge);
    const next = rule.tipo === 'practica' ? (validaHasta && validaHasta < cap ? validaHasta : cap) : (expiresAt && expiresAt < cap ? expiresAt : cap);
    porPlantilla = next === cap;
    expiresAt = next;
  }
  if (!expiresAt) return { state: 'no_leido', label: STATE_LABEL.no_leido, detail: 'Escribe la fecha de expedición.', dias };
  const daysLeft = Math.round((utcMs(expiresAt) - todayMs(now)) / DAY);
  const base = { daysLeft, expiresAt, issuedAt, dias: porPlantilla ? maxAge : dias, porPlantilla };
  const why = porPlantilla ? ` Límite de ${maxAge} días desde la expedición, según la plantilla.` : '';
  if (daysLeft < 0) return { ...base, state: 'vencido', label: STATE_LABEL.vencido, detail: `Venció el ${fmtDMY(expiresAt)} (hace ${-daysLeft} ${-daysLeft === 1 ? 'día' : 'días'}).${why}` };
  if (daysLeft <= POR_VENCER_DIAS) {
    const label = daysLeft === 0 ? 'Vence hoy' : `Vence en ${daysLeft} ${daysLeft === 1 ? 'día' : 'días'}`;
    return { ...base, state: 'por_vencer', label, detail: `Vence el ${fmtDMY(expiresAt)}.${why}` };
  }
  return { ...base, state: 'vigente', label: STATE_LABEL.vigente, detail: `Vence el ${fmtDMY(expiresAt)} (en ${daysLeft} días).${why}` };
}

const RANK = { vencido: 4, por_vencer: 3, vigente: 1 };
/** Estado de un documento con varios archivos: el más urgente entre los que tienen fecha. */
export function docVigencia(source, fileIds, metaById, now = new Date(), opts = {}) {
  const per = (fileIds || []).filter((id) => metaById?.[id]).map((id) => ({ id, v: computeVigencia(source, metaById[id], now, opts) }));
  if (!per.length) return null;
  const dated = per.filter((p) => RANK[p.v.state]);
  if (dated.length) return dated.sort((a, b) => RANK[b.v.state] - RANK[a.v.state] || a.v.daysLeft - b.v.daysLeft)[0].v;
  return per[0].v;
}

/** Resumen para banners/avisos. docs = [{id,label}] ya filtrados (mostrados e incluidos).
 *  -> { vencidos:[{id,label,v}], porVencer:[...], noLeidos:[...], conArchivo } */
export function summarizeVigencia(docs, profile, metaById, now = new Date(), opts = {}) {
  const out = { vencidos: [], porVencer: [], noLeidos: [], conArchivo: 0 };
  for (const d of docs) {
    const ids = profile?.documents?.[d.id] || [];
    const v = docVigencia(SOURCES[d.id], ids, metaById, now, opts);
    if (!v) continue;
    out.conArchivo++;
    if (v.state === 'vencido') out.vencidos.push({ id: d.id, label: d.label, v });
    else if (v.state === 'por_vencer') out.porVencer.push({ id: d.id, label: d.label, v });
    else if (v.state === 'no_leido') out.noLeidos.push({ id: d.id, label: d.label, v });
  }
  return out;
}

/** Frase de aviso por documento (plantillas / vista previa). */
export const vigenciaWarning = (label, v) => `${label}: ${v.state === 'vencido' ? 'vencido' : v.label.toLowerCase()}. ${v.detail}`;

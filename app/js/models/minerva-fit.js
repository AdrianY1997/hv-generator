// Capacidad de las casillas del formulario Minerva para el texto del perfil (aviso «no cabe» en el formulario). Funciones puras.
// Reproduce la heurística de render() en minerva.js (ancho medio de glifo 0.5 em; fitSize / rows / block) pero al revés:
// en vez de elegir el tamaño de letra para un texto, calcula cuántos caracteres caben a la letra cómoda (9 pt) y a la mínima.
// La geometría sale de minerva-layout.js (generado, no se toca).
import layout from './minerva-layout.js';

const GLYPH = 0.5;          // ancho medio de un glifo, en em
const SLACK = 0.9;          // en varias líneas, el corte por palabras desperdicia ~10 %
const SZ_COMFORT = 9;       // tamaño normal de los campos del solicitante
const SZ_LINE_MIN = 5;      // fitSize(): una línea se reduce hasta 5 pt y desde ahí se recorta
const SZ_ROWS_MIN = 4.5;    // rows(): hasta 4.5 pt
const rect = (p, k) => layout.pages[p]?.w?.[k] || null;
const perLine = (w, sz) => Math.max(1, Math.floor((w - 4) / (sz * GLYPH)));

/** Una línea dentro de una casilla. */
function lineCap(w) { return { comfort: perLine(w, SZ_COMFORT), max: perLine(w, SZ_LINE_MIN) }; }

/** Texto repartido en filas rotuladas (rows() de render): cada fila admite 1 línea a 9 pt o varias a tamaño menor. */
function rowsCap(rs) {
  const w = rs[0][2] - 4, at = (sz) => Math.max(1, Math.floor(14 / (sz * 1.15))) * rs.length * Math.floor(w / (sz * GLYPH)) * SLACK;
  return { comfort: Math.floor(at(SZ_COMFORT)), max: Math.floor(at(SZ_ROWS_MIN)) };
}

/** Bloque de varias líneas sobre la unión de varias casillas (block() de render). */
function blockCap(rs, lh) {
  const x0 = Math.min(...rs.map((r) => r[0])), x1 = Math.max(...rs.map((r) => r[0] + r[2]));
  const y0 = Math.min(...rs.map((r) => r[1])), y1 = Math.max(...rs.map((r) => r[1] + r[3]));
  const at = (sz) => Math.max(1, Math.floor((y1 - y0 + 0.5) / (lh || sz * 1.2))) * perLine(x1 - x0, sz) * SLACK;
  return { comfort: Math.floor(at(SZ_COMFORT)), max: Math.floor(at(SZ_LINE_MIN)) };
}

/**
 * Capacidad en caracteres de un campo del perfil: { comfort, max, multi } o null si no se conoce su casilla.
 *   comfort: hasta aquí cabe a letra normal; entre comfort y max el formulario reduce la letra; por encima de max se recorta.
 * spec: { mode:'line', boxes:[[pagina, clave], ...] } | { mode:'rows', boxes:[[pagina, [claves]], ...] } | { mode:'block', boxes:[[pagina, [claves], interlineado?], ...] }
 * Con varias casillas posibles (p. ej. los 3 bloques de experiencia) manda la más pequeña.
 */
export function fitCapacity(spec) {
  if (!spec || !Array.isArray(spec.boxes)) return null;
  const caps = [];
  for (const [p, keys, lh] of spec.boxes) {
    if (spec.mode === 'line') { const r = rect(p, keys); if (r) caps.push(lineCap(r[2])); continue; }
    const rs = (Array.isArray(keys) ? keys : [keys]).map((k) => rect(p, k)).filter(Boolean);
    if (!rs.length) continue;
    caps.push(spec.mode === 'block' ? blockCap(rs, lh) : rowsCap(rs));
  }
  if (!caps.length) return null;
  return { comfort: Math.min(...caps.map((c) => c.comfort)), max: Math.min(...caps.map((c) => c.max)), multi: spec.mode !== 'line' };
}

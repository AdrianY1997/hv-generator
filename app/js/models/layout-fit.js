// Capacidad de las casillas de un formulario (cualquier modelo con layout generado) para el aviso «no cabe» del Perfil. Funciones puras.
// Misma heurística que js/models/minerva-fit.js (ancho medio de glifo 0.5 em, letra cómoda 9 pt, mínima 5 pt), pero con el layout como
// parámetro. minerva-fit.js no se toca: el modelo Minerva sigue con el suyo.
const GLYPH = 0.5, SLACK = 0.9, SZ_COMFORT = 9, SZ_MIN = 5;
const perLine = (w, sz) => Math.max(1, Math.floor((w - 4) / (sz * GLYPH)));

/**
 * fitCapacity(layout, spec) -> { comfort, max, multi } | null
 * spec: { mode:'line', boxes:[[pagina, clave], ...], reserve? } (una línea; con varias casillas manda la más pequeña;
 *       `reserve` = caracteres que el render agrega en la misma casilla, p. ej. ", 03/11/2026")
 *     | { mode:'block', boxes:[[pagina, [claves], interlineado?]] } (varias líneas sobre la unión de casillas)
 */
export function fitCapacity(layout, spec) {
  if (!spec || !Array.isArray(spec.boxes)) return null;
  const rect = (p, k) => layout?.pages?.[p]?.w?.[k] || null;
  const res = Math.max(0, spec.reserve || 0);
  const caps = [];
  for (const [p, keys, lh] of spec.boxes) {
    if (spec.mode === 'line') {
      const r = rect(p, keys);
      if (r) caps.push({ comfort: Math.max(1, perLine(r[2], SZ_COMFORT) - res), max: Math.max(1, perLine(r[2], SZ_MIN) - res) });
      continue;
    }
    const rs = (Array.isArray(keys) ? keys : [keys]).map((k) => rect(p, k)).filter(Boolean);
    if (!rs.length) continue;
    const x0 = Math.min(...rs.map((r) => r[0])), x1 = Math.max(...rs.map((r) => r[0] + r[2]));
    const y0 = Math.min(...rs.map((r) => r[1])), y1 = Math.max(...rs.map((r) => r[1] + r[3]));
    const at = (sz) => Math.max(1, Math.floor((y1 - y0 + 0.5) / (lh || sz * 1.2))) * perLine(x1 - x0, sz) * SLACK;
    caps.push({ comfort: Math.floor(at(SZ_COMFORT)), max: Math.floor(at(SZ_MIN)) });
  }
  if (!caps.length) return null;
  return { comfort: Math.min(...caps.map((c) => c.comfort)), max: Math.min(...caps.map((c) => c.max)), multi: spec.mode !== 'line' };
}

/** fitLimit(secId, fieldId) memoizado para un layout y un mapa 'seccion.campo' -> spec. */
export function createFitLimit(layout, map) {
  const cache = new Map();
  return (secId, fieldId) => {
    const key = `${secId}.${fieldId}`;
    if (!cache.has(key)) cache.set(key, fitCapacity(layout, map[key]));
    return cache.get(key);
  };
}

// Especificación de la foto (G13): formatos predefinidos, normalización de lo que declara el modelo
// (schema.photo = { aspect, width, height, maxKB }, todo opcional) y búsqueda de calidad JPEG para no pasar de un peso máximo.
// Puro (sin DOM): el editor le pasa la función que codifica.

export const DEFAULT_SPEC = Object.freeze({ aspect: '3:4', width: 600, height: 800, maxKB: null });

/** Formatos del editor. El de carnet es el predeterminado (el recuadro de la HV es 3:4 y recorta con object-fit: cover). */
export const PRESETS = Object.freeze([
  { id: 'carnet', label: 'Carnet 3x4 (600 × 800 px)', width: 600, height: 800 },
  { id: 'pasaporte', label: 'Pasaporte / visa 35x45 mm (700 × 900 px)', width: 700, height: 900 },
  { id: 'cuadrada', label: 'Cuadrada 1:1 (800 × 800 px)', width: 800, height: 800 },
]);

export const LIMITS = Object.freeze({ minPx: 100, maxPx: 4000, minKB: 20, maxKB: 5000 });

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const int = (v) => (Number.isFinite(Number(v)) && v !== '' && v !== null && v !== false ? Math.round(Number(v)) : NaN);
const clampPx = (n) => Math.min(LIMITS.maxPx, Math.max(LIMITS.minPx, n));

/** '3:4' -> [3, 4]; cualquier otra cosa -> null. */
export function parseAspect(a) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*[:/x]\s*(\d+(?:\.\d+)?)\s*$/i.exec(String(a ?? ''));
  return m && +m[1] > 0 && +m[2] > 0 ? [+m[1], +m[2]] : null;
}

/** Peso máximo válido en KB (LIMITS) o null (= sin límite). */
export function parseMaxKB(v) {
  const n = int(v);
  return Number.isFinite(n) && n >= LIMITS.minKB && n <= LIMITS.maxKB ? n : null;
}

/**
 * normalizeSpec(raw, fallback = DEFAULT_SPEC) -> { aspect:'w:h', width, height, maxKB }.
 * Acepta datos parciales: solo `aspect` (se calcula el tamaño con el ancho del fallback), solo ancho y alto (se deduce el aspecto)
 * o nada. Valores inválidos caen al fallback; las medidas se acotan a LIMITS.
 */
export function normalizeSpec(raw, fallback = DEFAULT_SPEC) {
  const fb = { ...DEFAULT_SPEC, ...fallback };
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  let w = int(r.width), h = int(r.height);
  const ar = parseAspect(r.aspect);
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) { w = clampPx(w); h = clampPx(h); }
  else if (ar && Number.isFinite(w) && w > 0) { w = clampPx(w); h = clampPx(Math.round(w * ar[1] / ar[0])); }
  else if (ar && Number.isFinite(h) && h > 0) { h = clampPx(h); w = clampPx(Math.round(h * ar[0] / ar[1])); }
  else if (ar) { w = clampPx(fb.width); h = clampPx(Math.round(w * ar[1] / ar[0])); }
  else { w = fb.width; h = fb.height; }
  const g = gcd(w, h);
  return { aspect: `${w / g}:${h / g}`, width: w, height: h, maxKB: r.maxKB === undefined ? parseMaxKB(fb.maxKB) : parseMaxKB(r.maxKB) };
}

/** Id del formato predefinido que coincide con las medidas, o 'custom'. */
export const presetIdOf = (spec) => PRESETS.find((p) => p.width === spec.width && p.height === spec.height)?.id || 'custom';

/**
 * Busca la calidad JPEG más alta (<= start) cuyo archivo no pase de `maxKB`; si ni a la calidad mínima cabe,
 * reduce las medidas (x0.85 por paso, sin bajar de `minSide` px en el lado menor).
 *   encode(width, height, quality) -> Promise<{ size:number, ... }|Blob>  (cualquier objeto con `size` en bytes)
 * -> { blob, quality, width, height, shrunk, ok }   ok = false si no se logró el peso.
 */
export async function fitToWeight(encode, width, height, maxKB, { start = 0.9, floor = 0.4, minSide = 240, iterations = 6 } = {}) {
  const cap = maxKB ? maxKB * 1024 : Infinity;
  let w = width, h = height, shrunk = false;
  for (;;) {
    let best = await encode(w, h, start);
    if (best.size <= cap) return { blob: best, quality: start, width: w, height: h, shrunk, ok: true };
    const low = await encode(w, h, floor);
    if (low.size <= cap) {
      let lo = floor, hi = start, bestQ = floor;
      best = low;
      for (let i = 0; i < iterations; i++) {
        const mid = (lo + hi) / 2, b = await encode(w, h, mid);
        if (b.size <= cap) { lo = mid; bestQ = mid; best = b; } else hi = mid;
      }
      return { blob: best, quality: Math.round(bestQ * 100) / 100, width: w, height: h, shrunk, ok: true };
    }
    const nw = Math.round(w * 0.85), nh = Math.round(h * 0.85);
    if (Math.min(nw, nh) < minSide) return { blob: low, quality: floor, width: w, height: h, shrunk, ok: false };
    w = nw; h = nh; shrunk = true;
  }
}

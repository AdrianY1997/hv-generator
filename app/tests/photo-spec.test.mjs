import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SPEC, PRESETS, normalizeSpec, parseAspect, parseMaxKB, presetIdOf, fitToWeight } from '../js/photo-spec.js';

test('el predeterminado es carnet 3:4 a 600x800 sin límite de peso', () => {
  assert.deepEqual({ ...DEFAULT_SPEC }, { aspect: '3:4', width: 600, height: 800, maxKB: null });
  assert.deepEqual(normalizeSpec(undefined), { aspect: '3:4', width: 600, height: 800, maxKB: null });
  assert.deepEqual(normalizeSpec('basura'), { aspect: '3:4', width: 600, height: 800, maxKB: null });
  assert.equal(presetIdOf(normalizeSpec({})), 'carnet');
});

test('normalizeSpec acepta datos parciales del modelo', () => {
  assert.deepEqual(normalizeSpec({ width: 350, height: 450, maxKB: 100 }), { aspect: '7:9', width: 350, height: 450, maxKB: 100 });
  const sq = normalizeSpec({ aspect: '1:1' });
  assert.equal(sq.width, 600); assert.equal(sq.height, 600);
  const byH = normalizeSpec({ aspect: '3:4', height: 400 });
  assert.equal(byH.width, 300); assert.equal(byH.height, 400);
  assert.equal(normalizeSpec({ aspect: 'x', width: 'a' }).width, 600, 'inválido -> fallback');
  assert.equal(normalizeSpec({ width: 99999, height: 10 }).width, 4000);
  assert.equal(normalizeSpec({ width: 99999, height: 10 }).height, 100);
  assert.equal(normalizeSpec({ maxKB: 5 }).maxKB, null, 'bajo el mínimo = sin límite');
  assert.equal(normalizeSpec({ maxKB: '150' }).maxKB, 150);
});

test('aspect, peso y presets', () => {
  assert.deepEqual(parseAspect('35:45'), [35, 45]);
  assert.equal(parseAspect('0:4'), null);
  assert.equal(parseMaxKB(''), null);
  assert.equal(parseMaxKB(100.4), 100);
  assert.equal(presetIdOf({ width: 700, height: 900 }), 'pasaporte');
  assert.equal(presetIdOf({ width: 800, height: 800 }), 'cuadrada');
  assert.equal(presetIdOf({ width: 301, height: 400 }), 'custom');
  assert.equal(PRESETS[0].id, 'carnet');
});

// Codificador falso: el peso crece con los píxeles y la calidad.
const fake = (k) => async (w, h, q) => ({ size: Math.round(w * h * q * k), w, h, q });

test('fitToWeight: sin tope usa la calidad inicial', async () => {
  const r = await fitToWeight(fake(0.2), 600, 800, null);
  assert.equal(r.quality, 0.9); assert.equal(r.shrunk, false); assert.equal(r.ok, true);
});

test('fitToWeight: baja la calidad hasta cumplir y devuelve la más alta que cabe', async () => {
  const enc = fake(0.2);
  const max = 70; // KB; a q=0.9 pesa ~84 KB
  const r = await fitToWeight(enc, 600, 800, max);
  assert.equal(r.ok, true); assert.equal(r.shrunk, false);
  assert.ok(r.blob.size <= max * 1024);
  assert.ok(r.quality < 0.9 && r.quality >= 0.4);
  const next = await enc(600, 800, r.quality + 0.03);
  assert.ok(next.size > max * 1024 || r.quality >= 0.86, 'cerca del máximo posible');
});

test('fitToWeight: si ni a la calidad mínima cabe, reduce las medidas', async () => {
  const r = await fitToWeight(fake(0.2), 600, 800, 20);
  assert.equal(r.ok, true); assert.equal(r.shrunk, true);
  assert.ok(r.width < 600 && r.height < 800);
  assert.ok(Math.abs(r.width / r.height - 0.75) < 0.01, 'conserva el aspecto');
  assert.ok(r.blob.size <= 20 * 1024);
});

test('fitToWeight: imposible -> ok false con lo mejor logrado', async () => {
  const r = await fitToWeight(async (w, h, q) => ({ size: 50000 + w * h * q }), 600, 800, 20);
  assert.equal(r.ok, false);
  assert.ok(r.blob.size > 20 * 1024);
});

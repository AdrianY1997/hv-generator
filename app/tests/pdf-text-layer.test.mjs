// drawTextLayer: el estado gráfico (q/Q) queda balanceado aunque drawText falle a mitad del bucle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { drawTextLayer } from '../js/pdf-package.js';

const lib = {
  pushGraphicsState: () => 'q', popGraphicsState: () => 'Q', setTextRenderingMode: (m) => 'Tr' + m,
  TextRenderingMode: { Invisible: 3 }, PDFOperator: { of: (n) => n }, PDFNumber: { of: (x) => x }, degrees: (d) => d,
};
const font = { widthOfTextAtSize: (t, sz) => t.length * sz * 0.5 };
const glyphs = new Set([...'abc '].map((c) => c.codePointAt(0)));
const runs = [{ text: 'abc', x: 0, y: 0, w: 30, h: 10 }, { text: 'abc', x: 0, y: 20, w: 30, h: 10 }];
const mkPage = (failAt) => {
  const ops = []; let n = 0;
  return { ops, pushOperators: (...o) => ops.push(...o), drawText: () => { if (++n === failAt) throw new Error('boom'); } };
};
const balance = (ops) => ops.filter((o) => o === 'q').length - ops.filter((o) => o === 'Q').length;

test('drawTextLayer: q/Q balanceado cuando todo sale bien', () => {
  const pg = mkPage(0);
  const n = drawTextLayer(lib, pg, font, glyphs, runs, { x: 0, y: 0 }, { w: 612, h: 792 });
  assert.ok(n > 0);
  assert.equal(balance(pg.ops), 0);
});

test('drawTextLayer: si drawText lanza, igual se cierra el q con Q y el error se propaga', () => {
  const pg = mkPage(1);
  assert.throws(() => drawTextLayer(lib, pg, font, glyphs, runs, { x: 0, y: 0 }, { w: 612, h: 792 }), /boom/);
  assert.ok(pg.ops.includes('q'));
  assert.equal(balance(pg.ops), 0);
});

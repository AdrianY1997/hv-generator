// G02: fidelidad del render en blanco de cada modelo frente a su PDF oficial. Cada hoja, dibujada por Chromium a 96 dpi (antialias en gris, como
// al imprimir: el subpíxel LCD de la pantalla añadiría bordes de color que no son diferencias de forma), contra la página del PDF dibujada por
// MuPDF a 96 dpi (docs/models/<modelo>/ref-96dpi-<n>.png, generadas con `python -I docs/design/model-compare.py refs <pdf> <carpeta>`):
// diferencia media por píxel (0-255) con el mejor desplazamiento de ±1 px. No se usa pdf.js como referencia: dibuja las líneas de 0.24 pt
// a 1 px negro y eso solo ya suma ~3/255 en el Formato Único. Minerva entra como referencia (su render en blanco no cambia byte a byte:
// app/tests/modelos.test.mjs). Las cifras quedan en tests-e2e/out/<ejecución>/fidelidad.jsonl (docs/design/formato-unico-spec.md).
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../helpers/fixtures.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const OUT = path.resolve(import.meta.dirname, '..', 'out', process.env.PW_RUN || '');
const PAGES = { 'formato-unico': 3, minerva: 4 };
// Las referencias se generaron en Windows; el rasterizador de Chromium en Linux (CI) dibuja los trazos finos con otra cobertura y el Formato Único
// da ~3.58/255 en la hoja 1 (determinista, dos intentos) frente a ~3.2 en Windows. Tope por plataforma, documentado en docs/GAPS.md.
const MAX_MEAN = process.platform === 'win32' ? 3.5 : 4.0;

test.use({ launchOptions: { args: ['--disable-lcd-text'] }, deviceScaleFactor: 1, viewport: { width: 900, height: 1100 } });

for (const [id, count] of Object.entries(PAGES)) {
  test(`${id}: diferencia media por hoja ≲ 3/255`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/__seed__');
    const n = await page.evaluate(async (id) => {
      const m = (await import('/js/models/index.js')).registry[id];
      document.head.innerHTML = '<link rel="stylesheet" href="/css/paper.css"><style>body{margin:0;background:#fff}.hv-sheet{margin:0!important;box-shadow:none!important}</style>';
      // Plantilla sin la sección "solicitud": sin la fecha de hoy, la hoja queda en blanco de verdad.
      document.body.innerHTML = m.render({}, { id: 'x', include: { sections: { solicitud: false }, items: {}, fields: {} }, options: {} }, {});
      await new Promise((r) => { const l = document.querySelector('link'); if (l.sheet) r(); else l.onload = r; });
      await document.fonts.ready;
      return document.querySelectorAll('.hv-sheet').length;
    }, id);
    expect(n, 'una hoja por página del PDF').toBe(count);
    const shots = [];
    for (const s of await page.locator('.hv-sheet').all()) shots.push((await s.screenshot()).toString('base64'));
    const refs = shots.map((_, i) => fs.readFileSync(path.join(ROOT, 'docs', 'models', id, `ref-96dpi-${i + 1}.png`)).toString('base64'));
    const res = await page.evaluate(async ({ shots, refs }) => {
      const pixels = async (b64) => {
        const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' }));
        const c = Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
        const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(bmp, 0, 0);
        return { w: c.width, h: c.height, d: x.getImageData(0, 0, c.width, c.height).data };
      };
      const out = [];
      for (let i = 0; i < shots.length; i++) {
        const a = await pixels(refs[i]), b = await pixels(shots[i]);
        let best = Infinity;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          let s = 0, k = 0;
          for (let y = 2; y < a.h - 2; y++) for (let x = 2; x < a.w - 2; x++) {
            const p = (y * a.w + x) * 4, q = ((y + dy) * b.w + (x + dx)) * 4;
            s += Math.abs(a.d[p] - b.d[q]) + Math.abs(a.d[p + 1] - b.d[q + 1]) + Math.abs(a.d[p + 2] - b.d[q + 2]); k += 3;
          }
          best = Math.min(best, s / k);
        }
        out.push({ page: i + 1, ref: [a.w, a.h], shot: [b.w, b.h], mean: Math.round(best * 100) / 100 });
      }
      return out;
    }, { shots, refs });
    fs.mkdirSync(OUT, { recursive: true });
    fs.appendFileSync(path.join(OUT, 'fidelidad.jsonl'), JSON.stringify({ model: id, sheets: n, pages: res }) + '\n');
    for (const r of res) {
      expect(r.shot, 'hoja de 612x792 pt a 96 dpi').toEqual(r.ref);
      expect(r.mean, `hoja ${r.page}: diferencia media (0-255)`).toBeLessThan(MAX_MEAN);
    }
  });
}

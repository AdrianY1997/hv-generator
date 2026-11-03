// ATS (G08): el PDF impreso (page.pdf, medio print) tiene texto real de los valores del perfil, sin rótulos de sección duplicados
// (la sombra de los rótulos es imagen, no texto) y sin la interfaz. Se lee con pdf.js, así que no hace falta Python.
import { test, expect, openApp, waitPreview } from '../helpers/fixtures.mjs';
import { fullProfile, makePng, template } from '../helpers/data.mjs';
import fs from 'node:fs';

test('el PDF impreso expone valores como texto y los títulos de sección una sola vez', async ({ page }) => {
  await openApp(page, '/vista-previa', { profile: fullProfile(), ack: false });
  await waitPreview(page);
  await page.emulateMedia({ media: 'print' });
  const buf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  const { text, images } = await page.evaluate(async (b64) => {
    const pdfjs = await import('/vendor/pdfjs/pdf.min.js');
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js';
    const doc = await pdfjs.getDocument({ data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) }).promise;
    let text = '', images = 0;
    for (let i = 1; i <= doc.numPages; i++) {
      const p = await doc.getPage(i);
      text += (await p.getTextContent()).items.map((t) => t.str).join(' ') + '\n';
      const ops = await p.getOperatorList();
      images += ops.fnArray.filter((f) => f === pdfjs.OPS.paintImageXObject || f === pdfjs.OPS.paintInlineImageXObject).length;
    }
    return { text, images };
  }, buf.toString('base64'));
  const flat = text.replace(/\s+/g, ' ');
  for (const v of ['Ana María', 'Pérez Gómez', '1020304050', 'ana.perez@example.com']) expect(flat, `valor extraíble: ${v}`).toContain(v);
  for (const t of ['INFORMACIÓN GENERAL', 'INFORMACIÓN PERSONAL', 'INFORMACIÓN FAMILIAR']) expect(flat.split(t).length - 1, `título "${t}" exactamente una vez`).toBe(1);
  expect(flat).not.toMatch(/\b([IVX]+\.)\s*\1/); // "IV.IV."
  expect(flat).not.toContain('Tus datos se quedan en este equipo'); // el aviso de privacidad no se imprime
  // La sombra de los rótulos se pinta como imagen (11 barras de sección): si vuelve a ser texto, desaparecen las imágenes y se duplican los títulos.
  expect(images, 'sombras de rótulos como imagen').toBeGreaterThanOrEqual(11);
});

// ---------- Paquete PDF (G08, pendiente 1): las hojas de la HV son imagen, pero llevan una capa de texto invisible ----------
test.describe('paquete PDF: capa de texto invisible', () => {
  const profile = () => {
    const p = fullProfile();
    Object.assign(p.experiencia[0], { empresa: 'Industrias Ñandú S.A.S.', cargo: 'Coordinadora de Logística' });
    return p;
  };
  const tpl = template('ATS');
  const files = [{ id: 'cert:it-superior-0', name: 'titulo.png', type: 'image/png', data: makePng(300, 400) }];

  /** Descarga el paquete con la UI y devuelve su texto por página y cuántas páginas son de la HV (pdf.js, sin Python). */
  async function packageText(page, testInfo, paper) {
    test.setTimeout(120_000);
    await openApp(page, `/vista-previa?template=${tpl.id}`, { profile: profile(), templates: [tpl], files });
    await waitPreview(page);
    if (paper) await page.getByLabel('Papel').selectOption(paper);
    const dl = page.waitForEvent('download');
    await page.locator('#pv-package').click();
    const file = testInfo.outputPath('paquete-ats.pdf');
    await (await dl).saveAs(file);
    const msg = page.locator('.pv-notice');
    await expect(msg).toContainText(/Listo: \d+ página\(s\)/);
    const [, total, hv] = (await msg.innerText()).match(/Listo: (\d+) página\(s\) \((\d+) de la HV/).map(Number);
    const out = await page.evaluate(async (b64) => {
      const pdfjs = await import('/vendor/pdfjs/pdf.min.js');
      pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js';
      const doc = await pdfjs.getDocument({ data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) }).promise;
      const pages = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const p = await doc.getPage(i);
        const tc = await p.getTextContent();
        const [x0, y0, x1, y1] = p.view;
        // Cada elemento: texto y posición en la página (origen abajo-izquierda); todo debe caer dentro de la hoja.
        pages.push({ w: x1 - x0, h: y1 - y0, items: tc.items.filter((t) => t.str.trim()).map((t) => ({ s: t.str, x: t.transform[4], y: t.transform[5], size: Math.hypot(t.transform[0], t.transform[1]) })) });
      }
      return pages;
    }, fs.readFileSync(file).toString('base64'));
    return { pages: out, hv, total, bytes: fs.statSync(file).size };
  }

  test('Carta: nombre, cédula, correo, empresa y cargo se extraen una sola vez, en la posición de la hoja', async ({ page }, testInfo) => {
    const { pages, hv, total, bytes } = await packageText(page, testInfo);
    expect(hv).toBeGreaterThanOrEqual(4);
    const hvText = pages.slice(0, hv).map((p) => p.items.map((i) => i.s).join(' ')).join('\n').replace(/\s+/g, ' ');
    const count = (s) => hvText.split(s).length - 1;
    for (const v of ['Ana María', 'Pérez Gómez', 'ana.perez@example.com', 'Industrias Ñandú S.A.S.', 'Coordinadora de Logística']) expect(count(v), `"${v}" exactamente una vez`).toBe(1);
    // La cédula está dos veces en la propia hoja (datos personales y firma, páginas 1 y 4): la capa no agrega ni pierde ninguna.
    const perPage = pages.slice(0, hv).map((p) => p.items.filter((i) => i.s.includes('1020304050')).length);
    expect(perPage.filter(Boolean).length).toBe(2);
    expect(Math.max(...perPage)).toBe(1);
    for (const t of ['INFORMACIÓN GENERAL', 'INFORMACIÓN PERSONAL', 'INFORMACIÓN FAMILIAR']) expect(count(t), `título "${t}" una vez`).toBe(1);
    expect(hvText).not.toMatch(/\b([IVX]+\.)\s*\1/);
    // Dentro de la hoja y con tamaño de letra razonable; orden de lectura: de arriba abajo en cada página.
    for (const p of pages.slice(0, hv)) {
      expect(p.items.length).toBeGreaterThan(20);
      for (const i of p.items) { expect(i.x).toBeGreaterThanOrEqual(-1); expect(i.x).toBeLessThanOrEqual(p.w); expect(i.y).toBeGreaterThan(0); expect(i.y).toBeLessThan(p.h); expect(i.size).toBeGreaterThan(3); expect(i.size).toBeLessThan(60); }
    }
    const first = pages[0].items, ia = first.findIndex((i) => i.s.includes('INFORMACIÓN GENERAL'));
    expect(ia).toBeGreaterThanOrEqual(0);
    const ys = first.map((i) => i.y);
    expect(ys.every((y, k) => k === 0 || y <= ys[k - 1] + 6), 'orden de lectura de arriba a abajo').toBe(true);
    // Los anexos (imagen) no llevan texto propio salvo su rótulo "Anexo · ...".
    const annex = pages.slice(hv).map((p) => p.items.map((i) => i.s).join(' ')).join(' ');
    expect(annex).toContain('Anexo');
    expect(total).toBe(pages.length);
    expect(bytes, 'tamaño del paquete').toBeLessThan(20 * 1024 * 1024);
  });

  test('A4: la capa sigue el tamaño del papel', async ({ page }, testInfo) => {
    const { pages, hv } = await packageText(page, testInfo, 'a4');
    expect(Math.round(pages[0].w)).toBe(595);
    const txt = pages.slice(0, hv).map((p) => p.items.map((i) => i.s).join(' ')).join(' ');
    expect(txt).toContain('ana.perez@example.com');
    for (const p of pages.slice(0, hv)) for (const i of p.items) { expect(i.x).toBeLessThanOrEqual(p.w); expect(i.y).toBeLessThan(p.h); }
  });
});

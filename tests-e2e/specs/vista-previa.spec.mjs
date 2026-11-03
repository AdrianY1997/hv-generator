// Vista previa: zoom, papel, impresión (window.print simulado) y paquete PDF (página contadas con pdf.js).
import fs from 'node:fs';
import { test, expect, openApp, waitPreview } from '../helpers/fixtures.mjs';
import { fullProfile, makePng, tinyPdf, template } from '../helpers/data.mjs';

test.beforeEach(async ({ page }) => {
  // window.print abre un diálogo del sistema que no se puede automatizar: se cuenta y se comprueba el estado en ese instante.
  await page.addInitScript(() => {
    window.__prints = [];
    window.print = () => { window.__prints.push({ title: document.title, css: document.getElementById('pv-pagesize')?.textContent || '' }); };
  });
});

test('zoom: alejar y acercar cambia el porcentaje y respeta los límites', async ({ page }) => {
  await openApp(page, '/vista-previa', { profile: fullProfile() });
  await waitPreview(page);
  const out = page.locator('#pv-zoom-out');
  await expect(out).toHaveText('100%');
  await page.getByRole('button', { name: 'Alejar' }).click();
  await expect(out).toHaveText('90%');
  const minus = page.getByRole('button', { name: 'Alejar' });
  while (await minus.isEnabled()) await minus.click();
  await expect(out).toHaveText('40%');
  await expect(page.getByRole('button', { name: 'Alejar' })).toBeDisabled();
  await page.getByRole('button', { name: 'Acercar' }).click();
  await expect(out).toHaveText('50%');
});

test('papel: Carta/A4 cambia la geometría de la hoja y se recuerda en la sesión', async ({ page }) => {
  await openApp(page, '/vista-previa', { profile: fullProfile() });
  await waitPreview(page);
  const w = () => page.locator('.hv-sheet').first().evaluate((e) => e.getBoundingClientRect().width);
  const letter = await w();
  expect(Math.round(letter)).toBe(816); // 612 pt
  await page.locator('#pv-paper').selectOption('a4');
  await expect.poll(w).toBeLessThan(letter); // A4 encaja el ancho de 210 mm (793,7 px)
  expect(Math.round(await w())).toBe(794);
  await page.reload();
  await expect(page.locator('#pv-paper')).toHaveValue('a4');
});

test('Imprimir pone el título sugerido y el tamaño de página, y los restaura al terminar', async ({ page }) => {
  await openApp(page, '/vista-previa', { profile: fullProfile() });
  await waitPreview(page);
  await page.locator('#pv-paper').selectOption('a4');
  await page.getByRole('button', { name: 'Imprimir', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__prints.length)).toBe(1);
  const call = await page.evaluate(() => window.__prints[0]);
  expect(call.title).toBe('HV - Ana María Pérez Gómez');
  expect(call.css).toContain('size:A4');
  await page.evaluate(() => dispatchEvent(new Event('afterprint')));
  await expect.poll(() => page.title()).toMatch(/Vista previa · HV Minerva/);
});

test('Descargar PDF avisa de elegir "Guardar como PDF"', async ({ page }) => {
  await openApp(page, '/vista-previa', { profile: fullProfile() });
  await page.getByRole('button', { name: 'Descargar PDF', exact: true }).click();
  await expect(page.locator('.pv-notice')).toContainText('Guardar como PDF');
  await expect.poll(() => page.evaluate(() => window.__prints.length)).toBe(1);
});

test('el enlace Imprimir de una plantilla abre la impresión una sola vez y limpia ?print=1', async ({ page }) => {
  const t = template('Para imprimir');
  await openApp(page, `/vista-previa?template=${t.id}&print=1`, { profile: fullProfile(), templates: [t] });
  await expect.poll(() => page.evaluate(() => window.__prints.length)).toBe(1);
  await expect(page).not.toHaveURL(/print=1/);
});

test('HTML autónomo: descarga un documento con la hoja y su CSS incrustado', async ({ page }, testInfo) => {
  await openApp(page, '/vista-previa', { profile: fullProfile() });
  await waitPreview(page);
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar HTML autónomo' }).click();
  const file = testInfo.outputPath('hv.html');
  await (await dl).saveAs(file);
  const html = fs.readFileSync(file, 'utf8');
  expect(html).toContain('<style>');
  expect(html).toContain('hv-standalone');
  expect(html).toContain('Ana María');
  expect(html).not.toMatch(/<script/i);
});

test.describe('paquete PDF', () => {
  const files = [
    { id: 'cert:it-superior-0', name: 'titulo.png', type: 'image/png', data: makePng(300, 400) },
    { id: 'doc:cedula', name: 'cedula.pdf', type: 'application/pdf', data: tinyPdf('Cedula', 2) },
  ];
  const tpl = template('Con anexos'); // los documentos solo se anexan desde una plantilla
  const route = `/vista-previa?template=${tpl.id}`;
  const profile = () => { const p = fullProfile(); p.documents = { cedula: ['doc:cedula'] }; p.documentsShown = ['cedula']; return p; };

  test('HV + anexos: el PDF descargado tiene las páginas que informa la app', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await openApp(page, route, { profile: profile(), templates: [tpl], files });
    await waitPreview(page);
    await expect(page.locator('.pv-banner__body')).toContainText(/Anexos: 1 imagen/);
    const dl = page.waitForEvent('download');
    await page.locator('#pv-package').click();
    const file = testInfo.outputPath('paquete.pdf');
    await (await dl).saveAs(file);
    const msg = page.locator('.pv-notice');
    await expect(msg).toContainText(/Listo: \d+ página\(s\)/);
    const [, total, hv, annex] = (await msg.innerText()).match(/Listo: (\d+) página\(s\) \((\d+) de la HV y (\d+) de anexos\)/).map(Number);
    expect(hv).toBeGreaterThanOrEqual(4); // las 4 hojas del formulario
    expect(annex).toBe(3); // 1 imagen (titulo) + PDF de 2 páginas (cédula)
    expect(total).toBe(hv + annex);
    // El conteo real del archivo, leído con pdf.js (el que ya trae la app).
    const pages = await page.evaluate(async (b64) => {
      const pdfjs = await import('/vendor/pdfjs/pdf.min.js');
      pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js';
      const doc = await pdfjs.getDocument({ data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) }).promise;
      return doc.numPages;
    }, fs.readFileSync(file).toString('base64'));
    expect(pages).toBe(total);
    expect(fs.readFileSync(file).subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('solo anexos: sin las hojas de la HV', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await openApp(page, route, { profile: profile(), templates: [tpl], files });
    await waitPreview(page);
    await expect(page.locator('.pv-banner__body')).toContainText(/Anexos/);
    const dl = page.waitForEvent('download');
    await page.locator('#pv-annex-only').click();
    await (await dl).saveAs(testInfo.outputPath('anexos.pdf'));
    await expect(page.locator('.pv-notice')).toContainText(/Listo: 3 página\(s\) de anexos/);
  });
});

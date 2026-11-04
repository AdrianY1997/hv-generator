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
  expect(call.css).toContain('@page{size:A4;margin:0}'); // todas las páginas con margen 0: igual con «Márgenes: ninguno» en el diálogo
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

test('?template= de un formato desconocido: avisa (sin bloquear) y muestra la hoja con el formato por omisión', async ({ page }) => {
  const t = template('De otra versión', { modelId: 'formato-del-futuro' });
  await openApp(page, `/vista-previa?template=${t.id}`, { profile: fullProfile(), templates: [t] });
  await waitPreview(page);
  const notice = page.locator('[data-notice="unknown-model"]');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('formato desconocido');
  await expect(notice).toContainText('formato-del-futuro');
  await expect(page.locator('.hv-sheet').first()).toBeVisible(); // no se bloquea
  await expect(page.locator('#pv-template')).toContainText('formato desconocido');
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
  expect(html).toContain('@page{size:Letter;margin:0}');
  expect(html).not.toMatch(/margin:\.5in/);
  expect(html).toContain('Ana María');
  expect(html).not.toMatch(/<script/i);
});

test.describe('paquete PDF', () => {
  const files = [
    { id: 'cert:it-superior-0', name: 'titulo.png', type: 'image/png', data: makePng(300, 400) },
    { id: 'doc:cedula', name: 'cedula.pdf', type: 'application/pdf', data: tinyPdf('Cedula', 2) },
  ];
  const tpl = template('Con anexos');
  const route = `/vista-previa?template=${tpl.id}`;
  const profile = () => { const p = fullProfile(); p.documents = { cedula: ['doc:cedula'] }; p.documentsShown = ['cedula']; return p; };

  test('HV + anexos: el PDF descargado tiene las páginas que informa la app', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await openApp(page, route, { profile: profile(), templates: [tpl], files });
    await waitPreview(page);
    await expect(page.locator('#pv-annex-sum')).toContainText('Anexos: 2 documentos / 3 páginas'); // la imagen y el PDF de 2 páginas (convertido para imprimir)
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
    await expect(page.locator('#pv-annex-sum')).toContainText(/Anexos: 2 documentos/);
    const dl = page.waitForEvent('download');
    await page.locator('#pv-annex-only').click();
    await (await dl).saveAs(testInfo.outputPath('anexos.pdf'));
    await expect(page.locator('.pv-notice')).toContainText(/Listo: 3 página\(s\) de anexos/);
  });
});

// Reporte desde la app en vivo: cédula, antecedentes y otros documentos subidos en Documentos no aparecían como anexos (sin plantilla no se
// anexaban documentos y los PDF solo se listaban como «no impresos").
test.describe('anexos de documentos', () => {
  const files = [
    { id: 'doc:cedula', name: 'cedula.png', type: 'image/png', data: makePng(600, 380) },
    { id: 'doc:procuraduria', name: 'procuraduria.pdf', type: 'application/pdf', data: tinyPdf(['PROCURADURIA GENERAL DE LA NACION']) },
    { id: 'doc:contraloria', name: 'contraloria.pdf', type: 'application/pdf', data: tinyPdf('Contraloria', 2) },
    { id: 'doc:policia', name: 'policia.pdf', type: 'application/pdf', data: tinyPdf('Policia') },
    { id: 'doc:eps', name: 'otro.png', type: 'image/png', data: makePng(300, 400) },
  ];
  const profile = () => ({ ...fullProfile(), documents: { cedula: ['doc:cedula'], procuraduria: ['doc:procuraduria'], contraloria: ['doc:contraloria'], policia: ['doc:policia'], eps: ['doc:eps'] } });
  const titles = (page) => page.locator('.pv-stage .hv-annex h2').allTextContents();

  test('sin plantilla: todos los documentos con archivo salen como páginas (cédula primero, PDF incluidos) y se pueden apagar', async ({ page }) => {
    test.setTimeout(90_000);
    await openApp(page, '/vista-previa', { profile: profile(), files });
    await waitPreview(page);
    const sum = page.locator('#pv-annex-sum');
    await expect(sum).toContainText('Anexos: 5 documentos / 6 páginas');
    const t = await titles(page);
    expect(t[0]).toMatch(/^Anexo · Cédula/);
    expect(t).toContain('Anexo · Antecedentes fiscales (Contraloría) (pág. 2 de 2)');
    expect(t.some((x) => /Procuraduría/.test(x)) && t.some((x) => /judiciales/.test(x)) && t.some((x) => /EPS/.test(x))).toBe(true);
    await expect(page.locator('.pv-stage .hv-annex img')).toHaveCount(6);
    // Interruptor de la vista: apaga los documentos (sin plantilla), lo dice y se recuerda en la sesión.
    await expect(page.locator('#pv-att-docs')).toBeChecked();
    await page.getByLabel('Incluir documentos adjuntos').uncheck();
    await expect(sum).toContainText('Anexos: 0 documentos / 0 páginas');
    await expect(sum).toContainText('desactivaste los documentos adjuntos');
    await expect(page.locator('.pv-stage .hv-annex')).toHaveCount(0);
    await page.reload();
    await waitPreview(page);
    await expect(page.locator('#pv-att-docs')).not.toBeChecked();
    await page.getByLabel('Incluir documentos adjuntos').check();
    await expect(sum).toContainText('Anexos: 5 documentos / 6 páginas');
  });

  test('con una plantilla nueva: los mismos anexos; un PDF que no se puede leer se avisa en pantalla y en la hoja', async ({ page }) => {
    test.setTimeout(90_000);
    const tpl = template('Nueva');
    const bad = [...files, { id: 'doc:policia', name: 'policia.pdf', type: 'application/pdf', data: Buffer.from('%PDF-1.4\nesto no es un PDF valido') }];
    await openApp(page, `/vista-previa?template=${tpl.id}`, { profile: profile(), templates: [tpl], files: bad });
    await waitPreview(page);
    const sum = page.locator('#pv-annex-sum');
    await expect(sum).toContainText('Anexos: 4 documentos / 5 páginas');
    await expect(sum.locator('[data-annex-loose]')).toContainText('Antecedentes judiciales');
    await expect(page.locator('.pv-stage .hv-annex').last()).toContainText('no salen en esta impresión');
  });
});

// Quinta auditoría: resumen de anexos claro (documentos de identidad/salud), «Reintentar» para PDF fallidos y limpieza al salir de la vista.
test.describe('quinta auditoría: anexos y limpieza', () => {
  const profile = () => ({ ...fullProfile(), documents: { cedula: ['doc:cedula'], policia: ['doc:policia'] } });
  const good = [{ id: 'doc:cedula', name: 'cedula.png', type: 'image/png', data: makePng(600, 380) }];

  test('el resumen dice cuántos documentos de identidad/salud van en la vista y en el HTML, con el interruptor al lado; un PDF fallido ofrece Reintentar', async ({ page }) => {
    test.setTimeout(90_000);
    const bad = { id: 'doc:policia', name: 'policia.pdf', type: 'application/pdf', data: Buffer.from('%PDF-1.4\nesto no es un PDF valido') };
    await openApp(page, '/vista-previa', { profile: profile(), files: [...good, bad] });
    await waitPreview(page);
    const sum = page.locator('#pv-annex-sum');
    await expect(sum.locator('[data-annex-docs]')).toContainText('Se incluyen 2 documentos de identidad/salud en esta vista y en el HTML descargable');
    // El interruptor vive junto al resumen (mismo contenedor).
    await expect(page.locator('.pv-annex-wrap #pv-att-docs')).toHaveCount(1);
    await expect(page.locator('.pv-annex-wrap #pv-annex-sum')).toHaveCount(1);
    const retry = page.locator('#pv-annex-retry');
    await expect(retry).toBeVisible();
    await expect(sum.locator('[data-annex-loose]')).toContainText('Antecedentes judiciales');
    await retry.click();
    await expect(sum.locator('[data-annex-loose]')).toContainText('Antecedentes judiciales'); // sigue fallando, pero volvió a intentarlo y no quedó «Preparando…» para siempre
    await expect(sum).not.toContainText('Preparando los anexos');
    await page.getByLabel('Incluir documentos adjuntos').uncheck();
    await expect(sum.locator('[data-annex-docs]')).toHaveCount(0);
  });

  test('al salir de Vista previa se quitan el CSS de impresión de la HV y la clase del cuerpo (Ctrl+P en otra vista no hereda papel ni márgenes)', async ({ page }) => {
    await openApp(page, '/vista-previa', { profile: fullProfile() });
    await waitPreview(page);
    await expect(page.locator('#pv-pagesize')).toHaveCount(1);
    await expect(page.locator('body')).toHaveClass(/pv-on/);
    await page.getByRole('navigation', { name: 'Secciones principales' }).getByRole('link', { name: 'Perfil' }).click();
    await expect(page.locator('#app h1').first()).toBeVisible();
    await expect(page.locator('#pv-pagesize')).toHaveCount(0);
    await expect(page.locator('body')).not.toHaveClass(/pv-on/);
    expect(await page.evaluate(() => [...document.styleSheets].some((s) => { try { return [...s.cssRules].some((r) => r.constructor.name === 'CSSPageRule' && !r.selectorText); } catch { return false; } })), 'ninguna @page global').toBe(false);
  });
});

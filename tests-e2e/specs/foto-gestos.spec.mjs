// G13: editor de foto — tope de peso no logrado (el segundo clic acepta) y gestos táctiles (pellizco, arrastre) y volteo.
// Los gestos usan emulación táctil REAL de Chromium (contexto con hasTouch + Input.dispatchTouchEvent por CDP): el navegador genera los
// pointer events (pointerType "touch", captura de puntero). No sustituye a un dispositivo real (ver docs/GAPS.md, G13).
import { test, expect, openApp } from '../helpers/fixtures.mjs';
import { makePng, noisePng } from '../helpers/data.mjs';

test.use({ hasTouch: true });
test.skip(({ browserName }) => browserName !== 'chromium', 'CDP (Input.dispatchTouchEvent) solo existe en Chromium');

const tab = (page, name) => page.getByRole('button', { name: new RegExp(name) }).first();

async function openEditor(page, buffer) {
  await openApp(page, '/perfil');
  await tab(page, 'Información general').click();
  await page.locator('.photo-field input[type="file"]').setInputFiles({ name: 'yo.png', mimeType: 'image/png', buffer });
  const dlg = page.getByRole('dialog', { name: 'Ajusta tu fotografía' });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole('button', { name: 'Guardar foto' })).toBeEnabled();
  return dlg;
}
const savedPhoto = (page) => page.evaluate(async () => {
  const r = await (await import('/js/store.js')).getFile('photo');
  const b = await createImageBitmap(r.blob);
  const c = document.createElement('canvas'); c.width = b.width; c.height = b.height;
  const x = c.getContext('2d'); x.drawImage(b, 0, 0);
  const mid = Math.floor(b.height * 0.9); // fila baja: fuera del disco, solo el degradado horizontal
  return { size: r.blob.size, type: r.blob.type, w: b.width, h: b.height, left: x.getImageData(4, mid, 1, 1).data[0], right: x.getImageData(b.width - 5, mid, 1, 1).data[0] };
});

test('tope de peso no logrado: avisa, sigue abierto y el segundo clic acepta la foto tal cual', async ({ page }) => {
  test.setTimeout(120_000);
  const dlg = await openEditor(page, noisePng(800, 1000));
  // Formato personalizado 2000 x 400 px (el lado menor 400 deja varios pasos de reducción antes del mínimo de 240 px) y el tope mínimo de 20 KB:
  // con ruido ni a calidad 0,4 ni a ~1230 x 246 px baja de 20 KB, así que la app avisa en vez de guardar.
  await dlg.getByLabel('Formato de la foto').selectOption('custom');
  await dlg.getByLabel('Ancho (px)').fill('2000'); await dlg.getByLabel('Ancho (px)').dispatchEvent('change');
  await dlg.getByLabel('Alto (px)').fill('400'); await dlg.getByLabel('Alto (px)').dispatchEvent('change');
  const kb = dlg.getByLabel('Peso máximo (KB, opcional)');
  await kb.fill('20');
  await kb.dispatchEvent('change');
  const ok = dlg.getByRole('button', { name: 'Guardar foto' });
  await ok.click();
  await expect(dlg.getByRole('alert')).toContainText(/No se logró bajar de 20 KB/, { timeout: 60_000 });
  await expect(dlg).toBeVisible(); // no se cerró ni se guardó nada
  expect(await page.evaluate(async () => (await (await import('/js/store.js')).listFiles()).length)).toBe(0);
  await expect(ok).toBeEnabled();
  await ok.click(); // segundo clic: se acepta tal cual
  await expect(dlg).toBeHidden();
  const p = await savedPhoto(page);
  expect(p.type).toBe('image/jpeg');
  expect(p.size).toBeGreaterThan(20 * 1024); // no cumplió el tope, y aun así se guardó
  expect(p.w).toBeLessThan(2000); // las medidas se redujeron buscando el peso (x0.85 por paso)
  expect(p.w / p.h).toBeCloseTo(5, 0); // conservando el aspecto
});

test('tope de peso logrado: guarda bajo el límite sin pedir un segundo clic', async ({ page }) => {
  const dlg = await openEditor(page, makePng(900, 1200));
  const kb = dlg.getByLabel('Peso máximo (KB, opcional)');
  await kb.fill('60');
  await kb.dispatchEvent('change');
  await dlg.getByRole('button', { name: 'Guardar foto' }).click();
  await expect(dlg).toBeHidden();
  const p = await savedPhoto(page);
  expect(p.size).toBeLessThanOrEqual(60 * 1024);
});

test.describe('gestos táctiles', () => {
  const touch = async (page, type, points) => {
    const cdp = page.__cdp ||= await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id: id + 1 })) });
  };
  const stageBox = async (page) => (await page.locator('.pe-stage').boundingBox());
  const zoom = (dlg) => dlg.getByLabel('Zoom').inputValue().then(Number);
  const canvasSig = (page) => page.locator('.pe-canvas').evaluate((c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]) | 0; return h; });

  test('pellizco: separar los dedos acerca, juntarlos aleja (con los límites del zoom)', async ({ page }) => {
    const dlg = await openEditor(page, makePng(900, 1200));
    const b = await stageBox(page), cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    expect(await zoom(dlg)).toBe(1);
    await touch(page, 'touchStart', [[cx - 20, cy], [cx + 20, cy]]);
    for (const d of [30, 50, 70]) await touch(page, 'touchMove', [[cx - d, cy], [cx + d, cy]]); // 40 px -> 140 px: x3,5
    await touch(page, 'touchEnd', []);
    const zin = await zoom(dlg);
    expect(zin).toBeGreaterThan(2.5);
    expect(zin).toBeLessThanOrEqual(4);
    await touch(page, 'touchStart', [[cx - 70, cy], [cx + 70, cy]]);
    for (const d of [40, 20, 6]) await touch(page, 'touchMove', [[cx - d, cy], [cx + d, cy]]);
    await touch(page, 'touchEnd', []);
    const zout = await zoom(dlg);
    expect(zout).toBeLessThan(zin);
    expect(zout).toBeGreaterThanOrEqual(0.5); // tope inferior del zoom
    // un pellizco enorme no pasa de 4
    await touch(page, 'touchStart', [[cx - 5, cy], [cx + 5, cy]]);
    await touch(page, 'touchMove', [[b.x + 2, cy], [b.x + b.width - 2, cy]]);
    await touch(page, 'touchEnd', []);
    expect(await zoom(dlg)).toBeLessThanOrEqual(4);
  });

  test('un dedo arrastra el encuadre (con zoom) y soltar termina el gesto', async ({ page }) => {
    const dlg = await openEditor(page, makePng(900, 1200));
    const b = await stageBox(page), cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    await dlg.getByLabel('Zoom').fill('2.5');
    const before = await canvasSig(page);
    await touch(page, 'touchStart', [[cx, cy]]);
    for (const d of [10, 25, 40]) await touch(page, 'touchMove', [[cx + d, cy + d / 2]]);
    await touch(page, 'touchEnd', []);
    expect(await canvasSig(page)).not.toBe(before);
    expect(await zoom(dlg)).toBeCloseTo(2.5, 1); // arrastrar no cambia el zoom
    await expect(page.locator('.pe-stage')).not.toHaveClass(/pe-drag/);
    // pellizco seguido de un dedo: el gesto de dos dedos terminó (sin zoom residual)
    const z = await zoom(dlg);
    await touch(page, 'touchStart', [[cx, cy]]);
    await touch(page, 'touchMove', [[cx + 15, cy]]);
    await touch(page, 'touchEnd', []);
    expect(await zoom(dlg)).toBe(z);
  });

  test('voltear invierte la imagen horizontalmente en la vista y en la foto guardada', async ({ page }) => {
    const dlg = await openEditor(page, makePng(900, 1200));
    const edge = () => page.locator('.pe-canvas').evaluate((c) => { const x = c.getContext('2d'), y = Math.floor(c.height * 0.9); return [x.getImageData(4, y, 1, 1).data[0], x.getImageData(c.width - 5, y, 1, 1).data[0]]; });
    const [l0, r0] = await edge();
    expect(r0).toBeGreaterThan(l0 + 20); // degradado: rojo creciente hacia la derecha
    await dlg.getByRole('button', { name: 'Voltear' }).click();
    const [l1, r1] = await edge();
    expect(l1).toBeGreaterThan(r1 + 20);
    await dlg.getByRole('button', { name: 'Voltear' }).click(); // volver a voltear lo deja como estaba
    const [l2, r2] = await edge();
    expect(r2).toBeGreaterThan(l2 + 20);
    await dlg.getByRole('button', { name: 'Voltear' }).click();
    await dlg.getByRole('button', { name: 'Guardar foto' }).click();
    await expect(dlg).toBeHidden();
    const p = await savedPhoto(page);
    expect(p.left).toBeGreaterThan(p.right + 20);
  });
});

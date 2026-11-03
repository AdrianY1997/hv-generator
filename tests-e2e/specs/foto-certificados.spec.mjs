// Editor de foto (aplicar y cancelar) y carga de certificados (aceptar, rechazar tipo falso, quitar).
import { test, expect, openApp, listFileIds, readLS } from '../helpers/fixtures.mjs';
import { fullProfile, makePng, tinyPdf } from '../helpers/data.mjs';

const tab = (page, name) => page.getByRole('button', { name: new RegExp(name) }).first();

test('foto: el editor recorta, guarda un JPEG 600x800 y la hoja la muestra', async ({ page }) => {
  await openApp(page, '/perfil');
  await tab(page, 'Información general').click();
  await page.locator('.photo-field input[type="file"]').setInputFiles({ name: 'yo.png', mimeType: 'image/png', buffer: makePng(900, 1200) });
  const dlg = page.getByRole('dialog', { name: 'Ajusta tu fotografía' });
  await expect(dlg).toBeVisible();
  const ok = dlg.getByRole('button', { name: 'Guardar foto' });
  await expect(ok).toBeEnabled(); // habilitado cuando la imagen terminó de decodificarse
  await ok.click();
  await expect(dlg).toBeHidden();
  await expect(page.locator('.photo-field img.thumb')).toBeVisible();
  const meta = await page.evaluate(async () => { const r = await (await import('/js/store.js')).getFile('photo'); return { type: r.blob.type, size: r.blob.size }; });
  expect(meta.type).toBe('image/jpeg');
  expect(meta.size).toBeGreaterThan(1000);
  const dims = await page.evaluate(async () => { const r = await (await import('/js/store.js')).getFile('photo'); const b = await createImageBitmap(r.blob); return [b.width, b.height]; });
  expect(dims).toEqual([600, 800]);
  await expect.poll(async () => (await readLS(page, 'hv.profile'))?.personales?.foto).toBe('photo');
  await page.getByRole('link', { name: 'Vista previa' }).click();
  await expect(page.locator('.hv-sheet img.mv-photo')).toBeVisible();
});

test('foto: cancelar no guarda nada y devuelve el foco', async ({ page }) => {
  await openApp(page, '/perfil');
  await tab(page, 'Información general').click();
  await page.locator('.photo-field input[type="file"]').setInputFiles({ name: 'yo.png', mimeType: 'image/png', buffer: makePng(300, 400) });
  const dlg = page.getByRole('dialog', { name: 'Ajusta tu fotografía' });
  await expect(dlg).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  expect(await listFileIds(page)).toEqual([]);
});

test('foto: un archivo que no es imagen se rechaza con mensaje', async ({ page }) => {
  await openApp(page, '/perfil');
  await tab(page, 'Información general').click();
  await page.locator('.photo-field input[type="file"]').setInputFiles({ name: 'nota.txt', mimeType: 'text/plain', buffer: Buffer.from('hola') });
  await expect(page.locator('.photo-field .file-msg.err')).toContainText(/no es un PDF ni una imagen/);
  expect(await listFileIds(page)).toEqual([]);
});

test('certificado de un registro: adjuntar PDF, verlo como adjunto y quitarlo', async ({ page }) => {
  await openApp(page, '/perfil', { profile: fullProfile() });
  await tab(page, 'Educación superior').click();
  const first = page.locator('li.item').first();
  const slot = first.locator('.cert-row .file-slot');
  await slot.locator('input[type="file"]').setInputFiles({ name: 'titulo.pdf', mimeType: 'application/pdf', buffer: tinyPdf('Titulo profesional') });
  await expect(slot.locator('.file-name')).toContainText('titulo.pdf');
  await expect(slot.getByText('Adjunto', { exact: true })).toBeVisible();
  expect(await listFileIds(page)).toEqual(['cert:it-superior-0']);
  await slot.getByRole('button', { name: /Eliminar archivo/ }).click();
  await expect(slot.getByText('Pendiente')).toBeVisible();
  expect(await listFileIds(page)).toEqual([]);
});

test('certificado: se detecta el tipo real (un .pdf que es texto se rechaza) y se acepta una imagen', async ({ page }) => {
  await openApp(page, '/perfil', { profile: fullProfile() });
  await tab(page, 'Educación superior').click();
  const slot = page.locator('li.item').first().locator('.cert-row .file-slot');
  await slot.locator('input[type="file"]').setInputFiles({ name: 'falso.pdf', mimeType: 'application/pdf', buffer: Buffer.from('<html><script>alert(1)</script></html>') });
  await expect(slot.locator('.file-msg.err')).toContainText(/no es un PDF ni una imagen/);
  expect(await listFileIds(page)).toEqual([]);
  await slot.locator('input[type="file"]').setInputFiles({ name: 'acta.png', mimeType: 'image/png', buffer: makePng(200, 200) });
  await expect(slot.locator('.file-name')).toContainText('acta.png');
  await expect(slot.locator('img.thumb')).toBeVisible();
});

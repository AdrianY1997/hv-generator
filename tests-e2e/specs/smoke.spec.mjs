// Humo (chromium, firefox y webkit): la app carga, navega entre vistas, guarda el perfil y lo pinta en la hoja.
import { test, expect, openApp, nav, readLS, waitPreview } from '../helpers/fixtures.mjs';

test('carga la app, navega por las 5 vistas y cambia de tema', async ({ page }) => {
  await openApp(page, '/perfil');
  await expect(page).toHaveTitle(/Perfil · HV Minerva/);
  for (const [name, title] of [['Documentos', /Documentos/], ['Plantillas', /Plantillas/], ['Vista previa', /Vista previa/], ['Ajustes', /Ajustes/], ['Perfil', /Perfil/]]) {
    await nav(page, name);
    await expect(page).toHaveTitle(title);
    await expect(page.locator('#app h1').first()).toBeFocused(); // el foco pasa al título al cambiar de vista
    await expect(page.getByRole('navigation', { name: 'Secciones principales' }).getByRole('link', { name })).toHaveAttribute('aria-current', 'page');
  }
  const before = await page.evaluate(() => document.documentElement.dataset.theme || '');
  await page.getByRole('button', { name: /Cambiar tema/ }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).not.toBe(before);
});

test('perfil: escribir, guardar solo y verlo en la vista previa tras recargar', async ({ page }) => {
  await openApp(page, '/perfil');
  await page.getByRole('button', { name: /Información general/ }).click();
  await page.locator('input[name="nombres"]').fill('Camila Andrea');
  await page.locator('input[name="apellidos"]').fill('Rojas Pardo');
  await page.locator('input[name="numeroDocumento"]').fill('52123456');
  await expect.poll(async () => (await readLS(page, 'hv.profile'))?.personales?.nombres).toBe('Camila Andrea');
  await page.reload();
  await page.getByRole('button', { name: /Información general/ }).click();
  await expect(page.locator('input[name="apellidos"]')).toHaveValue('Rojas Pardo');
  await nav(page, 'Vista previa');
  await waitPreview(page);
  await expect(page.locator('.hv-sheet .mv-f', { hasText: 'Camila Andrea' }).first()).toBeVisible();
  await expect(page.locator('.hv-sheet .mv-f', { hasText: 'Rojas Pardo' }).first()).toBeVisible();
});

test('la hoja imprimible se ve con la plantilla por omisión y tiene 4 hojas de formulario', async ({ page }) => {
  await openApp(page, '/vista-previa');
  await waitPreview(page);
  await expect(page.locator('.hv-sheet')).toHaveCount(4);
});

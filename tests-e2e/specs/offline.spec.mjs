// Sin conexión (G16): con el service worker sellado como en producción (__BUILD__ -> versión), la app arranca y se usa sin red.
// Usa su propio servidor (serve.mjs con `stamp`), porque el worker en modo desarrollo (sin sellar) es "red primero".
import { test, expect } from '@playwright/test';
import { createAppServer } from '../serve.mjs';

test.use({ serviceWorkers: 'allow', baseURL: undefined });
const STAMP = 'e2e' + Date.now().toString(36);
let server, base;

test.beforeAll(async () => {
  server = createAppServer({ stamp: STAMP });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
});
test.afterAll(async () => { await new Promise((r) => server.close(r)); });

test('el sw sellado precachea el shell y la app funciona sin conexión', async ({ page, context }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + 'index.html#/perfil');
  await expect(page.locator('#app h1').first()).toBeVisible();
  // El worker se instala, activa y precachea (CORE + MORE) bajo el nombre con el sello.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(async (stamp) => {
    const cache = await caches.open('hv-app-' + stamp);
    return (await cache.keys()).length;
  }, STAMP), { message: 'precache del shell' }).toBeGreaterThanOrEqual(40);
  expect(await page.evaluate(() => caches.keys())).toEqual(['hv-app-' + STAMP]);
  // Recarga ya controlada por el worker (la primera carga no lo está).
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#app h1').first()).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Cuéntanos quién eres' })).toBeVisible();
  // Todas las vistas cargan sus módulos desde la caché y se puede escribir y guardar sin red.
  for (const name of ['Documentos', 'Plantillas', 'Vista previa', 'Ajustes', 'Perfil']) {
    const link = page.getByRole('navigation', { name: 'Secciones principales' }).getByRole('link', { name });
    await link.click();
    await expect(link).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#app h1').first()).toBeVisible();
  }
  await page.getByRole('button', { name: /Información general/ }).click();
  await page.locator('input[name="nombres"]').fill('Sin Conexión');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('hv.profile') || '{}').personales?.nombres)).toBe('Sin Conexión');
  await page.getByRole('link', { name: 'Vista previa' }).click();
  await expect(page.locator('.hv-sheet .mv-f', { hasText: 'Sin Conexión' }).first()).toBeVisible();
  expect(errors).toEqual([]);
  await context.setOffline(false);
});

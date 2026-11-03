// Almacenamiento: error de cuota (localStorage e IndexedDB) y "Borrar todos mis datos".
import { test, expect, openApp, readLS, listFileIds } from '../helpers/fixtures.mjs';
import { fullProfile, makePng } from '../helpers/data.mjs';

const tab = (page, name) => page.getByRole('button', { name: new RegExp(name) }).first();

test.describe('cuota llena', () => {
  test.use({ allowConsoleErrors: true }); // el store registra el fallo; la app lo avisa a la persona
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.__quota = false;
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (window.__quota && k === 'hv.profile') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        return set.call(this, k, v);
      };
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...a) {
        if (window.__quota) throw new DOMException('Quota exceeded', 'QuotaExceededError');
        return put.apply(this, a);
      };
    });
  });

  test('localStorage lleno: avisa con banner y estado, no pierde lo escrito y se recupera al liberar espacio', async ({ page }) => {
    await openApp(page, '/perfil');
    await tab(page, 'Información general').click();
    await page.locator('input[name="nombres"]').fill('Antes');
    await expect.poll(async () => (await readLS(page, 'hv.profile'))?.personales?.nombres).toBe('Antes');
    await page.evaluate(() => { window.__quota = true; });
    await page.locator('input[name="nombres"]').fill('Después');
    const banner = page.locator('[data-notice="storage"]');
    await expect(banner).toContainText('Almacenamiento lleno');
    await expect(banner).toHaveAttribute('role', 'alert');
    await expect(page.locator('.save-state')).toContainText('No se guardó: almacenamiento lleno');
    expect((await readLS(page, 'hv.profile')).personales.nombres).toBe('Antes'); // lo guardado antes sigue intacto
    await expect(page.locator('input[name="nombres"]')).toHaveValue('Después'); // y lo escrito sigue en pantalla
    await banner.getByRole('button', { name: 'Abrir Ajustes' }).waitFor();
    // Se libera espacio: el siguiente cambio vuelve a guardar todo lo pendiente.
    await page.evaluate(() => { window.__quota = false; });
    await page.locator('input[name="apellidos"]').fill('Apellido');
    await expect.poll(async () => (await readLS(page, 'hv.profile'))?.personales?.nombres).toBe('Después');
    expect((await readLS(page, 'hv.profile')).personales.apellidos).toBe('Apellido');
  });

  test('IndexedDB lleno: el adjunto no se guarda y se explica el motivo', async ({ page }) => {
    await openApp(page, '/perfil', { profile: fullProfile() });
    await tab(page, 'Educación superior').click();
    const slot = page.locator('li.item').first().locator('.cert-row .file-slot');
    await page.evaluate(() => { window.__quota = true; });
    await slot.locator('input[type="file"]').setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: makePng(50, 50) });
    await expect(slot.locator('.file-msg.err')).toContainText('almacenamiento del navegador está lleno');
    await expect(page.locator('[data-notice="storage"]')).toContainText('Almacenamiento lleno');
    await page.evaluate(() => { window.__quota = false; });
    expect(await listFileIds(page)).toEqual([]);
  });
});

test.describe('borrar todos mis datos', () => {
  const seeded = { profile: fullProfile(), templates: [], files: [{ id: 'photo', name: 'f.png', type: 'image/png', data: makePng(30, 30) }] };

  test('pide escribir BORRAR; cancelar o escribir otra cosa no borra nada', async ({ page }) => {
    await openApp(page, '/ajustes', seeded);
    await page.getByRole('button', { name: 'Borrar todos mis datos' }).click();
    const dlg = page.getByRole('dialog', { name: '¿Borrar todos tus datos?' });
    const go = dlg.getByRole('button', { name: 'Borrar definitivamente' });
    await expect(go).toBeDisabled();
    await dlg.getByLabel(/Escribe BORRAR/).fill('borra');
    await expect(go).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    expect((await readLS(page, 'hv.profile')).personales.nombres).toBe('Ana María');
    expect(await listFileIds(page)).toEqual(['photo']);
  });

  test('borra perfil, plantillas, archivos y preferencias del navegador y reinicia la app', async ({ page }) => {
    await openApp(page, '/ajustes', { ...seeded, templates: [{ ...(await import('../helpers/data.mjs')).template('T') }], theme: 'dark' });
    await page.getByRole('button', { name: 'Borrar todos mis datos' }).click();
    const dlg = page.getByRole('dialog', { name: '¿Borrar todos tus datos?' });
    await dlg.getByLabel(/Escribe BORRAR/).fill('borrar'); // sin distinguir mayúsculas
    await dlg.getByRole('button', { name: 'Borrar definitivamente' }).click();
    await expect(page).toHaveURL(/#\/perfil$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Cuéntanos quién eres' })).toBeVisible();
    // (la app vuelve a escribir solo hv.version al arrancar: no es un dato de la persona)
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('hv.') && k !== 'hv.version'))).toEqual([]);
    await page.getByRole('button', { name: /Información general/ }).click();
    await expect(page.locator('input[name="nombres"]')).toHaveValue('');
    expect(await listFileIds(page)).toEqual([]);
    await expect(page.locator('[data-notice="privacy"]')).toBeVisible(); // vuelve el aviso de primer uso
  });
});

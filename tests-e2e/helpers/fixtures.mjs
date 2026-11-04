// Fixtures y utilidades comunes de las pruebas e2e. Sin esperas fijas: todo espera por condición (expect / locator).
import { test as base, expect } from '@playwright/test';

export { expect };

const SEED_URL = '/__seed__'; // 404 del mismo origen: permite sembrar localStorage/IndexedDB antes de que arranque la app

export const test = base.extend({
  // Falla la prueba si la página lanza una excepción o registra console.error (salvo `allowConsoleErrors`).
  allowConsoleErrors: [false, { option: true }],
  page: async ({ page, allowConsoleErrors }, use) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console.error: ' + m.text()); });
    await use(page);
    if (!allowConsoleErrors) expect(errors, 'errores de consola').toEqual([]);
  },
});

/**
 * Siembra el almacenamiento (vacío por omisión) y abre la app en `route`.
 * `profile`/`templates` van a localStorage; `ack` descarta el aviso de privacidad; `nudge:false` marca un respaldo reciente
 * (evita el recordatorio de respaldo). `files`: [{id, data:Buffer, type, name, meta?}] se guardan en IndexedDB con el store real.
 */
export async function openApp(page, route = '/perfil', { profile, templates, ack = true, nudge = false, theme, files = [], clean = true, dataVersion = '3' } = {}) {
  if (clean) {
    await page.goto(SEED_URL);
    await page.evaluate(async ({ profile, templates, ack, nudge, theme, dataVersion }) => {
      localStorage.clear(); sessionStorage.clear();
      await new Promise((res) => { const r = indexedDB.deleteDatabase('hv'); r.onsuccess = r.onerror = r.onblocked = () => res(); });
      if (profile) localStorage.setItem('hv.profile', JSON.stringify(profile));
      if (templates) localStorage.setItem('hv.templates', JSON.stringify(templates));
      if (profile || templates) localStorage.setItem('hv.version', dataVersion); // = CURRENT_VERSION de migrate.js: los datos sembrados ya están migrados (dataVersion:'2' para probar la migración)
      if (ack) localStorage.setItem('hv.privacy.ack', '1');
      if (!nudge) localStorage.setItem('hv.lastBackup', String(Date.now()));
      if (theme) localStorage.setItem('hv.theme', theme);
    }, { profile, templates, ack, nudge, theme, dataVersion });
  }
  await page.goto('/index.html#' + route);
  await expect(page.locator('#app h1').first()).toBeVisible();
  if (files.length) {
    await putFiles(page, files);
    await page.reload();
    await expect(page.locator('#app h1').first()).toBeVisible();
  }
}

/** Cambia de vista con la navegación real (clic en el menú) y espera a que la vista esté montada. */
export async function nav(page, name) {
  const link = page.getByRole('navigation', { name: 'Secciones principales' }).getByRole('link', { name });
  await link.click();
  await expect(link).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#app h1').first()).toBeVisible();
}

/** Guarda archivos en IndexedDB usando el store real de la app. */
export async function putFiles(page, files) {
  await page.evaluate(async (list) => {
    const store = await import('/js/store.js');
    for (const f of list) {
      const bytes = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0));
      await store.putFile(f.id, new File([bytes], f.name, { type: f.type }), f.meta || {});
    }
  }, files.map((f) => ({ id: f.id, name: f.name, type: f.type, meta: f.meta, b64: f.data.toString('base64') })));
}

export const readLS = (page, key) => page.evaluate((k) => { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; }, key);
export const listFileIds = (page) => page.evaluate(async () => (await (await import('/js/store.js')).listFiles()).map((f) => f.id).sort());

/** Espera a que la vista previa pinte la hoja y sus imágenes. */
export async function waitPreview(page) {
  await expect(page.locator('.pv-stage .hv-sheet').first()).toBeVisible();
  await page.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? 1 : new Promise((r) => { i.onload = i.onerror = r; })))));
}

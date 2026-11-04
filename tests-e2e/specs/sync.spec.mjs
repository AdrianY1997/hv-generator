// Sincronización entre equipos (G04) con GitHub Gist FALSO: page.route intercepta https://api.github.com y responde con el GitHub en
// memoria de app/tests/_fake-github.mjs. Sin red real y sin token real. Dos contextos de navegador = dos equipos.
// La carpeta sincronizada (showDirectoryPicker) no se puede automatizar: se prueba en unitarias con un directorio falso y a mano.
import { AxeBuilder } from '@axe-core/playwright';
import { test, expect, openApp, readLS, listFileIds } from '../helpers/fixtures.mjs';
import { makePng } from '../helpers/data.mjs';
import { createFakeGitHub, FAKE_TOKEN } from '../../app/tests/_fake-github.mjs';

const PASS = 'frase de prueba para sincronizar';
// La derivación de clave (PBKDF2) es lenta en CI/Linux: las aserciones que esperan su resultado usan un plazo mayor.
const SLOW = 20_000;
const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'ETag, X-OAuth-Scopes, X-RateLimit-Remaining, X-RateLimit-Reset' };
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
async function audit(page, label) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(violations.map((v) => `${v.id}: ${v.help} -> ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`), `axe en ${label}`).toEqual([]);
}

/** Enruta api.github.com de un contexto al GitHub falso (compartido entre "equipos"). Cuenta cualquier otra salida a internet. */
async function fakeGitHub(context, gh) {
  const leaks = [];
  await context.route('https://api.github.com/**', async (route) => {
    const rq = route.request();
    if (rq.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-headers': 'Authorization, Content-Type, If-None-Match, X-GitHub-Api-Version, Accept', 'access-control-allow-methods': 'GET, POST, PATCH' } });
    const r = gh.handle({ method: rq.method(), url: rq.url(), headers: rq.headers(), body: rq.postData() });
    await route.fulfill({ status: r.status, headers: { ...r.headers, ...CORS }, body: r.body });
  });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|api\.github\.com)/, (route) => { leaks.push(route.request().url()); return route.abort(); });
  return leaks;
}
const card = (page) => page.getByRole('region', { name: 'Sincronización entre equipos' });
async function connectGist(page, { token = FAKE_TOKEN, pass = PASS, remember = false } = {}) {
  const c = card(page);
  await c.getByRole('radio', { name: /GitHub Gist secreto/ }).check();
  await c.getByLabel('Token de GitHub (permiso «gist»)').fill(token);
  await c.getByLabel('Contraseña de sincronización', { exact: true }).fill(pass);
  await c.getByLabel('Repite la contraseña').fill(pass);
  const rem = c.getByRole('checkbox', { name: /Recordar la contraseña/ });
  await expect(rem, 'recordar la contraseña viene desmarcado por omisión').not.toBeChecked();
  if (remember) await rem.check();
  await c.getByRole('button', { name: 'Conectar y sincronizar' }).click();
}
async function secondDevice(browser, gh) {
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, serviceWorkers: 'block', locale: 'es-CO', viewport: { width: 1280, height: 900 } });
  const leaks = await fakeGitHub(ctx, gh);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return { ctx, page, leaks, errors };
}

test.describe('sincronización con GitHub Gist (falso)', () => {
  test('conectar en A, traer en B, editar en ambos y combinar; GitHub solo ve texto cifrado', async ({ page, context, browser }) => {
    const gh = createFakeGitHub();
    const leaksA = await fakeGitHub(context, gh);
    await openApp(page, '/ajustes', {
      profile: { personales: { nombres: 'Ana', apellidos: 'Pérez', foto: 'photo' }, cursos: [{ id: 'c1', nombre: 'Excel' }] },
      files: [{ id: 'photo', name: 'foto.png', type: 'image/png', data: makePng(60, 80) }],
    });
    await connectGist(page);
    await expect(card(page).getByRole('status').first()).toContainText('conectada', { timeout: SLOW });
    await expect(card(page)).toContainText('GitHub Gist secreto de @aspirante-prueba');
    expect(gh.gists.size).toBe(2); // índice + adjuntos
    const remote = JSON.stringify([...gh.gists.values()]);
    for (const s of ['Pérez', 'nombres', 'Excel', 'foto.png']) expect(remote.includes(s), `texto claro en GitHub: ${s}`).toBe(false);
    for (const g of gh.gists.values()) expect(g.public).toBe(false);
    // El token no queda en claro en este navegador.
    const stored = await page.evaluate(async () => {
      const db = await new Promise((res) => { const r = indexedDB.open('hv-sync'); r.onsuccess = () => res(r.result); });
      const cfg = await new Promise((res) => { const r = db.transaction('kv').objectStore('kv').get('config'); r.onsuccess = () => res(r.result); });
      return JSON.stringify({ cfg: { ...cfg, folder: undefined }, ls: { ...localStorage } });
    });
    expect(stored.includes(FAKE_TOKEN)).toBe(false);
    expect(stored.includes(PASS)).toBe(false);

    // Equipo B, vacío.
    const B = await secondDevice(browser, gh);
    await openApp(B.page, '/ajustes');
    await connectGist(B.page);
    await expect(card(B.page).getByRole('status').first()).toContainText('conectada', { timeout: SLOW });
    expect((await readLS(B.page, 'hv.profile')).personales).toEqual({ nombres: 'Ana', apellidos: 'Pérez', foto: 'photo' });
    expect(await listFileIds(B.page)).toEqual(['photo']);

    // Ediciones en los dos equipos (por la API del store, que fecha el cambio como la vista Perfil) y combinación.
    await B.page.evaluate(async () => { const s = await import('/js/store.js'); const p = s.getProfile(); s.updateProfile({ personales: { ...p.personales, ciudad: 'Pasto' } }); });
    await page.evaluate(async () => { const s = await import('/js/store.js'); const p = s.getProfile(); s.updateProfile({ cursos: [...p.cursos, { id: 'c2', nombre: 'Word' }] }); });
    await card(B.page).getByRole('button', { name: 'Sincronizar ahora' }).click();
    await expect(card(B.page)).toContainText('Se subieron los cambios de este equipo');
    await card(page).getByRole('button', { name: 'Sincronizar ahora' }).click();
    await expect(card(page)).toContainText('Se recibieron cambios de otro equipo');
    await card(B.page).getByRole('button', { name: 'Sincronizar ahora' }).click();
    await expect(card(B.page)).toContainText('Se recibieron cambios de otro equipo');
    const want = { personales: { nombres: 'Ana', apellidos: 'Pérez', foto: 'photo', ciudad: 'Pasto' }, cursos: [{ id: 'c1', nombre: 'Excel' }, { id: 'c2', nombre: 'Word' }] };
    for (const p of [page, B.page]) { const prof = await readLS(p, 'hv.profile'); expect({ personales: prof.personales, cursos: prof.cursos }).toEqual(want); }
    // Borrado en B -> se borra en A (lápida).
    await B.page.evaluate(async () => { const s = await import('/js/store.js'); s.updateProfile({ cursos: s.getProfile().cursos.filter((c) => c.id !== 'c1') }); });
    await card(B.page).getByRole('button', { name: 'Sincronizar ahora' }).click();
    await expect(card(B.page)).toContainText('Se subieron', { timeout: SLOW });
    await card(page).getByRole('button', { name: 'Sincronizar ahora' }).click();
    await expect.poll(async () => (await readLS(page, 'hv.profile')).cursos.map((c) => c.id)).toEqual(['c2']);
    // La copia previa a la última sincronización que cambió algo se puede descargar.
    await card(page).getByText('Opciones avanzadas').click();
    const dl = page.waitForEvent('download');
    await card(page).getByRole('button', { name: /Descargar la copia previa/ }).click();
    expect((await dl).suggestedFilename()).toMatch(/^hv-copia-previa-sincronizacion-\d{4}-\d\d-\d\d\.json$/);
    expect(leaksA).toEqual([]); expect(B.leaks).toEqual([]); expect(B.errors).toEqual([]);
    await B.ctx.close();
  });

  test('unirse con datos propios pide cómo combinar; sin recordar la contraseña queda bloqueada al recargar y se desbloquea', async ({ page, context, browser }) => {
    const gh = createFakeGitHub();
    await fakeGitHub(context, gh);
    await openApp(page, '/ajustes', { profile: { personales: { nombres: 'Ana', celular: '300' } } });
    await connectGist(page);
    await expect(card(page).getByRole('status').first()).toContainText('conectada', { timeout: SLOW });

    const B = await secondDevice(browser, gh);
    await openApp(B.page, '/ajustes', { profile: { personales: { nombres: 'Bea', ciudad: 'Cali' } } });
    await connectGist(B.page, { remember: false });
    const dlg = B.page.getByRole('dialog', { name: 'Unir este equipo a tu sincronización' });
    await expect(dlg).toBeVisible();
    await audit(B.page, 'diálogo de unirse');
    await dlg.getByRole('radio', { name: /Preferir los datos de este equipo/ }).check();
    await dlg.getByRole('button', { name: 'Combinar' }).click();
    await expect(card(B.page).getByRole('status').first()).toContainText('conectada', { timeout: SLOW });
    expect((await readLS(B.page, 'hv.profile')).personales).toEqual({ nombres: 'Bea', celular: '300', ciudad: 'Cali' });
    await card(page).getByRole('button', { name: 'Sincronizar ahora' }).click();
    await expect.poll(async () => (await readLS(page, 'hv.profile')).personales).toEqual({ nombres: 'Bea', celular: '300', ciudad: 'Cali' });

    // B no recordó la contraseña: tras recargar queda bloqueada.
    await B.page.reload();
    await expect(card(B.page).getByRole('status').first()).toContainText('bloqueada', { timeout: SLOW });
    await expect(card(B.page).getByRole('button', { name: 'Sincronizar ahora' })).toBeDisabled();
    await audit(B.page, 'sincronización bloqueada');
    await card(B.page).getByLabel('Contraseña de sincronización').fill('incorrecta de verdad');
    await card(B.page).getByRole('button', { name: 'Desbloquear' }).click();
    await expect(card(B.page).getByRole('alert')).toContainText('incorrecta', { timeout: SLOW });
    await card(B.page).getByLabel('Contraseña de sincronización').fill(PASS);
    await card(B.page).getByRole('button', { name: 'Desbloquear' }).click();
    await expect(card(B.page).getByRole('status').first()).toContainText('conectada', { timeout: SLOW });
    // Desconectar conserva los datos locales.
    await card(B.page).getByRole('button', { name: 'Desconectar' }).click();
    await B.page.getByRole('dialog', { name: '¿Desconectar este equipo?' }).getByRole('button', { name: 'Desconectar' }).click();
    await expect(card(B.page).getByRole('status').first()).toContainText('no configurada');
    expect((await readLS(B.page, 'hv.profile')).personales.nombres).toBe('Bea');
    expect(B.errors).toEqual([]);
    await B.ctx.close();
  });

  test('errores de GitHub: token rechazado (401) y límite de uso, con aviso claro y sin cambiar datos', async ({ page, context }) => {
    const gh = createFakeGitHub();
    await fakeGitHub(context, gh);
    await openApp(page, '/ajustes', { profile: { personales: { nombres: 'Ana' } } });
    await connectGist(page, { token: 'ghp_' + 'Y'.repeat(36) });
    const alert = card(page).getByRole('alert');
    await expect(alert).toContainText('401');
    await expect(card(page).getByRole('status').first()).toContainText('no configurada');
    await audit(page, 'error de token');
    gh.opts.rateLimited = true;
    await card(page).getByLabel('Token de GitHub (permiso «gist»)').fill(FAKE_TOKEN);
    await card(page).getByLabel('Contraseña de sincronización', { exact: true }).fill(PASS);
    await card(page).getByLabel('Repite la contraseña').fill(PASS);
    await card(page).getByRole('button', { name: 'Conectar y sincronizar' }).click();
    await expect(alert).toContainText('limitó las solicitudes');
    expect(gh.gists.size).toBe(0);
    expect((await readLS(page, 'hv.profile')).personales.nombres).toBe('Ana');
  });

  test('sincronización automática al abrir la app trae los cambios de otro equipo', async ({ page, context, browser }) => {
    const gh = createFakeGitHub();
    await fakeGitHub(context, gh);
    await openApp(page, '/ajustes', { profile: { personales: { nombres: 'Ana' } } });
    await connectGist(page, { remember: true }); // la sincronización automática al abrir necesita la clave recordada
    await expect(card(page).getByRole('status').first()).toContainText('conectada', { timeout: SLOW });
    const B = await secondDevice(browser, gh);
    await openApp(B.page, '/ajustes');
    await connectGist(B.page);
    await expect(card(B.page).getByRole('status').first()).toContainText('conectada', { timeout: SLOW });
    await B.page.evaluate(async () => { const s = await import('/js/store.js'); s.updateProfile({ personales: { ...s.getProfile().personales, celular: '3001234567' } }); });
    await card(B.page).getByRole('button', { name: 'Sincronizar ahora' }).click();
    await expect(card(B.page)).toContainText('Se subieron', { timeout: SLOW });
    await page.goto('/index.html#/perfil');
    await page.reload(); // volver a abrir la app en A (cambiar solo el hash no recarga): sincroniza sola al arrancar
    await expect(page.locator('#app h1').first()).toBeVisible();
    await expect.poll(async () => (await readLS(page, 'hv.profile')).personales.celular, { timeout: 15000 }).toBe('3001234567');
    await expect(page.locator('#toasts')).toContainText('Se recibieron cambios de otro equipo');
    await B.ctx.close();
  });
});

test.describe('CSP de index.html', () => {
  test.use({ allowConsoleErrors: true }); // el navegador registra como error cada bloqueo de la CSP, que es justo lo que se prueba
  test('bloquea scripts en línea inyectados y conexiones a sitios que no sean el propio o api.github.com', async ({ page }) => {
    const msgs = [];
    page.on('console', (m) => msgs.push(m.text()));
    await openApp(page, '/ajustes');
    const r = await page.evaluate(async () => {
      const s = document.createElement('script'); s.textContent = 'window.__inl = 1'; document.head.append(s);
      let ext = 'ok'; try { await fetch('https://example.com/'); } catch { ext = 'blocked'; }
      return { inline: window.__inl ?? null, ext, theme: document.documentElement.dataset.theme ?? null };
    });
    expect(r.inline).toBe(null);
    expect(r.ext).toBe('blocked');
    expect(msgs.some((m) => /Content Security Policy/.test(m))).toBe(true);
    expect(msgs.filter((m) => /Content Security Policy/.test(m) && !/inline script|example\.com/.test(m)), 'solo los bloqueos provocados').toEqual([]);
  });
});

test.describe('sincronización: accesibilidad @a11y', () => {
  for (const theme of ['light', 'dark']) {
    test(`tarjeta sin configurar y conectada (${theme})`, async ({ page, context }) => {
      const gh = createFakeGitHub();
      await fakeGitHub(context, gh);
      await openApp(page, '/ajustes', { theme, profile: { personales: { nombres: 'Ana' } } });
      await card(page).getByRole('radio', { name: /GitHub Gist secreto/ }).check();
      await audit(page, `sincronización sin configurar (${theme})`);
      await connectGist(page);
      await expect(card(page).getByRole('status').first()).toContainText('conectada', { timeout: SLOW });
      await card(page).getByText('Opciones avanzadas').click();
      await audit(page, `sincronización conectada (${theme})`);
    });
  }
});

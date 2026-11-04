// Respaldo: exportar, importar (combinar y reemplazar), rechazo de archivos maliciosos o inválidos.
import fs from 'node:fs';
import { test, expect, openApp, nav, readLS, listFileIds } from '../helpers/fixtures.mjs';
import { fullProfile, makePng, tinyPdf, template } from '../helpers/data.mjs';

const b64 = (buf) => buf.toString('base64');
const png = makePng(40, 40);
const pdf = tinyPdf('respaldo');

/** Descarga el respaldo desde Ajustes y devuelve el JSON. */
async function exportBackup(page, testInfo) {
  await nav(page, 'Ajustes');
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar respaldo' }).click();
  await page.getByRole('dialog', { name: 'Descargar respaldo' }).getByRole('button', { name: 'Descargar', exact: true }).click(); // sin contraseña por omisión
  const file = testInfo.outputPath('respaldo.json');
  await (await dl).saveAs(file);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
const backupOf = (over = {}) => ({
  app: 'hv-minerva', version: 1, schemaVersion: 1, exportedAt: new Date().toISOString(),
  profile: { personales: { nombres: 'Respaldada' } }, templates: [], files: [], ...over,
});
/** Elige un archivo en el campo de importar de Vista previa. */
const importFile = async (page, name, content) => {
  await nav(page, 'Vista previa');
  await page.locator('.pv-more input[type="file"]').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(typeof content === 'string' ? content : JSON.stringify(content)) });
};
const notice = (page) => page.locator('.pv-notice');
const dialog = (page) => page.getByRole('dialog', { name: 'Importar respaldo' });

test('exportar: el respaldo trae perfil, plantillas y archivos en base64 y marca la fecha', async ({ page }, testInfo) => {
  await openApp(page, '/ajustes', { profile: fullProfile(), templates: [template('Mi plantilla')], files: [{ id: 'photo', name: 'f.png', type: 'image/png', data: png }, { id: 'doc:cedula', name: 'c.pdf', type: 'application/pdf', data: pdf }] });
  await expect(page.getByText('Aún no has descargado ningún respaldo')).toBeHidden(); // (el sembrado marca uno reciente)
  const data = await exportBackup(page, testInfo);
  expect(data).toMatchObject({ app: 'hv-minerva', schemaVersion: 3 });
  expect(data.profile.personales.nombres).toBe('Ana María');
  expect(data.templates.map((t) => t.name)).toEqual(['Mi plantilla']);
  expect(data.files.map((f) => f.id).sort()).toEqual(['doc:cedula', 'photo']);
  expect(Buffer.from(data.files.find((f) => f.id === 'photo').data, 'base64').subarray(1, 4).toString()).toBe('PNG');
  await expect(page.getByText(/Último respaldo: hoy/)).toBeVisible();
});

test('ida y vuelta: exportar, borrar todo, importar con "Reemplazar todo" restaura los datos', async ({ page }, testInfo) => {
  await openApp(page, '/ajustes', { profile: fullProfile(), templates: [template('Plantilla ida')], files: [{ id: 'photo', name: 'f.png', type: 'image/png', data: png }] });
  const data = await exportBackup(page, testInfo);
  // Estado distinto: otro perfil, sin plantillas ni archivos.
  await openApp(page, '/vista-previa', { profile: { personales: { nombres: 'Otra Persona' } } });
  await importFile(page, 'respaldo.json', data);
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole('radio', { name: /Reemplazar todo/ }).check();
  const prev = page.waitForEvent('download'); // copia de seguridad previa
  await dialog(page).getByRole('button', { name: 'Reemplazar todo' }).click();
  expect((await prev).suggestedFilename()).toMatch(/hv-respaldo-previo/);
  await expect(notice(page)).toContainText('se reemplazaron tus datos');
  expect((await readLS(page, 'hv.profile')).personales.nombres).toBe('Ana María');
  expect((await readLS(page, 'hv.templates')).map((t) => t.name)).toEqual(['Plantilla ida']);
  expect(await listFileIds(page)).toEqual(['photo']);
});

test('combinar: llena solo campos vacíos, conserva lo actual y agrega registros y plantillas nuevos', async ({ page }) => {
  const mine = { personales: { nombres: '', apellidos: 'Actual Apellido', correo: '' }, hermanos: [{ id: 'h-mio', nombre: 'Mío' }] };
  const theirs = { personales: { nombres: 'Del Respaldo', apellidos: 'Respaldo Apellido', correo: 'resp@example.com' }, hermanos: [{ id: 'h-otro', nombre: 'Otro' }] };
  await openApp(page, '/vista-previa', { profile: mine, templates: [template('Actual')] });
  const bk = backupOf({ profile: theirs, templates: [template('Del respaldo')], files: [{ id: 'photo', meta: { name: 'f.png', type: 'image/png', size: png.length }, data: b64(png) }] });
  await importFile(page, 'respaldo.json', bk);
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole('radio', { name: /Combinar/ })).toBeChecked();
  await expect(dialog(page).locator('.imp-preview')).toContainText(/campo\(s\) vacío\(s\) se completan/);
  const prev = page.waitForEvent('download');
  await dialog(page).getByRole('button', { name: 'Combinar' }).click();
  await prev;
  await expect(notice(page)).toContainText('Respaldo combinado');
  const p = await readLS(page, 'hv.profile');
  expect(p.personales).toMatchObject({ nombres: 'Del Respaldo', apellidos: 'Actual Apellido', correo: 'resp@example.com' });
  expect(p.hermanos.map((h) => h.id).sort()).toEqual(['h-mio', 'h-otro']);
  expect((await readLS(page, 'hv.templates')).map((t) => t.name).sort()).toEqual(['Actual', 'Del respaldo']);
  expect(await listFileIds(page)).toEqual(['photo']);
});

test('combinar con "Preferir el respaldo" reemplaza los campos en conflicto; repetir no cambia nada', async ({ page }) => {
  await openApp(page, '/vista-previa', { profile: { personales: { nombres: 'Actual' } } });
  const bk = backupOf({ profile: { personales: { nombres: 'Del Respaldo' } } });
  await importFile(page, 'respaldo.json', bk);
  await dialog(page).getByRole('checkbox', { name: /Preferir el respaldo/ }).check();
  const prev = page.waitForEvent('download');
  await dialog(page).getByRole('button', { name: 'Combinar' }).click();
  await prev;
  await expect.poll(async () => (await readLS(page, 'hv.profile')).personales.nombres).toBe('Del Respaldo');
  // Idempotente: combinar el mismo respaldo otra vez avisa que no hay nada nuevo.
  await importFile(page, 'respaldo.json', bk);
  await dialog(page).getByRole('checkbox', { name: /Preferir el respaldo/ }).check();
  await expect(dialog(page).locator('.imp-preview')).toContainText('No hay nada nuevo');
  await dialog(page).getByRole('button', { name: 'Cerrar sin cambios' }).click();
  await expect(notice(page)).toContainText('No había nada nuevo');
});

test('cancelar el diálogo no cambia nada', async ({ page }) => {
  await openApp(page, '/vista-previa', { profile: { personales: { nombres: 'Intacto' } } });
  await importFile(page, 'respaldo.json', backupOf());
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
  expect((await readLS(page, 'hv.profile')).personales.nombres).toBe('Intacto');
});

// El rechazo se registra con console.error (es el comportamiento esperado de la app ante un archivo inválido).
const malicious = [
  ['no es JSON', '<<<esto no es json', /no es un respaldo ni una plantilla válidos/],
  ['JSON de otra app', { app: 'otra-app', profile: {} }, /no es un respaldo ni una plantilla válidos/],
  ['esquema de una versión más nueva', backupOf({ schemaVersion: 999 }), /versión más nueva/],
  ['perfil que no es objeto', backupOf({ profile: [1, 2] }), /perfil debe ser un objeto/],
  ['archivo HTML disfrazado (tipo no permitido)', backupOf({ files: [{ id: 'photo', meta: { name: 'x.html', type: 'text/html', size: 10 }, data: b64(Buffer.from('<script>1</script>')) }] }), /tipo no permitido/],
  ['contenido que no coincide con su tipo', backupOf({ files: [{ id: 'photo', meta: { name: 'x.png', type: 'image/png', size: 18 }, data: b64(Buffer.from('<script>1</script>')) }] }), /no coincide con su tipo/],
  ['identificador de archivo con ruta', backupOf({ files: [{ id: '../../etc/passwd', meta: { name: 'x.png', type: 'image/png', size: png.length }, data: b64(png) }] }), /identificador válido/],
  ['archivo repetido', backupOf({ files: [1, 2].map(() => ({ id: 'photo', meta: { name: 'x.png', type: 'image/png', size: png.length }, data: b64(png) })) }), /repetido/],
];
test.describe('archivos inválidos', () => {
  test.use({ allowConsoleErrors: true });
  for (const [name, content, msg] of malicious) test(`rechaza y no toca los datos: ${name}`, async ({ page }) => {
    await openApp(page, '/vista-previa', { profile: { personales: { nombres: 'Intacto' } }, templates: [template('Mia')] });
    await importFile(page, 'malo.json', content);
    await expect(notice(page)).toContainText(msg);
    await expect(dialog(page)).toHaveCount(0);
    expect((await readLS(page, 'hv.profile')).personales.nombres).toBe('Intacto');
    expect((await readLS(page, 'hv.templates')).map((t) => t.name)).toEqual(['Mia']);
    expect(await listFileIds(page)).toEqual([]);
  });
});

test('contaminación de prototipo: claves __proto__/constructor del respaldo no llegan al perfil', async ({ page }) => {
  await openApp(page, '/vista-previa', { profile: {} });
  const raw = '{"app":"hv-minerva","schemaVersion":1,"templates":[],"files":[],"profile":{"__proto__":{"polluted":"si"},"constructor":{"prototype":{"polluted2":"si"}},"personales":{"__proto__":{"polluted3":"si"},"nombres":"Limpio"}}}';
  await importFile(page, 'proto.json', raw);
  await expect(dialog(page)).toBeVisible();
  const prev = page.waitForEvent('download');
  await dialog(page).getByRole('button', { name: /Combinar|Cerrar sin cambios/ }).click();
  await prev.catch(() => null);
  await expect.poll(async () => (await readLS(page, 'hv.profile'))?.personales?.nombres).toBe('Limpio');
  const stored = await page.evaluate(() => localStorage.getItem('hv.profile'));
  expect(stored).not.toContain('__proto__'); // la clave __proto__ se descarta (una clave "constructor" suelta queda como dato inerte, no como prototipo)
  expect(await page.evaluate(() => [({}).polluted, ({}).polluted2, ({}).polluted3, Object.prototype.polluted, Object.getPrototypeOf(JSON.parse(localStorage.getItem('hv.profile')).personales) === Object.prototype])).toEqual([undefined, undefined, undefined, undefined, true]);
});

// ---------- Respaldo cifrado con contraseña (G05) ----------
const PASS = 'caballo-bateria-grapa-77';
const expDialog = (page) => page.getByRole('dialog', { name: 'Descargar respaldo' });
const pwDialog = (page) => page.getByRole('dialog', { name: 'Respaldo cifrado' });
const goDownload = (d) => d.getByRole('button', { name: 'Descargar', exact: true });
async function exportEncrypted(page, testInfo, pass = PASS) {
  await nav(page, 'Ajustes');
  await page.getByRole('button', { name: 'Descargar respaldo' }).click();
  const d = expDialog(page);
  await d.getByRole('checkbox', { name: 'Proteger con contraseña' }).check();
  await expect(d.getByText(/no hay forma de recuperar el respaldo/)).toBeVisible();
  await d.getByLabel('Contraseña', { exact: true }).fill(pass);
  await d.getByLabel('Repite la contraseña').fill(pass);
  const dl = page.waitForEvent('download');
  await goDownload(d).click();
  const download = await dl;
  const file = testInfo.outputPath('cifrado.json');
  await download.saveAs(file);
  return { file, name: download.suggestedFilename(), text: fs.readFileSync(file, 'utf8') };
}

test('cifrado: el diálogo valida (corta, no coincide) y avisa que la contraseña perdida no se recupera', async ({ page }) => {
  await openApp(page, '/ajustes', { profile: fullProfile() });
  await nav(page, 'Ajustes');
  await page.getByRole('button', { name: 'Descargar respaldo' }).click();
  const d = expDialog(page);
  await expect(d.getByLabel('Contraseña', { exact: true })).toBeHidden(); // sin marcar la casilla no hay campos
  await d.getByRole('checkbox', { name: 'Proteger con contraseña' }).check();
  await d.getByLabel('Contraseña', { exact: true }).fill('corta');
  await expect(d.locator('.imp-strength')).toContainText(/Seguridad: muy débil.*mínimo 10/);
  await goDownload(d).click();
  await expect(d.getByRole('alert').filter({ hasText: 'al menos 10 caracteres' })).toBeVisible();
  await d.getByLabel('Contraseña', { exact: true }).fill(PASS);
  await expect(d.locator('.imp-strength')).toContainText(/Seguridad: (buena|fuerte|aceptable)/);
  await d.getByLabel('Repite la contraseña').fill(PASS + 'x');
  await goDownload(d).click();
  await expect(d.getByRole('alert').filter({ hasText: 'no coinciden' })).toBeVisible();
  await expect(d).toBeVisible(); // nada se descargó: sigue abierto
  await page.keyboard.press('Escape');
  await expect(d).toBeHidden();
});

test('cifrado: exportar con contraseña, cambiar los datos e importar con la contraseña (la incorrecta se rechaza sin cambiar nada)', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openApp(page, '/ajustes', { profile: fullProfile(), templates: [template('Plantilla cifrada')], files: [{ id: 'photo', name: 'f.png', type: 'image/png', data: png }] });
  const { name, text, file } = await exportEncrypted(page, testInfo);
  expect(name).toBe('hv-datos-cifrado.json');
  const env = JSON.parse(text);
  expect(env).toMatchObject({ app: 'hv-minerva', format: 'hv-minerva-enc', v: 1, cipher: 'AES-256-GCM', kdf: { name: 'PBKDF2', hash: 'SHA-256' } });
  expect(env.kdf.iterations).toBeGreaterThanOrEqual(600000);
  for (const secret of ['Ana María', 'Plantilla cifrada', '1020304050', 'ana.perez@example.com', 'iVBOR']) expect(text, `el archivo no debe contener "${secret}"`).not.toContain(secret);
  await expect(page.getByText(/Último respaldo: hoy/)).toBeVisible();

  // Otro estado distinto (sin plantillas ni archivos): equivale a haber borrado todo.
  await openApp(page, '/vista-previa', { profile: { personales: { nombres: 'Otra Persona' } } });
  await page.locator('.pv-more input[type="file"]').setInputFiles(file);
  const pp = pwDialog(page);
  await expect(pp).toBeVisible();
  // Contraseña incorrecta: error en el mismo diálogo, nada cambia.
  await pp.getByLabel('Contraseña', { exact: true }).fill('contraseña equivocada');
  await pp.getByRole('button', { name: 'Descifrar' }).click();
  await expect(pp.getByRole('alert').filter({ hasText: 'Contraseña incorrecta' })).toBeVisible();
  await expect(pp).toBeVisible();
  expect((await readLS(page, 'hv.profile')).personales.nombres).toBe('Otra Persona');
  expect(await listFileIds(page)).toEqual([]);
  // Contraseña correcta: continúa el flujo normal (diálogo Importar respaldo).
  await pp.getByLabel('Contraseña', { exact: true }).fill(PASS);
  await pp.getByRole('button', { name: 'Descifrar' }).click();
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole('radio', { name: /Reemplazar todo/ }).check();
  const prev = page.waitForEvent('download');
  await dialog(page).getByRole('button', { name: 'Reemplazar todo' }).click();
  expect((await prev).suggestedFilename()).toMatch(/hv-respaldo-previo-\d{4}-\d\d-\d\d\.json$/); // copia previa sin cifrar por omisión
  await expect(notice(page)).toContainText('se reemplazaron tus datos');
  expect((await readLS(page, 'hv.profile')).personales.nombres).toBe('Ana María');
  expect((await readLS(page, 'hv.templates')).map((t) => t.name)).toEqual(['Plantilla cifrada']);
  expect(await listFileIds(page)).toEqual(['photo']);
});

test('cifrado: un archivo alterado, uno con KDF degradado y cancelar el diálogo no cambian los datos', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openApp(page, '/ajustes', { profile: fullProfile() });
  const { text } = await exportEncrypted(page, testInfo);
  const env = JSON.parse(text);
  await openApp(page, '/vista-previa', { profile: { personales: { nombres: 'Intacto' } } });
  const intact = async () => expect((await readLS(page, 'hv.profile')).personales.nombres).toBe('Intacto');

  // Alterado: un byte del texto cifrado -> mismo error que contraseña incorrecta.
  const raw = Buffer.from(env.ciphertext, 'base64'); raw[5] ^= 1;
  await importFile(page, 'alterado.json', { ...env, ciphertext: raw.toString('base64') });
  const pp = pwDialog(page);
  await pp.getByLabel('Contraseña', { exact: true }).fill(PASS);
  await pp.getByRole('button', { name: 'Descifrar' }).click();
  await expect(pp.getByRole('alert').filter({ hasText: /incorrecta, o el archivo está dañado o fue modificado/ })).toBeVisible();
  await intact();
  await page.keyboard.press('Escape'); // cancelar
  await expect(pp).toBeHidden();
  await expect(notice(page)).toContainText('no se modificaron');
  await intact();

  // KDF degradado: se rechaza sin pedir contraseña.
  await importFile(page, 'degradado.json', { ...env, kdf: { ...env.kdf, iterations: 1000 } });
  await expect(notice(page)).toContainText(/derivación de clave débil/);
  await expect(pp).toHaveCount(0);
  await intact();

  // Sobre sin campos.
  await importFile(page, 'roto.json', { app: 'hv-minerva', format: 'hv-minerva-enc', v: 1 });
  await expect(notice(page)).toContainText(/No se pudo importar/);
  await intact();
  expect(await listFileIds(page)).toEqual([]);
});

test('cifrado: la copia de seguridad previa puede cifrarse con su propia contraseña', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openApp(page, '/vista-previa', { profile: { personales: { nombres: 'Actual Secreto' } } });
  await importFile(page, 'plano.json', backupOf());
  const d = dialog(page);
  await d.getByRole('radio', { name: /Reemplazar todo/ }).check();
  await d.getByRole('checkbox', { name: /Cifrar esa copia con una contraseña/ }).check();
  await d.getByLabel('Contraseña', { exact: true }).fill('previa-secreta-99');
  await d.getByLabel('Repite la contraseña').fill('otra-distinta-99');
  await d.getByRole('button', { name: 'Reemplazar todo' }).click();
  await expect(d.getByRole('alert').filter({ hasText: 'no coinciden' })).toBeVisible(); // no avanza
  await d.getByLabel('Repite la contraseña').fill('previa-secreta-99');
  const prev = page.waitForEvent('download');
  await d.getByRole('button', { name: 'Reemplazar todo' }).click();
  const dl = await prev;
  expect(dl.suggestedFilename()).toMatch(/-cifrado\.json$/);
  const f = testInfo.outputPath('previa.json'); await dl.saveAs(f);
  const text = fs.readFileSync(f, 'utf8');
  expect(text).toContain('hv-minerva-enc'); expect(text).not.toContain('Actual Secreto');
  await expect.poll(async () => (await readLS(page, 'hv.profile')).personales.nombres).toBe('Respaldada');
});

// axe sobre los diálogos de contraseña (claro y oscuro): etiquetas, contraste, errores anunciados.
import { AxeBuilder } from '@axe-core/playwright';
for (const theme of ['light', 'dark']) test(`cifrado: axe sin violaciones en los diálogos de contraseña (${theme}) @a11y`, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
  const audit = async (label) => {
    const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(violations.map((v) => `${v.id}: ${v.help} ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' ')}`), `axe en ${label}`).toEqual([]);
  };
  await openApp(page, '/ajustes', { profile: fullProfile(), theme });
  await page.getByRole('button', { name: 'Descargar respaldo' }).click();
  const d = expDialog(page);
  await d.getByRole('checkbox', { name: 'Proteger con contraseña' }).check();
  await d.getByLabel('Contraseña', { exact: true }).fill('corta');
  await goDownload(d).click(); // muestra el error
  await expect(d.getByRole('alert').filter({ hasText: 'al menos 10' })).toBeVisible();
  await audit('diálogo de exportar con error');
  await page.keyboard.press('Escape');
  const { file } = await exportEncrypted(page, testInfo);
  await openApp(page, '/vista-previa', { profile: { personales: { nombres: 'X' } }, theme });
  await page.locator('.pv-more input[type="file"]').setInputFiles(file);
  const pp = pwDialog(page);
  await pp.getByLabel('Contraseña', { exact: true }).fill('incorrecta-incorrecta');
  await pp.getByRole('button', { name: 'Descifrar' }).click();
  await expect(pp.getByRole('alert').filter({ hasText: 'Contraseña incorrecta' })).toBeVisible();
  await audit('diálogo de contraseña con error');
  await expect(pp.getByLabel('Contraseña', { exact: true })).toHaveAttribute('aria-invalid', 'true');
});

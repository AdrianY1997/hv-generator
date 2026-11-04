// Documentos: selector "Documentos de tu lista" y lectura local de la vigencia de PDF (pdf.js, sin red).
import { test, expect, openApp, listFileIds } from '../helpers/fixtures.mjs';
import { fullProfile, tinyPdf, makePng, procuraduriaLines } from '../helpers/data.mjs';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/** Fecha de hace `n` días en el formato de los certificados ("19 de octubre del 2026"). */
const hace = (n) => { const d = new Date(Date.now() - n * 86400000); return `${d.getDate()} de ${MESES[d.getMonth()]} del ${d.getFullYear()}`; };
const row = (page, id) => page.locator(`li.doc[data-doc="${id}"]`);
const upload = (page, id, buffer, name = 'cert.pdf', mimeType = 'application/pdf') =>
  row(page, id).locator('input[type="file"]').first().setInputFiles({ name, mimeType, buffer });

test('selector de documentos: quitar y añadir documentos de la lista', async ({ page }) => {
  await openApp(page, '/documentos', { profile: fullProfile() });
  await expect(row(page, 'policia')).toBeVisible();
  const count = await page.locator('li.doc').count();
  expect(count).toBeGreaterThanOrEqual(4);

  await page.getByRole('button', { name: 'Añadir documento' }).first().click();
  const dlg = page.getByRole('dialog', { name: 'Documentos de tu lista' });
  await expect(dlg).toBeVisible();
  await dlg.getByRole('checkbox', { name: /Antecedentes judiciales/ }).first().uncheck();
  await expect(row(page, 'policia')).toHaveCount(0);
  await dlg.getByRole('button', { name: 'Todos' }).click();
  await expect(page.locator('li.doc')).toHaveCount(20);
  await dlg.getByRole('button', { name: 'Ninguno' }).click();
  await expect(page.locator('li.doc')).toHaveCount(0);
  await dlg.getByRole('checkbox', { name: /Cédula de ciudadanía/ }).check();
  await expect(page.locator('li.doc')).toHaveCount(1);
  await dlg.getByRole('button', { name: 'Listo' }).click();
  await expect(dlg).toBeHidden();
  await page.reload(); // la elección persiste en el perfil
  await expect(page.locator('li.doc')).toHaveCount(1);
});

test('conjunto por defecto (verificación legal): cédula, antecedentes, EPS y pensión; el resto se añade desde el selector', async ({ page }) => {
  await openApp(page, '/documentos', { profile: fullProfile() });
  await expect(page.locator('li.doc')).toHaveCount(6);
  for (const id of ['cedula', 'procuraduria', 'contraloria', 'policia', 'eps', 'pension']) await expect(row(page, id)).toBeVisible();
  for (const id of ['rnmc', 'inhabilidades', 'libreta', 'rut', 'redam', 'sisben', 'bdme', 'vigenciacedula', 'leyangel']) await expect(row(page, id)).toHaveCount(0);
  await page.getByRole('button', { name: 'Añadir documento' }).first().click();
  const dlg = page.getByRole('dialog', { name: 'Documentos de tu lista' });
  await expect(dlg.getByRole('group', { name: 'Principales' }).getByRole('checkbox')).toHaveCount(6);
  await expect(dlg.getByRole('group', { name: /Opcionales/ })).toContainText('Registro Nacional de Medidas Correctivas');
  await expect(dlg.getByRole('group', { name: /Otros/ })).toContainText('Inhabilidades por delitos sexuales');
  await expect(dlg.getByRole('checkbox', { name: /Registro Nacional de Medidas Correctivas/ })).not.toBeChecked();
  await dlg.getByRole('checkbox', { name: /Registro Nacional de Medidas Correctivas/ }).check();
  await expect(row(page, 'rnmc')).toBeVisible();
  for (const label of ['Autorización de tratamiento de datos', 'Certificado de antecedentes especial', 'Declaración de bienes y rentas', 'Examen médico de ingreso']) await expect(dlg.getByRole('checkbox', { name: new RegExp(label) })).toBeAttached();
});

test('un documento con archivos sigue visible aunque ya no esté en el conjunto por defecto', async ({ page }) => {
  const p = fullProfile(); p.documents = { rnmc: ['doc:rnmc'] };
  await openApp(page, '/documentos', { profile: p, files: [{ id: 'doc:rnmc', name: 'rnmc.pdf', type: 'application/pdf', data: tinyPdf('RNMC') }] });
  await expect(row(page, 'rnmc')).toBeVisible();
  await expect(page.locator('li.doc')).toHaveCount(7);
});

test('aviso: lo que un empleador no puede exigir se señala sin bloquear, y la base legal es consultable', async ({ page }) => {
  await openApp(page, '/documentos', { profile: fullProfile() });
  const chip = row(page, 'policia').locator('[data-employer="no"]');
  await expect(chip).toContainText('Un empleador no puede exigirlo — es tu decisión compartirlo');
  await expect(row(page, 'procuraduria').locator('[data-employer="no"]')).toHaveCount(0);
  const legal = row(page, 'policia').locator('details.doc-legal');
  await expect(legal).not.toHaveAttribute('open', '');
  await legal.locator('summary').click();
  await expect(legal).toContainText('Decreto-Ley 19 de 2012');
  await expect(legal).toContainText('Si el empleador es una entidad pública');
  await expect(legal.getByRole('link', { name: /Decreto-Ley 19 de 2012/ })).toHaveAttribute('href', /^https:\/\//);
  await expect(legal).toContainText('no es asesoría jurídica');
  // Sigue pudiéndose adjuntar: nada se bloquea.
  await expect(row(page, 'policia').locator('input[type="file"]').first()).toBeEnabled();
});

test('descargo: visible, se lee completo y se oculta durante la sesión', async ({ page }) => {
  await openApp(page, '/documentos', { profile: fullProfile() });
  const note = page.getByRole('note', { name: /no es asesoría jurídica/ });
  await expect(note).toBeVisible();
  await note.getByText('Leer el aviso completo').click();
  await expect(note).toContainText('Ley 1581 de 2012');
  await expect(note).toContainText('Ministerio del Trabajo');
  await note.getByRole('button', { name: /Ocultar el aviso legal/ }).click();
  await expect(note).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Añadir documento' }).first()).toBeFocused();
  await page.reload(); // misma sesión: sigue oculto
  await expect(page.locator('li.doc').first()).toBeVisible();
  await expect(page.getByRole('note', { name: /no es asesoría jurídica/ })).toHaveCount(0);
});

test('vigencia por tipo de regla: la ventana de práctica es editable y rotulada', async ({ page }) => {
  await openApp(page, '/documentos', { profile: fullProfile() });
  await upload(page, 'policia', tinyPdf(procuraduriaLines(hace(10))));
  const r = row(page, 'policia');
  await expect(r.locator('.vig')).toHaveText(/Vigente/);
  await expect(r.locator('.vig-basis')).toContainText('Práctica de las empresas (sin vigencia legal)');
  await r.getByLabel('Vigencia que exige la entidad (días)').fill('5');
  await r.getByLabel('Vigencia que exige la entidad (días)').press('Tab'); // el cambio se aplica al salir del campo
  await expect(r.locator('.vig')).toHaveText(/Vencido/);
  await upload(page, 'procuraduria', tinyPdf(procuraduriaLines(hace(10))));
  await expect(row(page, 'procuraduria').locator('.vig-basis')).toContainText('Norma');
  await expect(row(page, 'procuraduria').getByLabel('Vigencia que exige la entidad (días)')).toHaveCount(0);
});

test('PDF reciente: lee la fecha y marca el documento como vigente, con la cédula coincidente', async ({ page }) => {
  await openApp(page, '/documentos', { profile: fullProfile() });
  await upload(page, 'procuraduria', tinyPdf(procuraduriaLines(hace(10))));
  const panel = row(page, 'procuraduria');
  await expect(panel.locator('.vig')).toHaveText(/Vigente/);
  await expect(panel.locator('.vig-facts')).toContainText('Expedido:');
  await expect(panel.locator('.vig-facts')).toContainText('Código: 123456789');
  await expect(panel.locator('.vig-ok')).toContainText('La cédula del PDF coincide con tu perfil');
  await expect(row(page, 'procuraduria')).toHaveAttribute('data-state', 'done');
  expect(await listFileIds(page)).toContain('doc:procuraduria');
});

test('PDF antiguo: aparece como vencido y el resumen lo cuenta', async ({ page }) => {
  await openApp(page, '/documentos', { profile: fullProfile() });
  await upload(page, 'procuraduria', tinyPdf(procuraduriaLines(hace(200))));
  await expect(row(page, 'procuraduria').locator('.vig')).toHaveText(/Vencido/);
  await expect(page.locator('.doc-banner')).toBeVisible();
  await expect(page.locator('.doc-banner')).toContainText(/1 vencido/);
});

test('PDF con otra cédula: advierte que no coincide con el perfil', async ({ page }) => {
  await openApp(page, '/documentos', { profile: fullProfile() });
  await upload(page, 'procuraduria', tinyPdf(procuraduriaLines(hace(5), '9988776655')));
  await expect(row(page, 'procuraduria').locator('.vig-warn')).toContainText(/no coincide/);
});

test('corregir a mano la fecha de expedición recalcula la vigencia', async ({ page }) => {
  await openApp(page, '/documentos', { profile: fullProfile() });
  await upload(page, 'procuraduria', tinyPdf(procuraduriaLines(hace(5))));
  const r = row(page, 'procuraduria');
  await expect(r.locator('.vig')).toHaveText(/Vigente/);
  const old = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
  await r.getByLabel('Fecha de expedición (corregir)').fill(old);
  await expect(r.locator('.vig')).toHaveText(/Vencido/);
  await expect(r.locator('.vig-facts')).toContainText('corregido a mano');
});

test('imagen o PDF sin texto: no se lee solo y pide la fecha', async ({ page }) => {
  await openApp(page, '/documentos', { profile: fullProfile() });
  await upload(page, 'procuraduria', makePng(200, 200), 'scan.png', 'image/png');
  await expect(row(page, 'procuraduria').locator('.vig-note')).toContainText(/Es una imagen/);
  await expect(row(page, 'procuraduria').locator('.vig')).toHaveText(/No se pudo leer/);
});

// G19: PDF de varias páginas: se leen las 4 primeras y las 2 últimas (la fecha o el código pueden estar al final).
const filler = (n) => Array.from({ length: n }, (_, i) => `Pagina ${i + 1}: texto general sin datos del certificado`);

test('PDF de 12 páginas con la fecha y el código en la última: se leen', async ({ page }) => {
  await openApp(page, '/documentos', { profile: fullProfile() });
  const pages = filler(11).concat([procuraduriaLines(hace(10))]);
  await upload(page, 'procuraduria', tinyPdf(null, pages));
  const panel = row(page, 'procuraduria');
  await expect(panel.locator('.vig')).toHaveText(/Vigente/);
  await expect(panel.locator('.vig-facts')).toContainText('Código: 123456789');
});

test('PDF de 12 páginas con la fecha solo en una página intermedia (no leída): queda sin fecha', async ({ page }) => {
  await openApp(page, '/documentos', { profile: fullProfile() });
  const pages = filler(12);
  pages[6] = procuraduriaLines(hace(10)); // página 7: ni de las 4 primeras ni de las 2 últimas
  await upload(page, 'procuraduria', tinyPdf(null, pages));
  const panel = row(page, 'procuraduria');
  await expect(panel.locator('.vig')).toBeVisible();
  await expect(panel.locator('.vig')).not.toHaveText(/Vigente/);
});

// Quinta auditoría: el conjunto por defecto cambió, pero quien ya usaba la app conserva lo que veía (migración v3, app/js/migrate.js).
test('migración v3: un perfil existente (datos v2, sin lista) conserva RNMC e Inhabilidades y la lista queda guardada; borrar el último archivo no hace desaparecer un documento', async ({ page }) => {
  const p = fullProfile(); p.documents = { rut: ['doc:rut'] };
  await openApp(page, '/documentos', { profile: p, dataVersion: '2', files: [{ id: 'doc:rut', name: 'rut.pdf', type: 'application/pdf', data: tinyPdf('RUT') }] });
  for (const id of ['cedula', 'policia', 'procuraduria', 'contraloria', 'rnmc', 'inhabilidades', 'rut']) await expect(row(page, id)).toBeVisible();
  for (const id of ['eps', 'pension']) await expect(row(page, id)).toHaveCount(0);
  const saved = await page.evaluate(() => ({ v: localStorage.getItem('hv.version'), shown: JSON.parse(localStorage.getItem('hv.profile')).documentsShown }));
  expect(saved.v).toBe('3');
  expect(saved.shown).toEqual(expect.arrayContaining(['rnmc', 'inhabilidades', 'rut']));
  await page.evaluate(async () => { await (await import('/js/store.js')).deleteFile('doc:rut'); const s = await import('/js/store.js'); s.updateProfile({ documents: { rut: [] } }); });
  await page.reload();
  await expect(row(page, 'rut')).toBeVisible();
});

test('migración v3: un perfil nuevo (sin datos) usa el conjunto nuevo y no guarda lista', async ({ page }) => {
  await openApp(page, '/documentos');
  await expect(row(page, 'eps')).toBeVisible();
  await expect(row(page, 'rnmc')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('hv.profile'))).toBeNull();
});

test('estado legal: procuraduría y REDAM «parcial» con su nota; cédula/EPS/pensión sin etiqueta alarmante', async ({ page }) => {
  await openApp(page, '/documentos', { profile: { ...fullProfile(), documentsShown: ['cedula', 'procuraduria', 'eps', 'pension', 'redam'] } });
  await row(page, 'procuraduria').getByText('Base legal').click();
  await expect(row(page, 'procuraduria')).toContainText('Verificación parcial');
  await expect(row(page, 'procuraduria').locator('[data-legal-note]')).toContainText('no se comprobó que siga vigente');
  await expect(row(page, 'procuraduria')).toContainText('según la norma citada');
  await row(page, 'redam').getByText('Base legal').click();
  await expect(row(page, 'redam').locator('[data-legal-note]')).toContainText('Decreto 1310 de 2022');
  for (const id of ['cedula', 'eps', 'pension']) {
    await row(page, id).getByText('Base legal').click();
    await expect(row(page, id)).toContainText('Sin norma específica identificada');
    await expect(row(page, id)).not.toContainText(/Sin verificar: no se encontró una norma|Sin verificar/);
  }
});

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
  await expect(page.locator('li.doc')).toHaveCount(15);
  await dlg.getByRole('button', { name: 'Ninguno' }).click();
  await expect(page.locator('li.doc')).toHaveCount(0);
  await dlg.getByRole('checkbox', { name: /Cédula de ciudadanía/ }).check();
  await expect(page.locator('li.doc')).toHaveCount(1);
  await dlg.getByRole('button', { name: 'Listo' }).click();
  await expect(dlg).toBeHidden();
  await page.reload(); // la elección persiste en el perfil
  await expect(page.locator('li.doc')).toHaveCount(1);
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

// G20: antigüedad máxima por plantilla (template.options.maxAgeDays): editor de plantillas -> Documentos (semáforo) -> Vista previa (resumen).
import { test, expect, openApp, readLS } from '../helpers/fixtures.mjs';
import { fullProfile, tinyPdf, procuraduriaLines, template } from '../helpers/data.mjs';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const hace = (n) => { const d = new Date(Date.now() - n * 86400000); return `${d.getDate()} de ${MESES[d.getMonth()]} del ${d.getFullYear()}`; };
const row = (page, id) => page.locator(`li.doc[data-doc="${id}"]`);

test('plantilla de 30 días: el certificado de 50 días (vigencia oficial 90) pasa a vencido solo con esa plantilla', async ({ page }) => {
  const t = template('Máximo 30 días'), libre = template('Sin límite');
  await openApp(page, '/documentos', { profile: fullProfile(), templates: [t, libre] });
  await row(page, 'procuraduria').locator('input[type="file"]').first().setInputFiles({ name: 'proc.pdf', mimeType: 'application/pdf', buffer: tinyPdf(procuraduriaLines(hace(50))) });
  await expect(row(page, 'procuraduria').locator('.vig')).toHaveText(/Vigente/); // regla oficial: 90 días

  // Editor de plantillas: fijar 30 días y guardar.
  await page.getByRole('link', { name: 'Plantillas' }).click();
  await page.getByRole('button', { name: 'Editar plantilla: Máximo 30 días' }).click();
  await page.getByLabel('Antigüedad máxima de los documentos con vigencia').selectOption('30');
  await page.getByRole('button', { name: 'Guardar plantilla' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Máximo 30 días' })).toBeVisible();
  const saved = (await readLS(page, 'hv.templates')).find((x) => x.name === 'Máximo 30 días');
  expect(saved.options.maxAgeDays).toBe(30);
  expect((await readLS(page, 'hv.templates')).find((x) => x.name === 'Sin límite').options.maxAgeDays).toBeUndefined();

  // Documentos: evaluar con la plantilla -> vencido; sin plantilla o con la otra -> vigente.
  await page.getByRole('link', { name: 'Documentos' }).click();
  const sel = page.getByLabel('Evaluar la vigencia con la plantilla');
  await expect(row(page, 'procuraduria').locator('.vig')).toHaveText(/Vigente/);
  await sel.selectOption(t.id);
  await expect(row(page, 'procuraduria').locator('.vig')).toHaveText(/Vencido/);
  await expect(page.locator('.doc-banner')).toContainText(/1 vencido/);
  await expect(sel.locator('option:checked')).toHaveText('Máximo 30 días (máx. 30 días)');
  await sel.selectOption(libre.id);
  await expect(row(page, 'procuraduria').locator('.vig')).toHaveText(/Vigente/);

  // Vista previa con la plantilla: el resumen lo cuenta como vencido y menciona el límite.
  await page.goto(`/index.html#/vista-previa?template=${t.id}`);
  await expect(page.locator('.pv-banner')).toContainText(/1 documento\(s\) vencido\(s\)/);
  await expect(page.locator('.pv-banner')).toContainText(/30 días/);
});

test('el valor "Otro" del editor valida de 1 a 365 y quitar el límite lo borra de la plantilla', async ({ page }) => {
  const t = template('Con límite propio'); t.options.maxAgeDays = 45;
  await openApp(page, '/plantillas', { profile: fullProfile(), templates: [t] });
  await page.getByRole('button', { name: 'Editar plantilla: Con límite propio' }).click();
  const sel = page.getByLabel('Antigüedad máxima de los documentos con vigencia');
  await expect(sel).toHaveValue('otro'); // 45 no es 30/60/90: se muestra como "Otro valor"
  const n = page.getByLabel('Días de antigüedad máxima');
  await expect(n).toHaveValue('45');
  await n.fill('400');
  await expect(page.locator('.tpl-maxage ~ .field-err')).toContainText(/entre 1 y 365/);
  await expect(n).toHaveAttribute('aria-invalid', 'true');
  await n.fill('120');
  await sel.selectOption('');
  await page.getByRole('button', { name: 'Guardar plantilla' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Con límite propio' })).toBeVisible();
  expect((await readLS(page, 'hv.templates'))[0].options.maxAgeDays).toBeUndefined();
});

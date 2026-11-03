// Plantillas: crear, editar, duplicar, eliminar y comprobar que la vista previa cambia según lo que incluye cada una.
import { test, expect, openApp, readLS, waitPreview } from '../helpers/fixtures.mjs';
import { fullProfile } from '../helpers/data.mjs';

const profile = () => {
  const p = fullProfile();
  p.hermanos[0].nombre = 'Hermano Visible';
  p.experiencia[0].empresa = 'Empresa Alfa SAS';
  p.experiencia[1].empresa = 'Empresa Beta SAS';
  return p;
};
const sheetText = (page) => page.locator('.hv-doc').innerText();

test('crear una plantilla que excluye secciones y un registro, y guardarla', async ({ page }) => {
  await openApp(page, '/plantillas', { profile: profile() });
  await expect(page.getByText('Aún no hay plantillas propias')).toBeVisible();
  await page.getByRole('button', { name: 'Nueva plantilla' }).click();
  const form = page.locator('form');
  await expect(form).toBeVisible();
  // El nombre es obligatorio: guardar vacío no guarda.
  await page.getByRole('button', { name: 'Guardar plantilla' }).click();
  await expect(page.locator('#tpl-name-err')).not.toBeEmpty();
  expect(await readLS(page, 'hv.templates')).toBeNull();

  await page.locator('#tpl-name').fill('Cargo operativo');
  await page.locator('#tpl-job').fill('Operativo');
  await page.getByRole('button', { name: 'Ninguno: III. Hermanos' }).click();
  await page.locator('.tpl-sec[data-sec="experiencia"] .tpl-items label', { hasText: 'Empresa Beta SAS' }).getByRole('checkbox').uncheck();
  await page.getByRole('button', { name: 'Guardar plantilla' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Cargo operativo' })).toBeVisible();
  const [t] = await readLS(page, 'hv.templates');
  expect(t).toMatchObject({ name: 'Cargo operativo', jobType: 'Operativo' });
  expect(t.include.sections.hermanos).toBe(false);
  expect(t.include.items['it-experiencia-1']).toBe(false);
});

test('las vistas previas difieren: completa, sin una sección y sin un registro', async ({ page }) => {
  const t = {
    ...(await import('../helpers/data.mjs')).template('Sin hermanos'),
  };
  t.include.sections.hermanos = false;
  t.include.items['it-experiencia-1'] = false;
  await openApp(page, '/vista-previa', { profile: profile(), templates: [t] });
  await waitPreview(page);
  const full = await sheetText(page);
  expect(full).toContain('Hermano Visible');
  expect(full).toContain('Empresa Alfa SAS');
  expect(full).toContain('Empresa Beta SAS');

  await page.locator('#pv-template').selectOption({ label: 'Sin hermanos' });
  await expect(page).toHaveURL(/template=/);
  await expect.poll(async () => (await sheetText(page)).includes('Hermano Visible')).toBe(false);
  const filtered = await sheetText(page);
  expect(filtered).toContain('Empresa Alfa SAS');
  expect(filtered).not.toContain('Empresa Beta SAS');
  expect(filtered).not.toBe(full);
});

test('editar y duplicar y eliminar una plantilla desde la lista', async ({ page }) => {
  const { template } = await import('../helpers/data.mjs');
  await openApp(page, '/plantillas', { profile: profile(), templates: [template('Plantilla uno')] });
  await page.getByRole('button', { name: 'Editar plantilla: Plantilla uno' }).click();
  await page.locator('#tpl-name').fill('Plantilla renombrada');
  await page.locator('#tpl-obj').fill('Objetivo personalizado para el cargo.');
  await page.getByRole('button', { name: 'Guardar plantilla' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Plantilla renombrada' })).toBeVisible();
  expect((await readLS(page, 'hv.templates'))[0].options.objective).toBe('Objetivo personalizado para el cargo.');

  await page.getByRole('button', { name: 'Duplicar plantilla: Plantilla renombrada' }).click();
  await expect(page.locator('.tpl-card')).toHaveCount(2);
  await expect(page.getByRole('heading', { level: 2, name: 'Plantilla renombrada (copia)' })).toBeVisible();

  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Eliminar plantilla: Plantilla renombrada (copia)' }).click();
  await expect(page.locator('.tpl-card')).toHaveCount(1);
  expect(await readLS(page, 'hv.templates')).toHaveLength(1);
});

test('el objetivo de la plantilla sustituye al perfil profesional en la hoja', async ({ page }) => {
  const { template } = await import('../helpers/data.mjs');
  const t = template('Con objetivo');
  t.options.objective = 'Objetivo exclusivo de la plantilla XYZ';
  const p = profile();
  p.personales.perfil = 'Perfil profesional del aspirante ABC';
  await openApp(page, '/vista-previa', { profile: p, templates: [t] });
  await waitPreview(page);
  await expect.poll(async () => (await sheetText(page)).includes('Perfil profesional del aspirante ABC')).toBe(true);
  await page.locator('#pv-template').selectOption({ label: 'Con objetivo' });
  await expect.poll(async () => (await sheetText(page)).includes('Objetivo exclusivo de la plantilla XYZ')).toBe(true);
  expect(await sheetText(page)).not.toContain('Perfil profesional del aspirante ABC');
});

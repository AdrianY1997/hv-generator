// Perfil: llenar y persistir, registros repetibles (alta, orden, baja), avisos de validación y obligatorios pendientes.
import { test, expect, openApp, readLS } from '../helpers/fixtures.mjs';
import { fullProfile } from '../helpers/data.mjs';

const tab = (page, name) => page.getByRole('button', { name: new RegExp(name) }).first();

test('llenar varias secciones persiste en localStorage y sobrevive a la recarga', async ({ page }) => {
  await openApp(page, '/perfil');
  await tab(page, 'Información general').click();
  await page.locator('input[name="nombres"]').fill('Laura Sofía');
  await page.locator('input[name="apellidos"]').fill('Gómez Ruiz');
  await page.locator('select[name="tipoDocumento"]').selectOption('CE');
  await page.locator('select[name="estadoCivil"]').selectOption('Casado(a)'); // el cónyuge solo se pregunta si está casado o en unión libre (showIf)
  await page.locator('input[name="correo"]').fill('LAURA@Example.com');
  await page.locator('input[name="correo"]').blur();
  await tab(page, 'Información familiar').click();
  await page.locator('input[name="conyugeNombre"]').fill('Pedro Pérez');
  await expect.poll(async () => (await readLS(page, 'hv.profile'))?.familiar?.conyugeNombre).toBe('Pedro Pérez'); // guardado automático (400 ms)
  const saved = await readLS(page, 'hv.profile');
  expect(saved.personales).toMatchObject({ nombres: 'Laura Sofía', apellidos: 'Gómez Ruiz', tipoDocumento: 'CE' });
  expect(saved.personales.correo).toBe('laura@example.com'); // se normaliza a minúsculas al salir del campo
  expect(saved.familiar.conyugeNombre).toBe('Pedro Pérez');
  await page.reload();
  await tab(page, 'Información general').click();
  await expect(page.locator('input[name="nombres"]')).toHaveValue('Laura Sofía');
  await expect(page.locator('select[name="tipoDocumento"]')).toHaveValue('CE');
});

test('registros repetibles: agregar, reordenar y eliminar (con confirmación)', async ({ page }) => {
  await openApp(page, '/perfil');
  await tab(page, 'Hermanos').click();
  await expect(page.getByText('Aún no hay hermanos')).toBeVisible();
  await page.getByRole('button', { name: 'Agregar hermano o hermana' }).first().click();
  const items = page.locator('li.item');
  await expect(items).toHaveCount(1);
  await items.nth(0).locator('input[name="nombre"]').fill('Andrés');
  await page.getByRole('button', { name: 'Agregar hermano o hermana' }).first().click();
  await expect(items).toHaveCount(2);
  await items.nth(1).locator('input[name="nombre"]').fill('Beatriz');
  await page.getByRole('button', { name: 'Bajar Registro 1' }).click();
  await expect(items.nth(0).locator('input[name="nombre"]')).toHaveValue('Beatriz');
  await expect.poll(async () => (await readLS(page, 'hv.profile'))?.hermanos?.map((h) => h.nombre)).toEqual(['Beatriz', 'Andrés']);

  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('button', { name: 'Eliminar Registro 1' }).click();
  await expect(items).toHaveCount(2);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Eliminar Registro 1' }).click();
  await expect(items).toHaveCount(1);
  await expect.poll(async () => (await readLS(page, 'hv.profile'))?.hermanos?.map((h) => h.nombre)).toEqual(['Andrés']);
});

test('campos con formato dudoso avisan sin bloquear el guardado', async ({ page }) => {
  await openApp(page, '/perfil');
  await tab(page, 'Información general').click();
  const cel = page.locator('input[name="celular"]');
  await cel.fill('12345');
  await cel.blur();
  await expect(page.locator('.field', { has: cel }).locator('.field-err, .field-warn').filter({ hasText: /\S/ }).first()).toBeVisible();
  await expect.poll(async () => (await readLS(page, 'hv.profile'))?.personales?.celular).toBeTruthy(); // se guardó igual
});

test('las pestañas muestran cuántos obligatorios faltan y desaparecen al completarlos', async ({ page }) => {
  await openApp(page, '/perfil');
  const general = tab(page, 'Información general');
  await expect(general.locator('.n')).toBeVisible();
  await tab(page, 'Información general').click();
  await page.locator('input[name="nombres"]').fill('A');
  await page.locator('input[name="apellidos"]').fill('B');
  await page.locator('select[name="tipoDocumento"]').selectOption('CC');
  await page.locator('input[name="numeroDocumento"]').fill('1234567');
  await expect(general.locator('.n')).toBeHidden();
});

test('un perfil completo precargado se muestra en todas las secciones', async ({ page }) => {
  await openApp(page, '/perfil', { profile: fullProfile() });
  await tab(page, 'Información general').click();
  await expect(page.locator('input[name="nombres"]')).toHaveValue('Ana María');
  await tab(page, 'Experiencia laboral').click();
  await expect(page.locator('li.item')).toHaveCount(2);
});

// G17: dirección vaga y cruce de fechas entre trabajos consecutivos (avisos que nunca bloquean).
test('dirección incompleta avisa y la dirección se normaliza al salir del campo', async ({ page }) => {
  await openApp(page, '/perfil');
  await tab(page, 'Información general').click();
  const dir = page.locator('input[name="direccion"]');
  await dir.fill('Cra 7');
  await dir.blur();
  await expect(page.locator('.field', { has: dir }).locator('.field-warn').filter({ hasText: /incompleta/ })).toBeVisible();
  await dir.fill('  Calle   10#5 - 20 ');
  await dir.blur();
  await expect(dir).toHaveValue('Calle 10 # 5-20');
  await expect(page.locator('.field', { has: dir }).locator('.field-warn').filter({ hasText: /\S/ })).toHaveCount(0);
  await expect.poll(async () => (await readLS(page, 'hv.profile'))?.personales?.direccion).toBe('Calle 10 # 5-20');
});

test('experiencia: un trabajo que empieza antes de que termine el anterior avisa (sin bloquear); el empalme corto no', async ({ page }) => {
  await openApp(page, '/perfil', { profile: { experiencia: [
    { id: 'e1', empresa: 'Acme', cargo: 'Analista', fechaInicio: '2018-01-01', fechaFin: '2020-06-30' },
    { id: 'e2', empresa: 'Beta', cargo: 'Líder', fechaInicio: '2020-01-01', fechaFin: '2022-01-01' },
  ] } });
  await tab(page, 'Experiencia laboral').click();
  const items = page.locator('li.item');
  const ing = (n) => items.nth(n).locator('input[name="fechaInicio"]');
  const fld = (n) => items.nth(n).locator('.field').filter({ has: page.locator('input[name="fechaInicio"]') });
  await ing(1).focus(); await ing(1).blur();
  await expect(fld(1).locator('.field-warn').filter({ hasText: /Se cruza 182 días con tu trabajo en Acme/ })).toBeVisible();
  await expect(fld(0).locator('.field-warn').filter({ hasText: /\S/ })).toHaveCount(0); // el que empieza primero no se avisa
  await ing(1).fill('2020-06-15'); // empalme de 16 días: normal
  await ing(1).blur();
  await expect(fld(1).locator('.field-warn').filter({ hasText: /\S/ })).toHaveCount(0);
  await expect.poll(async () => (await readLS(page, 'hv.profile'))?.experiencia?.[1]?.fechaInicio).toBe('2020-06-15'); // guarda igual
});

// Reportes desde la app en vivo: el tiempo servido de cada empleo se calcula solo (y se ve al escribir), y el primer bloque de la hoja de
// experiencia («Nombre de la última o actual empresa») lleva el trabajo actual aunque haya un registro vacío.
test('experiencia: tiempo servido calculado en vivo; lo escrito a mano manda; el trabajo actual va en el primer bloque', async ({ page }) => {
  await openApp(page, '/perfil', { profile: { experiencia: [
    { id: 'e1', empresa: 'Vieja SA', cargo: 'Auxiliar', fechaInicio: '2015-01-01', fechaFin: '2017-06-30' },
  ] } });
  await tab(page, 'Experiencia laboral').click();
  const items = page.locator('li.item');
  const out = (n) => items.nth(n).locator('.svc-time output');
  await expect(out(0)).toHaveText('2 años, 6 meses');
  await expect(items.nth(0).locator('input[name="tiempoServido"]')).toHaveAttribute('placeholder', 'Se calculará: 2 años, 6 meses');
  await items.nth(0).locator('input[name="fechaFin"]').fill('2015-01-20');
  await expect(out(0)).toHaveText('menos de 1 mes');
  await items.nth(0).locator('input[name="fechaFin"]').fill('2017-06-30');
  await items.nth(0).locator('input[name="tiempoServido"]').fill('Dos años y medio');
  await expect(items.nth(0).locator('.svc-time')).toContainText('Se imprimirá lo que escribiste');
  // Un trabajo actual y un registro vacío (se pulsó «Agregar» de más).
  await page.getByRole('button', { name: 'Agregar experiencia' }).first().click();
  await items.nth(1).locator('input[name="empresa"]').fill('Actual SAS');
  await items.nth(1).locator('input[name="fechaInicio"]').fill('2020-02-01');
  await items.nth(1).locator('input[name="actual"]').check();
  await expect(out(1)).toHaveText(/^\d+ años(, \d+ mes(es)?)?$/);
  await page.getByRole('button', { name: 'Agregar experiencia' }).first().click();
  await expect(items).toHaveCount(3);
  await expect.poll(async () => (await readLS(page, 'hv.profile'))?.experiencia?.length).toBe(3);
  await page.goto('/index.html#/vista-previa');
  await expect(page.locator('.pv-stage .hv-sheet').first()).toBeVisible();
  const p3 = page.locator('.pv-stage .mv-page[data-page="3"] .mv-f');
  const texts = await p3.allTextContents();
  expect(texts[0], 'primer bloque: el trabajo actual').toBe('Actual SAS');
  expect(texts).toContain('Vieja SA');
  expect(texts).toContain('Dos años y medio');
  expect(texts.filter((x) => x === 'Actual SAS')).toHaveLength(1);
});

test('Formato Único: el tiempo servido de cada empleo se muestra calculado (informativo)', async ({ page }) => {
  await openApp(page, '/perfil', { profile: { experiencia: [{ id: 'e1', empresa: 'Alcaldía', fechaInicio: '2019-03-01', fechaFin: '2020-02-29' }] } });
  await page.evaluate(() => localStorage.setItem('hv.model', 'formato-unico'));
  await page.reload();
  await tab(page, 'Experiencia laboral').click();
  const box = page.locator('li.item .svc-time');
  await expect(box.locator('output')).toHaveText('1 año');
  await expect(box).toContainText('Informativo');
});

test('experiencia: Minerva pide «Cargo de su jefe inmediato» (con el cargo anterior como respaldo) y el Formato Único «Cargo o contrato»', async ({ page }) => {
  await openApp(page, '/perfil', { profile: { experiencia: [{ id: 'e1', empresa: 'Vieja SA', cargo: 'Auxiliar contable', fechaInicio: '2015-01-01', fechaFin: '2017-06-30' }] } });
  await tab(page, 'Experiencia laboral').click();
  const item = page.locator('li.item').first();
  await expect(item.locator('input[name="cargo"]')).toHaveCount(0);
  const boss = item.getByLabel('Cargo de su jefe inmediato');
  await expect(boss).toHaveAttribute('placeholder', 'Se usará: Auxiliar contable (dato anterior)');
  await expect(item.getByLabel('Cargo desempeñado por usted')).toBeVisible();
  await boss.fill('Jefe de contabilidad');
  await expect.poll(async () => (await readLS(page, 'hv.profile'))?.experiencia?.[0]).toMatchObject({ cargo: 'Auxiliar contable', cargoJefe: 'Jefe de contabilidad' });
  await page.evaluate(() => localStorage.setItem('hv.model', 'formato-unico'));
  await page.reload();
  await tab(page, 'Experiencia laboral').click();
  await expect(page.locator('li.item').first().getByLabel('Cargo o contrato')).toHaveValue('Auxiliar contable');
  await expect(page.locator('li.item input[name="cargoJefe"]')).toHaveCount(0);
});

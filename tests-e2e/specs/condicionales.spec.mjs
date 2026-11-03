// Campos condicionales (showIf, docs/CONDICIONALES.md): el formulario oculta lo que no aplica según las respuestas anteriores,
// conserva lo escrito, no lo valida ni lo imprime, y avisa cuando un texto no cabe en la casilla del PDF.
import { test, expect, openApp, readLS, nav } from '../helpers/fixtures.mjs';

const tab = (page, name) => page.getByRole('button', { name: new RegExp(name) }).first();
const f = (page, name) => page.locator(`[name="${name}"]`);
const stage = (page) => page.locator('.pv-stage');

/** Ejecuta `fn` y comprueba que los campos `deps` estén ocultos antes y visibles después (y de vuelta al revertir). */
async function toggles(page, { show, hide, deps }) {
  await hide();
  for (const d of deps) await expect(f(page, d), `${d} oculto`).toBeHidden();
  await show();
  for (const d of deps) await expect(f(page, d), `${d} visible`).toBeVisible();
  await hide();
  for (const d of deps) await expect(f(page, d), `${d} oculto otra vez`).toBeHidden();
}

test('ejemplo del enunciado: «Trabaja actualmente» No oculta empresa, vinculación y contrato; Sí los muestra', async ({ page }) => {
  await openApp(page, '/perfil');
  await tab(page, 'Información personal').click();
  for (const d of ['empresaActual', 'vinculacionActual', 'tipoContratoActual']) await expect(f(page, d)).toBeHidden(); // sin responder: ocultos
  await expect(page.locator('.cond-note').first()).toBeVisible();
  await f(page, 'trabajaActualmente').selectOption('Si');
  for (const d of ['empresaActual', 'vinculacionActual', 'tipoContratoActual']) await expect(f(page, d)).toBeVisible();
  await expect(page.locator('.sec-panel [role="status"], [role="status"]').filter({ hasText: /Ahora se muestran/ })).toHaveCount(1);
  await f(page, 'empresaActual').fill('ACME-QX1 S.A.S.');
  await f(page, 'tipoContratoActual').fill('Término fijo');
  await f(page, 'trabajaActualmente').selectOption('No');
  for (const d of ['empresaActual', 'vinculacionActual', 'tipoContratoActual']) await expect(f(page, d)).toBeHidden();
  // el valor oculto se CONSERVA en el almacenamiento...
  await expect.poll(async () => (await readLS(page, 'hv.profile'))?.infopersonal?.empresaActual).toBe('ACME-QX1 S.A.S.');
  // ...pero no se imprime
  await nav(page, 'Vista previa');
  await expect(stage(page).locator('.hv-sheet').first()).toBeVisible();
  await expect(stage(page)).not.toContainText('ACME-QX1');
  await expect(stage(page)).not.toContainText('Término fijo');
  // al cambiar de opinión vuelve tal cual, también en la hoja
  await nav(page, 'Perfil');
  await tab(page, 'Información personal').click();
  await f(page, 'trabajaActualmente').selectOption('Si');
  await expect(f(page, 'empresaActual')).toHaveValue('ACME-QX1 S.A.S.');
  await nav(page, 'Vista previa');
  await expect(stage(page)).toContainText('ACME-QX1');
});

test('el foco no se pierde, los ocultos salen del orden de tabulación y el controlador declara aria-controls', async ({ page }) => {
  await openApp(page, '/perfil', { profile: { infopersonal: { trabajaActualmente: 'Si' } } });
  await tab(page, 'Información personal').click();
  const ctrl = f(page, 'trabajaActualmente');
  const controls = await ctrl.getAttribute('aria-controls');
  expect(controls.split(' ').length).toBe(3);
  for (const id of controls.split(' ')) await expect(page.locator(`[id="${id}"]`)).toBeVisible();
  await ctrl.focus();
  await ctrl.selectOption('No');
  await expect(ctrl).toBeFocused();
  for (const id of controls.split(' ')) await expect(page.locator(`[id="${id}"]`)).toBeHidden();
  await page.keyboard.press('Tab');
  await expect(f(page, 'trabajoAntes')).toBeFocused(); // salta los tres ocultos
  await page.keyboard.press('Shift+Tab');
  await ctrl.selectOption('Si');
  await page.keyboard.press('Tab');
  await expect(f(page, 'empresaActual')).toBeFocused();
  await expect(page.locator('[role="status"]').filter({ hasText: /Ahora se muestran: .*empresa/ })).toHaveCount(1);
});

test('Información personal: las preguntas Sí/No muestran sus detalles', async ({ page }) => {
  await openApp(page, '/perfil');
  await tab(page, 'Información personal').click();
  const sel = (name, v) => () => f(page, name).selectOption(v);
  await toggles(page, { show: sel('solicitoAntes', 'Si'), hide: sel('solicitoAntes', 'No'), deps: ['fechaSolicitudAnterior'] });
  await toggles(page, { show: sel('recomendado', 'Si'), hide: sel('recomendado', 'No'), deps: ['recomendadoNombre', 'recomendadoDependencia'] });
  await toggles(page, { show: sel('parientes', 'Si'), hide: sel('parientes', 'No'), deps: ['parientesNombre', 'parientesDependencia'] });
  await toggles(page, { show: sel('comoSupo', 'Otro'), hide: sel('comoSupo', 'Amigo'), deps: ['comoSupoOtro'] });
  await toggles(page, { show: sel('vivienda', 'Alquilada'), hide: sel('vivienda', 'Propia'), deps: ['arrendador', 'arrendadorTelefono'] });
  await toggles(page, { show: sel('ingresoAdicional', 'Si'), hide: sel('ingresoAdicional', 'No'), deps: ['ingresoDescripcion', 'ingresoConceptos'] });
  await toggles(page, { show: sel('practicaDeporte', 'Si'), hide: sel('practicaDeporte', 'No'), deps: ['deporteCual'] });
  await toggles(page, { show: sel('distinciones', 'Si'), hide: sel('distinciones', 'No'), deps: ['distincionesCual'] });
  await toggles(page, { show: sel('asociacion', 'Si'), hide: sel('asociacion', 'No'), deps: ['asociacionCual'] });
  // siempre visibles (la casilla del PDF es siempre aplicable)
  for (const d of ['trabajoAntes', 'aceptaOtraCiudad', 'tiempoResidencia', 'obligacionesMensuales', 'aspiracionSalarial', 'aficiones']) await expect(f(page, d)).toBeVisible();
});

test('estado civil y personas a cargo: cónyuge y dependientes; sexo: libreta militar', async ({ page }) => {
  await openApp(page, '/perfil');
  await tab(page, 'Información general').click();
  // libreta militar: no aplica a mujeres; clase y distrito aparecen al escribir el número
  await f(page, 'sexo').selectOption('F');
  await expect(f(page, 'libretaMilitar')).toBeHidden();
  await f(page, 'sexo').selectOption('M');
  await expect(f(page, 'libretaMilitar')).toBeVisible();
  await expect(f(page, 'claseLibreta')).toBeHidden();
  await f(page, 'libretaMilitar').fill('12345678');
  await expect(f(page, 'claseLibreta')).toBeVisible();
  await expect(f(page, 'distritoMilitar')).toBeVisible();
  await expect(f(page, 'licenciaNumero')).toBeHidden();
  await f(page, 'licenciaConduccion').fill('B1');
  await expect(f(page, 'licenciaNumero')).toBeVisible();
  // estado civil -> cónyuge (otra sección)
  await f(page, 'estadoCivil').selectOption('Soltero(a)');
  await tab(page, 'Información familiar').click();
  for (const d of ['conyugeNombre', 'conyugeProfesion', 'conyugeEmpresa', 'conyugeCargo', 'conyugeDireccion', 'conyugeTelefono', 'conyugeCiudad']) await expect(f(page, d)).toBeHidden();
  await expect(f(page, 'padreNombre')).toBeVisible();
  await tab(page, 'Información general').click();
  await f(page, 'estadoCivil').selectOption('Unión libre');
  await tab(page, 'Información familiar').click();
  await expect(f(page, 'conyugeNombre')).toBeVisible();
  await f(page, 'conyugeNombre').fill('CONYUGE-QX2');
  await tab(page, 'Información general').click();
  await f(page, 'estadoCivil').selectOption('Viudo(a)');
  await nav(page, 'Vista previa');
  await expect(stage(page)).not.toContainText('CONYUGE-QX2');
  await expect((await readLS(page, 'hv.profile')).familiar.conyugeNombre).toBe('CONYUGE-QX2');
  // dependientes
  await nav(page, 'Perfil');
  await tab(page, 'Información familiar').click();
  await expect(f(page, 'parentescoDependientes')).toBeHidden();
  await f(page, 'personasACargo').fill('2');
  await expect(f(page, 'parentescoDependientes')).toBeVisible();
  await expect(f(page, 'edadesDependientes')).toBeVisible();
  await f(page, 'personasACargo').fill('0');
  await expect(f(page, 'edadesDependientes')).toBeHidden();
});

test('educación: nivel, graduado y estudios actuales', async ({ page }) => {
  await openApp(page, '/perfil');
  await tab(page, 'Educación básica y media').click();
  await expect(f(page, 'primariaInstitucion')).toBeVisible(); // sin nivel elegido, la primaria se pregunta
  await f(page, 'nivel').selectOption('Primaria');
  for (const d of ['bachilleratoTipo', 'aniosCursados', 'primariaInstitucion', 'primariaAnio']) await expect(f(page, d)).toBeHidden();
  await f(page, 'nivel').selectOption('Bachiller académico');
  for (const d of ['bachilleratoTipo', 'aniosCursados', 'primariaInstitucion', 'primariaAnio']) await expect(f(page, d)).toBeVisible();

  await tab(page, 'Educación superior').click();
  await page.getByRole('button', { name: 'Agregar estudio' }).first().click();
  const item = page.locator('li.item').first();
  const g = (n) => item.locator(`[name="${n}"]`);
  await expect(g('semestres')).toBeVisible();
  await expect(g('fechaGrado')).toBeHidden();
  await g('graduado').check();
  await expect(g('fechaGrado')).toBeVisible();
  await expect(g('semestres')).toBeHidden();
  await expect(g('tarjetaProfesional')).toBeVisible();
  await g('graduado').uncheck();
  await expect(g('fechaGrado')).toBeHidden();

  await tab(page, 'Estudios actuales').click();
  await toggles(page, { show: () => f(page, 'cursa').selectOption('Si'), hide: () => f(page, 'cursa').selectOption('No'), deps: ['tipoEstudios', 'duracion', 'anioSemestre', 'institucion', 'horario'] });
});

test('experiencia: «es mi trabajo actual» oculta fecha y motivo de retiro por registro; contrato y «otro»', async ({ page }) => {
  await openApp(page, '/perfil');
  await tab(page, 'Experiencia laboral').click();
  const add = page.getByRole('button', { name: 'Agregar experiencia' });
  await add.first().click();
  await add.first().click();
  const items = page.locator('li.item');
  const g = (i, n) => items.nth(i).locator(`[name="${n}"]`);
  await g(0, 'empresa').fill('PASADA-QX3');
  await g(0, 'motivoRetiro').fill('MOTIVO-QX3');
  await g(1, 'empresa').fill('ACTUAL-QX3');
  await g(1, 'actual').check();
  await expect(g(1, 'fechaFin')).toBeHidden();
  await expect(g(1, 'motivoRetiro')).toBeHidden();
  await expect(g(0, 'fechaFin')).toBeVisible(); // el otro registro no cambia
  await expect(g(0, 'motivoRetiro')).toBeVisible();
  await g(1, 'actual').uncheck();
  await expect(g(1, 'fechaFin')).toBeVisible();
  await g(1, 'actual').check();
  await g(1, 'motivoRetiro').evaluate((e) => e.value); // sigue en el DOM aunque oculto
  // contrato
  await expect(g(0, 'contratoDuracion')).toBeHidden();
  await g(0, 'contratoTermino').selectOption('Fijo');
  await expect(g(0, 'contratoDuracion')).toBeVisible();
  await expect(g(0, 'contratoOtro')).toBeHidden();
  await g(0, 'contratoVinculacion').selectOption('Otro');
  await expect(g(0, 'contratoOtro')).toBeVisible();
  await g(0, 'contratoVinculacion').selectOption('Directo');
  await expect(g(0, 'contratoOtro')).toBeHidden();
  await nav(page, 'Vista previa');
  await expect(stage(page)).toContainText('PASADA-QX3');
  await expect(stage(page)).toContainText('MOTIVO-QX3');
  await nav(page, 'Perfil');
  await tab(page, 'Experiencia laboral').click();
  await items.nth(0).locator('[name="actual"]').check();
  await nav(page, 'Vista previa');
  await expect(stage(page)).not.toContainText('MOTIVO-QX3');
});

test('seguridad social y trayectoria: afiliación y casillas «otros»', async ({ page }) => {
  await openApp(page, '/perfil');
  await tab(page, 'Seguridad social').click();
  const sel = (name, v) => () => f(page, name).selectOption(v);
  await toggles(page, { show: sel('eps', 'Si'), hide: sel('eps', 'No'), deps: ['epsNombre', 'epsFecha', 'epsTipo'] });
  await toggles(page, { show: sel('pension', 'Si'), hide: sel('pension', 'No'), deps: ['pensionNombre', 'pensionFecha'] });
  await toggles(page, { show: sel('cesantias', 'Si'), hide: sel('cesantias', 'No'), deps: ['cesantiasNombre', 'cesantiasFecha'] });
  await tab(page, 'Trayectoria por empresas').click();
  await expect(f(page, 'sectorOtros')).toBeHidden();
  await expect(f(page, 'areaOtras')).toBeHidden();
  const box = (label) => page.getByRole('checkbox', { name: label, exact: true });
  await box('OTROS SECTORES').check();
  await expect(f(page, 'sectorOtros')).toBeVisible();
  await box('Industria: otros').check();
  await expect(f(page, 'sectorIndustriaOtros')).toBeVisible();
  await box('Otras áreas').check();
  await expect(f(page, 'areaOtras')).toBeVisible();
  await box('OTROS SECTORES').uncheck();
  await expect(f(page, 'sectorOtros')).toBeHidden();
});

test('un perfil anterior (marca legacyConditions, controlador sin responder) no pierde su dato; en cuanto se responde manda la respuesta', async ({ page }) => {
  await openApp(page, '/perfil', { profile: { legacyConditions: true, infopersonal: { empresaActual: 'LEGADO-QX4' }, seguridadSocial: { epsNombre: 'EPS-QX4' } } });
  await tab(page, 'Información personal').click();
  await expect(f(page, 'empresaActual')).toHaveValue('LEGADO-QX4');
  await expect(f(page, 'vinculacionActual')).toBeHidden(); // sin dato propio: oculto hasta responder
  await f(page, 'trabajaActualmente').selectOption('No');
  await expect(f(page, 'empresaActual')).toBeHidden();
  await nav(page, 'Vista previa');
  await expect(stage(page)).not.toContainText('LEGADO-QX4');
  await expect(stage(page)).toContainText('EPS-QX4'); // seguridad social sin responder: el dato sigue saliendo
});

test('un perfil nuevo (sin marca) con el controlador sin responder oculta el dato y no lo imprime', async ({ page }) => {
  await openApp(page, '/perfil', { profile: { infopersonal: { empresaActual: 'NUEVO-QX5' }, seguridadSocial: { epsNombre: 'EPS-QX5' } } });
  await tab(page, 'Información personal').click();
  await expect(f(page, 'empresaActual')).toBeHidden();
  await nav(page, 'Vista previa');
  await expect(stage(page)).not.toContainText('NUEVO-QX5');
});

test('la vista previa no revisa ni exige lo que no aplica', async ({ page }) => {
  const bad = (vivienda) => ({ infopersonal: { vivienda, arrendadorTelefono: '12' } });
  await openApp(page, '/vista-previa', { profile: bad('Propia') });
  await expect(stage(page).locator('.hv-sheet').first()).toBeVisible();
  await expect(page.locator('.pv-banner')).not.toContainText(/arrendador/i);
  await openApp(page, '/vista-previa', { profile: bad('Alquilada') });
  await expect(page.locator('.pv-banner')).toContainText(/arrendador/i);
});

test('plantillas: los campos que no aplican se marcan «Condicional» y no cuentan', async ({ page }) => {
  const prof = (t) => ({ personales: { nombres: 'A', apellidos: 'B' }, infopersonal: { trabajaActualmente: t, empresaActual: 'X' } });
  await openApp(page, '/plantillas', { profile: prof('No') });
  await page.getByRole('button', { name: 'Nueva plantilla' }).first().click();
  const na = page.locator('.tpl-sec[data-sec="infopersonal"] .tpl-field.is-na');
  await expect(na.filter({ hasText: '¿En qué empresa?' })).toHaveCount(1);
  await expect(na.filter({ hasText: 'Condicional: no aplica' }).first()).toBeAttached();
  await openApp(page, '/plantillas', { profile: prof('Si') });
  await page.getByRole('button', { name: 'Nueva plantilla' }).first().click();
  await expect(page.locator('.tpl-sec[data-sec="infopersonal"] .tpl-field.is-na', { hasText: '¿En qué empresa?' })).toHaveCount(0);
});

test('texto más largo que la casilla del PDF: aviso visible, sin bloquear el guardado', async ({ page }) => {
  await openApp(page, '/perfil');
  await tab(page, 'Información general').click();
  const ap = f(page, 'apellidos');
  const fit = page.locator('.field', { has: ap }).locator('.field-fit');
  await ap.fill('Pérez');
  await expect(fit).toHaveClass(/is-ok/);
  await expect(fit).not.toContainText('No cabe');
  await ap.fill('x'.repeat(55)); // entre la letra normal (~42) y el máximo (~76)
  await expect(fit).toHaveClass(/is-small/);
  await expect(fit).toContainText('letra más pequeña');
  await expect(fit).toBeVisible();
  const long = 'Apellido muy largo '.repeat(8).trim();
  await ap.fill(long);
  await expect(fit).toHaveClass(/is-clip/);
  await expect(fit).toContainText('No cabe en la casilla del PDF');
  await expect(fit).toContainText(`${long.length} /`);
  await expect(ap).toHaveAttribute('aria-describedby', /-fit/);
  await expect.poll(async () => (await readLS(page, 'hv.profile'))?.personales?.apellidos).toBe(long); // se guarda completo
  await ap.fill('Pérez');
  await expect(fit).toHaveClass(/is-ok/);
  // varias líneas: el objetivo
  const perfil = f(page, 'perfil');
  await perfil.fill('palabra '.repeat(80));
  await expect(page.locator('.field', { has: perfil }).locator('.field-fit')).toHaveClass(/is-clip/);
});

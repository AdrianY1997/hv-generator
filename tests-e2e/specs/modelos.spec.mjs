// G02: segundo modelo (Formato Único de Hoja de Vida - Persona Natural, Función Pública) y selector de modelo.
//  - La fidelidad frente al PDF oficial vive en modelos-fidelidad.spec.mjs (necesita su propio navegador: antialias en gris).
//  - Cambio de modelo con los datos reutilizados, plantillas por modelo, páginas en vista previa e impresión, paquete PDF con capa de texto,
//    HTML autónomo y axe en el Perfil del nuevo modelo.
import fs from 'node:fs';
import { AxeBuilder } from '@axe-core/playwright';
import { test, expect, openApp, nav, readLS, waitPreview } from '../helpers/fixtures.mjs';

const FU = 'formato-unico';
const plain = (t) => t.replace(/^(?:[IVXL]+|\d+)\.\s+/, '');

const minervaProfile = () => ({
  personales: { nombres: 'Ana María', apellidos: 'Pérez Gómez', tipoDocumento: 'CC', numeroDocumento: '1020304050', sexo: 'F', estadoCivil: 'Soltero(a)', nacionalidad: 'Colombiana', fechaNacimiento: '1990-05-17', correo: 'ana.perez@example.com', celular: '3001234567', ciudad: 'Tunja', direccion: 'Calle 10 # 5-20' },
  familiar: { padreNombre: 'Jorge Pérez' },
  superior: [{ id: 'sup-1', modalidad: 'Profesional', programa: 'Ingeniería de sistemas', institucion: 'UPTC', graduado: true, fechaGrado: '2014-06-20' }],
  experiencia: [
    { id: 'exp-1', empresa: 'Gobernación de Boyacá', cargo: 'Profesional universitario', fechaInicio: '2019-02-01', actual: true },
    { id: 'exp-2', empresa: 'Industrias Ñandú S.A.S.', cargo: 'Analista', fechaInicio: '2015-01-15', fechaFin: '2018-12-31' },
  ],
});
const tpl = (id, name, modelId, extra = {}) => ({ id, name, ...(modelId ? { modelId } : {}), jobType: '', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
  include: { sections: {}, items: {}, fields: {}, documents: {} }, options: { showPhoto: false, attachCertificates: false, attachDocuments: false, objective: '' }, ...extra });

async function useModel(page, id) {
  await page.locator('#model-select').selectOption(id);
  await expect(page.locator('#app h1').first()).toBeVisible();
}
/** Páginas y texto de un PDF con el pdf.js de la app. */
const pdfText = (page, buf) => page.evaluate(async (b64) => {
  const pdfjs = await import('/vendor/pdfjs/pdf.min.js');
  pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js';
  const doc = await pdfjs.getDocument({ data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) pages.push((await (await doc.getPage(i)).getTextContent()).items.map((t) => t.str).join(' ').replace(/\s+/g, ' '));
  return pages;
}, Buffer.from(buf).toString('base64'));

test('cambiar de modelo reutiliza los datos y no borra lo del otro formato', async ({ page }) => {
  await openApp(page, '/perfil', { profile: minervaProfile() });
  await useModel(page, FU);
  await expect(page.locator('.sec-tab[data-sec="familiar"]')).toHaveCount(0); // solo las secciones del formato activo
  await page.locator('.sec-tab[data-sec="personales"]').click();
  await expect(page.locator('.sec-panel h2')).toHaveText('Datos personales');
  await expect(page.locator('input[name="nombres"]')).toHaveValue('Ana María');
  await expect(page.locator('input[name="numeroDocumento"]')).toHaveValue('1020304050');
  await expect(page.locator('input[name="primerApellido"]')).toHaveAttribute('placeholder', 'Se usará: Pérez');
  await expect(page.locator('.sec-tab[data-sec="personales"] .n')).toBeHidden(); // el primer apellido derivado no cuenta como pendiente
  await page.locator('input[name="nacimientoMunicipio"]').fill('Sogamoso');
  await page.locator('input[name="segundoApellido"]').fill('Gómez');
  await page.locator('input[name="primerApellido"]').fill('Pérez');
  await expect.poll(async () => (await readLS(page, 'hv.profile'))?.personales?.primerApellido).toBe('Pérez');
  const saved = await readLS(page, 'hv.profile');
  expect(saved.personales).toMatchObject({ apellidos: 'Pérez Gómez', estadoCivil: 'Soltero(a)', nacimientoMunicipio: 'Sogamoso' }); // lo de Minerva sigue
  expect(saved.familiar).toEqual({ padreNombre: 'Jorge Pérez' });
  expect(await page.evaluate(() => localStorage.getItem('hv.model'))).toBe(FU);
  // Documentos del Formato Único: los mismos ids que Minerva (la lista y los archivos son comunes) más bienes y rentas (ahora también en el registro común).
  await nav(page, 'Documentos');
  await page.getByRole('button', { name: /Añadir documento/ }).click();
  await expect(page.getByText('Declaración de bienes y rentas (SIGEP)')).toBeVisible();
  await page.keyboard.press('Escape');
  // Vista previa del Formato Único con los datos escritos en Minerva.
  await nav(page, 'Vista previa');
  await waitPreview(page);
  const stage = page.locator('.pv-stage');
  await expect(stage.locator('.pv-zoom')).toHaveAttribute('data-model', FU);
  for (const v of ['Pérez', 'Gómez', 'Ana María', 'Gobernación de Boyacá', 'Industrias Ñandú S.A.S.', 'Ingeniería de sistemas', 'Sogamoso']) await expect(stage.locator('.mv-f', { hasText: v }).first()).toBeAttached();
  // De vuelta a Minerva: el selector recuerda el modelo y el dato derivado (lugar de nacimiento) sale en su casilla.
  await useModel(page, 'minerva');
  await waitPreview(page);
  await expect(stage.locator('.mv-f', { hasText: 'Pérez Gómez' }).first()).toBeAttached();
  await nav(page, 'Perfil');
  await page.locator('.sec-tab[data-sec="personales"]').click();
  await expect(page.locator('input[name="lugarNacimiento"]')).toHaveAttribute('placeholder', 'Se usará: Sogamoso');
});

test('plantillas por modelo: la lista filtra, la nueva queda en su modelo y la vista previa usa el modelo de la plantilla', async ({ page }) => {
  await openApp(page, '/plantillas', { profile: minervaProfile(), templates: [tpl('t-min', 'De Minerva', 'minerva'), tpl('t-old', 'Antigua sin modelo', null), tpl('t-fu', 'Para la alcaldía', FU)] });
  const names = () => page.locator('.tpl-card h2').allInnerTexts();
  expect(await names()).toEqual(['De Minerva', 'Antigua sin modelo']);
  await expect(page.locator('.tpl-others')).toContainText('1 plantilla(s) de otro formato');
  await useModel(page, FU);
  expect(await names()).toEqual(['Para la alcaldía']);
  await page.getByRole('button', { name: 'Nueva plantilla' }).click();
  await expect(page.getByText('Mostrar fotografía')).toHaveCount(0); // el formato no tiene foto ni objetivo
  await expect(page.locator('#tpl-obj')).toHaveCount(0);
  await expect(page.locator('.tpl-sec[data-sec="tiempoExperiencia"]')).toBeVisible();
  await page.locator('#tpl-name').fill('Concurso DAFP');
  await page.getByRole('button', { name: 'Guardar plantilla' }).click();
  await expect(page.locator('.tpl-card h2', { hasText: 'Concurso DAFP' })).toBeVisible();
  const list = await readLS(page, 'hv.templates');
  expect(list.find((t) => t.name === 'Concurso DAFP').modelId).toBe(FU);
  expect(Object.keys(list.find((t) => t.name === 'Concurso DAFP').include.sections)).toContain('declaracion');
  // Vista previa: el selector solo ofrece las del modelo activo...
  await nav(page, 'Vista previa');
  await waitPreview(page);
  expect(await page.locator('#pv-template option').allInnerTexts()).toEqual(['Hoja de vida completa (sin plantilla)', 'Para la alcaldía', 'Concurso DAFP']);
  // ...y una plantilla de Minerva pedida por enlace se dibuja con Minerva aunque el encabezado diga Formato Único.
  await page.goto('/index.html#/vista-previa?template=t-min');
  await waitPreview(page);
  await expect(page.locator('.pv-zoom')).toHaveAttribute('data-model', 'minerva');
  await expect(page.locator('.pv-stage .hv-sheet')).toHaveCount(4);
  await expect(page.locator('#pv-template')).toHaveValue('t-min');
});

test('Formato Único: hojas en vista previa, impresión (Carta y A4) y hojas de experiencia repetidas', async ({ page }) => {
  test.setTimeout(90_000);
  const p = minervaProfile();
  p.experiencia.push(...Array.from({ length: 4 }, (_, i) => ({ id: `exp-x${i}`, empresa: `Empresa anterior ${i + 1}`, cargo: 'Auxiliar', fechaInicio: `20${10 + i}-01-01`, fechaFin: `20${10 + i}-12-31` })));
  p.superior.push(...Array.from({ length: 5 }, (_, i) => ({ id: `sup-x${i}`, modalidad: 'Técnica', programa: `Técnico ${i + 1}` })));
  await openApp(page, '/vista-previa', { profile: p });
  await useModel(page, FU);
  await waitPreview(page);
  // 1 actual + 5 anteriores -> 2 hojas de experiencia; 6 estudios -> 1 en la hoja de continuación.
  await expect(page.locator('.pv-stage .hv-sheet')).toHaveCount(4);
  await expect(page.locator('.pv-stage .hv-cont')).toContainText('Técnico 5');
  await page.evaluate(() => { window.print = () => {}; });
  for (const paper of ['letter', 'a4']) {
    await page.locator('#pv-paper').selectOption(paper);
    await page.getByRole('button', { name: 'Imprimir', exact: true }).click();
    await page.emulateMedia({ media: 'print' });
    const pages = await pdfText(page, await page.pdf({ preferCSSPageSize: true, printBackground: true }));
    expect(pages.length, `páginas impresas (${paper})`).toBe(5); // 4 hojas + continuación
    expect(pages[0]).toContain('DATOS PERSONALES');
    expect(pages[0]).toContain('Pérez');
    expect(pages[1]).toContain('Gobernación de Boyacá');
    expect(pages[2]).toContain('Empresa anterior 1');
    expect(pages[3]).toContain('TIEMPO TOTAL DE EXPERIENCIA');
    expect(pages.join(' ')).not.toContain('Contenido de la hoja de vida en lectura lineal');
    await page.emulateMedia({ media: 'screen' });
  }
});

test('Formato Único: paquete PDF con capa de texto y HTML autónomo', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openApp(page, '/vista-previa', { profile: minervaProfile() });
  await useModel(page, FU);
  await waitPreview(page);
  const dl = page.waitForEvent('download');
  await page.locator('#pv-package').click();
  const file = testInfo.outputPath('paquete-fu.pdf');
  await (await dl).saveAs(file);
  await expect(page.locator('.pv-notice')).toContainText(/Listo: 3 página\(s\) \(3 de la HV y 0 de anexos\)/);
  const pages = await pdfText(page, fs.readFileSync(file));
  expect(pages.length).toBe(3);
  const all = pages.join(' ');
  for (const v of ['DATOS PERSONALES', 'Pérez', 'Gómez', 'Ana María', '1020304050', 'Gobernación de Boyacá', 'EXPERIENCIA LABORAL', 'FIRMA DEL SERVIDOR']) expect(all, `capa de texto: ${v}`).toContain(v);
  expect(all.split('Ana María').length - 1, 'el nombre una sola vez (la lectura lineal no entra al paquete)').toBe(1);
  expect(all).not.toContain('dafp.gov.co');
  // HTML autónomo: un solo archivo, con el CSS del papel y el escudo incrustados.
  const dl2 = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar HTML autónomo' }).click();
  const html = fs.readFileSync(await (await dl2).path(), 'utf8');
  expect(html.match(/class="hv-sheet"/g)).toHaveLength(3);
  expect(html).toContain('.mv-page{');
  expect(html).toContain('href="data:image/png;base64,');
  expect(html).not.toMatch(/<(?:link|script)\b/);
});

test.describe('axe @a11y: Perfil del Formato Único', () => {
  for (const theme of ['light', 'dark']) {
    test(`todas las secciones (${theme})`, async ({ page }) => {
      test.setTimeout(90_000);
      await openApp(page, '/perfil', { profile: minervaProfile(), theme });
      await useModel(page, FU);
      const secs = await page.locator('.sec-tab').evaluateAll((bs) => bs.map((b) => [b.dataset.sec, b.querySelector('.sec-tab__t').textContent]));
      expect(secs.length).toBe(8);
      for (const [id, title] of secs) {
        await page.locator(`.sec-tab[data-sec="${id}"]`).click();
        await expect(page.locator('.sec-panel h2')).toHaveText(plain(title));
        if (id === 'tiempoExperiencia') {
          await page.locator('select[name="calculo"]').selectOption('manual'); // muestra los campos condicionales
          await expect(page.locator('.cond-in')).toHaveCount(0); // termina la animación de entrada (axe mediría el contraste a mitad del fundido)
        }
        const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
        expect(violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`), `perfil/${id} (${theme})`).toEqual([]);
      }
    });
  }
});

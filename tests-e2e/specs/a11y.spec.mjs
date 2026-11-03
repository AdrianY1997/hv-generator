// Accesibilidad (axe-core, WCAG 2.0/2.1/2.2 A y AA + buenas prácticas): cero violaciones en las vistas y estados principales, en claro y oscuro.
// Complementa tools/a11y.mjs (28 estados x 4 configuraciones); aquí vive en el repo y corre en CI.
import { AxeBuilder } from '@axe-core/playwright';
import { test, expect, openApp, putFiles } from '../helpers/fixtures.mjs';
import { fullProfile, makePng, tinyPdf, template, SECTIONS } from '../helpers/data.mjs';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
async function audit(page, label) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n   ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join('\n   ')}`);
  expect(summary, `violaciones de axe en ${label}`).toEqual([]);
}
const plain = (t) => t.replace(/^[IVXL]+\.\s+/, '');
const files = [
  { id: 'photo', name: 'f.png', type: 'image/png', data: makePng(60, 80) },
  { id: 'doc:cedula', name: 'cedula.pdf', type: 'application/pdf', data: tinyPdf('Cedula') },
  { id: 'doc:procuraduria', name: 'proc.png', type: 'image/png', data: makePng(60, 60) },
];
const profile = () => { const p = fullProfile(); p.documents = { cedula: ['doc:cedula'], procuraduria: ['doc:procuraduria'] }; return p; };

// El título lleva @a11y para poder correr solo estas pruebas (npm run a11y) o excluirlas (--grep-invert @a11y).
test.describe('axe @a11y', () => {
  for (const theme of ['light', 'dark']) {
    test.describe(`tema ${theme}`, () => {
      test('Perfil: las 16 secciones', async ({ page }) => {
        await openApp(page, '/perfil', { profile: profile(), theme });
        for (const s of SECTIONS) {
          await page.locator(`.sec-tab[data-sec="${s.id}"]`).click();
          await expect(page.locator('.sec-panel h2')).toHaveText(plain(s.title));
          await audit(page, `perfil/${s.id} (${theme})`);
        }
      });

      test('Perfil: secciones con campos condicionales ocultos, mostrados y aviso de texto largo', async ({ page }) => {
        await openApp(page, '/perfil', { theme });
        for (const s of SECTIONS) { // perfil vacío: los campos condicionales están ocultos y cada sección muestra su nota
          await page.locator(`.sec-tab[data-sec="${s.id}"]`).click();
          await expect(page.locator('.sec-panel h2')).toHaveText(plain(s.title));
          await audit(page, `perfil vacío/${s.id} (${theme})`);
        }
        await page.locator('.sec-tab[data-sec="infopersonal"]').click();
        await page.locator('select[name="trabajaActualmente"]').selectOption('Si'); // se muestran los dependientes (aria-controls, región viva)
        await expect(page.locator('input[name="empresaActual"]')).toBeVisible();
        await audit(page, `infopersonal con condicionales visibles (${theme})`);
        await page.locator('select[name="trabajaActualmente"]').selectOption('No');
        await audit(page, `infopersonal con condicionales ocultos tras responder (${theme})`);
        await page.locator('.sec-tab[data-sec="personales"]').click();
        await page.locator('input[name="apellidos"]').fill('Apellido muy largo '.repeat(8));
        await expect(page.locator('.field-fit.is-clip')).toBeVisible();
        await audit(page, `aviso de texto largo (${theme})`);
        await page.locator('input[name="apellidos"]').fill('x'.repeat(55));
        await expect(page.locator('.field-fit.is-small')).toBeVisible();
        await audit(page, `aviso de letra reducida (${theme})`);
      });

      test('Perfil vacío y diálogo del editor de foto', async ({ page }) => {
        await openApp(page, '/perfil', { theme });
        await audit(page, `perfil vacío (${theme})`);
        await page.getByRole('button', { name: /Información general/ }).click();
        await page.locator('.photo-field input[type="file"]').setInputFiles({ name: 'yo.png', mimeType: 'image/png', buffer: makePng(300, 400) });
        const dlg = page.getByRole('dialog', { name: 'Ajusta tu fotografía' });
        await expect(dlg.getByRole('button', { name: 'Guardar foto' })).toBeEnabled();
        await audit(page, `editor de foto (${theme})`);
      });

      test('Documentos: vacío, con archivos y selector', async ({ page }) => {
        await openApp(page, '/documentos', { profile: profile(), theme });
        await audit(page, `documentos sin archivos (${theme})`);
        await putFiles(page, files);
        await page.reload();
        await expect(page.locator('li.doc[data-doc="cedula"] .file-name')).toBeVisible();
        await audit(page, `documentos con archivos (${theme})`);
        await page.getByRole('button', { name: 'Añadir documento' }).first().click();
        await expect(page.getByRole('dialog', { name: 'Documentos de tu lista' })).toBeVisible();
        await audit(page, `selector de documentos (${theme})`);
      });

      test('Plantillas: lista, editor y nueva', async ({ page }) => {
        const t = template('Cargo administrativo'); t.jobType = 'Administrativo';
        await openApp(page, '/plantillas', { profile: profile(), templates: [t, template('Cargo operativo')], theme });
        await audit(page, `plantillas lista (${theme})`);
        await page.getByRole('button', { name: 'Editar plantilla: Cargo administrativo' }).click();
        await expect(page.locator('#tpl-name')).toBeVisible();
        await audit(page, `plantilla editor (${theme})`);
        await page.getByRole('button', { name: 'Cancelar' }).click();
        await page.getByRole('button', { name: 'Nueva plantilla' }).click();
        await expect(page.locator('#tpl-name')).toHaveValue('');
        await audit(page, `plantilla nueva (${theme})`);
      });

      test('Vista previa: hoja, con plantilla y diálogo de importar', async ({ page }) => {
        const t = template('Con anexos');
        await openApp(page, '/vista-previa', { profile: profile(), templates: [t], theme });
        await expect(page.locator('.pv-stage .hv-sheet').first()).toBeVisible();
        await audit(page, `vista previa (${theme})`);
        await page.locator('#pv-template').selectOption({ label: 'Con anexos' });
        await expect(page).toHaveURL(/template=/);
        await expect(page.locator('.pv-stage .hv-sheet').first()).toBeVisible();
        await audit(page, `vista previa con plantilla (${theme})`);
        const bk = { app: 'hv-minerva', schemaVersion: 1, exportedAt: new Date().toISOString(), profile: { personales: { nombres: 'X' } }, templates: [], files: [] };
        await page.locator('.pv-more input[type="file"]').setInputFiles({ name: 'r.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bk)) });
        await expect(page.getByRole('dialog', { name: 'Importar respaldo' })).toBeVisible();
        await audit(page, `diálogo de importar (${theme})`);
      });

      test('Ajustes: base, huérfanos y diálogo de borrar', async ({ page }) => {
        await openApp(page, '/ajustes', { profile: profile(), theme, files: [...files, { id: 'cert:suelto', name: 'suelto.png', type: 'image/png', data: makePng(40, 40) }] });
        await audit(page, `ajustes (${theme})`);
        await page.getByRole('button', { name: 'Revisar archivos huérfanos' }).click();
        await expect(page.locator('.aj-orph li').first()).toBeVisible();
        await audit(page, `ajustes con huérfanos (${theme})`);
        await page.getByRole('button', { name: 'Borrar todos mis datos' }).click();
        await expect(page.getByRole('dialog', { name: '¿Borrar todos tus datos?' })).toBeVisible();
        await audit(page, `diálogo de borrar (${theme})`);
      });
    });
  }

  test('móvil (375 px): vistas principales sin violaciones ni scroll horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await openApp(page, '/perfil', { profile: profile() });
    for (const route of ['/perfil', '/documentos', '/plantillas', '/vista-previa', '/ajustes']) {
      await page.goto('/index.html#' + route);
      await expect(page.locator('#app h1').first()).toBeVisible();
      await audit(page, `${route} a 375 px`);
      if (route !== '/vista-previa') expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `scroll horizontal en ${route}`).toBe(true);
    }
  });
});

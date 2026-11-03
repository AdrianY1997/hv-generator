// G08: la HV para lector de pantalla y el HTML autónomo.
//  - Las hojas del formulario son un SVG de rótulos + <div> de valores posicionados: un lector leería valores sin rótulo. Van aria-hidden y la
//    lectura lineal (.hv-sr: grupos con lista de definición rótulo -> valor) las sustituye. No debe cambiar la geometría ni imprimirse.
//  - El HTML autónomo (solo paper.css + ajustes propios) cumple el contraste AA de las cabeceras de la hoja de continuación.
import fs from 'node:fs';
import { AxeBuilder } from '@axe-core/playwright';
import { test, expect, openApp, waitPreview } from '../helpers/fixtures.mjs';
import { fullProfile, overflowProfile, template } from '../helpers/data.mjs';

test.describe('hoja de vida accesible @a11y', () => {
  test('lectura lineal: rótulo del schema y valor juntos; hojas aria-hidden; sin cambiar la geometría', async ({ page }) => {
    await openApp(page, '/vista-previa', { profile: fullProfile() });
    await waitPreview(page);
    const sr = page.locator('.pv-stage .hv-sr');
    await expect(sr).toHaveCount(1);
    await expect(sr).toHaveAttribute('role', 'group');
    await expect(page.locator('.pv-stage .hv-sheet[aria-hidden="true"]')).toHaveCount(4);
    // Cada <dt> va seguido de su <dd>: el rótulo viaja con el valor.
    const pair = await page.evaluate(() => {
      const g = document.querySelector('.hv-sr [aria-label="I. Información general"]');
      const dts = [...g.querySelectorAll('dt')];
      return { n: dts.length, ok: dts.every((d) => d.nextElementSibling?.tagName === 'DD'), nombres: dts.find((d) => d.textContent === 'Nombres')?.nextElementSibling?.textContent };
    });
    expect(pair.n).toBeGreaterThan(5);
    expect(pair.ok).toBe(true);
    expect(pair.nombres).toBe('Ana María');
    // Árbol de accesibilidad: la lectura lineal está; las hojas (valores sueltos) no.
    const snap = await sr.ariaSnapshot();
    expect(snap).toContain('Nombres');
    expect(snap).toContain('Ana María');
    expect(await page.locator('.pv-stage .hv-sheet').first().ariaSnapshot()).not.toContain('Ana María');
    // Invisible y sin efecto en la maquetación.
    const box = await sr.boundingBox();
    expect(box.width).toBeLessThanOrEqual(1);
    expect(box.height).toBeLessThanOrEqual(1);
    const geo = () => page.locator('.pv-stage .hv-sheet').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map((n) => Math.round(n * 100) / 100); }));
    const before = await geo();
    await page.evaluate(() => document.querySelector('.hv-sr').remove());
    expect(await geo()).toEqual(before);
  });

  test('no se imprime (display:none en el medio print)', async ({ page }) => {
    await openApp(page, '/vista-previa', { profile: fullProfile() });
    await waitPreview(page);
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.hv-sr')).toBeHidden();
    expect(await page.locator('.hv-sr').evaluate((e) => getComputedStyle(e).display)).toBe('none');
  });

  test('con plantilla: solo lo incluido; lo que desborda queda en las tablas de continuación', async ({ page }) => {
    const t = template('Sin referencias'); t.include.sections.referencias = false;
    await openApp(page, `/vista-previa?template=${t.id}`, { profile: overflowProfile(14, 12), templates: [t] });
    await waitPreview(page);
    const info = await page.evaluate(() => ({
      refs: !!document.querySelector('.hv-sr [aria-label^="Referencias"]'),
      cont: document.querySelectorAll('.hv-cont .hv-tbl').length,
    }));
    expect(info.refs).toBe(false);
    expect(info.cont).toBeGreaterThan(0);
    // El texto de un registro que desborda no se duplica en la lectura lineal (ya está en la continuación).
    const spilled = await page.evaluate(() => {
      const cell = document.querySelector('.hv-cont .hv-tbl tbody td')?.textContent || '';
      return { cell, inSr: cell ? document.querySelector('.hv-sr').textContent.includes(cell) : null };
    });
    expect(spilled.cell.length).toBeGreaterThan(0);
    expect(spilled.inSr).toBe(false);
  });

  test('la lectura lineal sigue lo impreso: con objetivo de plantilla sustituye al perfil profesional', async ({ page }) => {
    const t = template('Con objetivo'); t.options.objective = 'Objetivo exclusivo XYZ';
    const p = fullProfile(); p.personales.perfil = 'Perfil profesional ABC';
    await openApp(page, `/vista-previa?template=${t.id}`, { profile: p, templates: [t] });
    await waitPreview(page);
    const txt = await page.locator('.hv-sr').textContent();
    expect(txt).toContain('Objetivo exclusivo XYZ');
    expect(txt).not.toContain('Perfil profesional ABC');
    await page.goto('/index.html#/vista-previa');
    await waitPreview(page);
    expect(await page.locator('.hv-sr').textContent()).toContain('Perfil profesional ABC');
  });

  test('HTML autónomo: contraste AA de la hoja de continuación y lectura lineal sin imprimir', async ({ page }, testInfo) => {
    await openApp(page, '/vista-previa', { profile: overflowProfile(14, 12) });
    await waitPreview(page);
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Descargar HTML autónomo' }).click();
    const file = testInfo.outputPath('hv.html');
    await (await dl).saveAs(file);
    const html = fs.readFileSync(file, 'utf8');
    expect(html).toContain('.hv-doc .hv-tbl th{color:#12467a}');
    expect(html).toContain('class="hv-sr"');
    await page.goto('about:blank');
    await page.setContent(html);
    await expect(page.locator('.hv-cont .hv-tbl th').first()).toBeVisible();
    const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ') + ' ' + (n.any[0]?.message || '')).join(' | ')}`)).toEqual([]);
    await page.emulateMedia({ media: 'print' });
    expect(await page.locator('.hv-sr').evaluate((e) => getComputedStyle(e).display)).toBe('none');
  });
});

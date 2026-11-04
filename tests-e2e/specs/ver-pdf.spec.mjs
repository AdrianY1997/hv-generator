// "Ver" un PDF adjunto: abre el blob en una pestaña nueva CON la CSP de index.html activa. Comprueba que el visor de PDF del navegador se monta y que no hay violaciones de la CSP en la ventana nueva ni en la app.
// (Observado en Chromium: la ventana abierta con noopener no hereda la CSP del documento, y aun así se deja object-src/frame-src blob:.
// Que el worker de pdf.js siga siendo una URL del mismo origen lo guarda app/tests/csp.test.mjs; la ingesta real la cubre documentos.spec.mjs.)
import { test, expect, openApp } from '../helpers/fixtures.mjs';
import { fullProfile, tinyPdf } from '../helpers/data.mjs';

// El visor de PDF solo existe en Chromium completo (el "headless shell" de Playwright descarga el PDF en vez de mostrarlo).
test.use({ channel: 'chromium', allowConsoleErrors: true });

test('Ver: el PDF subido abre en una pestaña nueva sin violaciones de la CSP', async ({ page, context }) => {
  const seen = [];
  await context.addInitScript(() => { document.addEventListener('securitypolicyviolation', (e) => console.log(`CSPV ${e.violatedDirective} ${e.blockedURI}`)); });
  context.on('page', (p) => { p.on('console', (m) => seen.push(m.text())); });
  page.on('console', (m) => seen.push(m.text()));

  await openApp(page, '/documentos', { profile: fullProfile(), files: [{ id: 'doc:cedula', name: 'cedula.pdf', type: 'application/pdf', data: tinyPdf('Cedula de prueba', 1) }] });
  const verBtn = page.getByRole('button', { name: /^Ver archivo/ }).first();
  await expect(verBtn).toBeVisible();
  const [popup] = await Promise.all([context.waitForEvent('page'), verBtn.click()]);
  await popup.waitForLoadState('load').catch(() => {});
  // Da tiempo a que el visor monte su marco/plugin (si la CSP lo bloquea, el aviso llega a la consola).
  await expect.poll(async () => popup.url(), { timeout: 10000 }).toMatch(/^blob:http:\/\/127\.0\.0\.1:\d+\//);
  await popup.waitForTimeout(1500);
  const info = await popup.evaluate(() => ({ type: document.contentType, embeds: [...document.querySelectorAll('embed,object,iframe')].map((e) => e.getAttribute('type') || e.tagName) })).catch(() => null);
  const frames = popup.frames().map((f) => f.url());
  const violations = seen.filter((t) => /CSPV |Content Security Policy|Refused to/i.test(t));
  expect(violations, 'violaciones de la CSP al abrir el PDF').toEqual([]);
  expect(info?.type).toBe('application/pdf');
  expect(frames.some((u) => u.startsWith('chrome-extension://')), 'el visor de PDF del navegador se montó').toBe(true);
});

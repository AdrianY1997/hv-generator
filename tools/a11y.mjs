#!/usr/bin/env node
// Auditoria de accesibilidad de HV Minerva con axe-core + Playwright (herramienta de desarrollo; NO se despliega).
// Uso:  node tools/a11y.mjs [--deps <carpeta con node_modules de axe-core y playwright>] [--json salida.json] [--only perfil,documentos]
// Instalacion de dependencias: ver tools/README.md. Sirve app/ en un puerto local temporal y lo apaga al terminar.
import fs from 'node:fs';
import { arg, chromium, axeSrc, BASE, server, SEED, tinyPdf, settle, go, choose, png } from './_lib.mjs';
const ONLY = (arg('only', '') || '').split(',').filter(Boolean);
const JSON_OUT = arg('json', '');

const STATES = [
  { id: 'perfil', run: async (page, audit) => {
    await go(page, '/perfil');
    const n = await page.locator('.mn-sidenav button').count();
    for (let i = 0; i < n; i++) {
      await page.locator('.mn-sidenav button').nth(i).click(); await settle(page, 150);
      await audit('perfil-seccion-' + (i + 1));
    }
    // Foto: abre el editor
    await page.locator('.mn-sidenav button').first().click(); await settle(page, 100);
    await page.locator('.mn-sidenav button').nth(1).click(); await settle(page, 100);
    const btn = page.getByRole('button', { name: /Elegir fotografía|Reemplazar: Fotografía/ }).first();
    if (await btn.count()) {
      await choose(page, btn, await png(page), 'foto.png', 'image/png');
      await page.waitForSelector('dialog.pe-dialog[open]'); await settle(page, 500);
      await audit('perfil-dialogo-foto', 'dialog.pe-dialog');
      await page.keyboard.press('Escape'); await settle(page, 200);
    }
  } },
  { id: 'documentos', run: async (page, audit) => {
    await go(page, '/documentos');
    await audit('documentos-vacio');
    const slot = page.getByRole('button', { name: /^Elegir archivo/ }).first();
    if (await slot.count()) { await choose(page, slot, tinyPdf('Certificado de antecedentes. Fecha de expedicion: 01/10/2026'), 'cert.pdf', 'application/pdf'); await settle(page, 1500); }
    const slot2 = page.getByRole('button', { name: /^Elegir archivo/ }).first();
    if (await slot2.count()) { await choose(page, slot2, await png(page), 'cedula.png', 'image/png'); await settle(page, 600); }
    await audit('documentos-filas');
    await page.locator('#doc-add').click(); await page.waitForSelector('dialog[open]'); await settle(page, 300);
    await audit('documentos-selector', 'dialog[open]');
    await page.keyboard.press('Escape'); await settle(page, 200);
  } },
  { id: 'plantillas', run: async (page, audit) => {
    await go(page, '/plantillas');
    await audit('plantillas-lista');
    await page.getByRole('button', { name: /^Editar/ }).first().click().catch(() => {});
    await settle(page, 400);
    await audit('plantillas-editor');
    await page.getByRole('button', { name: 'Cancelar' }).first().click().catch(() => {});
    await settle(page, 200);
    await page.getByRole('button', { name: /Nueva plantilla|Crear/ }).first().click().catch(() => {});
    await settle(page, 400);
    await audit('plantillas-nueva');
  } },
  { id: 'vista-previa', run: async (page, audit) => {
    await go(page, '/vista-previa'); await settle(page, 800);
    await audit('vista-previa');
    const imp = page.getByRole('button', { name: /Importar/ }).first();
    if (await imp.count()) {
      const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 3000 }).catch(() => null), imp.click()]);
      if (fc) { await fc.setFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"app":"hv-minerva","version":1,"profile":{},"templates":[],"files":[]}') }); await settle(page, 600); }
      if (await page.locator('dialog[open]').count()) await audit('vista-previa-importar', 'dialog[open]');
      await page.keyboard.press('Escape').catch(() => {});
    }
  } },
  { id: 'ajustes', run: async (page, audit) => {
    await go(page, '/ajustes');
    await audit('ajustes');
    const o = page.getByRole('button', { name: /huérfanos/ }).first();
    if (await o.count()) { await o.click(); await settle(page, 600); await audit('ajustes-huerfanos'); }
    const w = page.getByRole('button', { name: /Borrar todos/ }).first();
    if (await w.count()) { await w.click(); await settle(page, 300); if (await page.locator('dialog[open]').count()) await audit('ajustes-borrar', 'dialog[open]'); await page.keyboard.press('Escape').catch(() => {}); }
  } },
];

// ---------- ejecucion ----------
const CONFIGS = [];
for (const theme of ['light', 'dark']) for (const [vp, size] of [['desktop', { width: 1280, height: 900 }], ['375', { width: 375, height: 700 }]]) CONFIGS.push({ theme, vp, size });
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const results = [];
const consoleErrors = [];
const audited = new Set();
const extra = []; // comprobaciones propias (reflujo, objetivos tactiles, movimiento reducido)
const ROUTES = ['/perfil', '/documentos', '/plantillas', '/vista-previa', '/ajustes'];
const browser = await chromium.launch();
for (const cfg of CONFIGS) {
  const ctx = await browser.newContext({ viewport: cfg.size, colorScheme: cfg.theme, deviceScaleFactor: 1, serviceWorkers: 'block', acceptDownloads: true });
  await ctx.addInitScript(({ theme }) => { try { localStorage.setItem('hv.theme', theme); } catch {} }, { theme: cfg.theme });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[${cfg.theme}/${cfg.vp}] ${m.text()}`); });
  page.on('pageerror', (e) => consoleErrors.push(`[${cfg.theme}/${cfg.vp}] pageerror ${e.message}`));
  page.on('dialog', (d) => d.accept().catch(() => {}));
  await page.goto(BASE + '#/perfil');
  await page.evaluate(SEED);
  for (const st of STATES) {
    if (ONLY.length && !ONLY.includes(st.id)) continue;
    const audit = async (name, include) => {
      audited.add(`${name}@${cfg.theme}/${cfg.vp}`);
      await page.evaluate(axeSrc);
      const res = await page.evaluate(async ({ tags, include }) => axe.run(include ? { include: [include] } : document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] }), { tags: TAGS, include });
      for (const v of res.violations) results.push({ cfg: `${cfg.theme}/${cfg.vp}`, state: name, id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => ({ target: n.target.join(' '), summary: (n.failureSummary || '').split('\n').slice(1, 3).join(' | ').slice(0, 220) })) });
    };
    try { await st.run(page, audit); } catch (e) { results.push({ cfg: `${cfg.theme}/${cfg.vp}`, state: st.id, id: 'SCRIPT-ERROR', impact: 'script', help: e.message.split('\n')[0], nodes: [] }); }
  }
  // --- comprobaciones propias (una vez por configuracion de tema/ancho) ---
  if (!ONLY.length) {
    for (const r of ROUTES) {
      await go(page, r);
      const small = await page.evaluate(() => {
        const vis = (e) => { const b = e.getBoundingClientRect(); const s = getComputedStyle(e); return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && !e.closest('[hidden],[aria-hidden="true"]'); };
        const out = [];
        for (const e of document.querySelectorAll('button,select,input:not([type=hidden]):not(.mn-sr),textarea,summary,[role=button],a.mn-btn,.mn-nav a,.mn-brand')) {
          if (!vis(e)) continue;
          const lab = e.labels?.[0]; const b = (e.type === 'checkbox' || e.type === 'radio') && lab ? lab.getBoundingClientRect() : e.getBoundingClientRect();
          if (Math.min(b.width, b.height) < 24) out.push(`${e.tagName.toLowerCase()}${e.className ? '.' + String(e.className).split(' ')[0] : ''} ${Math.round(b.width)}x${Math.round(b.height)} "${(e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30)}"`);
        }
        return out;
      });
      for (const s of small) extra.push({ cfg: `${cfg.theme}/${cfg.vp}`, check: 'objetivo<24px', where: r, detail: s });
    }
  }
  await ctx.close();
}
// Reflujo (WCAG 1.4.10): sin scroll horizontal de pagina a 320 px y a 640 px (= 200 % de zoom en 1280).
if (!ONLY.length) {
  for (const w of [320, 640]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 700 }, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.accept().catch(() => {}));
    await page.goto(BASE + '#/perfil'); await page.evaluate(SEED);
    for (const r of ROUTES) {
      await go(page, r); await settle(page, 500);
      const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      if (o.sw > o.cw + 1) extra.push({ cfg: `ancho ${w}`, check: 'scroll horizontal', where: r, detail: `scrollWidth ${o.sw} > ${o.cw}` });
    }
    await ctx.close();
  }
  // Movimiento reducido: ninguna animacion/transicion debe durar mas de ~0 ms.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.goto(BASE + '#/documentos'); await page.evaluate(SEED); await go(page, '/documentos');
  await page.locator('#doc-add').click(); await settle(page, 300);
  const slow = await page.evaluate(() => [...document.querySelectorAll('*')].filter((e) => { const s = getComputedStyle(e); return (s.animationName !== 'none' && parseFloat(s.animationDuration) > 0.001) || parseFloat(s.transitionDuration) > 0.001; }).map((e) => e.tagName + '.' + e.className).slice(0, 5));
  if (slow.length) extra.push({ cfg: 'reduced-motion', check: 'animacion activa', where: '/documentos', detail: slow.join(', ') });
  await ctx.close();
}
await browser.close();
server.close();

// ---------- informe ----------
const order = { critical: 0, serious: 1, moderate: 2, minor: 3, script: 4 };
const groups = new Map();
for (const r of results) {
  const k = `${r.impact}|${r.id}`;
  const g = groups.get(k) || { impact: r.impact, id: r.id, help: r.help, where: new Set(), nodes: new Map() };
  g.where.add(`${r.state}@${r.cfg}`);
  for (const n of r.nodes) g.nodes.set(n.target, n.summary);
  groups.set(k, g);
}
const list = [...groups.values()].sort((a, b) => order[a.impact] - order[b.impact]);
for (const g of list) {
  console.log(`\n[${g.impact}] ${g.id} - ${g.help}  (${g.nodes.size} nodos; ${g.where.size} estados)`);
  console.log('  estados: ' + [...g.where].slice(0, 6).join(', ') + (g.where.size > 6 ? ' ...' : ''));
  for (const [t, s] of [...g.nodes].slice(0, 5)) console.log('  - ' + t + '\n      ' + s);
}
console.log(`\nEstados auditados con axe: ${audited.size} (${audited.size / 4} vistas/estados x 4 configuraciones)`);
if (extra.length) { console.log('\nComprobaciones propias con hallazgos:'); for (const e of extra) console.log(`  [${e.check}] ${e.cfg} ${e.where}: ${e.detail}`); } else console.log('Comprobaciones propias (objetivos >=24px, reflujo 320/640, movimiento reducido): sin hallazgos.');
const bySev = (s) => list.filter((g) => g.impact === s).length;
console.log(`\nResumen: critical=${bySev('critical')} serious=${bySev('serious')} moderate=${bySev('moderate')} minor=${bySev('minor')} errores-de-script=${bySev('script')}; errores de consola=${consoleErrors.length}`);
if (consoleErrors.length) console.log([...new Set(consoleErrors)].slice(0, 10).join('\n'));
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ results, extra, consoleErrors }, null, 1));
process.exit(bySev('critical') + bySev('serious') + bySev('script') + consoleErrors.length + extra.length ? 1 : 0);

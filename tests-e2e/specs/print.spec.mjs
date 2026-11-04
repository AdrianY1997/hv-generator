// G14: impresión y paginación en Chromium, Firefox y WebKit.
//  - Todos los navegadores: emulación del medio "print" y comprobaciones de geometría (nada fuera de su hoja, tablas dentro de la página,
//    hojas del formulario del tamaño exacto, cuántas hojas de continuación).
//  - Chromium además genera el PDF real (page.pdf) y lo lee con pdf.js: número de páginas, tamaño de página, texto fuera de la página,
//    páginas en blanco y títulos huérfanos al pie. Firefox y WebKit no tienen page.pdf (solo captura de pantalla con medio print, adjunta al informe).
// Cada caso escribe sus cifras en tests-e2e/out/print-<navegador>.jsonl (se usa para docs/IMPRESION.md).
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, openApp, waitPreview } from '../helpers/fixtures.mjs';
import { fullProfile, overflowProfile, template, templateExcluding } from '../helpers/data.mjs';

const OUT = path.resolve(import.meta.dirname, '..', 'out', process.env.PW_RUN || ''); // PW_RUN: carpeta aislada por ejecución (ver playwright.config.mjs)
const IN = 96; // px por pulgada CSS
const PAGE = { letter: { w: 8.5 * IN, h: 11 * IN, ptW: 612, ptH: 792 }, a4: { w: 210 / 25.4 * IN, h: 297 / 25.4 * IN, ptW: 595.28, ptH: 841.89 } };
const MARGIN = 0.5 * IN; // zona segura INTERNA de las hojas de flujo (continuación y anexos): todas las páginas tienen @page { margin: 0 } (export.js, printCss)

/** Todos los campos de texto con un valor larguísimo: mide cuántas casillas del formulario recortan el texto (informativo, ver docs/IMPRESION.md). */
const longProfile = () => {
  const p = fullProfile({ n: 1 });
  for (const sec of Object.values(p)) for (const rec of Array.isArray(sec) ? sec : [sec]) for (const [k, v] of Object.entries(rec)) if (typeof v === 'string' && k !== 'id' && !/fecha|anio|correo/i.test(k) && v.length > 3 && !/^\d{4}-/.test(v)) rec[k] = `${v} `.repeat(12).trim();
  return p;
};
const SCENARIOS = {
  vacio: { profile: {} },
  completo: { profile: fullProfile() },
  desborde: { profile: overflowProfile(14, 12) },
  'valores largos': { profile: longProfile() },
  'plantilla con secciones excluidas': { profile: overflowProfile(14, 12), template: templateExcluding('Sin secciones largas', ['experiencia', 'hermanos', 'cursos', 'referencias', 'superior']) },
};

/** Abre la vista previa del escenario, elige el papel y deja la página lista para imprimir (medio print). */
async function prepare(page, name, paper) {
  const sc = SCENARIOS[name];
  const route = '/vista-previa' + (sc.template ? `?template=${sc.template.id}` : '');
  await openApp(page, route, { profile: sc.profile, templates: sc.template ? [sc.template] : undefined });
  await waitPreview(page);
  await page.locator('#pv-paper').selectOption(paper);
  await expect(page.locator('.pv-stage')).toHaveClass(paper === 'a4' ? /hv-a4/ : /^(?!.*hv-a4)/);
  // window.print abre un diálogo no automatizable: se sustituye, pero printWithTitle SÍ inyecta el @page de Carta/A4 que se probará.
  await page.evaluate(() => { window.print = () => {}; });
  await page.getByRole('button', { name: 'Imprimir', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.getElementById('pv-pagesize')?.textContent || '')).toContain(paper === 'a4' ? 'size:A4' : 'size:Letter');
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => document.fonts.ready);
  await settled(page);
}

/** Espera a que la vista deje de re-pintarse (la carga de archivos termina con un update): 300 ms sin mutaciones en #app, medidos en la página. */
const settled = (page) => page.evaluate(() => new Promise((resolve) => {
  let t = setTimeout(done, 300);
  const mo = new MutationObserver(() => { clearTimeout(t); t = setTimeout(done, 300); });
  function done() { mo.disconnect(); resolve(); }
  mo.observe(document.getElementById('app'), { subtree: true, childList: true, attributes: true, characterData: true });
}));

/** Geometría de la hoja impresa (se ejecuta en el navegador). */
function domMetrics() {
  const r = (e) => e.getBoundingClientRect();
  const within = (a, b, tol = 0.75) => a.left >= b.left - tol && a.right <= b.right + tol && a.top >= b.top - tol && a.bottom <= b.bottom + tol;
  const sheets = [...document.querySelectorAll('.hv-sheet')];
  const outside = [];
  const clipped = [];
  sheets.forEach((s, i) => {
    const sr = r(s);
    for (const el of s.querySelectorAll('.mv-page, .mv-f, .mv-photo, .mv-bg, .mv-ov')) if (!within(r(el), sr)) outside.push(`hoja ${i + 1}: ${el.className.baseVal ?? el.className}`);
    for (const el of s.querySelectorAll('.mv-f')) {
      if (el.scrollWidth > el.clientWidth + 1) clipped.push({ sheet: i + 1, kind: 'ancho', text: el.textContent.slice(0, 40) });
      else if (el.scrollHeight > el.clientHeight + 1) clipped.push({ sheet: i + 1, kind: 'alto', text: el.textContent.slice(0, 40) });
    }
  });
  const cont = document.querySelector('.hv-cont');
  const tables = cont ? [...cont.querySelectorAll('table')] : [];
  const cr = cont ? r(cont) : null;
  return {
    sheetCount: sheets.length,
    sheetSize: sheets[0] ? [Math.round(r(sheets[0]).width * 10) / 10, Math.round(r(sheets[0]).height * 10) / 10] : null,
    outside,
    clippedValues: clipped,
    hasCont: !!cont,
    contWidth: cr ? Math.round(cr.width * 10) / 10 : null,
    contHeight: cr ? Math.round(cr.height) : null,
    contPad: cont ? ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].map((k) => Math.round(parseFloat(getComputedStyle(cont)[k]) * 10) / 10) : null,
    contSections: cont ? cont.querySelectorAll('.mv-cs').length : 0,
    contRows: tables.reduce((n, t) => n + t.querySelectorAll('tbody tr').length, 0),
    tablesOutside: tables.filter((t) => r(t).right > cr.right + 0.75).length,
    cellOverflow: [...(cont?.querySelectorAll('td, th') ?? [])].filter((c) => c.scrollWidth > c.clientWidth + 1).length,
    annexes: document.querySelectorAll('.hv-annex').length,
    hiddenChrome: ['.topbar', '.pv-bar', '.notices', '.pv-banner', '.pv-opts', 'h1.mn-page-title, .page-head'].every((q) => [...document.querySelectorAll(q)].every((e) => getComputedStyle(e).display === 'none')),
  };
}

/** Lee el PDF con pdf.js (el que ya vendoriza la app) y devuelve métricas por página. */
function pdfMetrics(page, buf) {
  return page.evaluate(async (b64) => {
    const pdfjs = await import('/vendor/pdfjs/pdf.min.js');
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js';
    const doc = await pdfjs.getDocument({ data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const p = await doc.getPage(i);
      const [x0, y0, x1, y1] = p.view;
      const items = (await p.getTextContent()).items.filter((t) => t.str.trim());
      // Texto girado (el pie vertical "© LIBRE ..."): el ancho corre sobre el eje Y, así que se mide la extensión real.
      const box = (t) => { const [a, b, , , e, f] = t.transform; return Math.abs(b) > Math.abs(a) ? [e, e, Math.min(f, f + t.width), Math.max(f, f + t.width)] : [e, e + t.width, f, f]; };
      const out = items.filter((t) => { const [l, r, lo, hi] = box(t); return l < x0 - 1 || r > x1 + 1 || lo < y0 - 1 || hi > y1 + 1; }).map((t) => t.str.slice(0, 30));
      // Fuera de la zona segura de 0,5 in (36 pt): solo se exige en las hojas de flujo (continuación y anexos), el formulario ocupa la página.
      const unsafe = items.filter((t) => { const [l, r, lo, hi] = box(t); return l < x0 + 34 || r > x1 - 34 || lo < y0 + 34 || hi > y1 - 34; }).map((t) => t.str.slice(0, 30));
      const lowest = items.length ? items.reduce((a, b) => (b.transform[5] < a.transform[5] ? b : a)) : null;
      pages.push({ w: Math.round((x1 - x0) * 100) / 100, h: Math.round((y1 - y0) * 100) / 100, texts: items.length, out, unsafe, firstText: items[0]?.str.slice(0, 50) || '', lastText: lowest?.str.slice(0, 50) || '', lastY: lowest ? Math.round(lowest.transform[5]) : null, hasCont: items.some((t) => /continuaci[oó]n/i.test(t.str)) });
    }
    return pages;
  }, buf.toString('base64'));
}

/** page.pdf con reintento ante la primera página vacía de más (Chromium, ver docs/IMPRESION.md): en el Linux del CI ocurre más a menudo que en local.
 *  `ok(pages)` dice si el PDF es el esperado; se repite hasta 4 veces con una pausa breve para que el rasterizador termine, y se devuelven los
 *  reintentos usados (se anotan; si el PDF sigue mal, el expect del caso falla con el detalle). */
async function printPdf(page, ok = (pages) => pages[0]?.texts > 0) {
  let buf, pages, retries = 0;
  for (;;) {
    buf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    pages = await pdfMetrics(page, buf);
    if (ok(pages) || retries >= 4) break;
    retries++;
    await page.waitForTimeout(250);
  }
  return { buf, pages, retries };
}

const record = (browserName, name, paper, data) => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.appendFileSync(path.join(OUT, `print-${browserName}.jsonl`), JSON.stringify({ browser: browserName, scenario: name, paper, ...data }) + '\n');
};

for (const paper of ['letter', 'a4']) {
  for (const name of Object.keys(SCENARIOS)) {
    test(`${name} · ${paper}: geometría de impresión y paginación`, async ({ page, browserName }, testInfo) => {
      test.setTimeout(120_000);
      await prepare(page, name, paper);
      const pg = PAGE[paper];
      // El PDF se genera antes de tocar el viewport: page.pdf pagina con el tamaño de @page, no con el viewport.
      // Con la máquina muy cargada (8 workers) se observó 1 PDF de cada ~150 con una primera página vacía de más; el mismo DOM, sin carga, dio
      // 150/150 PDF correctos (ver docs/IMPRESION.md). Por eso una página vacía se reintenta hasta 2 veces y se anota; si persiste, falla.
      let buf = null, pdfPages = null, pdfRetries = 0;
      if (browserName === 'chromium') {
        ({ buf, pages: pdfPages, retries: pdfRetries } = await printPdf(page, (pp) => pp.every((p) => p.texts > 0)));
      }
      // La página impresa no tiene margen (@page margin 0): el viewport es el ancho del papel y la zona segura es el relleno de la hoja de flujo.
      await page.setViewportSize({ width: Math.round(pg.w), height: 900 });
      const m = await page.evaluate(domMetrics);
      const data = { dom: m };

      // --- Comprobaciones válidas en cualquier navegador ---
      expect(m.sheetCount, 'hojas del formulario').toBe(4);
      expect(m.outside, 'elementos fuera de su hoja').toEqual([]);
      expect(Math.abs(m.sheetSize[0] - pg.w), `ancho de hoja ${m.sheetSize[0]} vs página ${pg.w.toFixed(1)}`).toBeLessThanOrEqual(1);
      expect(m.sheetSize[1], 'la hoja cabe en la altura de la página').toBeLessThanOrEqual(pg.h + 1);
      expect(m.annexes).toBe(0);
      expect(m.tablesOutside, 'tablas que sobresalen de la hoja de continuación').toBe(0);
      expect(m.cellOverflow, 'celdas con texto cortado').toBe(0);
      if (m.hasCont) {
        expect(Math.abs(m.contWidth - pg.w), 'la continuación ocupa el ancho del papel').toBeLessThanOrEqual(1);
        expect(m.contPad, 'zona segura interna de 0,5 in en la continuación').toEqual([MARGIN, MARGIN, MARGIN, MARGIN]);
        data.contPagesEstimate = Math.ceil((m.contHeight - 2 * MARGIN) / (pg.h - 2 * MARGIN));
      }
      if (name === 'vacio') expect(m.hasCont).toBe(false);
      if (name === 'desborde') expect(m.hasCont, 'el desborde debe producir hoja de continuación').toBe(true);
      if (name === 'plantilla con secciones excluidas') expect(m.hasCont, 'sin las secciones largas no hay continuación').toBe(false);

      // --- Chromium: el PDF real ---
      if (browserName === 'chromium') {
        const pages = pdfPages;
        data.pdf = { retries: pdfRetries, pages: pages.length, sizes: [...new Set(pages.map((p) => `${p.w}x${p.h}`))], perPage: pages.map((p) => ({ texts: p.texts, out: p.out.length, last: p.lastText })) };
        // El tamaño de página sale del @page inyectado (Carta 612x792, A4 595.28x841.89); las hojas de continuación usan el mismo papel.
        fs.mkdirSync(OUT, { recursive: true });
        fs.writeFileSync(path.join(OUT, `${name.replace(/\W+/g, '-')}-${paper}.pdf`), buf);
        await testInfo.attach('hv.pdf', { body: buf, contentType: 'application/pdf' });
        for (const [i, p] of pages.entries()) {
          expect(Math.abs(p.w - pg.ptW), `ancho de página ${p.w} (${paper})`).toBeLessThanOrEqual(1);
          expect(Math.abs(p.h - pg.ptH), `alto de página ${p.h} (${paper})`).toBeLessThanOrEqual(1);
          expect(p.texts, `página ${i + 1} de ${pages.length} sin texto (¿en blanco?): ${JSON.stringify(data.pdf.perPage)}`).toBeGreaterThan(0);
          expect(p.out, 'texto fuera de la página').toEqual([]);
          if (i >= 4) expect(p.unsafe, `página ${i + 1}: texto fuera de la zona segura de 0,5 in`).toEqual([]);
        }
        expect(pages.length, 'páginas del PDF').toBeGreaterThanOrEqual(4);
        expect(pages.slice(0, 4).every((p) => !p.hasCont), 'las 4 primeras páginas son el formulario').toBe(true);
        if (name === 'vacio' || name === 'plantilla con secciones excluidas') expect(pages.length).toBe(4);
        if (m.hasCont) {
          const contPages = pages.slice(4);
          expect(contPages.length, 'hojas de continuación').toBeGreaterThanOrEqual(1);
          expect(contPages[0].hasCont, 'la primera página tras el formulario es la continuación').toBe(true);
          // Ningún título de sección "(continuación)" debe quedar solo al pie de una página con su tabla en la siguiente.
          for (const [i, p] of contPages.entries()) expect(p.lastText, `título huérfano al pie de la página ${5 + i}`).not.toMatch(/continuaci[oó]n/i);
        }
      } else {
        // Firefox y WebKit: sin page.pdf; se adjunta la captura con medio print para revisión visual.
        await page.setViewportSize({ width: Math.round(pg.w), height: Math.round(pg.h) });
        await testInfo.attach('print-emulado.png', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
      }
      record(browserName, name, paper, data);
    });
  }
}

test('las reglas @media print ocultan la interfaz y dejan solo la hoja', async ({ page }) => {
  await prepare(page, 'completo', 'letter');
  const vis = await page.evaluate(() => {
    const shown = (q) => [...document.querySelectorAll(q)].some((e) => { const c = getComputedStyle(e); return c.display !== 'none' && c.visibility !== 'hidden' && e.getBoundingClientRect().height > 0; });
    return { topbar: shown('.topbar'), toolbar: shown('.pv-bar'), banner: shown('.pv-banner'), notices: shown('.notices'), sheet: shown('.hv-sheet'), bodyBg: getComputedStyle(document.body).backgroundColor };
  });
  expect(vis).toEqual({ topbar: false, toolbar: false, banner: false, notices: false, sheet: true, bodyBg: 'rgb(255, 255, 255)' });
});

test('el aviso de privacidad no se imprime como página aparte', async ({ page }) => {
  await openApp(page, '/vista-previa', { profile: fullProfile(), ack: false });
  await waitPreview(page);
  await expect(page.locator('[data-notice="privacy"]')).toBeVisible(); // en pantalla sí está
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.notices')).toBeHidden();
});

test('plantilla con anexos: cada anexo de imagen empieza en página nueva', async ({ page, browserName }) => {
  // El WebKit de Playwright (sesión efímera) no puede guardar Blob/File en IndexedDB ("Error preparing Blob/File data"); Safari real sí.
  test.skip(browserName === 'webkit', 'IndexedDB de WebKit/Playwright no admite Blob');
  const t = template('Con certificados');
  const p = fullProfile();
  await openApp(page, `/vista-previa?template=${t.id}`, { profile: p, templates: [t], files: [{ id: 'cert:it-superior-0', name: 'a.png', type: 'image/png', data: (await import('../helpers/data.mjs')).makePng(400, 300) }] });
  await waitPreview(page);
  await page.emulateMedia({ media: 'print' });
  const annex = page.locator('.hv-annex');
  await expect(annex).toHaveCount(1);
  expect(await annex.evaluate((e) => getComputedStyle(e).breakBefore)).toMatch(/page|always/);
  const fit = await annex.locator('.hv-fit img').evaluate((i) => { const r = i.getBoundingClientRect(); const f = i.parentElement.getBoundingClientRect(); return r.right <= f.right + 1 && r.bottom <= f.bottom + 1; });
  expect(fit).toBe(true);
});

// Reporte desde la app en vivo: los documentos subidos (cédula, antecedentes...) no salían como anexos sin plantilla, los PDF no se imprimían
// y las páginas añadidas (continuación y anexos) dependían del margen del diálogo de impresión. Ahora TODAS las páginas usan @page margin 0
// con el papel elegido y la continuación y los anexos llevan su zona segura de 0,5 in por dentro: mismo resultado con «Márgenes: ninguno».
for (const modelId of ['minerva', 'formato-unico']) {
  for (const paper of ['letter', 'a4']) {
    test(`anexos de documentos (imagen y PDF) sin plantilla · ${modelId} · ${paper}: página del papel, margen 0 y zona segura`, async ({ page, browserName }, testInfo) => {
      test.skip(browserName !== 'chromium', 'page.pdf solo en Chromium; el WebKit de Playwright no guarda Blob en IndexedDB');
      test.setTimeout(120_000);
      const { tinyPdf, makePng } = await import('../helpers/data.mjs');
      const profile = { ...overflowProfile(6, 4), documents: { cedula: ['doc:cedula'], procuraduria: ['doc:procuraduria'], contraloria: ['doc:contraloria'], eps: ['doc:eps'] } };
      await openApp(page, '/vista-previa', { profile, files: [
        { id: 'doc:cedula', name: 'cedula.png', type: 'image/png', data: makePng(1200, 760) },
        { id: 'doc:procuraduria', name: 'proc.pdf', type: 'application/pdf', data: tinyPdf(['PROCURADURIA GENERAL DE LA NACION', 'Certificado de prueba']) },
        { id: 'doc:contraloria', name: 'contra.pdf', type: 'application/pdf', data: tinyPdf(['CONTRALORIA', 'Hoja'], 2) },
        { id: 'doc:eps', name: 'eps.png', type: 'image/png', data: makePng(500, 1400) },
      ] });
      if (modelId !== 'minerva') { await page.evaluate((m) => localStorage.setItem('hv.model', m), modelId); await page.reload(); }
      await waitPreview(page);
      await page.locator('#pv-paper').selectOption(paper);
      await expect(page.locator('#pv-annex-sum')).toContainText('Anexos: 4 documentos / 5 páginas');
      await expect(page.locator('.pv-stage .hv-annex img')).toHaveCount(5);
      await page.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? 1 : new Promise((r) => { i.onload = i.onerror = r; })))));
      await page.evaluate(() => { window.print = () => {}; });
      await page.getByRole('button', { name: 'Imprimir', exact: true }).click();
      await page.emulateMedia({ media: 'print' });
      await page.evaluate(() => document.fonts.ready);
      await settled(page);
      const pg = PAGE[paper];
      const { buf, pages } = await printPdf(page);
      fs.mkdirSync(OUT, { recursive: true });
      fs.writeFileSync(path.join(OUT, `anexos-${modelId}-${paper}.pdf`), buf);
      await testInfo.attach('anexos.pdf', { body: buf, contentType: 'application/pdf' });
      const sheets = await page.locator('.pv-stage .hv-sheet').count(); // hojas del formulario (el Formato Único repite la de experiencia)
      for (const [i, p] of pages.entries()) {
        expect(Math.abs(p.w - pg.ptW), `ancho de la página ${i + 1}`).toBeLessThanOrEqual(1);
        expect(Math.abs(p.h - pg.ptH), `alto de la página ${i + 1}`).toBeLessThanOrEqual(1);
        expect(p.out, `página ${i + 1}: texto fuera de la página`).toEqual([]);
        if (i >= sheets) expect(p.unsafe, `página ${i + 1}: texto fuera de la zona segura`).toEqual([]);
      }
      const annexTitles = pages.filter((p) => p.texts && p.firstText?.startsWith('Anexo'));
      expect(annexTitles.length, 'una página por imagen y por página de PDF').toBe(5);
      // Imagen del anexo dentro de la zona segura, centrada y sin recortar (medido con el medio print y el viewport al ancho del papel).
      await page.setViewportSize({ width: Math.round(pg.w), height: Math.round(pg.h) });
      const boxes = await page.evaluate(() => [...document.querySelectorAll('.hv-annex')].filter((a) => a.querySelector('img')).map((a) => {
        const A = a.getBoundingClientRect(), I = a.querySelector('img').getBoundingClientRect(), img = a.querySelector('img');
        return { top: I.top - A.top, left: I.left - A.left, right: A.right - I.right, bottom: I.bottom - A.top, w: A.width, natural: img.naturalWidth > 0, mid: Math.abs((I.left + I.right) / 2 - (A.left + A.right) / 2) };
      }));
      expect(boxes.length).toBe(5);
      for (const b of boxes) {
        expect(b.natural, 'imagen cargada').toBe(true);
        expect(b.left, 'margen izquierdo de la imagen').toBeGreaterThanOrEqual(MARGIN - 1);
        expect(b.right, 'margen derecho de la imagen').toBeGreaterThanOrEqual(MARGIN - 1);
        expect(b.top, 'margen superior de la imagen').toBeGreaterThanOrEqual(MARGIN - 1);
        expect(b.bottom, 'la imagen termina antes de la zona segura inferior').toBeLessThanOrEqual(pg.h - MARGIN + 1);
        expect(b.mid, 'imagen centrada').toBeLessThanOrEqual(1.5);
      }
    });
  }
}

// Quinta auditoría: el anexo con un título larguísimo (3+ líneas) y una nota (PDF truncado) no deja una página en blanco ni recorta la imagen;
// la continuación larga se reparte en páginas propias con su relleno (sin depender de box-decoration-break).
for (const modelId of ['minerva', 'formato-unico']) {
  for (const paper of ['letter', 'a4']) {
    test(`anexo con título largo y nota · ${modelId} · ${paper}: ni páginas en blanco ni imagen recortada; continuación en páginas propias`, async ({ page, browserName }, testInfo) => {
      test.skip(browserName !== 'chromium', 'page.pdf solo en Chromium; el WebKit de Playwright no guarda Blob en IndexedDB');
      test.setTimeout(150_000);
      const { tinyPdf, makePng } = await import('../helpers/data.mjs');
      const profile = { ...overflowProfile(14, 4), documents: { cedula: ['doc:cedula'], contraloria: ['doc:contraloria'] } };
      const longName = 'Universidad Nacional Abierta y a Distancia de la República de Colombia Facultad de Ciencias Administrativas Contables Económicas y de Negocios '.repeat(3);
      for (const [k, v] of Object.entries(profile.superior[0])) if (typeof v === 'string' && k !== 'id' && !/fecha|anio|año/i.test(k) && v.length > 3 && !/^\d/.test(v)) profile.superior[0][k] = longName;
      await openApp(page, '/vista-previa', { profile, files: [
        { id: 'doc:cedula', name: 'cedula.png', type: 'image/png', data: makePng(900, 1300) },
        { id: 'doc:contraloria', name: 'contra.pdf', type: 'application/pdf', data: tinyPdf(['CONTRALORIA', 'Hoja'], 14) },
        { id: `cert:${profile.superior[0].id}`, name: 'titulo.png', type: 'image/png', data: makePng(1400, 900) },
      ] });
      if (modelId !== 'minerva') { await page.evaluate((m) => localStorage.setItem('hv.model', m), modelId); await page.reload(); }
      await waitPreview(page);
      await page.locator('#pv-paper').selectOption(paper);
      await expect(page.locator('#pv-annex-sum')).toContainText('Anexos: 3 documentos / 12 páginas');
      await expect(page.locator('#pv-annex-sum [data-annex-truncated]')).toContainText('(tope de 10 páginas por documento)');
      await page.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? 1 : new Promise((r) => { i.onload = i.onerror = r; })))));
      await page.evaluate(() => { window.print = () => {}; });
      await page.getByRole('button', { name: 'Imprimir', exact: true }).click();
      await page.emulateMedia({ media: 'print' });
      await page.evaluate(() => document.fonts.ready);
      await settled(page);
      const pg = PAGE[paper];
      const { buf, pages } = await printPdf(page);
      fs.mkdirSync(OUT, { recursive: true });
      fs.writeFileSync(path.join(OUT, `anexo-largo-${modelId}-${paper}.pdf`), buf);
      await testInfo.attach('anexo-largo.pdf', { body: buf, contentType: 'application/pdf' });
      const counts = await page.evaluate(() => ({ sheets: document.querySelectorAll('.pv-stage .hv-sheet').length, cont: document.querySelectorAll('.pv-stage .hv-cont').length, annex: document.querySelectorAll('.pv-stage .hv-annex').length }));
      expect(pages.length, 'una página por hoja, continuación y anexo: ni una más (sin páginas en blanco)').toBe(counts.sheets + counts.cont + counts.annex);
      expect(counts.cont, 'la continuación larga se repartió en varios elementos .hv-page').toBeGreaterThanOrEqual(1);
      for (const [i, p] of pages.entries()) {
        expect(Math.abs(p.w - pg.ptW), `ancho de la página ${i + 1}`).toBeLessThanOrEqual(1);
        expect(Math.abs(p.h - pg.ptH), `alto de la página ${i + 1}`).toBeLessThanOrEqual(1);
        expect(p.texts, `página ${i + 1} con texto (no está en blanco)`).toBeGreaterThan(0);
        expect(p.out, `página ${i + 1}: texto fuera de la página`).toEqual([]);
        if (i >= counts.sheets) expect(p.unsafe, `página ${i + 1}: texto fuera de la zona segura`).toEqual([]);
      }
      await page.setViewportSize({ width: Math.round(pg.w), height: Math.round(pg.h) });
      const boxes = await page.evaluate(() => [...document.querySelectorAll('.hv-annex')].filter((a) => a.querySelector('img')).map((a) => {
        const A = a.getBoundingClientRect(), img = a.querySelector('img'), I = img.getBoundingClientRect(), fit = a.querySelector('.hv-fit').getBoundingClientRect(), h2 = a.querySelector('h2').getBoundingClientRect();
        // La imagen dibujada (object-fit: contain) dentro de su caja: nada recortado si la caja cabe en la página.
        const nat = img.naturalWidth / img.naturalHeight, boxR = I.width / I.height;
        const drawn = nat > boxR ? { w: I.width, h: I.width / nat } : { w: I.height * nat, h: I.height };
        return { A: A.height, top: I.top - A.top, bottom: A.bottom - I.bottom, left: I.left - A.left, right: A.right - I.right, fitH: fit.height, h2H: h2.height, drawnOk: drawn.w <= I.width + 1 && drawn.h <= I.height + 1, ph: A.height };
      }));
      expect(boxes.length).toBe(3 + 9); // 12 páginas de anexo con imagen (3 documentos)
      for (const b of boxes) {
        expect(b.top, 'imagen dentro de la zona segura (arriba)').toBeGreaterThanOrEqual(MARGIN - 1);
        expect(b.bottom, 'imagen dentro de la zona segura (abajo)').toBeGreaterThanOrEqual(MARGIN - 1);
        expect(b.left).toBeGreaterThanOrEqual(MARGIN - 1);
        expect(b.right).toBeGreaterThanOrEqual(MARGIN - 1);
        expect(b.h2H, 'título limitado a 2 líneas').toBeLessThanOrEqual(42);
        expect(b.fitH, 'holgura: la imagen tiene al menos página - zona segura - 1 in').toBeGreaterThanOrEqual(pg.h - 2 * MARGIN - 1 * IN);
        expect(b.drawnOk).toBe(true);
      }
    });
  }
}

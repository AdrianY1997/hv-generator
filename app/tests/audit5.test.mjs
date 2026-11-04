// Quinta auditoría: regresiones de cada corrección (pdf-raster, presupuesto de anexos, impresión, migración del conjunto de documentos,
// tiempo servido, `replaces` en el Formato Único y seguridad entre versiones). Ver docs/IMPRESION.md, docs/SYNC.md y docs/MODELOS.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pdfToImages, PDF_PRINT } from '../js/pdf-raster.js';
import { loadFiles, printCss } from '../js/export.js';
import { annexHtml, annexSummary, continuation, incField, incFieldIn, visibleFields } from '../js/models/sheet-kit.js';
import { fieldIncluded } from '../js/template-check.js';
import { serviceMonths, serviceTime } from '../js/service-time.js';
import { migrate, CURRENT_VERSION } from '../js/migrate.js';
import { shownDocIds, DEFAULT_SHOWN, LEGACY_DEFAULT_SHOWN, DOC_ORDER } from '../js/doc-sources.js';
import { prepareBackup, mergeProfile } from '../js/backup-merge.js';
import { normalizeProfile } from '../js/backup-validate.js';
import { mergeSync } from '../js/sync/sync-merge.js';
import minerva from '../js/models/minerva.js';

const never = () => new Promise(() => {});
const pdfBlob = (size = 1000) => ({ size, type: 'application/pdf', arrayBuffer: async () => new ArrayBuffer(8) });

/** pdf.js falso: `pages` páginas de 612x792 pt; `mode` controla qué se atasca. */
function fakePdfjs({ pages = 3, mode = 'ok' } = {}) {
  const log = { opts: null, destroyed: 0, canvases: [], cancelled: 0, cleaned: 0 };
  const page = {
    getViewport: ({ scale }) => ({ width: 612 * scale, height: 792 * scale }),
    render: () => {
      if (mode === 'ok') return { promise: Promise.resolve(), cancel() { log.cancelled++; } };
      let rej;
      const promise = new Promise((_, r) => { rej = r; });
      return { promise, cancel() { log.cancelled++; rej(new Error('cancelado')); } };
    },
    cleanup() { log.cleaned++; },
  };
  const doc = { numPages: pages, getPage: async () => page, destroy: () => { log.destroyed++; return mode === 'ok' ? Promise.resolve() : never(); } };
  const pdfjs = { getDocument: (o) => { log.opts = o; return { promise: Promise.resolve(doc), destroy: () => { log.destroyed++; return never(); } }; } };
  const makeCanvas = () => { const c = { width: 0, height: 0, getContext: () => ({ fillRect() {} }), toDataURL: () => 'data:image/jpeg;base64,AAAA' }; log.canvases.push(c); return c; };
  return { pdfjs, makeCanvas, log };
}

test('pdf-raster: un PDF mayor al tope se rechaza antes de leerlo, con mensaje claro', async () => {
  const f = fakePdfjs();
  const big = { size: PDF_PRINT.maxBytes + 1, arrayBuffer: async () => { throw new Error('no debía leerse'); } };
  await assert.rejects(pdfToImages(big, { pdfjs: f.pdfjs, makeCanvas: f.makeCanvas }), (e) => /25 MB/.test(e.userMessage) && /paquete PDF/.test(e.userMessage));
  assert.equal(f.log.opts, null, 'ni siquiera se abrió');
});

test('pdf-raster: getDocument recibe maxImageSize (16 Mpx) y el JPEG sale a lado mayor <= 1800 px, calidad .8', async () => {
  const f = fakePdfjs({ pages: 2 });
  let q = null;
  const mk = () => { const c = f.makeCanvas(); const t = c.toDataURL; c.toDataURL = (type, quality) => { q = quality; return t(); }; return c; };
  const r = await pdfToImages(pdfBlob(), { pdfjs: f.pdfjs, makeCanvas: mk });
  assert.equal(f.log.opts.maxImageSize, 16777216);
  assert.equal(f.log.opts.isEvalSupported, false);
  assert.equal(PDF_PRINT.maxSide, 1800);
  assert.equal(q, 0.8);
  assert.equal(r.pages.length, 2);
  assert.ok(f.log.canvases.every((c) => c.width === 0 && c.height === 0), 'lienzos liberados al terminar');
  assert.ok(r.sizes.every((n) => n <= 1800 * 1800), 'lado mayor limitado');
});

test('pdf-raster: un worker atascado NO cuelga la conversión: vuelve en el tiempo límite, cancela y libera los lienzos', async () => {
  const f = fakePdfjs({ pages: 3, mode: 'stuck' }); // render nunca termina y destroy() nunca responde
  const t0 = Date.now();
  await assert.rejects(pdfToImages(pdfBlob(), { pdfjs: f.pdfjs, makeCanvas: f.makeCanvas, timeoutMs: 40 }), (e) => /tardó demasiado/.test(e.userMessage));
  assert.ok(Date.now() - t0 < 1500, 'regresó sin esperar a destroy()');
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(f.log.destroyed >= 2, 'destroy se disparó (sin esperarlo)');
  assert.ok(f.log.cancelled >= 1, 'la renderización en curso se canceló');
  assert.ok(f.log.canvases.length >= 1 && f.log.canvases.every((c) => c.width === 0 && c.height === 0), 'lienzos en cero también al fallar');
});

test('pdf-raster: un destroy() que rechaza no deja un rechazo sin manejar', async () => {
  const f = fakePdfjs({ pages: 1 });
  const orig = f.pdfjs.getDocument;
  f.pdfjs.getDocument = (o) => { const t = orig(o); return { promise: t.promise.then((d) => ({ ...d, destroy: () => Promise.reject(new Error('worker caído')) })), destroy: () => Promise.reject(new Error('x')) }; };
  let unhandled = 0;
  const h = () => { unhandled++; };
  process.on('unhandledRejection', h);
  const r = await pdfToImages(pdfBlob(), { pdfjs: f.pdfjs, makeCanvas: f.makeCanvas });
  await new Promise((res) => setTimeout(res, 20));
  process.off('unhandledRejection', h);
  assert.equal(r.pages.length, 1);
  assert.equal(unhandled, 0);
});

test('pdf-raster: presupuesto de píxeles — corta antes de maxPages y lo dice (limited)', async () => {
  const f = fakePdfjs({ pages: 8 });
  const one = Math.ceil(612 * (1800 / 792)) * 1800; // píxeles de una página Carta a 1800 px
  const r = await pdfToImages(pdfBlob(), { pdfjs: f.pdfjs, makeCanvas: f.makeCanvas, maxPixels: one * 2 + 10 });
  assert.equal(r.pages.length, 2);
  assert.equal(r.limited, 'pixeles');
  assert.equal(r.total, 8);
  await assert.rejects(pdfToImages(pdfBlob(), { pdfjs: f.pdfjs, makeCanvas: f.makeCanvas, maxPixels: 10 }), (e) => /demasiado grandes/.test(e.userMessage));
});

/** Almacén falso: el orden de listFiles() es DISTINTO del orden de impresión. */
function fakeStore(order, types = {}) {
  const meta = (id) => ({ name: id, size: 5, type: types[id] || 'application/pdf' });
  return { listFiles: async () => order.map((id) => ({ id, meta: meta(id) })), getFile: async (id) => ({ blob: { type: types[id] || 'application/pdf', size: 5 }, meta: meta(id) }) };
}
const fakeRaster = (pagesOf, fail = {}) => ({
  PDF_PRINT: { ...PDF_PRINT, maxTotal: 10, maxPages: 10 },
  pdfToImages: async (blob) => { const n = pagesOf.shift(); if (n instanceof Error) throw n; return { pages: Array.from({ length: n }, (_, i) => `data:image/jpeg;base64,P${i}`), sizes: Array(n).fill(1000), total: n, limited: '' }; },
});

test('loadFiles: el presupuesto de páginas se gasta en ORDEN DE IMPRESIÓN (cédula primero), no en el del almacén', async () => {
  const store = fakeStore(['doc:policia', 'doc:cedula']); // el almacén lista primero la policía
  const raster = fakeRaster([8, 8]); // pdfToImages se llama en el orden en que loadFiles pide: cédula, policía
  const got = await loadFiles(store, ['doc:cedula', 'doc:policia'], { pdf: true, raster });
  assert.equal(got['doc:cedula'].pages.length, 8, 'la cédula conserva todas sus páginas');
  assert.equal(got['doc:cedula'].truncReason, undefined);
  assert.equal(got['doc:policia'].pages.length, 2, 'lo que queda del tope de 10 páginas');
  assert.match(got['doc:policia'].truncReason, /tope de 10 páginas de anexos PDF por impresión/);
  assert.equal(got['doc:policia'].pageTotal, 8);
  // El resumen dice cuál se truncó y por qué.
  const s = annexSummary([{ title: 'Policía', id: 'doc:policia', file: got['doc:policia'] }]);
  assert.deepEqual(s.truncated, [{ title: 'Policía', shown: 2, total: 8, reason: got['doc:policia'].truncReason }]);
  assert.match(annexHtml([{ title: 'Policía', id: 'doc:policia', file: { ...got['doc:policia'], meta: { type: 'application/pdf' } } }]), /primeras 2 de 8 páginas \(tope de 10 páginas/);
});

test('loadFiles: sin páginas de presupuesto el documento no se convierte y dice por qué; el tope de píxeles también corta', async () => {
  const store = fakeStore(['a', 'b']);
  const got = await loadFiles(store, ['a', 'b'], { pdf: true, raster: fakeRaster([10, 3]) });
  assert.equal(got.a.pages.length, 10);
  assert.match(got.b.pdfError, /ya se alcanzó el tope de anexos PDF/);
  const px = { PDF_PRINT: { ...PDF_PRINT, maxTotal: 60, maxTotalPixels: 2500 }, pdfToImages: async () => ({ pages: ['data:image/jpeg;base64,A', 'data:image/jpeg;base64,B', 'data:image/jpeg;base64,C'], sizes: [1000, 1000, 1000], total: 3, limited: '' }) };
  const g2 = await loadFiles(fakeStore(['a']), ['a'], { pdf: true, raster: px });
  assert.equal(g2.a.pages.length, 2);
  assert.match(g2.a.truncReason, /memoria de imágenes/);
});

test('loadFiles: un fallo o un tiempo agotado NO se guardan en la caché (se reintenta); un éxito sí', async () => {
  const store = fakeStore(['a']);
  const cache = new Map();
  const timeout = Object.assign(new Error('x'), { userMessage: 'el PDF tardó demasiado en convertirse' });
  const raster = fakeRaster([timeout, 2]);
  const first = await loadFiles(store, ['a'], { pdf: true, cache, raster });
  assert.equal(first.a.pdfError, 'el PDF tardó demasiado en convertirse');
  assert.equal(cache.size, 0, 'el fallo no se cachea');
  const second = await loadFiles(store, ['a'], { pdf: true, cache, raster }); // «Reintentar» / siguiente carga
  assert.equal(second.a.pages.length, 2);
  assert.equal(cache.size, 1);
  const third = await loadFiles(store, ['a'], { pdf: true, cache, raster: fakeRaster([]) }); // si convirtiera de nuevo, fakeRaster([]) fallaría
  assert.equal(third.a.pages.length, 2, 'el éxito sale de la caché');
  const s = annexSummary([{ title: 'T', id: 'a', file: { meta: { type: 'application/pdf' }, pdfError: 'x' } }]);
  assert.equal(s.loose[0].retry, true, 'un PDF fallido ofrece Reintentar');
});

test('anexos: página con imagen marcada (data-annex=img) y la lista de los que no salen se reparte en páginas propias', () => {
  const img = annexHtml([{ title: 'Cédula', id: 'doc:cedula', file: { meta: { type: 'image/png' }, dataUrl: 'data:image/png;base64,AA' } }]);
  assert.match(img, /<div class="hv-page hv-annex" data-annex="img"><h2 title="Cédula">/);
  const many = Array.from({ length: 70 }, (_, i) => ({ title: `Documento ${i + 1}`, id: `doc:d${i}`, file: { meta: { type: 'application/pdf', name: `d${i}.pdf` }, pdfError: 'el PDF está dañado o no se pudo leer' } }));
  const html = annexHtml(many);
  const pages = html.match(/<div class="hv-page hv-annex">/g) || [];
  assert.ok(pages.length >= 3, `70 elementos no caben en una página (${pages.length})`);
  assert.equal((html.match(/<li>/g) || []).length, 70, 'ninguno se pierde');
  assert.ok(!/Documento 1<\/li>|<p>Los siguientes[\s\S]*<p>Los siguientes/.test(html), 'la explicación solo va en la primera');
  assert.match(html, /\(continuación\)/);
});

test('continuación: se reparte en páginas .hv-page propias (cada una con su relleno), repitiendo título de sección y encabezado', () => {
  const sec = { id: 'experiencia', title: 'VI. Experiencia', repeatable: true, fields: ['empresa', 'cargo', 'funciones'].map((id) => ({ id, label: id.toUpperCase(), type: 'text' })) };
  const list = Array.from({ length: 60 }, (_, i) => ({ id: `e${i}`, empresa: `Empresa ${i}`, cargo: 'Analista', funciones: 'Responsable de la conciliación bancaria y del cierre contable mensual. '.repeat(3) }));
  const html = continuation({ experiencia: sec }, [{ sec: 'experiencia', list }], null, { title: 'HV <small>x</small>', note: 'nota' });
  const pages = html.split('<div class="hv-page hv-cont">').slice(1);
  assert.ok(pages.length >= 3, `60 filas largas necesitan varias páginas (${pages.length})`);
  assert.ok(pages[0].startsWith('<h1>HV <small>x</small></h1><p>nota</p>'));
  for (const p of pages.slice(1)) assert.ok(!p.includes('<h1>'), 'solo la primera lleva el título general');
  for (const p of pages) assert.ok(/<section class="mv-cs"><h2>VI\. Experiencia \(continuación\)<\/h2><table class="hv-tbl"><thead>/.test(p), 'cada página repite título y encabezado');
  assert.equal((html.match(/<td>Empresa \d+<\/td>/g) || []).length, 60, 'ninguna fila se pierde ni se repite');
  // Una continuación pequeña sigue siendo UNA sola página.
  assert.equal(continuation({ experiencia: sec }, [{ sec: 'experiencia', list: list.slice(0, 2) }], null, { title: 'T', note: 'n' }).split('<div class="hv-page hv-cont">').length, 2);
  // Fichas (más de 7 campos): también se reparten por ficha.
  const wide = { id: 'w', title: 'W', repeatable: true, fields: Array.from({ length: 9 }, (_, i) => ({ id: `f${i}`, label: `Campo ${i}`, type: 'text' })) };
  const cards = Array.from({ length: 30 }, (_, i) => Object.fromEntries([['id', `w${i}`], ...Array.from({ length: 9 }, (_, j) => [`f${j}`, `valor ${i}-${j} `.repeat(4)])]));
  const ch = continuation({ w: wide }, [{ sec: 'w', list: cards }], null, { title: 'T', note: 'n' });
  assert.ok(ch.split('<div class="hv-page hv-cont">').length > 2);
  assert.equal((ch.match(/<table class="hv-tbl hv-card">/g) || []).length, 30);
});

test('impresión: el relleno no depende de box-decoration-break; anexo en columna con título limitado a 2 líneas y la imagen ocupa el resto', () => {
  const css = printCss('letter');
  assert.ok(css.includes('.hv-page{width:auto;min-height:0;margin:0;padding:var(--pm)'));
  assert.match(css, /\.hv-annex\[data-annex=img\]\{display:flex;flex-direction:column;height:calc\(var\(--ph\) - \.02in\)/);
  assert.match(css, /-webkit-line-clamp:2/);
  assert.match(css, /\.hv-fit\{flex:1 1 0;min-height:0;height:auto;position:relative/);
  assert.match(css, /hv-fit img\{position:absolute/);
  assert.ok(!css.includes('- .75in'), 'ya no se reserva un alto fijo para el título');
  assert.ok(css.includes('@page{size:Letter;margin:0}') && printCss('a4').includes('@page{size:A4;margin:0}'));
});

test('print.css: ninguna regla @page sin nombre (se heredaría al imprimir en otras vistas) y lo propio de la HV va bajo body.pv-on', () => {
  const css = fs.readFileSync(new URL('../css/print.css', import.meta.url), 'utf8');
  assert.ok(!/@page\s*\{/.test(css), 'sin @page global');
  assert.ok(!/^\s*\.hv-sr\{/m.test(css) && css.includes('body.pv-on .hv-sr'));
});

test('tiempo servido: fechas imposibles (31 feb, mes 13, día 0, años fuera de 1900-2100) no dan valor', () => {
  assert.equal(serviceMonths('2015-02-31', '2016-01-01'), null);
  assert.equal(serviceMonths('2015-01-01', '2015-13-01'), null);
  assert.equal(serviceMonths('2015-00-10', '2016-01-01'), null);
  assert.equal(serviceMonths('2015-01-00', '2016-01-01'), null);
  assert.equal(serviceMonths('1899-12-31', '2016-01-01'), null);
  assert.equal(serviceMonths('2015-01-01', '2101-01-01'), null);
  assert.equal(serviceMonths('2015-04-31', '2016-01-01'), null, 'abril tiene 30');
  assert.equal(serviceMonths('2019-02-29', '2020-01-01'), null, '2019 no es bisiesto');
  assert.equal(serviceMonths('2020-02-29', '2021-02-28'), 12, '2020 sí lo es');
  assert.equal(serviceMonths('2100-02-29', '2100-12-31'), null, '2100 no es bisiesto');
  assert.equal(serviceMonths('1900-01-01', '1900-12-31'), 12);
  assert.equal(serviceTime({ fechaInicio: '2015-02-31', fechaFin: '2016-01-01' }), '');
  assert.equal(serviceTime({ fechaInicio: '2015-13-01', actual: true }, '2016-01-01'), '');
});

test('Formato Único / kit: incField y visibleFields respetan `replaces` con la MISMA regla que template-check.fieldIncluded', () => {
  const sec = { id: 'experiencia', fields: [{ id: 'cargo' }, { id: 'cargoJefe', replaces: 'cargo' }, { id: 'empresa' }, { id: 'foto', type: 'photo' }] };
  const secById = { experiencia: sec };
  const inc = incFieldIn(secById);
  const tpls = [null, { include: { fields: {} } }, { include: { fields: { 'experiencia.cargo': false } } }, { include: { fields: { 'experiencia.cargo': false, 'experiencia.cargoJefe': true } } },
    { include: { fields: { 'experiencia.cargoJefe': false } } }, { include: { fields: { 'experiencia.empresa': false } } }];
  for (const t of tpls) for (const f of sec.fields) {
    assert.equal(incField(t, 'experiencia', f), fieldIncluded(t, 'experiencia', f), `objeto ${JSON.stringify(t)} ${f.id}`);
    assert.equal(inc(t, 'experiencia', f.id), fieldIncluded(t, 'experiencia', f), `id ${JSON.stringify(t)} ${f.id}`);
  }
  const hidden = { include: { fields: { 'experiencia.cargo': false } } };
  assert.deepEqual(visibleFields(sec, hidden).map((f) => f.id), ['empresa'], 'desmarcar cargo oculta también cargoJefe');
  assert.deepEqual(visibleFields(sec, { include: { fields: { 'experiencia.cargo': false, 'experiencia.cargoJefe': true } } }).map((f) => f.id), ['cargoJefe', 'empresa']);
});

// ---- Migración del conjunto de documentos visibles ----
const FILES = { documents: { policia: ['doc:policia'], rut: ['doc:rut'] } };
const ALL = DOC_ORDER;

test('migración v3: un perfil existente sin documentsShown conserva lo que veía (conjunto anterior + los que tienen archivos)', () => {
  assert.equal(CURRENT_VERSION, 3);
  const old = { personales: { nombres: 'Ana' }, ...FILES };
  const before = shownDocIds(old, ALL); // lo que ve con el código nuevo SIN migrar: pierde rnmc e inhabilidades
  assert.ok(!before.includes('rnmc') && !before.includes('inhabilidades'));
  const r = migrate(old, { from: 2 });
  assert.equal(r.changed, true);
  assert.deepEqual([...r.profile.documentsShown].sort(), [...new Set([...LEGACY_DEFAULT_SHOWN, 'rut'])].sort());
  const after = shownDocIds(r.profile, ALL);
  for (const id of LEGACY_DEFAULT_SHOWN) assert.ok(after.includes(id), id);
  assert.ok(after.includes('rut'));
  assert.ok(!after.includes('eps') && !after.includes('pension'), 'no se le añade nada que no veía');
});

test('migración v3: borrar el último archivo de un documento ya no lo hace desaparecer', () => {
  const old = { personales: { nombres: 'Ana' }, documents: { rut: ['doc:rut'] } };
  const withoutFile = (p) => ({ ...p, documents: { ...p.documents, rut: [] } });
  assert.ok(!shownDocIds(withoutFile(old), ALL).includes('rut'), 'sin migrar: desaparece (comportamiento que se corrige)');
  const migrated = migrate(old, { from: 2 }).profile;
  assert.ok(shownDocIds(withoutFile(migrated), ALL).includes('rut'), 'migrado: sigue en la lista');
});

test('migración v3: perfil nuevo/vacío NO se materializa (queda por ausencia con el conjunto nuevo); lista propia se respeta; idempotente', () => {
  for (const empty of [{}, { documents: {} }, { documents: { rut: [] }, personales: { nombres: '' } }]) {
    const r = migrate(empty, { from: 2 });
    assert.equal('documentsShown' in r.profile, false, JSON.stringify(empty));
    assert.deepEqual(shownDocIds(r.profile, ALL), ALL.filter((id) => DEFAULT_SHOWN.includes(id)));
  }
  const own = { personales: { nombres: 'Ana' }, documentsShown: ['cedula'] };
  assert.deepEqual(migrate(own, { from: 2 }).profile.documentsShown, ['cedula']);
  const once = migrate({ personales: { nombres: 'Ana' }, ...FILES }, { from: 0 });
  const twice = migrate(once.profile, { from: 0 });
  assert.deepEqual(twice.profile, once.profile);
  assert.equal(migrate(once.profile, { from: CURRENT_VERSION }).changed, false);
  assert.ok(once.profile.legacyConditions === true && Array.isArray(once.profile.documentsShown), 'versiones anteriores y la nueva se encadenan');
  // Solo archivos (sin datos): un perfil con documentos cargados no es «vacío».
  assert.ok(Array.isArray(migrate(FILES, { from: 2 }).profile.documentsShown));
});

test('migración v3 también al importar un respaldo viejo; documentsShown se UNE al combinar', () => {
  const backup = (o) => ({ app: 'hv-minerva', version: 1, exportedAt: '2026-01-01T00:00:00Z', templates: [], files: [], ...o });
  const v = prepareBackup(backup({ schemaVersion: 2, profile: { personales: { nombres: 'Ana' } } }));
  assert.equal(v.ok, true);
  assert.deepEqual([...v.profile.documentsShown].sort(), [...LEGACY_DEFAULT_SHOWN].sort());
  const cur = { personales: { nombres: 'Luis' }, documentsShown: ['cedula', 'bdme'] };
  const m = mergeProfile(cur, v.profile);
  assert.deepEqual([...m.profile.documentsShown].sort(), [...new Set(['cedula', 'bdme', ...LEGACY_DEFAULT_SHOWN])].sort());
  // Sin lista propia, se une con la lista efectiva conocida.
  const m2 = mergeProfile({ personales: { nombres: 'Luis' } }, v.profile, { currentShown: ['cedula', 'eps'] });
  assert.ok(m2.profile.documentsShown.includes('eps') && m2.profile.documentsShown.includes('rnmc'));
  assert.deepEqual(mergeProfile(m.profile, v.profile).profile.documentsShown, m.profile.documentsShown, 'idempotente');
});

test('sync: documentsShown con empate se une (ordenada, igual en los dos equipos); con una edición más nueva manda esa; presente gana a ausente', () => {
  const side = (profile, clock = {}) => ({ profile, templates: [], clock, files: {} });
  const A = side({ documentsShown: ['cedula', 'rnmc', 'rut'] }), B = side({ documentsShown: ['cedula', 'bdme'] });
  const ab = mergeSync(A, B).profile.documentsShown, ba = mergeSync(B, A).profile.documentsShown;
  assert.deepEqual(ab, ['bdme', 'cedula', 'rnmc', 'rut']);
  assert.deepEqual(ba, ab, 'convergen');
  assert.deepEqual(mergeSync(side({ documentsShown: ab }), B).profile.documentsShown, ab, 'idempotente');
  const T = Date.now() - 1000;
  const newer = mergeSync(side({ documentsShown: ['cedula'] }, { 'p:documentsShown': T }), side({ documentsShown: ['cedula', 'rnmc'] }, { 'p:documentsShown': T - 500 }));
  assert.deepEqual(newer.profile.documentsShown, ['cedula'], 'ocultar un documento (edición más nueva) se propaga');
  assert.deepEqual(mergeSync(side({}), side({ documentsShown: ['cedula', 'rnmc'] })).profile.documentsShown, ['cedula', 'rnmc']);
  assert.deepEqual(mergeSync(side({ documentsShown: ['cedula', 'rnmc'] }), side({})).profile.documentsShown, ['cedula', 'rnmc']);
});

// ---- Seguridad entre versiones: `cargo` (Formato Único / versiones anteriores) y `cargoJefe` (Minerva) ----
const EXP = (o) => ({ id: 'e1', empresa: 'ACME', fechaInicio: '2020-01-01', ...o });

test('normalizeProfile conserva claves desconocidas de los registros (una versión anterior no las pierde) y el registro con ambos campos', () => {
  const p = normalizeProfile({ experiencia: [EXP({ cargo: 'Auxiliar', cargoJefe: 'Gerente', campoFuturo: { a: 1 } })], futuro: { x: 1 } }, minerva.schema.sections);
  assert.deepEqual(p.experiencia[0], EXP({ cargo: 'Auxiliar', cargoJefe: 'Gerente', campoFuturo: { a: 1 } }));
  assert.deepEqual(p.futuro, { x: 1 }, 'secciones desconocidas también');
});

test('respaldo (combinar): un registro con `cargo` y sin `cargoJefe` no pierde ni inventa campos; con ambos los conserva', () => {
  const both = EXP({ cargo: 'Auxiliar', cargoJefe: 'Gerente', updatedAt: '2026-02-01T00:00:00Z' });
  const oldOnly = EXP({ cargo: 'Auxiliar', updatedAt: '2026-01-01T00:00:00Z' });
  // Actual con ambos + respaldo viejo (solo cargo, más antiguo): se queda con ambos.
  assert.deepEqual(mergeProfile({ experiencia: [both] }, { experiencia: [oldOnly] }).profile.experiencia, [both]);
  // Actual viejo + respaldo con ambos (más reciente): gana el del respaldo con ambos.
  assert.deepEqual(mergeProfile({ experiencia: [oldOnly] }, { experiencia: [both] }).profile.experiencia, [both]);
  // Sin fechas (empate): se conserva el actual PERO el campo que solo tenía el respaldo se añade, sin tocar lo que ya tenía.
  const cur = EXP({ cargo: 'Auxiliar' }), inc = EXP({ cargo: 'Auxiliar', cargoJefe: 'Gerente' });
  assert.deepEqual(mergeProfile({ experiencia: [cur] }, { experiencia: [inc] }).profile.experiencia, [inc]);
  assert.deepEqual(mergeProfile({ experiencia: [inc] }, { experiencia: [cur] }).profile.experiencia, [inc], 'el registro con ambos no pierde nada');
  // Gana el más reciente PERO el campo que solo tenía el otro no se pierde (versión anterior que no conoce cargoJefe).
  const newOld = EXP({ cargo: 'Auxiliar II', updatedAt: '2026-03-01T00:00:00Z' });
  assert.deepEqual(mergeProfile({ experiencia: [both] }, { experiencia: [newOld] }).profile.experiencia, [{ ...newOld, cargoJefe: 'Gerente' }]);
  // Un valor vacío del ganador es una decisión (borrado a propósito): no se rellena con el del otro.
  const cleared = EXP({ cargo: 'Auxiliar', cargoJefe: '', updatedAt: '2026-03-01T00:00:00Z' });
  assert.equal(mergeProfile({ experiencia: [both] }, { experiencia: [cleared] }).profile.experiencia[0].cargoJefe, '');
  // Idempotente.
  const once = mergeProfile({ experiencia: [cur] }, { experiencia: [inc] }).profile;
  assert.deepEqual(mergeProfile(once, { experiencia: [inc] }).profile, once);
});

test('sync: registro de un equipo con `cargo` y otro con `cargoJefe` se fusiona sin perder campos ni resucitar registros borrados', () => {
  const side = (items, clock = {}) => ({ profile: { experiencia: items }, templates: [], clock, files: {} });
  const T = Date.now() - 10_000;
  const newApp = EXP({ cargo: 'Auxiliar', cargoJefe: 'Gerente', updatedAt: new Date(T).toISOString() });
  const oldApp = EXP({ cargo: 'Auxiliar II', updatedAt: new Date(T + 5000).toISOString() }); // equipo con versión anterior, editó después
  const ab = mergeSync(side([newApp]), side([oldApp])).profile.experiencia[0], ba = mergeSync(side([oldApp]), side([newApp])).profile.experiencia[0];
  assert.equal(ab.cargo, 'Auxiliar II');
  assert.equal(ab.cargoJefe, 'Gerente', 'no se pierde cargoJefe');
  assert.deepEqual(ab, ba, 'los dos equipos convergen');
  assert.deepEqual(mergeSync(side([newApp]), side([newApp])).profile.experiencia, [newApp], 'con ambos campos, los conserva');
  // Registro borrado después en un equipo: la lápida gana a la copia vieja del otro (sin resurrección).
  const gone = mergeSync(side([], { 'xi:experiencia/e1': T + 9000 }), side([oldApp]));
  assert.deepEqual(gone.profile.experiencia, []);
});

test('Minerva imprime un registro anterior (solo `cargo`) en la casilla del jefe y uno nuevo con ambos campos usa cargoJefe', () => {
  const html = (rec) => minerva.render({ personales: { nombres: 'Ana' }, experiencia: [rec] }, null, {});
  const old = html(EXP({ cargo: 'Auxiliar contable' })), both = html(EXP({ cargo: 'Auxiliar contable', cargoJefe: 'Gerente' }));
  assert.ok(old.includes('Auxiliar contable'));
  assert.ok(both.includes('Gerente'));
});

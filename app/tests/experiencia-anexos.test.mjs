// Errores reportados desde la app en vivo (2026-11): primer bloque de experiencia en blanco, tiempo servido calculado, documentos que no
// salían como anexos (sin plantilla y PDF) y la página de impresión común a todas las hojas (margen 0 + zona segura interna).
import test from 'node:test';
import assert from 'node:assert/strict';
import minerva from '../js/models/minerva.js';
import fu from '../js/models/formato-unico.js';
import { serviceMonths, formatServiceTime, serviceTime } from '../js/service-time.js';
import { experienceOrder, annexFlags, annexSummary, annexHtml, filled } from '../js/models/sheet-kit.js';
import { printCss } from '../js/export.js';
import { todayIso } from '../js/validators.js';

const NO_DATE = { id: 'x', include: { sections: { solicitud: false }, items: {}, fields: {} }, options: {} };
/** Valores escritos en una hoja: [{x, y, text}] (Minerva y Formato Único usan las mismas clases .mv-f). */
function fieldsOf(html, page, copy = 0) {
  const parts = html.split(`data-page="${page}"`);
  const seg = (parts[1 + copy] || '').split('data-page=')[0];
  return [...seg.matchAll(/<div class="mv-f[^"]*" style="left:([\d.]+)pt;top:([\d.]+)pt[^>]*>([^<]*)</g)].map((m) => ({ x: +m[1], y: +m[2], text: m[3] }));
}
const at = (fs, x, y) => fs.find((f) => Math.abs(f.x - x) < 0.6 && Math.abs(f.y - y) < 0.6)?.text;
// Minerva, hoja 3: empresa de cada bloque (t0, t21, t44) y tiempo servido (t11, t32, t55).
const MV_EMP = [[76.6, 78.4], [76.5, 295.1], [76.7, 511.6]];
const MV_TMP = [[76.6, 126.2], [76.5, 343], [76.7, 559.5]];

test('tiempo servido: meses calendario con las dos fechas incluidas, singular/plural, menos de 1 mes y sin negativos', () => {
  assert.equal(serviceMonths('2015-01-01', '2017-06-30'), 30, 'del 01/01/2015 al 30/06/2017 son 30 meses (el último día cuenta)');
  assert.equal(formatServiceTime(30), '2 años, 6 meses');
  assert.equal(formatServiceTime(12), '1 año');
  assert.equal(formatServiceTime(13), '1 año, 1 mes');
  assert.equal(formatServiceTime(1), '1 mes');
  assert.equal(formatServiceTime(0), 'menos de 1 mes');
  assert.equal(formatServiceTime(null), '');
  assert.equal(serviceMonths('2020-03-10', '2020-03-25'), 0);
  assert.equal(serviceMonths('2020-01-31', '2020-02-28'), 0, 'mes incompleto (31 ene -> 28 feb) no cuenta');
  assert.equal(serviceMonths('2020-01-15', '2020-02-14'), 1, 'del 15 al 14 del mes siguiente es un mes completo');
  assert.equal(serviceMonths('2020-02-01', '2021-01-31'), 12);
  assert.equal(serviceMonths('2021-05-01', '2020-05-01'), null, 'fechas al revés: sin valor, nunca negativo');
  assert.equal(serviceMonths('2021-05-01', ''), null);
  assert.equal(serviceMonths('01/05/2021', '2022-05-01'), null);
  assert.equal(serviceTime({ fechaInicio: '2020-02-01', actual: true, fechaFin: '2020-03-01' }, '2026-11-04'), '6 años, 9 meses', 'actual: corre hasta hoy aunque haya un retiro guardado');
  assert.equal(serviceTime({ fechaInicio: '2026-11-01', actual: true }, '2026-11-04'), 'menos de 1 mes');
  assert.equal(serviceTime({ fechaInicio: '2019-01-01' }, '2026-11-04'), '', 'sin retiro y sin marcar «actual»: no se inventa');
});

test('experiencia: el trabajo actual va en el primer bloque y un registro vacío no ocupa ninguno (Minerva)', () => {
  const p = { experiencia: [
    { id: 'z', updatedAt: '2026-01-01T00:00:00Z', actual: false }, // se pulsó «Agregar experiencia» y no se escribió nada
    { id: 'a', empresa: 'Vieja SA', cargo: 'Aux', fechaInicio: '2015-01-01', fechaFin: '2017-06-30' },
    { id: 'b', empresa: 'Actual SAS', cargo: 'Jefe', fechaInicio: '2020-02-01', actual: true },
    { id: 'c', empresa: 'Media Ltda', cargo: 'Analista', fechaInicio: '2017-08-01', fechaFin: '2019-12-31' },
    { id: 'd', empresa: 'Sin retiro Ltda', fechaInicio: '2014-01-01', fechaFin: '2014-12-31', tiempoServido: '1 año (a mano)' },
  ] };
  const h = minerva.render(p, NO_DATE, {});
  const fs = fieldsOf(h, 3);
  assert.deepEqual(MV_EMP.map(([x, y]) => at(fs, x, y)), ['Actual SAS', 'Media Ltda', 'Vieja SA'], 'actual primero, luego del retiro más reciente al más antiguo');
  assert.equal(at(fs, ...MV_TMP[1]), '2 años, 5 meses');
  assert.equal(at(fs, ...MV_TMP[2]), '2 años, 6 meses');
  assert.equal(at(fs, ...MV_TMP[0]), serviceTime(p.experiencia[2], todayIso()), 'trabajo actual: hasta hoy');
  assert.ok(/Sin retiro Ltda/.test(h.split('hv-cont')[1] || ''), 'el cuarto empleo va a la hoja de continuación (sin perderse)');
  assert.ok(h.includes('1 año (a mano)'), 'lo escrito a mano manda sobre el cálculo');
  assert.equal((h.match(/Actual SAS/g) || []).length, 2, 'una vez en la hoja y una en la lectura lineal (sin duplicar)');
  assert.ok(!/registro \d de 5/.test(h), 'la lectura lineal no cuenta el registro vacío');
  assert.ok(h.includes('<dt>Total tiempo servido</dt><dd>2 años, 5 meses</dd>'), 'la lectura lineal da el tiempo calculado, como la hoja');
  // Sin trabajo actual, el más reciente va arriba aunque haya un registro vacío.
  const h2 = minerva.render({ experiencia: [{ id: 'z' }, p.experiencia[1], p.experiencia[3]] }, NO_DATE, {});
  assert.equal(at(fieldsOf(h2, 3), ...MV_EMP[0]), 'Media Ltda');
});

test('experiencia: Formato Único, un registro vacío no ocupa bloque; orden con «actual» primero', () => {
  const sec = fu.schema.sections.find((s) => s.id === 'experiencia');
  assert.equal(filled(sec)({ id: 'z', actual: false }), false);
  assert.equal(filled(sec)({ id: 'z', empresa: 'X' }), true);
  const h = fu.render({ experiencia: [{ id: 'z' }, { id: 'a', empresa: 'Previa SA', fechaInicio: '2015-01-01', fechaFin: '2016-01-01' }] }, null, {});
  const fs = fieldsOf(h, 2);
  assert.equal(fs.find((f) => f.text === 'Previa SA')?.y, fieldsOf(fu.render({ experiencia: [{ id: 'a', empresa: 'Previa SA', fechaInicio: '2015-01-01', fechaFin: '2016-01-01' }] }, null, {}), 2).find((f) => f.text === 'Previa SA')?.y);
  const list = [{ fechaFin: '2020-01-01' }, { actual: true, fechaInicio: '2010-01-01' }, {}, { fechaFin: '2022-01-01' }];
  assert.deepEqual([...list].sort(experienceOrder).map((x) => list.indexOf(x)), [1, 2, 3, 0]);
});

const IMG = { meta: { type: 'image/png', name: 'c.png' }, dataUrl: 'data:image/png;base64,AAAA' };
const PDF2 = { meta: { type: 'application/pdf', name: 'p.pdf' }, dataUrl: '', pages: ['data:image/jpeg;base64,AA', 'data:image/jpeg;base64,BB'], pageTotal: 2 };
const PDF_BAD = { meta: { type: 'application/pdf', name: 'roto.pdf' }, dataUrl: '', pdfError: 'el PDF está protegido con contraseña' };
const docsProfile = { documents: { cedula: ['doc:cedula'], procuraduria: ['doc:procuraduria'], contraloria: ['doc:contraloria'], policia: ['doc:policia'] } };

test('anexos sin plantilla: certificados Y documentos con archivo (cédula primero); los PDF salen como páginas', () => {
  for (const m of [minerva, fu]) {
    const files = { 'doc:policia': PDF2, 'doc:cedula': IMG, 'doc:procuraduria': PDF_BAD, 'doc:contraloria': PDF2 };
    const list = m.annexList(docsProfile, null, files);
    assert.deepEqual(list.map((a) => a.id), ['doc:cedula', 'doc:procuraduria', 'doc:contraloria', 'doc:policia'], m.id);
    const h = m.render(docsProfile, null, files);
    assert.equal((h.match(/class="hv-page hv-annex"/g) || []).length, 1 + 2 + 2 + 1, `${m.id}: cédula + 2 + 2 páginas de PDF + hoja de lo que no salió`);
    assert.ok(h.includes('(pág. 2 de 2)'));
    assert.ok(h.includes('protegido con contraseña'), 'dice por qué no se incluyó');
    const info = m.annexInfo(docsProfile, null, files);
    assert.deepEqual([info.items, info.pages, info.loose.length], [3, 5, 1]);
    assert.deepEqual(m.fileIds(docsProfile, null).filter((x) => x.startsWith('doc:')).sort(), ['doc:cedula', 'doc:contraloria', 'doc:policia', 'doc:procuraduria']);
    // Interruptores de la Vista previa: apagan documentos o certificados para esta vista, con o sin plantilla.
    assert.equal(m.annexList(docsProfile, null, files, { annex: { documents: false } }).length, 0);
    const tpl = { id: 't', include: { sections: {}, items: {}, fields: {} }, options: { attachDocuments: false, attachCertificates: true } };
    assert.equal(m.annexList(docsProfile, tpl, files).length, 0, 'la plantilla sin documentos no los anexa');
    assert.equal(m.annexList(docsProfile, tpl, files, { annex: { documents: true } }).length, 4, 'pero se pueden activar para esta vista');
  }
  // Un documento oculto en Documentos (la persona lo quitó) no se anexa sin plantilla.
  const hidden = { ...docsProfile, documentsShown: ['cedula'] };
  assert.deepEqual(minerva.annexList(hidden, null, { 'doc:cedula': IMG, 'doc:policia': PDF2 }).map((a) => a.id), ['doc:cedula']);
});

test('anexos: banderas, resumen, PDF truncado y escape', () => {
  assert.deepEqual(annexFlags(null), { certificates: true, documents: true });
  assert.deepEqual(annexFlags({ options: { attachCertificates: false, attachDocuments: true } }), { certificates: false, documents: true });
  assert.deepEqual(annexFlags(null, { certificates: false }), { certificates: false, documents: true });
  const long = { ...PDF2, pageTotal: 14 };
  const s = annexSummary([{ title: 'Largo', id: 'x', file: long }]);
  assert.deepEqual(s.truncated, [{ title: 'Largo', shown: 2, total: 14 }]);
  const h = annexHtml([{ title: 'Largo <b>', id: 'x', file: long }]);
  assert.ok(h.includes('(pág. 2 de 14)') && h.includes('primeras 2 de 14 páginas') && !h.includes('<b>'));
  // Solo data URL de imagen llegan a un src (nada de javascript: ni svg).
  const evil = annexHtml([{ title: 'x', id: 'x', file: { meta: { type: 'application/pdf' }, pages: ['javascript:alert(1)', 'data:image/svg+xml;base64,AA'] } }]);
  assert.ok(!evil.includes('javascript:') && !evil.includes('svg+xml') && evil.includes('no salen'));
});

test('impresión: una sola @page con margen 0 y el papel elegido; zona segura interna en continuación y anexos', () => {
  for (const [paper, size] of [['letter', 'Letter'], ['a4', 'A4']]) {
    const css = printCss(paper);
    assert.ok(css.includes(`@page{size:${size};margin:0}`), css);
    assert.ok(/\.hv-page\{[^}]*padding:var\(--pm\)[^}]*box-decoration-break:clone/.test(css));
    assert.ok(css.includes('--pm:.5in'));
    assert.ok(!/@page\s*\w*\s*\{[^}]*margin:\s*\.5in/.test(css), 'ninguna página con el margen de .5in de antes');
  }
});

// Reporte 3: el primer «Cargo» de cada empleo en Minerva es el del jefe (campo nuevo `cargoJefe`); `cargo` queda para el Formato Único.
import crypto from 'node:crypto';
import { fieldIncluded } from '../js/template-check.js';
const sheetsOnly = (h) => (h.match(/<div class="hv-sheet"[\s\S]*?(?=<div class="hv-sheet"|<div class="hv-page|<\/div>$)/g) || []).join('');
const LEGACY = { personales: { nombres: 'Ana', apellidos: 'Pérez' }, experiencia: [
  { id: 'a', empresa: 'Vieja SA', cargo: 'Auxiliar contable', jefe: 'Luis Rojas', fechaInicio: '2015-01-01', fechaFin: '2017-06-30', cargosDesempenados: 'Auxiliar y analista' },
  { id: 'b', empresa: 'Media Ltda', cargo: 'Analista', jefe: 'Marta Gil', fechaInicio: '2017-08-01', fechaFin: '2019-12-31' },
  { id: 'c', empresa: 'Otra SAS', cargo: 'Coordinador', fechaInicio: '2020-01-01', fechaFin: '2021-12-31', tiempoServido: '2 años' }] };
const MV_CAR = [[76.6, 102.9], [262.7, 319.6], [263, 536.1]]; // casilla «Cargo» de cada bloque (t3, t38, t62)

test('cargo del jefe (Minerva): campo propio, rótulos claros; `cargo` sigue siendo del Formato Único', () => {
  const mx = minerva.schema.sections.find((s) => s.id === 'experiencia').fields, fx = fu.schema.sections.find((s) => s.id === 'experiencia').fields;
  assert.equal(mx.find((f) => f.id === 'cargo'), undefined, 'Minerva ya no muestra `cargo`');
  assert.deepEqual([mx.find((f) => f.id === 'cargoJefe')?.label, mx.find((f) => f.id === 'cargoJefe')?.replaces], ['Cargo de su jefe inmediato', 'cargo']);
  assert.equal(mx.find((f) => f.id === 'cargosDesempenados').label, 'Cargo desempeñado por usted');
  const fc = fx.find((f) => f.id === 'cargo');
  assert.deepEqual([fc.label, fc.required, fc.type], ['Cargo o contrato', true, 'text']);
  assert.equal(fx.find((f) => f.id === 'cargoJefe'), undefined);
});

test('cargo del jefe: un perfil anterior imprime exactamente las mismas hojas (respaldo desde `cargo`)', () => {
  const h = minerva.render(LEGACY, NO_DATE, {});
  assert.equal(crypto.createHash('sha256').update(sheetsOnly(h)).digest('hex'), '16eb358583f445e1f59759ebda5a785eafbf6888d51b24bb5499a176f96b4bee', 'hojas byte a byte iguales a antes del cambio');
  assert.deepEqual(MV_CAR.map(([x, y]) => at(fieldsOf(h, 3), x, y)), ['Coordinador', 'Analista', 'Auxiliar contable']); // más reciente primero
  // Con el campo nuevo lleno: se imprime el cargo del jefe y el `cargo` (Formato Único) no aparece en la hoja de Minerva (sin duplicar).
  const p = structuredClone(LEGACY);
  p.experiencia[0].cargoJefe = 'Jefe de contabilidad';
  const h2 = minerva.render(p, NO_DATE, {}), f3 = fieldsOf(h2, 3);
  assert.equal(at(f3, ...MV_CAR[2]), 'Jefe de contabilidad');
  assert.ok(!f3.some((f) => f.text === 'Auxiliar contable'));
  assert.ok(h2.includes('<dt>Cargo de su jefe inmediato</dt><dd>Jefe de contabilidad</dd>'), 'lectura lineal con el rótulo nuevo');
  assert.ok(h2.includes('<dt>Cargo desempeñado por usted</dt><dd>Auxiliar y analista</dd>'));
  // El Formato Único sigue imprimiendo `cargo` (el de la persona), no el del jefe.
  const hf = fu.render(p, null, {});
  assert.ok(hf.includes('>Auxiliar contable<') && !hf.includes('Jefe de contabilidad'));
});

test('cargo del jefe: plantillas anteriores con `experiencia.cargo` desmarcado lo siguen ocultando; la bandera propia manda', () => {
  const f = { id: 'cargoJefe', replaces: 'cargo' };
  const tpl = (fields) => ({ id: 't', include: { sections: { solicitud: false }, items: {}, fields }, options: {} });
  assert.equal(fieldIncluded(null, 'experiencia', f), true);
  assert.equal(fieldIncluded(tpl({ 'experiencia.cargo': false }), 'experiencia', f), false);
  assert.equal(fieldIncluded(tpl({ 'experiencia.cargo': false, 'experiencia.cargoJefe': true }), 'experiencia', f), true);
  assert.equal(fieldIncluded(tpl({}), 'experiencia', { id: 'empresa' }), true);
  const old = minerva.render(LEGACY, tpl({ 'experiencia.cargo': false }), {});
  assert.equal(at(fieldsOf(old, 3), ...MV_CAR[0]), undefined, 'la casilla queda vacía como antes');
  assert.ok(!old.includes('Auxiliar contable'));
  const own = minerva.render({ ...LEGACY, experiencia: [{ ...LEGACY.experiencia[0], cargoJefe: 'Jefe' }] }, tpl({ 'experiencia.cargo': false, 'experiencia.cargoJefe': true }), {});
  assert.equal(at(fieldsOf(own, 3), ...MV_CAR[0]), 'Jefe');
});

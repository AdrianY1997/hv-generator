import test from 'node:test';
import assert from 'node:assert/strict';
import { docFlag, docSelected, docsMissing, certGaps } from '../js/template-check.js';
import { computeVigencia, docVigencia, summarizeVigencia, validMaxAge } from '../js/doc-parse.js';
import { SOURCES } from '../js/doc-sources.js';
import { normalizeTemplate, templateMaxAge, newTemplate } from '../js/template-model.js';

// ---------- G27: selección de documentos ----------
test('bandera explícita manda, también para documentos ocultos', () => {
  const t = { include: { documents: { cedula: true, rut: false, redam: true } } };
  const shown = new Set(['cedula', 'rut']);
  assert.equal(docFlag(t, 'redam'), true);
  assert.equal(docFlag(t, 'eps'), undefined);
  assert.equal(docSelected(t, 'redam', shown), true, 'oculto pero seleccionado');
  assert.equal(docSelected(t, 'rut', shown), false, 'mostrado pero desmarcado');
  assert.equal(docSelected(t, 'cedula', shown), true);
});

test('sin bandera: comportamiento anterior (solo los mostrados)', () => {
  const shown = new Set(['cedula']);
  assert.equal(docSelected({ include: {} }, 'cedula', shown), true);
  assert.equal(docSelected({ include: {} }, 'eps', shown), false);
  assert.equal(docSelected({ include: { documents: { cedula: true } } }, 'eps', shown), false, 'documento nuevo ausente en la plantilla');
  assert.equal(docSelected({ include: {} }, 'eps'), true, 'sin lista de mostrados se asume visible');
});

test('documentos pedidos sin archivo (incluso ocultos); sin bandera no se piden', () => {
  const t = { include: { documents: { cedula: true, redam: true, rut: false } } };
  const n = { cedula: 1, redam: 0, rut: 0, eps: 0 };
  assert.deepEqual(docsMissing(t, ['cedula', 'redam', 'rut', 'eps'], (id) => n[id]), ['redam']);
  assert.deepEqual(docsMissing({ include: {} }, ['eps'], () => 0), []);
});

// ---------- G06: certificados prometidos ----------
const sections = [
  { id: 'personales', title: 'I. Información general', fields: [
    { id: 'libretaMilitar', label: 'Libreta militar', type: 'text', certificate: true },
    { id: 'nombres', label: 'Nombres', type: 'text' },
    { id: 'foto', label: 'Foto', type: 'photo' },
  ] },
  { id: 'basica', title: 'IV. Básica', certificate: true, fields: [{ id: 'titulo', label: 'Título', type: 'text' }] },
  { id: 'superior', title: 'IV. Superior', repeatable: true, certificate: true, fields: [{ id: 'programa', label: 'Programa', type: 'text' }] },
];
const profile = { personales: { nombres: 'Ana', libretaMilitar: '12345678' }, basica: { titulo: 'Bachiller' }, superior: [{ id: 'a', programa: 'X' }, { id: 'b', programa: 'Y' }] };
const tpl = (over = {}) => ({ include: { sections: {}, items: {}, fields: {}, documents: {} }, options: { attachCertificates: true }, ...over });

test('certGaps: campo, sección simple e ítems sin archivo', () => {
  const g = certGaps(sections, tpl(), profile, (id) => id === 'cert:a');
  assert.deepEqual(g.map((x) => [x.kind, x.fileId]).sort(), [['field', 'cert:personales:libretaMilitar'], ['item', 'cert:b'], ['section', 'cert:basica']]);
  assert.equal(g.find((x) => x.kind === 'field').label, 'Libreta militar');
});

test('certGaps respeta include, kinds y attachCertificates', () => {
  assert.deepEqual(certGaps(sections, tpl({ options: { attachCertificates: false } }), profile, () => false), []);
  assert.deepEqual(certGaps(sections, null, profile, () => false), []);
  const off = tpl({ include: { sections: { basica: false }, items: { b: false }, fields: { 'personales.libretaMilitar': false }, documents: {} } });
  assert.deepEqual(certGaps(sections, off, profile, () => false).map((x) => x.fileId), ['cert:a']);
  assert.deepEqual(certGaps(sections, tpl(), profile, () => false, ['field']).map((x) => x.kind), ['field']);
});

test('certGaps: sin dato en el perfil no se promete nada; con archivo no avisa', () => {
  assert.deepEqual(certGaps(sections, tpl(), { personales: { nombres: 'Ana' } }, () => false), []);
  assert.deepEqual(certGaps(sections, tpl(), profile, () => true), []);
});

// ---------- G20: vigencia por plantilla ----------
const NOW = new Date(2026, 9, 29); // 2026-10-29
test('validMaxAge acota 1 a 365', () => {
  assert.equal(validMaxAge(30), 30); assert.equal(validMaxAge('45'), 45); assert.equal(validMaxAge(0), null);
  assert.equal(validMaxAge(400), null); assert.equal(validMaxAge(''), null); assert.equal(validMaxAge(null), null); assert.equal(validMaxAge(12.9), 12);
});

test('regla oficial (disciplinarios 90 d): la plantilla solo acorta', () => {
  const m = { emitidoEn: '2026-09-15' }; // hace 44 días
  assert.equal(computeVigencia(SOURCES.procuraduria, m, NOW).state, 'vigente');
  const v = computeVigencia(SOURCES.procuraduria, m, NOW, { maxAgeDays: 30 });
  assert.equal(v.state, 'vencido'); assert.equal(v.porPlantilla, true); assert.equal(v.expiresAt, '2026-10-15');
  assert.match(v.detail, /30 días.*plantilla/);
  const longer = computeVigencia(SOURCES.procuraduria, m, NOW, { maxAgeDays: 365 });
  assert.equal(longer.expiresAt, '2026-12-14', 'no alarga la regla oficial');
  assert.equal(longer.porPlantilla, false);
});

test('regla práctica (judiciales 30 d): la plantilla sustituye', () => {
  const m = { emitidoEn: '2026-09-15' };
  assert.equal(computeVigencia(SOURCES.policia, m, NOW).state, 'vencido');
  const v = computeVigencia(SOURCES.policia, m, NOW, { maxAgeDays: 60 });
  assert.equal(v.state, 'vigente'); assert.equal(v.expiresAt, '2026-11-14'); assert.equal(v.dias, 60);
  const withFile = computeVigencia(SOURCES.policia, { ...m, vigenciaDias: 90 }, NOW, { maxAgeDays: 30 });
  assert.equal(withFile.state, 'vencido', 'manda la plantilla sobre los días del archivo');
});

test('"válida hasta" impreso nunca se alarga; sin fecha de expedición no aplica; sin regla no se evalúa', () => {
  const r = computeVigencia(SOURCES.redam, { emitidoEn: '2026-10-01', validaHasta: '2026-10-20' }, NOW, { maxAgeDays: 90 });
  assert.equal(r.expiresAt, '2026-10-20'); assert.equal(r.state, 'vencido');
  assert.equal(computeVigencia(SOURCES.redam, { validaHasta: '2026-12-01' }, NOW, { maxAgeDays: 10 }).expiresAt, '2026-12-01');
  assert.equal(computeVigencia(SOURCES.policia, { lectura: 'fallo' }, NOW, { maxAgeDays: 30 }).state, 'no_leido');
  assert.equal(computeVigencia(SOURCES.rut, { emitidoEn: '2020-01-01' }, NOW, { maxAgeDays: 30 }).state, 'sin_vigencia');
});

test('docVigencia y summarizeVigencia propagan el límite de la plantilla', () => {
  const metas = { a: { emitidoEn: '2026-10-20' }, b: { emitidoEn: '2026-10-27' } };
  assert.equal(docVigencia(SOURCES.policia, ['a', 'b'], metas, NOW).state, 'vigente');
  assert.equal(docVigencia(SOURCES.policia, ['a', 'b'], metas, NOW, { maxAgeDays: 5 }).state, 'vencido');
  const docs = [{ id: 'policia', label: 'Judiciales' }, { id: 'procuraduria', label: 'Disciplinarios' }];
  const profile = { documents: { policia: ['a'], procuraduria: ['b'] } };
  assert.equal(summarizeVigencia(docs, profile, metas, NOW).vencidos.length, 0);
  const s = summarizeVigencia(docs, profile, metas, NOW, { maxAgeDays: 5 });
  assert.deepEqual(s.vencidos.map((x) => x.id), ['policia']);
  assert.equal(s.porVencer.length, 1, 'b vence en 3 días y entra como por vencer');
});

test('plantilla: maxAgeDays opcional, normalizado y retrocompatible', () => {
  assert.equal(templateMaxAge({ options: { maxAgeDays: 30 } }), 30);
  assert.equal(templateMaxAge({ options: { maxAgeDays: 30.5 } }), null);
  assert.equal(templateMaxAge({ options: {} }), null);
  assert.equal(templateMaxAge(null), null);
  const n = normalizeTemplate({ id: 'x', include: {}, options: { maxAgeDays: 45, objective: 'o' } });
  assert.equal(n.options.maxAgeDays, 45);
  assert.equal('maxAgeDays' in normalizeTemplate({ id: 'x', include: {}, options: { maxAgeDays: 999 } }).options, false);
  assert.equal('maxAgeDays' in normalizeTemplate({ id: 'x', include: {}, options: {} }).options, false);
  assert.equal('maxAgeDays' in newTemplate({ id: 'm', schema: { sections: [], documents: [] } }).options, false);
});

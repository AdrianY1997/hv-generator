import test from 'node:test';
import assert from 'node:assert/strict';
import model from '../js/models/minerva.js';
import { validateProfile } from '../js/validators.js';

// Documentos ocultos y plantillas (G27), certificados prometidos (G06) y validadores declarados en el schema (G17), contra el modelo real.
const file = (name) => ({ meta: { name, type: 'application/pdf', size: 10 } });
const baseProfile = (extra = {}) => ({
  personales: { nombres: 'Ana', apellidos: 'Pérez', tipoDocumento: 'CC', numeroDocumento: '12345678', libretaMilitar: '1234567 / Primera / 12' },
  documentsShown: ['cedula', 'policia'],
  documents: { cedula: ['doc:cedula'], redam: ['doc:redam'], policia: [] },
  ...extra,
});
const tpl = (docs, opts = {}) => ({ id: 't', name: 'T', include: { sections: {}, items: {}, fields: {}, documents: docs }, options: { showPhoto: false, attachCertificates: false, attachDocuments: true, ...opts } });
const ids = (p, t, files) => model.annexList(p, t, files).map((a) => a.id);

test('el anexo sigue la selección explícita: oculto + seleccionado se anexa, mostrado + desmarcado no', () => {
  const files = { 'doc:cedula': file('c.pdf'), 'doc:redam': file('r.pdf') };
  assert.deepEqual(ids(baseProfile(), tpl({ cedula: true, redam: true }), files), ['doc:cedula', 'doc:redam']);
  assert.deepEqual(ids(baseProfile(), tpl({ cedula: false, redam: true }), files), ['doc:redam']);
  assert.deepEqual(ids(baseProfile(), tpl({ cedula: true, redam: false }), files), ['doc:cedula']);
});

test('sin bandera para un documento: solo si está mostrado (plantillas anteriores)', () => {
  const files = { 'doc:cedula': file('c.pdf'), 'doc:redam': file('r.pdf') };
  assert.deepEqual(ids(baseProfile(), tpl({ cedula: true }), files), ['doc:cedula'], 'redam oculto y sin bandera: no se anexa');
  assert.deepEqual(ids(baseProfile(), { ...tpl({}), include: { sections: {}, items: {}, fields: {} } }, files), ['doc:cedula'], 'sin include.documents');
});

test('fileIds incluye los ocultos seleccionados', () => {
  assert.ok(model.fileIds(baseProfile(), tpl({ cedula: true, redam: true })).includes('doc:redam'));
  assert.ok(!model.fileIds(baseProfile(), tpl({ cedula: true, redam: false })).includes('doc:redam'));
});

test('seleccionado sin archivos avisa (también oculto); sin bandera no', () => {
  const files = { 'doc:cedula': file('c.pdf') };
  const m = model.missing(baseProfile(), tpl({ cedula: true, redam: true, policia: true, eps: true }), files);
  assert.ok(m.includes('Documento: REDAM (deudores alimentarios morosos) (oculto en Documentos)'), m.join('|'));
  assert.ok(m.some((x) => x.startsWith('Documento: Antecedentes judiciales')), 'mostrado sin archivos');
  assert.ok(m.some((x) => x.startsWith('Documento: Certificación de afiliación a EPS') && x.endsWith('(oculto en Documentos)')));
  assert.ok(!model.missing(baseProfile(), tpl({ cedula: true }), files).some((x) => x.startsWith('Documento:')), 'sin bandera para policia: no se pide');
});

test('certificado de campo simple prometido y ausente se avisa solo si se anexan certificados', () => {
  const files = {};
  const on = tpl({ cedula: false }, { attachCertificates: true });
  assert.ok(model.missing(baseProfile(), on, files).some((x) => x.startsWith('Certificado sin archivo:') && x.includes('Libreta militar')));
  assert.ok(!model.missing(baseProfile(), tpl({ cedula: false }), files).some((x) => x.startsWith('Certificado sin archivo:')));
  const withFile = { 'cert:personales:libretaMilitar': file('l.pdf') };
  assert.ok(!model.missing(baseProfile(), on, withFile).some((x) => x.includes('Libreta militar')));
  const noField = { ...on, include: { ...on.include, fields: { 'personales.libretaMilitar': false } } };
  assert.ok(!model.missing(baseProfile(), noField, files).some((x) => x.includes('Libreta militar')));
});

test('el schema declara validadores y la foto', () => {
  assert.deepEqual(model.schema.photo, { aspect: '3:4', width: 600, height: 800 });
  const withRules = model.schema.sections.flatMap((s) => s.fields.filter((f) => f.validate));
  assert.ok(withRules.length >= 20);
  const bad = {
    personales: { numeroDocumento: '123', tipoDocumento: 'CC', fechaNacimiento: '2999-01-01', celular: '12345', correo: 'a@b', telefono: '999' },
    experiencia: [{ id: 'e1', empresa: 'X', cargo: 'Y', fechaInicio: '2021-05-01', fechaFin: '2020-01-01' }],
  };
  const r = validateProfile(model.schema.sections, bad, { today: '2026-10-29' });
  const by = Object.fromEntries(r.map((x) => [`${x.secId}.${x.fieldId}`, x.level]));
  assert.equal(by['personales.numeroDocumento'], 'error');
  assert.equal(by['personales.fechaNacimiento'], 'error');
  assert.equal(by['personales.celular'], 'error');
  assert.equal(by['personales.correo'], 'error');
  assert.equal(by['personales.telefono'], 'warn');
  assert.equal(by['experiencia.fechaFin'], 'error');
  const good = { personales: { numeroDocumento: '1.098.765.432', tipoDocumento: 'CC', fechaNacimiento: '1990-05-01', celular: '300 123 4567', correo: 'a@b.co', telefono: '234 5678' } };
  assert.deepEqual(validateProfile(model.schema.sections, good, { today: '2026-10-29' }), []);
});

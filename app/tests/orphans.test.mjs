import test from 'node:test';
import assert from 'node:assert/strict';
import { referencedFileIds, findOrphans } from '../js/orphans.js';

const certFileId = (s, it, f) => (s.repeatable ? `cert:${it.id}` : f ? `cert:${s.id}:${f.id}` : `cert:${s.id}`);
const schema = {
  sections: [
    { id: 'personales', fields: [{ id: 'foto' }, { id: 'libreta', certificate: true }] },
    { id: 'bachiller', certificate: true, fields: [] },
    { id: 'cursos', repeatable: true, fields: [] },
  ],
  documents: [{ id: 'cedula' }, { id: 'rut' }],
};
const f = (id, size = 1, name) => ({ id, meta: { size, name } });

test('referencias: certificados, fotos y documentos', () => {
  const refs = referencedFileIds(
    { personales: { foto: 'photo' }, cursos: [{ id: 'c1' }, { id: 'c2' }], documents: { rut: ['doc:rut', 'doc:rut:2'] } }, [], schema, certFileId);
  for (const id of ['photo', 'cert:c1', 'cert:c2', 'cert:personales:libreta', 'cert:bachiller', 'doc:cedula', 'doc:rut', 'doc:rut:2']) assert.ok(refs.has(id), id);
  assert.ok(!refs.has('cert:c3'));
});

test('huérfanos: ítem borrado, página de documento no listada, foto sin referencia, ordenados por tamaño', () => {
  const profile = { personales: {}, cursos: [{ id: 'c1' }], documents: { rut: ['doc:rut'] } };
  const refs = referencedFileIds(profile, [], schema, certFileId);
  const files = [f('cert:c1', 10), f('cert:gone', 500, 'viejo.pdf'), f('doc:rut', 5), f('doc:rut:3', 900), f('photo', 50), f('doc:cedula', 7)];
  const o = findOrphans(files, refs);
  assert.deepEqual(o.map((x) => x.id), ['doc:rut:3', 'cert:gone']); // 'photo' nunca es huérfana
  assert.equal(o[1].name, 'viejo.pdf');
});

test('photo siempre está referenciada, aunque ningún campo del perfil la nombre', () => {
  assert.ok(referencedFileIds({}, [], schema, certFileId).has('photo'));
  assert.ok(referencedFileIds(null, null, null, certFileId).has('photo'));
  assert.deepEqual(findOrphans([f('photo', 9)], referencedFileIds({ personales: {} }, [], schema, certFileId)), []);
});

test('un id citado por una plantilla se considera referenciado', () => {
  const refs = referencedFileIds({}, [{ id: 't', include: { extra: 'cert:zzz' } }], schema, certFileId);
  assert.deepEqual(findOrphans([f('cert:zzz')], refs), []);
});

test('perfil vacío o inválido no rompe', () => {
  const refs = referencedFileIds(null, null, schema, certFileId);
  assert.deepEqual(findOrphans([f('cert:x', 3)], refs).map((x) => x.id), ['cert:x']);
  assert.deepEqual(findOrphans(null, refs), []);
});

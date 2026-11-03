import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate, CURRENT_VERSION } from '../js/migrate.js';

const gen = () => { let n = 0; return () => 'gen' + (++n); };

test('perfil sin versión: ids legacy doc:x:1 pasan a doc:x', () => {
  const r = migrate({ documents: { rut: ['doc:rut:1', 'doc:rut:2'] } }, { from: 0 });
  assert.deepEqual(r.profile.documents.rut, ['doc:rut', 'doc:rut:2']);
  assert.deepEqual(r.renames, { 'doc:rut:1': 'doc:rut' });
  assert.equal(r.version, CURRENT_VERSION);
  assert.equal(r.changed, true);
});

test('si el destino ya existe, el legacy toma el siguiente :n libre', () => {
  const r = migrate({ documents: { rut: ['doc:rut', 'doc:rut:1', 'doc:rut:2'] } });
  assert.deepEqual(r.profile.documents.rut, ['doc:rut', 'doc:rut:3', 'doc:rut:2']);
  assert.equal(r.renames['doc:rut:1'], 'doc:rut:3');
});

test('quita duplicados y valores que no son texto', () => {
  const r = migrate({ documents: { a: ['doc:a', 'doc:a', 5, null, 'doc:a:2'], b: 'x' } });
  assert.deepEqual(r.profile.documents, { a: ['doc:a', 'doc:a:2'], b: [] });
});

test('con fileIds conocidos se retiran los ids fantasma; los legacy con archivo se conservan renombrados', () => {
  const r = migrate({ documents: { rut: ['doc:rut:1'], cedula: ['doc:cedula', 'doc:cedula:2'] } }, { fileIds: ['doc:rut:1', 'doc:cedula'] });
  assert.deepEqual(r.profile.documents, { rut: ['doc:rut'], cedula: ['doc:cedula'] });
  assert.deepEqual(r.dropped, ['doc:cedula:2']);
});

test('sin fileIds no se retira nada por fantasma', () => {
  const r = migrate({ documents: { cedula: ['doc:cedula:2'] } });
  assert.deepEqual(r.profile.documents.cedula, ['doc:cedula:2']);
  assert.deepEqual(r.dropped, []);
});

test('claves ausentes: documents {} y registros repetibles sin id reciben uno', () => {
  const r = migrate({ personales: { nombres: 'Ana' }, cursos: [{ nombre: 'A' }, { id: 'k', nombre: 'B' }] }, { genId: gen() });
  assert.deepEqual(r.profile.documents, {});
  assert.deepEqual(r.profile.cursos, [{ nombre: 'A', id: 'gen1' }, { id: 'k', nombre: 'B' }]);
  assert.deepEqual(r.profile.personales, { nombres: 'Ana' });
});

test('no muta la entrada', () => {
  const input = { documents: { rut: ['doc:rut:1'] }, cursos: [{ n: 1 }] };
  const snap = structuredClone(input);
  migrate(input, { genId: gen() });
  assert.deepEqual(input, snap);
});

test('idempotente: migrar dos veces = migrar una; el segundo paso no cambia nada', () => {
  const first = migrate({ documents: { rut: ['doc:rut:1'] }, cursos: [{ n: 1 }] }, { genId: gen() });
  const second = migrate(first.profile, { from: 0, genId: gen() });
  assert.deepEqual(second.profile, first.profile);
  assert.equal(second.changed, false);
  assert.deepEqual(second.renames, {});
  const third = migrate(first.profile, { from: CURRENT_VERSION });
  assert.equal(third.changed, false);
});

test('v2: un perfil con datos de antes de las condiciones recibe legacyConditions; uno vacío o nuevo no', () => {
  const old = migrate({ personales: { nombres: 'Ana' } }, { from: 1 });
  assert.equal(old.profile.legacyConditions, true);
  assert.equal(old.changed, true);
  assert.equal(old.version, CURRENT_VERSION);
  for (const empty of [{}, { documents: {} }, { documents: { rut: ['doc:rut'] }, documentsShown: ['a'] }, { personales: { nombres: '  ', x: false }, cursos: [] }, null]) {
    assert.equal(Object.hasOwn(migrate(empty, { from: 0 }).profile, 'legacyConditions'), false, JSON.stringify(empty));
  }
  // versión 0 con datos: también es anterior
  assert.equal(migrate({ cursos: [{ n: 1 }] }, { genId: gen() }).profile.legacyConditions, true);
});

test('v2: la marca es idempotente y no se pone sobre un perfil ya en v2', () => {
  const first = migrate({ personales: { nombres: 'Ana' } }, { from: 1 });
  const again = migrate(first.profile, { from: 1 });
  assert.deepEqual(again.profile, first.profile);
  assert.equal(again.changed, false);
  const fresh = migrate({ personales: { nombres: 'Ana' } }, { from: CURRENT_VERSION });
  assert.equal(fresh.profile.legacyConditions, undefined);
  assert.equal(fresh.changed, false);
});

test('datos de una versión futura no se tocan', () => {
  const p = { documents: { rut: ['doc:rut:1'] } };
  const r = migrate(p, { from: CURRENT_VERSION + 1 });
  assert.equal(r.changed, false);
  assert.deepEqual(r.profile, p);
});

test('entrada inválida produce un perfil mínimo válido', () => {
  for (const bad of [null, undefined, 5, 'x', []]) {
    const r = migrate(bad);
    assert.deepEqual(r.profile, { documents: {} });
    assert.equal(r.version, CURRENT_VERSION);
  }
});

test('un id de otro documento no se renombra', () => {
  const r = migrate({ documents: { rut: ['doc:cedula:1'] } });
  assert.deepEqual(r.profile.documents.rut, ['doc:cedula:1']);
});

// Pruebas de la fusión pura de respaldos (G12): conflictos, formas raras/maliciosas e idempotencia.
// Ejecutar: node --test "app/tests/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeBackup, mergeTemplates, prepareBackup, summarizeProfile, isEmptyValue, mergeSummaryText } from '../js/backup-merge.js';
import { validateBackup, MAX_FILES, MAX_TEMPLATES } from '../js/backup-validate.js';
import { CURRENT_VERSION } from '../js/migrate.js';

const b64 = (b) => Buffer.from(b).toString('base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF');
const tpl = (over = {}) => ({ id: 't1', name: 'Plantilla', modelId: 'minerva', include: { sections: {}, items: {}, fields: {} }, options: {}, ...over });
const f = (id) => ({ id, meta: { type: 'application/pdf', name: id + '.pdf' }, bytes: new Uint8Array(PDF), type: 'application/pdf' });
const ymd = (n) => `2026-0${n}-01T00:00:00.000Z`;
const run = (cur, inc, opts) => { const r = mergeBackup(cur, inc, opts); assert.equal(r.ok, true, r.error); return r; };
// Después de fusionar, "lo actual" pasa a ser el resultado.
const asCurrent = (r, files) => ({ profile: r.profile, templates: r.templates, files });

test('sección simple: el respaldo solo llena campos vacíos', () => {
  const r = run({ profile: { personales: { nombres: 'Ana', apellidos: '', celular: null } } },
    { profile: { personales: { nombres: 'Otra', apellidos: 'Pérez', celular: '3001234567', ciudad: '  ' } } });
  assert.deepEqual(r.profile.personales, { nombres: 'Ana', apellidos: 'Pérez', celular: '3001234567' });
  assert.equal(r.stats.profile.filled, 2);
  assert.equal(r.stats.profile.kept, 1);
});

test('preferBackup reemplaza los campos distintos pero nunca con valores vacíos', () => {
  const r = run({ profile: { personales: { nombres: 'Ana', ciudad: 'Cali' } } }, { profile: { personales: { nombres: 'Otra', ciudad: '' } } }, { preferBackup: true });
  assert.deepEqual(r.profile.personales, { nombres: 'Otra', ciudad: 'Cali' });
  assert.equal(r.stats.profile.replaced, 1);
});

test('el cero y los números no cuentan como vacíos; false, "" y [] sí', () => {
  assert.equal(isEmptyValue(0), false);
  assert.equal(isEmptyValue('0'), false);
  for (const v of [null, undefined, '', '   ', false, [], {}]) assert.equal(isEmptyValue(v), true);
  const r = run({ profile: { x: { hijos: 0, marca: false } } }, { profile: { x: { hijos: 3, marca: true } } });
  assert.deepEqual(r.profile.x, { hijos: 0, marca: true });
});

test('sección ausente en lo actual se toma del respaldo', () => {
  const r = run({ profile: {} }, { profile: { personales: { nombres: 'Ana' }, hermanos: [{ id: 'h1', nombre: 'X' }] } });
  assert.deepEqual(r.profile, { personales: { nombres: 'Ana' }, hermanos: [{ id: 'h1', nombre: 'X' }] });
});

test('repetibles: agrega ids nuevos y conserva los actuales', () => {
  const r = run({ profile: { hermanos: [{ id: 'a', n: 1 }] } }, { profile: { hermanos: [{ id: 'b', n: 2 }, { id: 'a', n: 1 }] } });
  assert.deepEqual(r.profile.hermanos, [{ id: 'a', n: 1 }, { id: 'b', n: 2 }]);
  assert.equal(r.stats.profile.itemsAdded, 1);
  assert.equal(r.stats.profile.itemsSame, 1);
});

test('repetibles, mismo id: gana el updatedAt más reciente; sin fechas se conserva el actual', () => {
  const cur = { profile: { exp: [{ id: 'a', v: 'actual', updatedAt: ymd(2) }, { id: 'b', v: 'actual' }, { id: 'c', v: 'actual', updatedAt: ymd(5) }] } };
  const inc = { profile: { exp: [{ id: 'a', v: 'resp', updatedAt: ymd(4) }, { id: 'b', v: 'resp', updatedAt: ymd(9) }, { id: 'c', v: 'resp', updatedAt: ymd(1) }] } };
  const r = run(cur, inc);
  assert.deepEqual(r.profile.exp.map((x) => x.v), ['resp', 'actual', 'actual']);
  assert.equal(r.stats.profile.itemsReplaced, 1);
  assert.equal(r.stats.profile.itemsKept, 2);
  // con "preferir el respaldo" gana siempre el respaldo
  assert.deepEqual(run(cur, inc, { preferBackup: true }).profile.exp.map((x) => x.v), ['resp', 'resp', 'resp']);
  // updatedAt no parseable cuenta como ausente
  const bad = run({ profile: { exp: [{ id: 'a', v: 'actual', updatedAt: 'ayer' }] } }, { profile: { exp: [{ id: 'a', v: 'resp', updatedAt: ymd(9) }] } });
  assert.equal(bad.profile.exp[0].v, 'actual');
});

test('repetibles: registros sin id, no-objetos y ids repetidos del respaldo se omiten', () => {
  const r = run({ profile: { exp: [{ id: 'a' }] } }, { profile: { exp: [{ x: 1 }, 'texto', null, 7, [], { id: '' }, { id: 5 }, { id: 'n', v: 1 }, { id: 'n', v: 2 }] } });
  assert.deepEqual(r.profile.exp, [{ id: 'a' }, { id: 'n', v: 1 }]);
  assert.equal(r.stats.profile.skipped, 8);
});

test('tipos que no coinciden (arreglo vs objeto vs texto): se conserva lo actual', () => {
  const r = run({ profile: { a: { x: 1 }, b: [{ id: 'z' }], c: 'texto' } }, { profile: { a: [{ id: 'q' }], b: { x: 2 }, c: { y: 1 } } });
  assert.deepEqual(r.profile, { a: { x: 1 }, b: [{ id: 'z' }], c: 'texto' });
  assert.equal(r.changed, false);
});

test('claves peligrosas: __proto__ no contamina nada, constructor/prototype se descartan', () => {
  const evil = JSON.parse('{"profile":{"__proto__":{"polluted":1},"personales":{"__proto__":{"polluted":2},"constructor":"c","nombres":"Ana"},"exp":[{"id":"a","__proto__":{"polluted":3}}]},"templates":[],"files":[]}');
  const r = run({ profile: {} }, evil);
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.getPrototypeOf(r.profile.personales), Object.prototype);
  assert.equal(Object.hasOwn(r.profile, '__proto__'), false);
  assert.equal(Object.hasOwn(r.profile.personales, '__proto__'), false);
  assert.equal(Object.hasOwn(r.profile.exp[0], '__proto__'), false);
  assert.equal(Object.hasOwn(r.profile.personales, 'constructor'), false); // claves reservadas: se descartan
  assert.equal(r.profile.personales.nombres, 'Ana');
});

test('formas raras: entradas no objeto, profundidad excesiva y valores no JSON no rompen', () => {
  for (const inc of [null, undefined, 5, 'x', [], { profile: 'x', templates: 'y', files: 7 }, { profile: [1, 2] }]) {
    const r = run({ profile: { a: { x: 1 } }, templates: [tpl()], files: [] }, inc);
    assert.deepEqual(r.profile, { a: { x: 1 } });
    assert.equal(r.changed, false);
  }
  let deep = { v: 1 };
  for (let i = 0; i < 200; i++) deep = { d: deep };
  const r = run({ profile: {} }, { profile: { s: { campo: 'ok', hondo: deep } } });
  assert.equal(r.profile.s.campo, 'ok');
  assert.ok(JSON.stringify(r.profile).length < 2000);
  const r2 = run(null, { profile: { s: { f: () => 1, n: NaN, ok: 'si' } } });
  assert.deepEqual(r2.profile.s, { ok: 'si' });
});

test('no muta los argumentos', () => {
  const cur = { profile: { a: { x: '' }, l: [{ id: '1' }], documents: { d: ['doc:d'] } }, templates: [tpl()], files: [{ id: 'doc:d' }] };
  const inc = { profile: { a: { x: 'v' }, l: [{ id: '2' }], documents: { d: ['doc:d:2'] } }, templates: [tpl({ id: 't2' })], files: [f('doc:d:2')] };
  const c1 = JSON.stringify(cur), i1 = JSON.stringify({ ...inc, files: [] });
  run(cur, inc);
  assert.equal(JSON.stringify(cur), c1);
  assert.equal(JSON.stringify({ ...inc, files: [] }), i1);
});

test('documents y documentsShown: unión sin duplicados; ids de archivos inexistentes se descartan', () => {
  const cur = { profile: { documents: { cedula: ['doc:cedula'] }, documentsShown: ['cedula', 'rut'] }, files: [{ id: 'doc:cedula' }] };
  const inc = { profile: { documents: { cedula: ['doc:cedula', 'doc:cedula:2'], rut: ['doc:rut'], fantasma: ['doc:no'], x: 'mal' }, documentsShown: ['rut', 'eps', 7] }, files: [f('doc:cedula:2'), f('doc:rut')] };
  const r = run(cur, inc);
  assert.deepEqual(r.profile.documents, { cedula: ['doc:cedula', 'doc:cedula:2'], rut: ['doc:rut'] });
  assert.deepEqual(r.profile.documentsShown, ['cedula', 'rut', 'eps']);
});

test('documentsShown: sin lista propia solo se fija si se conoce la lista efectiva', () => {
  const inc = { profile: { documentsShown: ['eps'] } };
  assert.equal('documentsShown' in run({ profile: {} }, inc).profile, false);
  assert.deepEqual(run({ profile: {} }, inc, { currentShown: ['cedula'] }).profile.documentsShown, ['cedula', 'eps']);
  // si no aporta nada nuevo no se crea la clave
  assert.equal('documentsShown' in run({ profile: {} }, { profile: { documentsShown: ['cedula'] } }, { currentShown: ['cedula'] }).profile, false);
});

test('plantillas: nuevas se agregan, iguales se ignoran, distintas con el mismo id conservan ambas', () => {
  const r = run({ profile: {}, templates: [tpl()] }, { profile: {}, templates: [tpl(), tpl({ id: 't2' }), tpl({ name: 'Cambiada' })] });
  assert.deepEqual(r.templates.map((t) => t.id), ['t1', 't2', 't1:imp']);
  assert.equal(r.templates[2].name, 'Cambiada (importada)');
  assert.deepEqual(r.stats.templates, { added: 1, renamed: 1, same: 1 });
  assert.equal(r.templates[0].name, 'Plantilla');
});

test('plantillas: renombres sucesivos usan :imp2, :imp3 sin colisionar', () => {
  const cur = [tpl(), tpl({ id: 't1:imp', name: 'otra' })];
  const r = mergeTemplates(cur, [tpl({ name: 'Nueva' })]);
  assert.deepEqual(r.templates.map((t) => t.id), ['t1', 't1:imp', 't1:imp2']);
});

test('plantillas: entradas inválidas o sin id se omiten; el tope de plantillas se respeta', () => {
  const r = mergeTemplates([], [null, 5, 'x', {}, { id: '' }, tpl({ id: 'ok' })]);
  assert.deepEqual(r.templates.map((t) => t.id), ['ok']);
  const many = Array.from({ length: MAX_TEMPLATES }, (_, i) => tpl({ id: 'c' + i }));
  const big = mergeBackup({ profile: {}, templates: many, files: [] }, { profile: {}, templates: [tpl({ id: 'extra' })], files: [] });
  assert.equal(big.ok, false);
  assert.match(big.error, /plantillas/);
});

test('archivos: se agregan los que faltan; el id repetido conserva el actual salvo preferBackup', () => {
  const cur = { profile: {}, files: [{ id: 'photo' }, { id: 'a' }] };
  const inc = { profile: {}, files: [f('photo'), f('b'), f('b')] };
  const r = run(cur, inc);
  assert.deepEqual(r.filesToPut, ['b']);
  assert.deepEqual(r.stats.files, { added: 1, replaced: 0, kept: 1 });
  const p = run(cur, inc, { preferBackup: true });
  assert.deepEqual(p.filesToPut, ['photo', 'b']);
  assert.deepEqual(p.stats.files, { added: 1, replaced: 1, kept: 0 });
});

test('archivos: el tope de cantidad se respeta', () => {
  const cur = { profile: {}, files: Array.from({ length: MAX_FILES }, (_, i) => ({ id: 'f' + i })) };
  assert.equal(mergeBackup(cur, { profile: {}, files: [f('nuevo')] }).ok, false);
  assert.equal(mergeBackup(cur, { profile: {}, files: [f('f1')] }).ok, true); // reemplazar no suma
});

test('idempotencia: fusionar dos veces el mismo respaldo no cambia nada (con y sin preferBackup)', () => {
  const cur = { profile: { personales: { nombres: 'Ana' }, exp: [{ id: 'a', v: 1, updatedAt: ymd(5) }], documents: { d: ['doc:d'] }, documentsShown: ['d'] }, templates: [tpl()], files: [{ id: 'doc:d' }] };
  const inc = {
    profile: { personales: { nombres: 'Otro', ciudad: 'Cali' }, exp: [{ id: 'a', v: 9, updatedAt: ymd(8) }, { id: 'b', v: 2 }], documents: { d: ['doc:d', 'doc:d:2'] }, documentsShown: ['d', 'e'] },
    templates: [tpl({ name: 'Distinta' }), tpl({ id: 't9' })], files: [f('doc:d:2'), f('photo')],
  };
  for (const preferBackup of [false, true]) {
    const r1 = run(cur, inc, { preferBackup });
    assert.equal(r1.changed, true);
    const files1 = [...cur.files, ...r1.filesToPut.map((id) => ({ id }))];
    const r2 = run(asCurrent(r1, files1), inc, { preferBackup });
    assert.deepEqual(r2.profile, r1.profile);
    assert.deepEqual(r2.templates, r1.templates);
    // sin preferBackup la segunda fusión no cambia nada; con preferBackup solo se reescribirían archivos (mismo contenido)
    if (!preferBackup) { assert.equal(r2.changed, false); assert.deepEqual(r2.filesToPut, []); }
  }
});

test('fusionar un respaldo consigo mismo (lo actual == respaldo) no cambia nada', () => {
  const data = { profile: { personales: { nombres: 'Ana' }, exp: [{ id: 'a' }], documents: { d: ['doc:d'] } }, templates: [tpl()], files: [f('doc:d')] };
  const r = run({ profile: data.profile, templates: data.templates, files: [{ id: 'doc:d' }] }, data);
  assert.equal(r.changed, false);
  assert.deepEqual(r.filesToPut, []);
});

test('lo actual vacío + respaldo = el respaldo', () => {
  const inc = { profile: { personales: { nombres: 'Ana' }, exp: [{ id: 'a', v: 1 }] }, templates: [tpl()], files: [f('photo')] };
  const r = run({ profile: {}, templates: [], files: [] }, inc);
  assert.deepEqual(r.profile, inc.profile);
  assert.equal(r.templates.length, 1);
  assert.deepEqual(r.filesToPut, ['photo']);
});

test('summarizeProfile y mergeSummaryText', () => {
  assert.deepEqual(summarizeProfile({ p: { a: 'x', b: '' }, l: [{ id: '1' }, { id: '2' }], documents: { d: [] }, z: 't' }), { sections: 3, fields: 2, items: 2 });
  assert.deepEqual(summarizeProfile(null), { sections: 0, fields: 0, items: 0 });
  const r = run({ profile: {} }, { profile: { p: { a: 'x' } }, templates: [tpl()] });
  assert.match(mergeSummaryText(r.stats), /1 campo\(s\) completado\(s\).*1 plantilla/);
  assert.match(mergeSummaryText(run({ profile: {} }, { profile: {} }).stats), /nada nuevo/);
});

// ---- Versionado (prepareBackup / validateBackup) ----
const backup = (over = {}) => ({ app: 'hv-minerva', version: 1, exportedAt: '2026-10-01T10:00:00.000Z', profile: { personales: { nombres: 'A' } }, templates: [tpl()], files: [{ id: 'cert:a', meta: { name: 'a.pdf', type: 'application/pdf' }, data: b64(PDF) }], ...over });

test('schemaVersion más nueva que la de la app se rechaza con mensaje claro', () => {
  const r = validateBackup(backup({ schemaVersion: CURRENT_VERSION + 1 }));
  assert.equal(r.ok, false);
  assert.match(r.error, /versión más nueva/);
  assert.equal(prepareBackup(backup({ schemaVersion: 999 })).ok, false);
  assert.equal(prepareBackup(backup({ schemaVersion: CURRENT_VERSION })).ok, true);
});

test('schemaVersion rara (texto, negativa, decimal) se trata como 0 y se migra', () => {
  for (const sv of ['9', -1, 1.5, null, {}]) {
    const r = prepareBackup(backup({ schemaVersion: sv, profile: { documents: { rut: ['doc:rut:1'] } }, files: [{ id: 'doc:rut:1', meta: { type: 'application/pdf' }, data: b64(PDF) }] }));
    assert.equal(r.ok, true, String(sv));
    assert.equal(r.schemaVersion, 0);
    assert.equal(r.upgraded, true);
    assert.deepEqual(r.profile.documents.rut, ['doc:rut']);
    assert.equal(r.files[0].id, 'doc:rut');
  }
});

test('un respaldo viejo (sin schemaVersion) se migra antes de fusionar', () => {
  const p = prepareBackup(backup({ profile: { exp: [{ cargo: 'sin id' }] } }));
  assert.equal(p.ok, true);
  assert.ok(p.profile.exp[0].id);
  const r = run({ profile: {} }, p);
  assert.equal(r.profile.exp.length, 1);
});

test('el respaldo inválido sigue rechazándose entero (un archivo malo invalida todo)', () => {
  const bad = backup({ files: [{ id: 'cert:a', meta: { type: 'application/pdf' }, data: b64(PDF) }, { id: 'x', meta: { type: 'text/html' }, data: b64('<html>') }] });
  assert.equal(prepareBackup(bad).ok, false);
  assert.equal(prepareBackup({ app: 'otro' }).ok, false);
  assert.equal(prepareBackup(null).ok, false);
});

test('legacyConditions: el respaldo conserva la marca (ida y vuelta) y la de v2 sin marca no la inventa', () => {
  const legacy = prepareBackup(backup({ schemaVersion: 1, profile: { personales: { nombres: 'A' } } }));
  assert.equal(legacy.profile.legacyConditions, true);
  const again = prepareBackup(backup({ schemaVersion: CURRENT_VERSION, profile: legacy.profile }));
  assert.equal(again.ok, true);
  assert.equal(again.profile.legacyConditions, true);
  const fresh = prepareBackup(backup({ schemaVersion: CURRENT_VERSION, profile: { personales: { nombres: 'A' } } }));
  assert.equal(Object.hasOwn(fresh.profile, 'legacyConditions'), false);
  // valores que no son exactamente true se descartan
  assert.equal(Object.hasOwn(validateBackup(backup({ profile: { legacyConditions: 'si', personales: { nombres: 'A' } } })).profile, 'legacyConditions'), false);
});

test('legacyConditions: fusionar no agrega la marca a un perfil que no la tiene', () => {
  const inc = { profile: { legacyConditions: true, personales: { nombres: 'Z', apellidos: 'Y' } }, templates: [], files: [] };
  const m = mergeBackup({ profile: { personales: { nombres: 'A' } }, templates: [], files: [] }, inc);
  assert.equal(m.ok, true);
  assert.equal(Object.hasOwn(m.profile, 'legacyConditions'), false);
  assert.equal(m.profile.personales.apellidos, 'Y');
  // el perfil actual con marca la conserva
  const k = mergeBackup({ profile: { legacyConditions: true, personales: { nombres: 'A' } }, templates: [], files: [] }, { profile: { personales: { nombres: 'A' } }, templates: [], files: [] });
  assert.equal(k.profile.legacyConditions, true);
  // un perfil actual vacío adopta la del respaldo
  const e = mergeBackup({ profile: {}, templates: [], files: [] }, inc);
  assert.equal(e.profile.legacyConditions, true);
  assert.equal(summarizeProfile({ legacyConditions: true, personales: { nombres: 'A' } }).fields, 1);
});

// Sincronización (G04): reloj de cambios (clock.js) y fusión "gana el más reciente" con lápidas (sync-merge.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { stampProfile, stampTemplates, stampFiles, stampUndated, pruneClock, sanitizeClock, canon, kindOf, combineKind, TOMBSTONE_TTL } from '../js/sync/clock.js';
import { mergeSync, syncSummaryText } from '../js/sync/sync-merge.js';

const T0 = 1_700_000_000_000;
const side = (o = {}) => ({ profile: {}, templates: [], clock: {}, files: {}, ...o });
const tpl = (id, name, updatedAt = '') => ({ id, name, modelId: 'minerva', jobType: '', createdAt: '', updatedAt, include: { sections: {}, items: {}, fields: {} }, options: { showPhoto: true, attachCertificates: true, attachDocuments: true, objective: '' } });

test('kindOf / combineKind: tipos de primer nivel coherentes entre reloj y fusión', () => {
  assert.equal(kindOf(undefined), 'none');
  assert.equal(kindOf({ a: 1 }), 'obj');
  assert.equal(kindOf([]), 'empty');
  assert.equal(kindOf([{ id: 'x' }]), 'items');
  assert.equal(kindOf(['cedula']), 'scalar');
  assert.equal(combineKind('empty', 'items'), 'items');
  assert.equal(combineKind('empty', 'scalar'), 'scalar');
  assert.equal(combineKind('none', 'empty'), 'items');
  assert.equal(combineKind('obj', 'items'), 'scalar');
});

test('stampProfile fecha solo lo que cambió: campo, registro (alta/cambio/baja) y escalar', () => {
  const prev = { personales: { nombres: 'Ana', apellidos: 'Pérez' }, superior: [{ id: 'a', programa: 'X' }, { id: 'b', programa: 'Y' }], documentsShown: ['cedula'] };
  const next = { personales: { nombres: 'Ana', apellidos: 'Gómez' }, superior: [{ id: 'a', programa: 'X2' }, { id: 'c', programa: 'Z' }], documentsShown: ['cedula', 'rut'] };
  const c = stampProfile(prev, next, {}, T0);
  assert.deepEqual(Object.keys(c).sort(), ['i:superior/a', 'i:superior/c', 'p:documentsShown', 'p:personales.apellidos', 'xi:superior/b'].sort());
  assert.equal(c['p:personales.apellidos'], T0);
  // Sin cambios: reloj intacto. Un segundo cambio en el mismo milisegundo sigue siendo estrictamente posterior.
  assert.deepEqual(stampProfile(next, next, c, T0 + 5), c);
  const c2 = stampProfile(next, { ...next, personales: { nombres: 'Ana', apellidos: 'Otro' } }, c, T0);
  assert.ok(c2['p:personales.apellidos'] > c['p:personales.apellidos']);
  // Volver a crear un registro borrado quita su lápida.
  const c3 = stampProfile(next, { ...next, superior: [...next.superior, { id: 'b', programa: 'Y' }] }, c, T0 + 10);
  assert.equal(c3['xi:superior/b'], undefined);
  assert.equal(c3['i:superior/b'], T0 + 10);
});

test('stampTemplates y stampFiles: altas, cambios y lápidas', () => {
  const c = stampTemplates([tpl('t1', 'A'), tpl('t2', 'B')], [tpl('t1', 'A2'), tpl('t3', 'C')], {}, T0);
  assert.deepEqual(Object.keys(c).sort(), ['t:t1', 't:t3', 'xt:t2']);
  const f = stampFiles({ 'xf:photo': 1 }, { put: ['photo'], del: ['cert:a'] }, T0);
  assert.equal(f['f:photo'], T0); assert.equal(f['xf:photo'], undefined); assert.equal(f['xf:cert:a'], T0);
});

test('sanitizeClock y pruneClock: descarta basura y lápidas vencidas', () => {
  assert.deepEqual(sanitizeClock({ 'p:a.b': 5, __proto__: 1, 'z:raro': 3, 'p:x': -1, 'p:y': 'n', 'xt:t': 7.9 }), { 'p:a.b': 5, 'xt:t': 7 });
  const c = pruneClock({ 'xt:viejo': T0 - TOMBSTONE_TTL - 1, 'xt:nuevo': T0 - 1000, 't:x': 1 }, T0);
  assert.deepEqual(Object.keys(c).sort(), ['t:x', 'xt:nuevo']);
});

test('mergeSync: por campo gana la edición más reciente (en ambos sentidos)', () => {
  const L = side({ profile: { personales: { nombres: 'Ana', celular: '300' } }, clock: { 'p:personales.nombres': T0 + 10, 'p:personales.celular': T0 } });
  const R = side({ profile: { personales: { nombres: 'Ana María', celular: '311' } }, clock: { 'p:personales.nombres': T0, 'p:personales.celular': T0 + 20 } });
  const m = mergeSync(L, R, { now: T0 + 100 });
  assert.deepEqual(m.profile.personales, { nombres: 'Ana', celular: '311' });
  assert.equal(m.changedLocal, true);
  assert.equal(m.stats.fields, 1);
  assert.equal(m.clock['p:personales.nombres'], T0 + 10);
  // Convergencia: fusionar el resultado con cualquiera de los lados no cambia nada.
  const back = side({ profile: m.profile, templates: m.templates, clock: m.clock, files: m.files });
  assert.equal(canon(mergeSync(back, R, { now: T0 + 100 }).profile), canon(m.profile));
  assert.equal(mergeSync(back, back, { now: T0 + 100 }).changedLocal, false);
});

test('mergeSync: vaciar un campo a propósito se propaga (en la fusión de respaldos un vacío nunca gana)', () => {
  const L = side({ profile: { personales: { libreta: '123' } }, clock: { 'p:personales.libreta': T0 } });
  const R = side({ profile: { personales: { libreta: '' } }, clock: { 'p:personales.libreta': T0 + 1 } });
  assert.equal(mergeSync(L, R).profile.personales.libreta, '');
});

test('mergeSync: empate sin fechas -> gana el remoto, salvo que el remoto esté vacío (llenar huecos)', () => {
  const L = side({ profile: { personales: { nombres: 'Local', celular: '300', ciudad: '' } } });
  const R = side({ profile: { personales: { nombres: 'Remoto', celular: '', ciudad: 'Cali' } } });
  assert.deepEqual(mergeSync(L, R).profile.personales, { nombres: 'Remoto', celular: '300', ciudad: 'Cali' });
});

test('mergeSync: registros repetibles por id, updatedAt cuenta como fecha, lápidas borran y una edición posterior resucita', () => {
  const L = side({
    profile: { superior: [{ id: 'a', programa: 'A local', updatedAt: new Date(T0 + 50).toISOString() }, { id: 'b', programa: 'B' }, { id: 'c', programa: 'C editado' }] },
    clock: { 'i:superior/c': T0 + 30 },
  });
  const R = side({
    profile: { superior: [{ id: 'a', programa: 'A remoto' }, { id: 'd', programa: 'D nuevo' }] },
    clock: { 'i:superior/a': T0 + 10, 'xi:superior/b': T0 + 5, 'xi:superior/c': T0 + 20 },
  });
  const m = mergeSync(L, R, { now: T0 + 100 });
  assert.deepEqual(m.profile.superior.map((x) => x.id + ':' + x.programa), ['a:A local', 'c:C editado', 'd:D nuevo']);
  assert.equal(m.stats.itemsDeleted, 1);
  assert.equal(m.stats.items, 1);
  // El otro lado, con el resultado, borra "b" (ya no lo tiene) y no lo vuelve a traer.
  const m2 = mergeSync(R, side({ profile: m.profile, clock: m.clock }), { now: T0 + 100 });
  assert.deepEqual(m2.profile.superior.map((x) => x.id), ['a', 'd', 'c']);
});

test('mergeSync: plantillas — gana la más reciente, sin duplicar "(importada)"; lápida la borra', () => {
  const L = side({ templates: [tpl('t1', 'Admin v2', new Date(T0 + 10).toISOString()), tpl('t2', 'Borrable')] });
  const R = side({ templates: [tpl('t1', 'Admin v1', new Date(T0).toISOString()), tpl('t3', 'Nueva')], clock: { 'xt:t2': T0 + 1 } });
  const m = mergeSync(L, R, { now: T0 + 100 });
  assert.deepEqual(m.templates.map((t) => t.name), ['Admin v2', 'Nueva']);
  assert.equal(m.stats.templatesDeleted, 1);
});

test('mergeSync: archivos — reemplazo más reciente (misma id, otro contenido) baja; borrado remoto borra; solo-metadatos no baja bytes', () => {
  const meta = (n) => ({ name: n, type: 'image/png', size: 10 });
  const L = side({ files: { photo: { h: 'a'.repeat(32), meta: meta('vieja.png') }, 'cert:x': { h: 'b'.repeat(32), meta: meta('x.png') }, 'doc:rut': { h: 'c'.repeat(32), meta: meta('rut.png') } }, clock: { 'f:photo': T0, 'f:cert:x': T0, 'f:doc:rut': T0 } });
  const R = side({ files: { photo: { h: 'd'.repeat(32), meta: meta('nueva.png'), b: true }, 'doc:rut': { h: 'c'.repeat(32), meta: { ...meta('rut.png'), emitidoEn: '2026-01-01' }, b: true } }, clock: { 'f:photo': T0 + 5, 'xf:cert:x': T0 + 5, 'f:doc:rut': T0 + 5 } });
  const m = mergeSync(L, R, { now: T0 + 100 });
  assert.deepEqual(m.apply.put, [{ id: 'photo', needBytes: true }, { id: 'doc:rut', needBytes: false }]);
  assert.deepEqual(m.apply.del, ['cert:x']);
  assert.deepEqual(Object.keys(m.files).sort(), ['doc:rut', 'photo']);
});

test('stampUndated: unirse "prefiriendo este equipo" hace ganar los datos locales sin fecha', () => {
  const L = side({ profile: { personales: { nombres: 'Local' } }, templates: [tpl('t1', 'L')] });
  const R = side({ profile: { personales: { nombres: 'Remoto' } }, templates: [tpl('t1', 'R')] });
  const stamped = { ...L, clock: stampUndated(L, L.clock, T0) };
  const m = mergeSync(stamped, R, { now: T0 });
  assert.equal(m.profile.personales.nombres, 'Local');
  assert.equal(m.templates[0].name, 'L');
  assert.equal(mergeSync(L, R).profile.personales.nombres, 'Remoto');
});

test('syncSummaryText resume cambios y borrados', () => {
  assert.equal(syncSummaryText({ fields: 2, items: 1, templates: 0, files: 1, itemsDeleted: 1, templatesDeleted: 0, filesDeleted: 0 }), 'Se recibieron cambios de otro equipo: 2 campo(s), 1 registro(s), 1 archivo(s). Se aplicaron 1 borrado(s) hechos en otro equipo.');
  assert.equal(syncSummaryText({ fields: 0, items: 0, templates: 0, files: 0 }), '');
});

test('sellos remotos adelantados: se limitan a ahora + 1 día (sanitizeClock y mergeSync); un reloj local normal sigue ganando después', () => {
  const DAY = 86400000, NOW = T0 + 10 * DAY;
  const far = NOW + 400 * DAY;
  assert.deepEqual(sanitizeClock({ 'p:a.b': far, 'p:a.c': NOW - 5 }, NOW), { 'p:a.b': NOW + DAY, 'p:a.c': NOW - 5 });
  // Un remoto con el reloj adelantado un año: sin tope ganaría contra cualquier edición local de los próximos 400 días.
  const remote = side({ profile: { personales: { nombres: 'Remoto' } }, clock: { 'p:personales.nombres': far } });
  const local = side({ profile: { personales: { nombres: 'Local' } }, clock: { 'p:personales.nombres': NOW - 1000 } });
  const m1 = mergeSync(local, remote, { now: NOW });
  assert.equal(m1.profile.personales.nombres, 'Remoto', 'sigue ganando el remoto (más nuevo que lo local), pero con sello acotado');
  assert.equal(m1.clock['p:personales.nombres'], NOW + DAY, 'el reloj fusionado no guarda el sello adelantado');
  // El resultado fusionado (con el sello ya acotado) es lo que se sube: dos días después una edición local legítima ya gana.
  const later = NOW + 2 * DAY;
  const pushed = side({ profile: m1.profile, clock: m1.clock });
  const editedLocal = side({ profile: { personales: { nombres: 'Nueva' } }, clock: { ...m1.clock, 'p:personales.nombres': later } });
  assert.equal(mergeSync(editedLocal, pushed, { now: later }).profile.personales.nombres, 'Nueva');
  // updatedAt de registros y plantillas más allá de ahora + 1 día no se toma en cuenta (es dato: no se reescribe al fusionar).
  const farIso = new Date(far).toISOString();
  const rt = side({ templates: [tpl('t1', 'Remota', farIso)] }), lt = side({ templates: [tpl('t1', 'Local', new Date(later).toISOString())], clock: { 't:t1': later } });
  assert.equal(mergeSync(lt, rt, { now: later }).templates[0].name, 'Local');
});

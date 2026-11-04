// Adaptador local de la sincronización (js/sync/local-store.js) con `store` y `sdb` inyectados en memoria (sin navegador).
// Cubre: saveClock nunca pisa un sello más nuevo (pérdida de actualización) y la copia previa solo se promueve si applySync tuvo éxito.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalStore, maxClock } from '../js/sync/local-store.js';
import { syncOnce } from '../js/sync/engine.js';
import { createMemoryProvider } from '../js/sync/provider.js';
import { stampProfile } from '../js/sync/clock.js';
import { device, sharedKeys } from './_sync-fixtures.mjs';

function fakes({ failApply = false } = {}) {
  const kv = new Map();
  const sdb = { get: async (k) => kv.get(k), set: async (k, v) => { kv.set(k, structuredClone(v)); }, del: async (k) => { kv.delete(k); } };
  const st = { profile: {}, templates: [], clock: {}, files: new Map() };
  const store = {
    getProfile: () => structuredClone(st.profile), getTemplates: () => structuredClone(st.templates), getSyncClock: () => ({ ...st.clock }),
    setSyncClock: (c) => { st.clock = { ...c }; },
    listFiles: async () => [], getFile: async () => null, hasData: async () => true,
    applySync: async (x) => { if (failApply) throw Object.assign(new Error('x'), { code: 'write' }); st.profile = x.profile; st.templates = x.templates; st.clock = { ...x.clock }; },
  };
  return { kv, sdb, st, store };
}

test('maxClock: máximo por clave, sin retroceder ningún sello', () => {
  assert.deepEqual(maxClock({ a: 5, b: 9 }, { a: 7, b: 3, c: 1 }), { a: 7, b: 9, c: 1 });
  assert.deepEqual(maxClock({ a: 5 }, undefined), { a: 5 });
});

test('saveClock relee el reloj actual y conserva el sello de una edición hecha durante la fase de red', async () => {
  const f = fakes();
  const local = createLocalStore({ store: f.store, sdb: f.sdb });
  f.st.clock = { 'p:personales.nombres': 100 };
  const read = await local.read();                       // el motor lee el reloj...
  f.st.clock = { ...f.st.clock, 'p:personales.ciudad': 500, 'p:personales.nombres': 150 }; // ...y la persona edita durante la red
  await local.saveClock({ ...read.clock, 'xi:cursos/c1': 200 }); // el motor guarda el reloj fusionado que calculó con el viejo
  assert.deepEqual(f.st.clock, { 'p:personales.nombres': 150, 'p:personales.ciudad': 500, 'xi:cursos/c1': 200 });
});

test('motor + dispositivo: una edición que sella el reloj durante la fase de red sobrevive a saveClock', async () => {
  const keys = await sharedKeys();
  const space = { index: {}, blobs: {}, etag: 0 };
  const A = device('A', { profile: { personales: { nombres: 'Ana' } } });
  const B = device('B', { t0: 1_700_000_000_500, profile: { personales: { nombres: 'Ana' } } });
  const mk = (d, state) => ({ provider: createMemoryProvider(space, { maxChunk: 1000 }), local: d.local, state, getKeys: async () => keys, now: d.now });
  let sa = (await syncOnce(mk(A, {}))).state;
  let sb = (await syncOnce(mk(B, {}))).state;
  // Mismo valor editado en los dos equipos: el contenido no cambia al fusionar, solo el reloj -> camino saveClock.
  A.jump(100000); A.edit((p) => { p.personales.celular = '300'; }); sa = (await syncOnce(mk(A, sa))).state;
  B.edit((p) => { p.personales.celular = '300'; });
  const orig = B.local.saveClock;
  let calls = 0;
  B.local.saveClock = async (c) => { calls++; B.edit((p) => { p.personales.ciudad = 'Cali'; }); return orig(c); }; // edición durante la red
  const r = await syncOnce(mk(B, sb));
  assert.ok(calls >= 1, 'se usó saveClock');
  const stamp = B.s.clock['p:personales.ciudad'];
  assert.ok(stamp > 0, 'el sello de la edición concurrente no se perdió');
  sb = r.state;
  // Y esa edición llega al otro equipo en la siguiente ronda.
  B.local.saveClock = orig;
  await syncOnce(mk(B, sb));
  await syncOnce(mk(A, sa));
  assert.equal(A.s.profile.personales.ciudad, 'Cali');
});

test('copia previa: la anterior se conserva hasta que applySync termina bien (ranura pendiente)', async () => {
  const f = fakes();
  const local = createLocalStore({ store: f.store, sdb: f.sdb });
  await f.sdb.set('snapshot', { at: 1, profile: { viejo: true }, templates: [], clock: {}, files: [], added: [] });
  const base = await local.read();
  const x = { base, profile: { nuevo: 1 }, templates: [], clock: {}, puts: [], dels: [] };
  // Fallo al aplicar: la copia válida anterior sigue, y no queda la pendiente.
  const bad = fakes({ failApply: true });
  await bad.sdb.set('snapshot', { at: 1, profile: { viejo: true }, templates: [], clock: {}, files: [], added: [] });
  await assert.rejects(createLocalStore({ store: bad.store, sdb: bad.sdb }).apply({ ...x, base: await createLocalStore({ store: bad.store, sdb: bad.sdb }).read() }));
  assert.equal((await bad.sdb.get('snapshot')).at, 1);
  assert.deepEqual((await bad.sdb.get('snapshot')).profile, { viejo: true });
  assert.equal(await bad.sdb.get('snapshot-pending'), undefined);
  // Mientras se aplica, la copia vigente es la anterior y la nueva está pendiente.
  let during = null;
  const orig = f.store.applySync;
  f.store.applySync = async (y) => { during = { snap: (await f.sdb.get('snapshot')).at, pending: (await f.sdb.get('snapshot-pending'))?.profile }; return orig(y); };
  await local.apply(x);
  assert.equal(during.snap, 1);
  assert.deepEqual(during.pending, {});
  // Éxito: se promueve y se limpia la ranura pendiente.
  const snap = await f.sdb.get('snapshot');
  assert.ok(snap.at > 1);
  assert.deepEqual(snap.profile, {});
  assert.equal(await f.sdb.get('snapshot-pending'), undefined);
});

test('stampProfile usado por el dispositivo de prueba coincide con el reloj real (sanidad del fixture)', () => {
  assert.ok(stampProfile({}, { a: { b: 1 } }, {}, 5)['p:a.b'] >= 5);
});

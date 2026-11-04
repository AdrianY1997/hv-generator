// "Borrar todos mis datos": borrado VERIFICADO de IndexedDB (sync-db.js wipeDatabase) y wipeAll (store.js) con un indexedDB falso inyectado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { wipeDatabase } from '../js/sync/sync-db.js';
import { wipeAll } from '../js/store.js';

/** indexedDB mínimo: una base con almacenes en memoria. deleteMode: 'ok' | 'blocked-then-ok' | 'blocked-forever' | 'error'. */
function fakeIdb({ deleteMode = 'ok', openFails = false, clearFails = false } = {}) {
  const stores = { kv: new Map([['config', 1], ['keys', 2]]), extra: new Map([['x', 1]]) };
  const later = (fn, ms = 0) => setTimeout(fn, ms);
  const idb = {
    stores, deletes: 0,
    deleteDatabase() {
      idb.deletes++;
      const r = {};
      later(() => {
        if (deleteMode === 'ok') { for (const m of Object.values(stores)) m.clear(); r.onsuccess?.(); }
        else if (deleteMode === 'error') r.onerror?.();
        else { r.onblocked?.(); if (deleteMode === 'blocked-then-ok') later(() => { for (const m of Object.values(stores)) m.clear(); r.onsuccess?.(); }, 20); }
      });
      return r;
    },
    open() {
      const r = {};
      later(() => {
        if (openFails) { r.error = new Error('no'); r.onerror?.(); return; }
        r.result = {
          objectStoreNames: Object.keys(stores), close() {},
          transaction(names) {
            const t = {};
            t.objectStore = (n) => ({
              clear() { if (clearFails) { later(() => { t.error = new Error('x'); t.onabort?.(); }); return; } stores[n].clear(); },
              count() { const c = {}; later(() => { c.result = stores[n].size; c.onsuccess?.(); }); return c; },
            });
            later(() => t.oncomplete?.(), 5);
            return t;
          },
        };
        r.onsuccess?.();
      });
      return r;
    },
  };
  return idb;
}
const size = (idb) => Object.values(idb.stores).reduce((n, m) => n + m.size, 0);

test('wipeDatabase: deleteDatabase correcto', async () => {
  const idb = fakeIdb();
  assert.deepEqual(await wipeDatabase('hv-sync', { idb, timeout: 200 }), { ok: true, via: 'delete' });
  assert.equal(size(idb), 0);
});

test('wipeDatabase: si queda bloqueado espera a que la otra conexión se cierre (onblocked no es un éxito ni un fallo)', async () => {
  const idb = fakeIdb({ deleteMode: 'blocked-then-ok' });
  assert.deepEqual(await wipeDatabase('hv-sync', { idb, timeout: 500 }), { ok: true, via: 'delete' });
  assert.equal(size(idb), 0);
});

test('wipeDatabase: bloqueado para siempre o con error -> vacía CADA almacén y lo verifica', async () => {
  for (const deleteMode of ['blocked-forever', 'error']) {
    const idb = fakeIdb({ deleteMode });
    const r = await wipeDatabase('hv-sync', { idb, timeout: 60 });
    assert.deepEqual(r, { ok: true, via: 'clear' }, deleteMode);
    assert.equal(size(idb), 0, 'ningún dato queda: ' + deleteMode);
  }
});

test('wipeDatabase: si ni borrar ni vaciar funciona, informa ok:false (los datos siguen)', async () => {
  const a = fakeIdb({ deleteMode: 'error', openFails: true });
  assert.equal((await wipeDatabase('hv-sync', { idb: a, timeout: 60 })).ok, false);
  const b = fakeIdb({ deleteMode: 'error', clearFails: true });
  const r = await wipeDatabase('hv-sync', { idb: b, timeout: 60 });
  assert.equal(r.ok, false);
  assert.ok(size(b) > 0);
});

test('wipeAll: borra hv.* de localStorage/sessionStorage ANTES de las bases y dice qué quedó si una base no se pudo borrar', async () => {
  // Object.keys(st) debe listar las claves: objeto simple con removeItem no enumerable.
  const mkStore = (o) => { const st = { ...o }; Object.defineProperty(st, 'removeItem', { value: (k) => { delete st[k]; }, enumerable: false }); return st; };
  const ls = mkStore({ 'hv.profile': '{}', 'hv.sync.on': '1', otra: 'x' }), ss = mkStore({ 'hv.x': '1' });
  const order = [];
  const wipeDb = async (name) => { order.push({ name, lsLeft: Object.keys(ls).filter((k) => k.startsWith('hv.')).length + Object.keys(ss).filter((k) => k.startsWith('hv.')).length }); return { ok: name !== 'hv-sync', via: null }; };
  const r = await wipeAll({ storages: [ls, ss], wipeDb });
  assert.deepEqual(order.map((o) => o.name).sort(), ['hv', 'hv-sync']);
  assert.ok(order.every((o) => o.lsLeft === 0), 'localStorage hv.* ya estaba vacío cuando se tocaron las bases');
  assert.equal(ls.otra, 'x', 'no toca claves ajenas');
  assert.equal(r.ok, false);
  assert.equal(r.remaining.length, 1);
  assert.match(r.remaining[0], /sincronización/);
  // Todo bien -> ok.
  const ok = await wipeAll({ storages: [mkStore({ 'hv.a': '1' })], wipeDb: async () => ({ ok: true }) });
  assert.deepEqual(ok, { ok: true, remaining: [] });
});

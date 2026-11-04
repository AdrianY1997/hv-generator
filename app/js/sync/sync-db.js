// Almacén local de la sincronización (G04): IndexedDB `hv-sync`, separado de los datos del aspirante (`hv`).
// Claves: 'config' (proveedor, opciones, sal, token ENVUELTO con la clave de sincronización, handle de carpeta), 'keys' (CryptoKey no
// extraíbles, solo si la persona eligió recordar la contraseña), 'state' (revisión remota, huellas; nada secreto), 'snapshot' (copia de
// los datos locales previa a la última sincronización que los cambió). "Borrar todos mis datos" elimina la base entera (store.wipeAll).
const DB = 'hv-sync', STORE = 'kv';
let dbp = null;

function open() {
  if (dbp) return dbp;
  const p = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => { const d = r.result; d.onversionchange = () => { d.close(); if (dbp === p) dbp = null; }; res(d); };
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('IndexedDB bloqueada'));
  });
  dbp = p;
  p.catch(() => { if (dbp === p) dbp = null; });
  return p;
}
async function tx(mode, fn) {
  const d = await open();
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => res(req?.result);
    t.onabort = t.onerror = () => rej(t.error || new Error('Transacción cancelada'));
  });
}
export const get = (k) => tx('readonly', (s) => s.get(k));
export const set = (k, v) => tx('readwrite', (s) => s.put(v, k));
export const del = (k) => tx('readwrite', (s) => s.delete(k));
export const clear = () => tx('readwrite', (s) => s.clear());

/** deleteDatabase con resultado: 'deleted' | 'blocked' (otra conexión sigue abierta) | 'error' | 'timeout'. */
function tryDelete(idb, name, timeout) {
  return new Promise((res) => {
    let done = false, blocked = false, timer = null;
    const fin = (v) => { if (!done) { done = true; clearTimeout(timer); res(v); } };
    let r;
    try { r = idb.deleteDatabase(name); } catch { res('error'); return; }
    r.onsuccess = () => fin('deleted');
    r.onerror = () => fin('error');
    r.onblocked = () => { blocked = true; }; // el borrado sigue pendiente: se espera a que las otras conexiones se cierren
    timer = setTimeout(() => fin(blocked ? 'blocked' : 'timeout'), timeout);
  });
}
/**
 * Borra una base de IndexedDB y LO VERIFICA. -> { ok, via: 'delete'|'clear'|null }.
 * 1) deleteDatabase (esperando si queda bloqueado por otra conexión); 2) si no se pudo, abre la base y VACÍA cada almacén de objetos
 * (los datos desaparecen aunque la base siga existiendo) y comprueba que todos quedaron en 0. Si tampoco, ok:false.
 * Quien llama debe haber cerrado antes SUS propias conexiones. `idb` se puede inyectar (pruebas).
 */
export async function wipeDatabase(name, { idb = globalThis.indexedDB, timeout = 3000 } = {}) {
  if (!idb) return { ok: true, via: 'delete' };
  const r = await tryDelete(idb, name, timeout);
  if (r === 'deleted') return { ok: true, via: 'delete' };
  let db = null;
  try {
    db = await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('open-timeout')), timeout);
      let q;
      try { q = idb.open(name); } catch (e) { clearTimeout(t); rej(e); return; }
      q.onsuccess = () => { clearTimeout(t); res(q.result); };
      q.onerror = () => { clearTimeout(t); rej(q.error); };
      q.onblocked = () => { /* espera */ };
    });
    const names = [...db.objectStoreNames];
    if (names.length) {
      await new Promise((res, rej) => {
        const t = db.transaction(names, 'readwrite');
        for (const n of names) t.objectStore(n).clear();
        t.oncomplete = () => res();
        t.onabort = t.onerror = () => rej(t.error || new Error('Transacción cancelada'));
      });
      let left = 0;
      await new Promise((res, rej) => {
        const t = db.transaction(names, 'readonly');
        for (const n of names) { const c = t.objectStore(n).count(); c.onsuccess = () => { left += c.result; }; }
        t.oncomplete = () => res();
        t.onabort = t.onerror = () => rej(t.error || new Error('Transacción cancelada'));
      });
      if (left) return { ok: false, via: null };
    }
    return { ok: true, via: 'clear' };
  } catch { return { ok: false, via: null }; }
  finally { try { db?.close(); } catch { /* nada */ } }
}

/** Cierra la conexión propia y borra la base completa (verificado; ver wipeDatabase). -> { ok, via } */
export async function deleteSyncDb(opts) {
  try { const d = dbp ? await dbp.catch(() => null) : null; d?.close(); } catch { /* nada */ }
  dbp = null;
  return wipeDatabase(DB, opts);
}

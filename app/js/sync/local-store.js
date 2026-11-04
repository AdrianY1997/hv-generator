// Adaptador local del motor de sincronización sobre js/store.js (navegador). Antes de aplicar cambios recibidos guarda una copia previa
// (perfil, plantillas, reloj y los archivos que se van a reemplazar o borrar) en IndexedDB `hv-sync`, descargable desde Ajustes.
import * as realStore from '../store.js';
import * as realSdb from './sync-db.js';
import { toB64 } from '../backup-crypto.js';
import { CURRENT_VERSION } from '../migrate.js';

export let applying = false;
const store = realStore, sdb = realSdb;

/** Fusiona dos relojes quedándose con el MAYOR de cada clave (nunca retrocede un sello). */
export function maxClock(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) if (!(out[k] >= v)) out[k] = v;
  return out;
}

/** `store` y `sdb` se pueden inyectar (pruebas con almacenes en memoria). */
export function createLocalStore({ store = realStore, sdb = realSdb } = {}) {
  return {
    async read() {
      return { profile: store.getProfile(), templates: store.getTemplates(), clock: store.getSyncClock(), files: (await store.listFiles()).map((f) => ({ id: f.id, meta: f.meta })) };
    },
    async readBytes(id) {
      const f = await store.getFile(id);
      return f?.blob ? new Uint8Array(await f.blob.arrayBuffer()) : null;
    },
    hasData: () => store.hasData(),
    // Pérdida de actualización: una edición puede sellar el reloj durante la fase de red (después de `read()`). Se relee el reloj ACTUAL y se
    // guarda el máximo por clave, así nunca se pisa un sello más nuevo con el reloj que se leyó antes.
    async saveClock(c) { store.setSyncClock(maxClock(store.getSyncClock(), c)); },
    async apply(x) {
      const touched = new Set([...x.dels, ...x.puts.map((p) => p.id)]);
      const files = [];
      for (const id of touched) { const f = await store.getFile(id); if (f) files.push({ id, blob: f.blob, meta: f.meta }); }
      const had = new Set(files.map((f) => f.id));
      // La copia nueva va primero a una ranura PENDIENTE; la anterior (válida) se conserva hasta que applySync termine bien.
      const snap = { at: Date.now(), profile: x.base.profile, templates: x.base.templates, clock: x.base.clock, files, added: x.puts.map((p) => p.id).filter((id) => !had.has(id)) };
      await sdb.set('snapshot-pending', snap);
      applying = true; // el evento 'all' que emite applySync no debe programar otra sincronización automática
      try { await store.applySync(x); }
      catch (e) { await sdb.del('snapshot-pending').catch(() => {}); throw e; }
      finally { applying = false; }
      try { await sdb.set('snapshot', snap); await sdb.del('snapshot-pending'); } catch (e) { console.warn('sync: no se pudo promover la copia previa', e?.name); }
    },
  };
}

/**
 * Respaldo (JSON del formato de siempre, importable con Vista previa > Importar JSON) con los datos como estaban ANTES de la última
 * sincronización que cambió algo en este equipo. Archivos: los que esa sincronización reemplazó o borró (de la copia) + los demás
 * actuales que no tocó. -> objeto | null si no hay copia.
 */
export async function snapshotBackup() {
  const snap = await sdb.get('snapshot');
  if (!snap) return null;
  const skip = new Set([...snap.added, ...snap.files.map((f) => f.id)]);
  const files = [];
  const add = async (id, blob, meta) => files.push({ id, meta, data: toB64(new Uint8Array(await blob.arrayBuffer())) });
  for (const f of snap.files) await add(f.id, f.blob, f.meta);
  for (const { id } of await store.listFiles()) if (!skip.has(id)) { const f = await store.getFile(id); if (f) await add(id, f.blob, f.meta); }
  return { app: 'hv-minerva', version: 1, schemaVersion: CURRENT_VERSION, exportedAt: new Date(snap.at).toISOString(), profile: snap.profile, templates: snap.templates, files };
}

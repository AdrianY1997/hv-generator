// Proveedor "Carpeta sincronizada" (G04): File System Access API (Chrome/Edge de escritorio). La persona elige una carpeta que YA
// sincroniza con Google Drive, OneDrive, Dropbox o Syncthing; la app escribe ahí UN archivo cifrado, hv-generator-sync.json, y el
// cliente de esa nube lo lleva a sus otros equipos. Sin red desde la app. Probado con un directorio falso en tests/sync-folder.test.mjs;
// el selector real (showDirectoryPicker) y los permisos solo se prueban a mano (docs/SYNC.md).
//
// Un solo archivo (y no uno por trozo) a propósito: el cliente de la nube sube/baja archivos por separado y en cualquier orden; con
// varios, el otro equipo podría ver un índice nuevo con adjuntos viejos. Un archivo = una foto coherente. Si la nube crea una copia en
// conflicto ("hv-generator-sync (1).json"), `conflictCopies()` la detecta y la interfaz lo avisa.
import { SyncError } from './provider.js';
import { MANIFEST_NAME, parseManifest } from './sync-format.js';

export const FOLDER_FILE = MANIFEST_NAME;
const DOC_FORMAT = 'hv-minerva-sync-folder';
const MAX_FILE_CHARS = 120 * 1048576;

export const folderSupported = () => typeof globalThis.showDirectoryPicker === 'function';

/** Abre el selector de carpetas (requiere un gesto de la persona). -> FileSystemDirectoryHandle. */
export async function pickFolder() {
  if (!folderSupported()) throw new SyncError('unsupported');
  try { return await globalThis.showDirectoryPicker({ id: 'hv-sync', mode: 'readwrite', startIn: 'documents' }); }
  catch (e) { if (e?.name === 'AbortError') throw new SyncError('cancelled', 'No se eligió ninguna carpeta.'); throw new SyncError('permission', 'No se pudo abrir la carpeta elegida.'); }
}

/** Verifica (y si `request`, pide) permiso de lectura/escritura sobre la carpeta. Pedirlo exige un gesto (clic) de la persona. */
export async function ensurePermission(dir, { request = false } = {}) {
  const opts = { mode: 'readwrite' };
  let p = typeof dir?.queryPermission === 'function' ? await dir.queryPermission(opts) : 'granted';
  if (p !== 'granted' && request && typeof dir?.requestPermission === 'function') {
    try { p = await dir.requestPermission(opts); } catch { p = 'denied'; }
  }
  if (p !== 'granted') throw new SyncError('permission');
}

/** createFolderProvider({dir}) -> proveedor (ver provider.js) + conflictCopies(). */
export function createFolderProvider({ dir }) {
  let cache = null; // { etag, doc }
  const etagOf = (f) => `${f.lastModified}-${f.size}`;
  async function handle(create = false) {
    try { return await dir.getFileHandle(FOLDER_FILE, { create }); }
    catch (e) { if (e?.name === 'NotFoundError' && !create) return null; throw new SyncError('permission', 'No se pudo abrir el archivo de sincronización en la carpeta.'); }
  }
  async function load() {
    await ensurePermission(dir);
    const fh = await handle();
    if (!fh) return { etag: null, doc: null };
    const f = await fh.getFile();
    const etag = etagOf(f);
    if (cache?.etag === etag) return cache;
    if (f.size > MAX_FILE_CHARS) throw new SyncError('format', 'El archivo de sincronización de la carpeta es demasiado grande.');
    let doc;
    try { doc = JSON.parse(await f.text()); } catch { throw new SyncError('format', 'El archivo de sincronización de la carpeta está dañado (¿se copió a medias?). Espera a que tu nube termine de sincronizar e inténtalo de nuevo.'); }
    const strMap = (o) => o && typeof o === 'object' && !Array.isArray(o) && Object.values(o).every((v) => typeof v === 'string');
    if (!doc || doc.app !== 'hv-minerva' || doc.format !== DOC_FORMAT || !strMap(doc.index) || !strMap(doc.blobs)) throw new SyncError('format', `«${FOLDER_FILE}» en esa carpeta no es una sincronización de HV Minerva.`);
    if (!Number.isInteger(doc.v) || doc.v > 1) throw new SyncError('unsupported', 'El archivo de la carpeta lo escribió una versión más nueva de la app. Actualiza la app en este equipo.');
    cache = { etag, doc };
    return cache;
  }
  return {
    id: 'folder',
    maxChunk: Infinity,
    get name() { return dir?.name || ''; },
    describe: () => `Carpeta «${dir?.name || 'sin nombre'}»`,
    async read({ etag } = {}) {
      const c = await load();
      if (!c.doc) return { etag: null, files: {} };
      if (etag && etag === c.etag) return { notModified: true };
      return { etag: c.etag, files: { ...c.doc.index, ...(c.doc.manifest ? { [MANIFEST_NAME]: JSON.stringify(c.doc.manifest) } : {}) } };
    },
    async readBlobs(_m, names) {
      const c = await load();
      const out = {};
      for (const n of names) if (c.doc && Object.hasOwn(c.doc.blobs, n)) out[n] = c.doc.blobs[n];
      return out;
    },
    async write({ manifest, index = {}, blobs = {}, expectRev = null }) {
      cache = null;
      const c = await load();
      const curRev = c.doc?.manifest ? (parseManifest(c.doc.manifest).manifest?.rev ?? null) : null;
      if (curRev !== expectRev) throw new SyncError('conflict');
      const doc = c.doc ? { ...c.doc, index: { ...c.doc.index }, blobs: { ...c.doc.blobs } } : { app: 'hv-minerva', format: DOC_FORMAT, v: 1, index: {}, blobs: {} };
      for (const [n, v] of Object.entries(index)) { if (v === null) delete doc.index[n]; else doc.index[n] = v; }
      for (const [n, v] of Object.entries(blobs)) { if (v === null) delete doc.blobs[n]; else doc.blobs[n] = v; }
      doc.manifest = manifest;
      doc.note = 'Datos cifrados de HV Minerva. No edites este archivo: sin la contraseña de sincronización no se puede leer.';
      const fh = await handle(true);
      let w;
      try {
        w = await fh.createWritable(); // escribe en un archivo temporal y lo reemplaza al cerrar (atómico)
        await w.write(JSON.stringify(doc));
        await w.close();
      } catch (e) {
        try { await w?.abort?.(); } catch { /* nada */ }
        if (e?.name === 'QuotaExceededError') throw new SyncError('quota', 'No hay espacio en el disco para escribir la sincronización.');
        throw new SyncError('permission', 'No se pudo escribir en la carpeta de sincronización.');
      }
      const f = await fh.getFile();
      cache = { etag: etagOf(f), doc };
      return { etag: cache.etag };
    },
    /** Copias en conflicto que haya creado el cliente de la nube (p. ej. "hv-generator-sync (1).json"). */
    async conflictCopies() {
      const out = [];
      try {
        for await (const name of dir.keys()) if (name !== FOLDER_FILE && /^hv-generator-sync.*\.json$/i.test(name)) out.push(name);
      } catch { /* sin listado */ }
      return out.sort();
    },
  };
}

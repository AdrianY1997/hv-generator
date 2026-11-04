// Interfaz de proveedor de sincronización (G04) + error tipado con mensajes en español + proveedor en memoria (pruebas y referencia).
//
// Un proveedor guarda archivos de TEXTO con nombre en dos espacios: "índice" (manifiesto + núcleo, pequeño, se lee en cada sincronización)
// y "adjuntos" (trozos de adjuntos, grande, solo se lee lo que falta). Nunca ve texto claro: el motor (engine.js) le entrega sobres cifrados.
//
//   id: 'gist' | 'folder' | 'memory'          maxChunk: caracteres máximos por archivo (Infinity = sin partir)
//   async read({ etag }) -> { notModified: true } | { etag, files: { [name]: text } }        espacio índice completo ({} = vacío)
//   async readBlobs(manifest, names) -> { [name]: text }                                      trozos de adjuntos pedidos
//   async write({ manifest, index, blobs, expectRev }) -> { etag }
//        index/blobs: { [name]: text | null } (null = borrar). Debe lanzar SyncError('conflict') si el manifiesto remoto actual no tiene
//        la revisión `expectRev` (null = el espacio debe estar vacío). Puede completar `manifest.store` (p. ej. id del Gist de adjuntos)
//        antes de escribirlo. Escribe los adjuntos ANTES que el índice (un índice nunca apunta a trozos que aún no existen).
//   describe() -> texto para el estado ("GitHub Gist de @ana", "Carpeta «Drive»").

export const SYNC_MESSAGES = {
  offline: 'Sin conexión a internet. Tus datos siguen guardados en este equipo; se sincronizará cuando vuelva la conexión.',
  network: 'No se pudo conectar con el servicio de sincronización. Revisa tu conexión e inténtalo de nuevo.',
  unauthorized: 'GitHub rechazó el token (401): es incorrecto, venció o fue revocado. Crea uno nuevo con permiso «gist» y vuelve a conectar.',
  forbidden: 'GitHub no permite esta operación con el token (403). Revisa que tenga permiso para Gists (classic: alcance «gist»; fine-grained: «Gists: lectura y escritura»).',
  'rate-limit': 'GitHub limitó las solicitudes por un rato (límite de uso). Espera unos minutos e inténtalo de nuevo; tus datos siguen en este equipo.',
  'not-found': 'No se encontró la sincronización remota (404): el Gist fue borrado o el token no tiene acceso a él. Desconecta y vuelve a conectar para crear una nueva.',
  invalid: 'GitHub rechazó los datos enviados (422). Puede que la copia sea demasiado grande: baja el límite de adjuntos en Opciones avanzadas.',
  server: 'El servicio de sincronización falló temporalmente. Inténtalo de nuevo en unos minutos.',
  conflict: 'Otro equipo sincronizó al mismo tiempo. Vuelve a intentarlo: se combinarán ambos cambios.',
  permission: 'La app ya no tiene permiso sobre la carpeta de sincronización. Pulsa «Sincronizar ahora» y acepta el permiso del navegador.',
  unsupported: 'Este navegador no permite elegir una carpeta (File System Access API). Usa Chrome o Edge de escritorio, o la opción GitHub Gist.',
  locked: 'La sincronización está bloqueada: escribe la contraseña de sincronización para desbloquearla en este equipo.',
  busy: 'Ya hay una sincronización en curso (quizá en otra pestaña).',
  format: 'La copia remota está dañada o no es de HV Minerva.',
  unknown: 'No se pudo sincronizar. Tus datos siguen en este equipo.',
};

/** Error de sincronización. `code` es una clave de SYNC_MESSAGES (o de CryptoBackupError); `userMessage` va a la interfaz tal cual. */
export class SyncError extends Error {
  constructor(code, userMessage, extra = {}) {
    super('sync:' + code);
    this.name = 'SyncError';
    this.code = code;
    this.userMessage = userMessage || SYNC_MESSAGES[code] || SYNC_MESSAGES.unknown;
    Object.assign(this, extra);
  }
}
/** Convierte cualquier error en un SyncError (sin perder `userMessage` de CryptoBackupError u otros errores de la app). */
export function toSyncError(e) {
  if (e instanceof SyncError) return e;
  if (e?.name === 'CryptoBackupError') return new SyncError(e.code === 'auth' ? 'auth' : e.code, e.userMessage, { cause: e });
  if (e?.userMessage) return new SyncError(e.code || 'unknown', e.userMessage, { cause: e });
  return new SyncError('unknown', undefined, { cause: e });
}

/**
 * Proveedor en memoria: los dos espacios son objetos {nombre: texto}. Comparte `space` entre "equipos" para simularlos en pruebas.
 * `hooks.beforeWrite()` permite inyectar una escritura concurrente (conflicto) en las pruebas.
 */
export function createMemoryProvider(space = { index: {}, blobs: {}, etag: 0 }, { maxChunk = 1000, hooks = {} } = {}) {
  const parseRev = () => { try { return JSON.parse(space.index['hv-generator-sync.json']).rev; } catch { return null; } };
  return {
    id: 'memory', maxChunk, space,
    describe: () => 'Memoria (pruebas)',
    async read({ etag } = {}) {
      if (etag && etag === String(space.etag)) return { notModified: true };
      return { etag: String(space.etag), files: { ...space.index } };
    },
    async readBlobs(_m, names) { const out = {}; for (const n of names) if (n in space.blobs) out[n] = space.blobs[n]; return out; },
    async write({ manifest, index = {}, blobs = {}, expectRev = null }) {
      await hooks.beforeWrite?.();
      // Adjuntos nuevos antes del índice; los borrados (null) solo DESPUÉS de escribirlo y nunca si hay conflicto (mismo orden que gist.js).
      for (const [n, v] of Object.entries(blobs)) if (v !== null) space.blobs[n] = v;
      if ((parseRev() ?? null) !== (expectRev ?? null)) throw new SyncError('conflict');
      for (const [n, v] of Object.entries(index)) { if (v === null) delete space.index[n]; else space.index[n] = v; }
      space.index['hv-generator-sync.json'] = JSON.stringify(manifest);
      for (const [n, v] of Object.entries(blobs)) if (v === null) delete space.blobs[n];
      space.etag++;
      space.writes = (space.writes || 0) + 1;
      return { etag: String(space.etag) };
    },
  };
}

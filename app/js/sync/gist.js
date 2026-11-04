// Proveedor "GitHub Gist secreto" (G04): API REST de GitHub desde el navegador con un token personal (PAT) que pega la persona.
// El token SOLO se envía a https://api.github.com (constante; nunca en la URL ni a gist.githubusercontent.com). GitHub solo recibe sobres
// cifrados (engine.js). Probado con un `fetch` simulado en tests/sync-gist.test.mjs.
//
// Dos Gists secretos (no públicos; ojo: "secreto" = no listado, cualquiera con la URL puede verlo, por eso todo va cifrado):
//   índice   ("HV Minerva · sincronización cifrada"): hv-generator-sync.json + hv-core-NNN.txt. Pequeño; se lee en cada sincronización con
//            If-None-Match (un 304 no gasta cuota de la API).
//   adjuntos ("HV Minerva · adjuntos cifrados"): hv-blob-<id>-NNN.txt. Grande; solo se lee cuando falta algún adjunto. Separado porque
//            GET /gists/:id devuelve el contenido de TODOS los archivos (hasta 1 MB por archivo): con los adjuntos en el índice, cada
//            sincronización bajaría decenas de MB.
// Cada archivo <= 800 000 caracteres (GIST_CHUNK): la API marca `truncated` y corta el contenido a partir de 1 MB.
import { SyncError } from './provider.js';
import { MANIFEST_NAME, GIST_CHUNK, GIST_ID } from './sync-format.js';

export const API = 'https://api.github.com';
export const INDEX_DESC = 'HV Minerva · sincronización cifrada (no editar)';
export const BLOB_DESC = 'HV Minerva · adjuntos cifrados (no editar)';
export const BLOB_MARKER = 'hv-generator-sync-adjuntos.txt';
const MARKER_TEXT = 'Archivos cifrados de HV Minerva (sincronización). No los edites ni los borres: sin la contraseña no se pueden leer.';
const MAX_BATCH_CHARS = 8 * 1048576; // por PATCH
const MAX_BATCH_FILES = 60;
export const TOKEN_RE = /^[A-Za-z0-9_]{20,255}$/;
export const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=gist&description=HV%20Minerva%20sync';

/** Normaliza y valida la forma del token (no lo verifica con GitHub). */
export function cleanToken(t) {
  const s = String(t ?? '').trim();
  if (!TOKEN_RE.test(s)) throw new SyncError('token', 'El token no tiene la forma de un token de GitHub (empieza por «ghp_» o «github_pat_»). Cópialo completo, sin espacios.');
  return s;
}

const hhmm = (sec) => { const d = new Date(sec * 1000); return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }); };

/** Traduce una respuesta de error de GitHub a SyncError (mensaje en español, sin datos sensibles). */
export async function mapGitHubError(r) {
  let msg = '';
  try { msg = String((await r.json())?.message || ''); } catch { /* sin cuerpo */ }
  const remaining = r.headers.get('x-ratelimit-remaining'), reset = Number(r.headers.get('x-ratelimit-reset'));
  if (r.status === 401) return new SyncError('unauthorized', undefined, { status: 401 });
  if (r.status === 429 || (r.status === 403 && (remaining === '0' || /rate limit/i.test(msg)))) {
    const at = reset ? hhmm(reset) : '';
    return new SyncError('rate-limit', `GitHub limitó las solicitudes (límite de uso de la API).${at ? ` Podrás volver a sincronizar hacia las ${at}.` : ' Espera unos minutos.'} Tus datos siguen en este equipo.`, { status: r.status });
  }
  if (r.status === 403) return new SyncError('forbidden', undefined, { status: 403 });
  if (r.status === 404) return new SyncError('not-found', undefined, { status: 404 });
  if (r.status === 422) return new SyncError('invalid', undefined, { status: 422 });
  if (r.status >= 500) return new SyncError('server', undefined, { status: r.status });
  return new SyncError('unknown', `GitHub respondió con un error (${r.status}). Tus datos siguen en este equipo.`, { status: r.status });
}

/**
 * createGistProvider({ token, indexId, login, fetch, onIndex }) -> proveedor (ver provider.js) + checkToken(), findIndex(), indexId.
 * `onIndex(id)` se llama al crear el Gist índice (quien llama lo guarda en la configuración).
 */
export function createGistProvider({ token, indexId = null, login = '', fetch: fetchFn = globalThis.fetch?.bind(globalThis), onIndex = () => {} } = {}) {
  const tok = cleanToken(token);
  let idx = indexId, user = login;
  const blobCache = new Map(); // id del Gist de adjuntos -> {etag, files}

  async function api(method, path, body, { etag } = {}) {
    if (globalThis.navigator?.onLine === false) throw new SyncError('offline');
    const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${tok}`, 'X-GitHub-Api-Version': '2022-11-28' };
    if (body) headers['Content-Type'] = 'application/json';
    if (etag) headers['If-None-Match'] = etag;
    let r;
    try {
      r = await fetchFn(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
    } catch { throw new SyncError(globalThis.navigator?.onLine === false ? 'offline' : 'network'); }
    if (r.status === 304) return { status: 304, etag };
    if (!r.ok) throw await mapGitHubError(r);
    const json = r.status === 204 ? null : await r.json();
    return { status: r.status, etag: r.headers.get('etag'), json, headers: r.headers };
  }
  const contents = (gist) => {
    const out = {};
    for (const [name, f] of Object.entries(gist?.files || {})) {
      if (f?.truncated) throw new SyncError('format', 'GitHub devolvió un archivo de la sincronización recortado. Vuelve a sincronizar desde el otro equipo con un límite de adjuntos menor.');
      if (typeof f?.content === 'string') out[name] = f.content;
    }
    return out;
  };
  /** Escribe cambios {nombre: texto|null} en un Gist, en lotes (cuerpo acotado). */
  async function patchFiles(id, changes) {
    let batch = {}, chars = 0, n = 0;
    const flush = async () => { if (!n) return; await api('PATCH', `/gists/${id}`, { files: batch }); batch = {}; chars = 0; n = 0; };
    for (const [name, v] of Object.entries(changes)) {
      const len = v === null ? 0 : v.length;
      if (n && (chars + len > MAX_BATCH_CHARS || n >= MAX_BATCH_FILES)) await flush();
      batch[name] = v === null ? null : { content: v }; chars += len; n++;
    }
    await flush();
  }

  return {
    id: 'gist',
    maxChunk: GIST_CHUNK,
    get indexId() { return idx; },
    get login() { return user; },
    describe: () => `GitHub Gist secreto${user ? ` de @${user}` : ''}`,

    /** Verifica el token. -> {login, scopes|null, extraScopes:[...]} (scopes null = token fine-grained, GitHub no los informa). */
    async checkToken() {
      const r = await api('GET', '/user');
      user = String(r.json?.login || '').slice(0, 100);
      const raw = r.headers.get('x-oauth-scopes');
      const scopes = raw === null ? null : raw.split(',').map((s) => s.trim()).filter(Boolean);
      if (scopes && !scopes.includes('gist')) throw new SyncError('forbidden', 'El token no tiene el alcance «gist». Crea un token classic marcando solo «gist» (o uno fine-grained con «Gists: lectura y escritura»).');
      return { login: user, scopes, extraScopes: scopes ? scopes.filter((s) => s !== 'gist') : [] };
    },
    /** Busca el Gist índice de una sincronización ya existente (en otro equipo). -> id | null. */
    async findIndex() {
      let best = null;
      for (let page = 1; page <= 10; page++) {
        const r = await api('GET', `/gists?per_page=100&page=${page}`);
        const list = Array.isArray(r.json) ? r.json : [];
        for (const g of list) if (g?.files && Object.hasOwn(g.files, MANIFEST_NAME) && (!best || String(g.updated_at) > String(best.updated_at))) best = g;
        if (list.length < 100) break;
      }
      idx = best && /^[0-9a-f]+$/i.test(best.id) ? best.id : null;
      return idx;
    },
    async read({ etag } = {}) {
      if (!idx) return { etag: null, files: {} };
      const r = await api('GET', `/gists/${idx}`, null, { etag });
      if (r.status === 304) return { notModified: true };
      return { etag: r.etag, files: contents(r.json) };
    },
    async readBlobs(manifest, names) {
      const id = manifest?.store?.blobGist;
      if (!id) throw new SyncError('incomplete', 'La copia remota está incompleta (no encuentra el Gist de adjuntos).');
      const c = blobCache.get(id);
      const r = await api('GET', `/gists/${id}`, null, { etag: c?.etag });
      const files = r.status === 304 ? c.files : contents(r.json);
      if (r.status !== 304) blobCache.set(id, { etag: r.etag, files });
      const out = {};
      for (const n of names) if (Object.hasOwn(files, n)) out[n] = files[n];
      return out;
    },
    async write({ manifest, index = {}, blobs = {}, expectRev = null }) {
      // 1) Adjuntos NUEVOS primero: el índice nuevo nunca apunta a trozos que aún no existen. Los trozos huérfanos (valor null) NO se
      //    borran aquí: solo después de que el índice nuevo se escribió bien (paso 4) y nunca si hubo conflicto; si no, un conflicto o un
      //    fallo del PATCH del índice dejaría el índice vigente apuntando a adjuntos ya borrados.
      const puts = Object.entries(blobs).filter(([, v]) => v !== null), dels = Object.entries(blobs).filter(([, v]) => v === null);
      let blobGist = manifest.store?.blobGist || null;
      if (!blobGist && puts.length) {
        const r = await api('POST', '/gists', { description: BLOB_DESC, public: false, files: { [BLOB_MARKER]: { content: MARKER_TEXT } } });
        blobGist = String(r.json?.id || '');
        if (!GIST_ID.test(blobGist)) throw new SyncError('server');
      }
      if (blobGist && puts.length) {
        await patchFiles(blobGist, Object.fromEntries(puts));
        blobCache.delete(blobGist);
      }
      manifest.store = { ...(manifest.store || {}), ...(blobGist ? { blobGist } : {}) };
      // 2) Conflicto: ¿alguien escribió el índice desde que lo leímos? (Gist no ofrece escritura condicional: queda una ventana de
      //    ~1 s; si dos equipos la pisan, el que pierde vuelve a fusionar en la próxima sincronización y no se pierden datos locales.)
      if (idx) {
        const cur = await api('GET', `/gists/${idx}`);
        let rev = null;
        try { rev = JSON.parse(contents(cur.json)[MANIFEST_NAME] ?? 'null')?.rev ?? null; } catch { rev = null; }
        if (rev !== expectRev) throw new SyncError('conflict');
      } else if (expectRev !== null) throw new SyncError('conflict');
      // 3) Índice (manifiesto + núcleo) en una sola escritura (una revisión del Gist).
      const files = {};
      for (const [n, v] of Object.entries(index)) files[n] = v === null ? null : { content: v };
      files[MANIFEST_NAME] = { content: JSON.stringify(manifest, null, 1) };
      if (!idx) {
        for (const n of Object.keys(files)) if (files[n] === null) delete files[n];
        const r = await api('POST', '/gists', { description: INDEX_DESC, public: false, files });
        idx = String(r.json?.id || '');
        if (!/^[0-9a-f]+$/i.test(idx)) throw new SyncError('server');
        onIndex(idx);
      } else await api('PATCH', `/gists/${idx}`, { files });
      // 4) Recién ahora se borran los trozos huérfanos. Si falla, solo quedan sin usar (el índice ya es correcto): no se hace fallar la escritura.
      if (blobGist && dels.length) {
        try { await patchFiles(blobGist, Object.fromEntries(dels)); } catch (e) { console.warn('sync: no se pudieron borrar adjuntos huérfanos', e?.code); }
        blobCache.delete(blobGist);
      }
      return { etag: null };
    },
  };
}

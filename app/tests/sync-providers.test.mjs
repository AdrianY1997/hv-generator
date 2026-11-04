// Proveedores de sincronización (G04): GitHub Gist con `fetch` simulado (sin red, sin token real) y carpeta con un directorio falso.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGistProvider, cleanToken, mapGitHubError, INDEX_DESC, BLOB_DESC, API } from '../js/sync/gist.js';
import { createFolderProvider, ensurePermission, FOLDER_FILE } from '../js/sync/folder.js';
import { SyncError } from '../js/sync/provider.js';
import { syncOnce } from '../js/sync/engine.js';
import { MANIFEST_NAME, GIST_CHUNK } from '../js/sync/sync-format.js';
import { createFakeGitHub, FAKE_TOKEN } from './_fake-github.mjs';
import { device, png, sharedKeys } from './_sync-fixtures.mjs';

const run = async (provider, dev, state = {}, extra = {}) => { const keys = await sharedKeys(); return syncOnce({ provider, local: dev.local, state, getKeys: async () => keys, now: dev.now, ...extra }); };

test('token: forma validada antes de usarlo; nunca va en la URL', () => {
  assert.equal(cleanToken('  ' + FAKE_TOKEN + '\n'), FAKE_TOKEN);
  assert.throws(() => cleanToken('mi contraseña'), (e) => e.code === 'token');
  assert.throws(() => cleanToken(''), (e) => e.code === 'token');
});

test('Gist: conectar, crear índice + Gist de adjuntos secretos, segundo equipo encuentra la sincronización y la trae', async () => {
  const gh = createFakeGitHub();
  const A = device('A', { profile: { personales: { nombres: 'Ana' } }, files: { photo: { bytes: png(2_000_000, 3) } } });
  let saved = null;
  const pa = createGistProvider({ token: FAKE_TOKEN, fetch: gh.fetch, onIndex: (id) => { saved = id; } });
  const who = await pa.checkToken();
  assert.deepEqual(who, { login: 'aspirante-prueba', scopes: ['gist'], extraScopes: [] });
  assert.equal(await pa.findIndex(), null);
  const ra = await run(pa, A);
  assert.equal(ra.status, 'created');
  assert.ok(saved && saved === pa.indexId);
  const [idx, blob] = [...gh.gists.values()].sort((a, b) => (a.description === INDEX_DESC ? -1 : 1));
  assert.equal(idx.description, INDEX_DESC); assert.equal(blob.description, BLOB_DESC);
  assert.equal(idx.public, false); assert.equal(blob.public, false);
  for (const f of [...Object.values(idx.files), ...Object.values(blob.files)]) assert.ok(f.content.length <= GIST_CHUNK);
  assert.ok(Object.keys(blob.files).length >= 4, 'adjunto de 2 MB partido en trozos');
  assert.ok(!JSON.stringify([...gh.gists.values()]).includes('nombres'), 'sin texto claro en GitHub');
  assert.ok(gh.calls.every((c) => c.auth), 'todas las llamadas llevan el token en el encabezado');
  // Segundo equipo
  const B = device('B');
  const pb = createGistProvider({ token: FAKE_TOKEN, fetch: gh.fetch });
  assert.equal(await pb.findIndex(), idx.id);
  const rb = await run(pb, B);
  assert.equal(rb.status, 'merged');
  assert.deepEqual(B.s.profile, A.s.profile);
  assert.deepEqual(B.s.files.get('photo').bytes, A.s.files.get('photo').bytes);
  // Sin cambios: la lectura usa If-None-Match y GitHub responde 304 (no gasta cuota); no se escribe nada.
  const before = gh.calls.length;
  const r2 = await run(pb, B, rb.state);
  assert.equal(r2.status, 'up-to-date');
  assert.deepEqual(gh.calls.slice(before).map((c) => c.method), ['GET']);
  // Un cambio local sin cambios remotos (304) sube sin releer el núcleo y conserva el ETag para la próxima vez.
  B.edit((p) => { p.personales.ciudad = 'Tunja'; });
  const r3 = await run(pb, B, r2.state);
  assert.equal(r3.status, 'pushed');
  const r4 = await run(pa, A, ra.state);
  assert.equal(r4.status, 'merged');
  assert.equal(A.s.profile.personales.ciudad, 'Tunja');
  const r5 = await run(pa, A, r4.state);
  const n = gh.calls.length;
  assert.equal((await run(pa, A, r5.state)).status, 'up-to-date');
  assert.equal(gh.calls.length - n, 1);
  assert.ok(r5.state.etag, 'ETag conservado tras un 304');
});

test('Gist: conflicto real (otro equipo escribió entre lectura y escritura) se reintenta y combina', async () => {
  const gh = createFakeGitHub();
  const A = device('A', { profile: { personales: { nombres: 'Ana' } } });
  const pa = createGistProvider({ token: FAKE_TOKEN, fetch: gh.fetch });
  let sa = (await run(pa, A)).state;
  const B = device('B');
  const pb = createGistProvider({ token: FAKE_TOKEN, fetch: gh.fetch });
  await pb.findIndex();
  let sb = (await run(pb, B)).state;
  A.edit((p) => { p.personales.ciudad = 'Cali'; });
  B.edit((p) => { p.personales.celular = '300'; });
  // 1) A escribe después de que B leyó y ANTES de la comprobación de B (2.º GET del índice): B detecta el conflicto, reintenta y fusiona.
  let gets = 0, injected = false;
  const idxPath = `/gists/${pb.indexId}`;
  const fetchB = async (url, init) => {
    if (!injected && (init?.method || 'GET') === 'GET' && url.endsWith(idxPath) && ++gets === 2) { injected = true; sa = (await run(pa, A, sa)).state; }
    return gh.fetch(url, init);
  };
  const pb2 = createGistProvider({ token: FAKE_TOKEN, fetch: fetchB, indexId: pb.indexId });
  sb = (await run(pb2, B, sb)).state;
  assert.ok(injected);
  assert.deepEqual(B.s.profile.personales, { nombres: 'Ana', ciudad: 'Cali', celular: '300' }, 'B combinó tras el conflicto');
  sa = (await run(pa, A, sa)).state;
  assert.deepEqual(A.s.profile.personales, { nombres: 'Ana', ciudad: 'Cali', celular: '300' });
  // 2) Ventana sin escritura condicional (A escribe entre la comprobación y el PATCH de B): B pisa el índice, pero ningún dato se pierde:
  //    A lo conserva en local con su fecha y lo vuelve a subir en su próxima sincronización.
  A.edit((p) => { p.personales.ciudad = 'Ipiales'; });
  B.edit((p) => { p.personales.celular = '301'; });
  let inj2 = false;
  const fetchB3 = async (url, init) => { if (!inj2 && init?.method === 'PATCH') { inj2 = true; sa = (await run(pa, A, sa)).state; } return gh.fetch(url, init); };
  sb = (await run(createGistProvider({ token: FAKE_TOKEN, fetch: fetchB3, indexId: pb.indexId }), B, sb)).state;
  sa = (await run(pa, A, sa)).state;
  sb = (await run(pb, B, sb)).state;
  const want = { nombres: 'Ana', ciudad: 'Ipiales', celular: '301' };
  assert.deepEqual(A.s.profile.personales, want);
  assert.deepEqual(B.s.profile.personales, want);
});

test('Gist: errores de GitHub y de red con mensajes claros en español', async () => {
  const gh = createFakeGitHub();
  const bad = createGistProvider({ token: 'ghp_' + 'X'.repeat(36), fetch: gh.fetch });
  await assert.rejects(bad.checkToken(), (e) => e instanceof SyncError && e.code === 'unauthorized' && /401/.test(e.userMessage));
  const p = createGistProvider({ token: FAKE_TOKEN, fetch: gh.fetch });
  gh.opts.rateLimited = true;
  await assert.rejects(p.checkToken(), (e) => e.code === 'rate-limit' && /límite/.test(e.userMessage));
  gh.opts.rateLimited = false;
  gh.opts.fail = { status: 422 };
  await assert.rejects(p.findIndex(), (e) => e.code === 'invalid' && /422/.test(e.userMessage));
  gh.opts.fail = { status: 503 };
  await assert.rejects(p.findIndex(), (e) => e.code === 'server');
  gh.opts.fail = null;
  const gone = createGistProvider({ token: FAKE_TOKEN, fetch: gh.fetch, indexId: 'abc123' });
  await assert.rejects(gone.read({}), (e) => e.code === 'not-found' && /404/.test(e.userMessage));
  const offline = createGistProvider({ token: FAKE_TOKEN, fetch: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(offline.checkToken(), (e) => e.code === 'network');
  const forbidden = createGistProvider({ token: FAKE_TOKEN, fetch: createFakeGitHub({ scopes: 'repo, user' }).fetch });
  await assert.rejects(forbidden.checkToken(), (e) => e.code === 'forbidden' && /gist/.test(e.userMessage));
  const extra = await createGistProvider({ token: FAKE_TOKEN, fetch: createFakeGitHub({ scopes: 'gist, repo' }).fetch }).checkToken();
  assert.deepEqual(extra.extraScopes, ['repo']);
  const fine = await createGistProvider({ token: FAKE_TOKEN, fetch: createFakeGitHub({ scopes: null }).fetch }).checkToken();
  assert.equal(fine.scopes, null);
  const e403 = await mapGitHubError(new Response('{"message":"Resource not accessible"}', { status: 403 }));
  assert.equal(e403.code, 'forbidden');
});

test('Gist: solo habla con api.github.com y nunca pone el token en la URL', async () => {
  const seen = [];
  const gh = createFakeGitHub();
  const p = createGistProvider({ token: FAKE_TOKEN, fetch: async (url, init) => { seen.push({ url, init }); return gh.fetch(url, init); } });
  await run(p, device('A', { profile: { a: { b: 1 } }, files: { photo: { bytes: png(100) } } }));
  await p.checkToken(); await p.findIndex();
  assert.ok(seen.length >= 5);
  for (const { url, init } of seen) {
    assert.ok(url.startsWith(API + '/'), url);
    assert.ok(!url.includes(FAKE_TOKEN));
    assert.equal(init.credentials, 'omit');
    assert.equal(init.headers.Authorization, `Bearer ${FAKE_TOKEN}`);
  }
});

// ---- Carpeta: directorio falso con la forma de FileSystemDirectoryHandle ----
function fakeDir(name = 'Drive', perm = 'granted') {
  const files = new Map();
  let t = 1000;
  const fh = (n) => ({
    async getFile() { const v = files.get(n); return { size: v.text.length, lastModified: v.at, text: async () => v.text }; },
    async createWritable() { let buf = ''; return { async write(s) { buf += s; }, async close() { files.set(n, { text: buf, at: ++t }); }, async abort() {} }; },
  });
  return {
    name, files, perm,
    async queryPermission() { return this.perm; },
    async requestPermission() { if (this.perm === 'prompt') this.perm = 'granted'; return this.perm; },
    async getFileHandle(n, { create = false } = {}) { if (!files.has(n)) { if (!create) throw Object.assign(new Error('nf'), { name: 'NotFoundError' }); files.set(n, { text: '', at: ++t }); } return fh(n); },
    async *keys() { yield* files.keys(); },
  };
}

test('Carpeta: un solo archivo cifrado; dos equipos con la misma carpeta (sincronizada por la nube) convergen', async () => {
  const dir = fakeDir();
  const A = device('A', { profile: { personales: { nombres: 'Ana' } }, files: { photo: { bytes: png(5000, 2) } } });
  const B = device('B');
  const pa = createFolderProvider({ dir }), pb = createFolderProvider({ dir });
  let sa = (await run(pa, A)).state;
  assert.deepEqual([...dir.files.keys()], [FOLDER_FILE]);
  const doc = JSON.parse(dir.files.get(FOLDER_FILE).text);
  assert.equal(doc.format, 'hv-minerva-sync-folder');
  assert.ok(!dir.files.get(FOLDER_FILE).text.includes('Ana'));
  assert.equal(Object.keys(doc.index).length, 1, 'sin partir: un trozo de núcleo');
  let sb = (await run(pb, B)).state;
  assert.deepEqual(B.s.profile, A.s.profile);
  B.edit((p) => { p.personales.ciudad = 'Pasto'; });
  sb = (await run(pb, B, sb)).state;
  sa = (await run(pa, A, sa)).state;
  assert.equal(A.s.profile.personales.ciudad, 'Pasto');
  assert.equal((await run(pa, A, sa)).status, 'up-to-date');
  dir.files.set('hv-generator-sync (1).json', { text: '{}', at: 1 });
  assert.deepEqual(await pa.conflictCopies(), ['hv-generator-sync (1).json']);
});

test('Carpeta: sin permiso -> error claro; con gesto se puede pedir; archivo ajeno o dañado no se toca', async () => {
  const dir = fakeDir('Docs', 'prompt');
  await assert.rejects(createFolderProvider({ dir }).read({}), (e) => e.code === 'permission');
  await ensurePermission(dir, { request: true });
  assert.equal(dir.perm, 'granted');
  dir.files.set(FOLDER_FILE, { text: '{"otra":"cosa"}', at: 5 });
  await assert.rejects(createFolderProvider({ dir }).read({}), (e) => e.code === 'format');
  dir.files.set(FOLDER_FILE, { text: '{roto', at: 6 });
  await assert.rejects(createFolderProvider({ dir }).read({}), (e) => e.code === 'format' && /dañado/.test(e.userMessage));
  dir.perm = 'denied';
  await assert.rejects(ensurePermission(dir, { request: true }), (e) => e.code === 'permission');
});

test('Carpeta: conflicto si otro equipo escribió desde la lectura', async () => {
  const dir = fakeDir();
  const A = device('A', { profile: { a: { b: 1 } } });
  await run(createFolderProvider({ dir }), A);
  const p = createFolderProvider({ dir });
  const m = JSON.parse((await p.read({})).files[MANIFEST_NAME]);
  await assert.rejects(p.write({ manifest: { ...m, rev: 'ffffffffffffffff' }, index: {}, blobs: {}, expectRev: '0000000000000000' }), (e) => e.code === 'conflict');
});

test('Gist: los trozos de adjuntos huérfanos se borran solo DESPUÉS del PATCH del índice; con conflicto quedan intactos y el siguiente push funciona', async () => {
  const gh = createFakeGitHub();
  const A = device('A', { profile: { personales: { nombres: 'Ana' } }, files: { photo: { bytes: png(3000, 5) } } });
  const pa = createGistProvider({ token: FAKE_TOKEN, fetch: gh.fetch });
  let sa = (await run(pa, A)).state;
  const B = device('B');
  const pb = createGistProvider({ token: FAKE_TOKEN, fetch: gh.fetch });
  await pb.findIndex();
  let sb = (await run(pb, B)).state;
  assert.ok(B.s.files.has('photo'));
  const blobGist = [...gh.gists.values()].find((g) => g.description === BLOB_DESC);
  const chunks = () => Object.keys(blobGist.files).filter((n) => n.startsWith('hv-blob-'));
  const before = chunks();
  assert.ok(before.length >= 1);

  // A borra la foto (sus trozos quedan huérfanos). Entre su lectura y su comprobación de conflicto, B escribe el índice.
  A.delFile('photo');
  B.edit((p) => { p.personales.ciudad = 'Cali'; });
  const idxPath = `/gists/${pb.indexId}`;
  const log = [];       // orden de los PATCH de A: 'index' | 'blobs-del'
  let gets = 0, injected = false, intactAtRetry = null;
  const fetchA = async (url, init) => {
    const method = init?.method || 'GET';
    if (method === 'GET' && url.endsWith(idxPath)) {
      gets++;
      if (gets === 2 && !injected) { injected = true; sb = (await run(pb, B, sb)).state; } // B escribe antes de la comprobación de A
      if (gets === 3) intactAtRetry = before.every((n) => n in blobGist.files);              // lectura del reintento: tras el conflicto
    }
    if (method === 'PATCH') log.push(url.endsWith(idxPath) ? 'index' : (Object.values(JSON.parse(init.body).files).every((f) => f === null) ? 'blobs-del' : 'blobs-put'));
    return gh.fetch(url, init);
  };
  const pa2 = createGistProvider({ token: FAKE_TOKEN, fetch: fetchA, indexId: pa.indexId });
  const r = await run(pa2, A, sa);
  assert.ok(injected && gets >= 3, 'hubo conflicto y reintento');
  assert.equal(intactAtRetry, true, 'el conflicto no borró adjuntos');
  assert.ok(r.pushed);
  assert.deepEqual(log, ['index', 'blobs-del'], 'el índice se escribe antes de borrar los trozos huérfanos');
  assert.deepEqual(chunks(), [], 'tras el PATCH del índice los huérfanos sí se borran');
  sa = r.state;
  // El siguiente push (de B) funciona y nadie quedó con un índice que apunte a trozos inexistentes.
  const rb = await run(pb, B, sb);
  assert.ok(['merged', 'up-to-date', 'pushed'].includes(rb.status));
  assert.equal(B.s.files.has('photo'), false);
  assert.equal(B.s.profile.personales.ciudad, 'Cali');
  assert.equal(A.s.profile.personales.ciudad, 'Cali');
  B.edit((p) => { p.personales.celular = '300'; });
  assert.equal((await run(pb, B, rb.state)).status, 'pushed');
  assert.equal((await run(pa2, A, sa)).status, 'merged');
});

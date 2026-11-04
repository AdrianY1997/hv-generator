// Sincronización (G04): trozos, manifiesto, núcleo y claves (sync-format.js, sync-crypto.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitText, joinChunks, buildManifest, parseManifest, parseCore, buildCore, sanitizeMeta, checkBlob, coreName, blobName, GIST_CHUNK } from '../js/sync/sync-format.js';
import { deriveSyncKeys, sealJson, sealBytes, openJson, openBytes, blobId, wrapSecret, unwrapSecret, checkSyncPassphrase, newSalt } from '../js/sync/sync-crypto.js';
import { decryptBackup, MIN_ITERATIONS } from '../js/backup-crypto.js';
import { sharedKeys, PASS, png } from './_sync-fixtures.mjs';

test('splitText / joinChunks: ida y vuelta, límites y trozo faltante', () => {
  const s = 'abcdefghij'.repeat(25);
  const parts = splitText(s, 60);
  assert.ok(parts.every((p) => p.length <= 60));
  assert.equal(parts.length, Math.ceil(s.length / 60));
  const files = Object.fromEntries(parts.map((p, i) => [coreName(i), p]));
  assert.equal(joinChunks(files, parts.map((_, i) => coreName(i))), s);
  assert.deepEqual(splitText('', 10), ['']);
  assert.deepEqual(splitText(s, Infinity), [s]);
  delete files[coreName(1)];
  assert.throws(() => joinChunks(files, parts.map((_, i) => coreName(i))), (e) => e.code === 'incomplete');
  assert.ok(GIST_CHUNK <= 900000, 'por debajo del corte de 1 MB de la API de Gist');
  assert.match(blobName('a'.repeat(32), 3), /^hv-blob-a{32}-003\.txt$/);
});

const goodManifest = () => buildManifest({ rev: 'abcdef0123456789', kdf: { salt: newSalt(), iterations: 600000 }, digest: 'f'.repeat(32), core: 2, blobs: { ['1'.repeat(32)]: 3 }, store: { blobGist: 'deadbeef'.repeat(4) } });

test('parseManifest acepta el propio y rechaza degradación, versión futura y basura', () => {
  const m = goodManifest();
  const p = parseManifest(JSON.stringify(m));
  assert.equal(p.ok, true);
  assert.equal(p.manifest.store.blobGist, 'deadbeef'.repeat(4));
  const bad = (patch, code) => { const r = parseManifest({ ...goodManifest(), ...patch }); assert.equal(r.ok, false, JSON.stringify(patch)); if (code) assert.equal(r.code, code); assert.ok(r.error.length > 10); };
  bad({ v: 2 }, 'unsupported');
  bad({ kdf: { ...m.kdf, iterations: MIN_ITERATIONS - 1 } }, 'params');
  bad({ kdf: { ...m.kdf, hash: 'SHA-1' } }, 'params');
  bad({ rev: '../../etc' });
  bad({ core: 0 });
  bad({ blobs: { 'no-hex': 1 } });
  bad({ format: 'otro' });
  assert.equal(parseManifest('{no json').ok, false);
  assert.deepEqual(parseManifest({ ...m, store: { blobGist: 'a'.repeat(32), ok: 'abc' } }).manifest.store, { blobGist: 'a'.repeat(32), ok: 'abc' });
  assert.deepEqual(parseManifest({ ...m, store: { ok: 'abc' } }).manifest.store, { ok: 'abc' });
});

test('parseManifest valida store.blobGist como un id de Gist de 32 hex y rechaza el resto', () => {
  for (const v of ['x/../y', 'deadbeef', 'a'.repeat(31), 'a'.repeat(33), 'g'.repeat(32), '../' + 'a'.repeat(29), '', 5, null, ['a'.repeat(32)]]) {
    const r = parseManifest({ ...goodManifest(), store: { blobGist: v } });
    assert.equal(r.ok, false, 'blobGist ' + JSON.stringify(v));
    assert.equal(r.code, 'format');
  }
});

test('parseCore valida perfil/plantillas como un respaldo, sanea el índice y rechaza datos más nuevos', () => {
  const core = buildCore({ profile: { personales: { nombres: 'Ana' }, __proto__: { x: 1 } }, templates: [], clock: { 'p:personales.nombres': 5, raro: 1 }, files: { photo: { h: 'a'.repeat(32), meta: { name: 'f.png', type: 'image/png', size: 10, __proto__: { y: 1 }, label: 'Foto' }, b: true } } });
  const r = parseCore(JSON.parse(JSON.stringify(core)));
  assert.equal(r.ok, true);
  assert.deepEqual(r.core.clock, { 'p:personales.nombres': 5 });
  assert.deepEqual(r.core.files.photo, { h: 'a'.repeat(32), meta: { label: 'Foto', name: 'f.png', type: 'image/png', size: 10 }, b: true });
  assert.equal(parseCore({ ...core, schemaVersion: 99 }).code, 'unsupported');
  assert.equal(parseCore({ ...core, v: 2 }).code, 'unsupported');
  assert.equal(parseCore({ ...core, files: { photo: { h: 'a'.repeat(32), meta: { name: 'x.html', type: 'text/html', size: 1 } } } }).ok, false);
  assert.equal(parseCore({ ...core, files: { 'a/../b': { h: 'a'.repeat(32), meta: { type: 'image/png' } } } }).ok, false);
  assert.equal(parseCore({ ...core, profile: [] }).ok, false);
});

test('sanitizeMeta y checkBlob: solo tipos permitidos y contenido que coincide con el tipo', () => {
  assert.equal(sanitizeMeta({ type: 'image/svg+xml', name: 'x' }), null);
  assert.equal(checkBlob({ type: 'image/png', name: 'f' }, png(40)), null);
  assert.match(checkBlob({ type: 'application/pdf', name: 'f.pdf' }, png(40)), /no coincide/);
});

test('claves: la misma contraseña y sal dan la misma clave en dos "equipos"; los sobres son respaldos cifrados estándar', async () => {
  const k1 = await sharedKeys();
  const k2 = await deriveSyncKeys(PASS.normalize('NFD'), { salt: k1.salt, iterations: k1.iterations }); // otra normalización: NFKC la iguala
  const env = await sealJson(k1, { hola: 'mundo' });
  assert.deepEqual(await openJson(k2, env), { hola: 'mundo' });
  assert.deepEqual(await decryptBackup(env, PASS), { hola: 'mundo' }); // compatibilidad con backup-crypto.js
  assert.equal(await blobId(k1, png(50)), await blobId(k2, png(50)));
  assert.notEqual(await blobId(k1, png(50, 1)), await blobId(k1, png(50, 2)));
  assert.match(await blobId(k1, png(50)), /^[0-9a-f]{32}$/);
  const b = await sealBytes(k1, png(30));
  assert.deepEqual(await openBytes(k2, JSON.stringify(b)), png(30));
  const t = await wrapSecret(k1, 'ghp_secreto');
  assert.ok(!JSON.stringify(t).includes('secreto'));
  assert.equal(await unwrapSecret(k2, t), 'ghp_secreto');
});

test('claves: contraseña distinta, sal distinta y sobre alterado -> error "auth" sin distinguir', async () => {
  const k1 = await sharedKeys();
  const env = await sealJson(k1, { a: 1 });
  const other = await deriveSyncKeys('otra frase bastante larga', { salt: k1.salt });
  await assert.rejects(openJson(other, env), (e) => e.code === 'auth');
  await assert.rejects(openJson({ ...k1, salt: newSalt() }, env), (e) => e.code === 'auth');
  const t = { ...env, ciphertext: (env.ciphertext[0] === 'A' ? 'B' : 'A') + env.ciphertext.slice(1) };
  await assert.rejects(openJson(k1, t), (e) => e.code === 'auth');
  await assert.rejects(openJson(k1, { ...env, kdf: { ...env.kdf, iterations: 1000 } }), (e) => e.code === 'params');
});

test('contraseña de sincronización: mínimo 10 caracteres (puntos de código) al crear; vacía nunca', async () => {
  assert.throws(() => checkSyncPassphrase('corta', { creating: true }), (e) => e.code === 'passphrase');
  assert.throws(() => checkSyncPassphrase(''), (e) => e.code === 'passphrase');
  assert.equal(checkSyncPassphrase('😀😀😀😀😀😀😀😀😀😀', { creating: true }).length, 20);
  await assert.rejects(deriveSyncKeys('suficientemente larga', { salt: 'no-b64!' }), (e) => e.code === 'format');
  await assert.rejects(deriveSyncKeys('suficientemente larga', { salt: newSalt(), iterations: 1000 }), (e) => e.code === 'params');
});

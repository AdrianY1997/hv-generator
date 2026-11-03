// Cifrado del respaldo (G05): ida y vuelta, contraseña incorrecta, alteración, sobres mal formados y degradación del KDF.
import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptBackup, decryptBackup, isEncryptedEnvelope, validateEnvelope, passphraseStrength, toB64, fromB64,
  ENC_FORMAT, MIN_ITERATIONS, MAX_ITERATIONS, KDF_ITERATIONS, MAX_ENVELOPE_BYTES, CryptoBackupError } from '../js/backup-crypto.js';

const backup = { app: 'hv-minerva', version: 1, schemaVersion: 1, exportedAt: '2026-10-29T00:00:00.000Z', profile: { personales: { nombres: 'Ana María', apellidos: 'Pérez Ñandú 😀' } }, templates: [], files: [{ id: 'photo', meta: { name: 'f.png', type: 'image/png' }, data: 'iVBORw0KGgo=' }] };
const PASS = 'correcta caballo bateria';
let env; // un solo cifrado compartido: PBKDF2 con 600 000 iteraciones cuesta ~0,2 s
test.before(async () => { env = await encryptBackup(backup, PASS); });
const clone = () => JSON.parse(JSON.stringify(env));
const rejects = (p, code) => assert.rejects(p, (e) => e instanceof CryptoBackupError && e.code === code && typeof e.userMessage === 'string' && e.userMessage.length > 10, `se esperaba ${code}`);

test('el sobre tiene el formato versionado y no contiene el texto claro', () => {
  assert.equal(env.app, 'hv-minerva'); assert.equal(env.format, ENC_FORMAT); assert.equal(env.v, 1);
  assert.deepEqual(env.kdf, { name: 'PBKDF2', hash: 'SHA-256', iterations: KDF_ITERATIONS });
  assert.equal(env.cipher, 'AES-256-GCM');
  assert.equal(fromB64(env.salt).length, 16); assert.equal(fromB64(env.iv).length, 12);
  assert.ok(isEncryptedEnvelope(env));
  const raw = JSON.stringify(env);
  assert.ok(!raw.includes('Ana') && !raw.includes('nombres') && !raw.includes('iVBOR'));
  assert.ok(KDF_ITERATIONS >= 600000);
});

test('ida y vuelta: se recupera el respaldo exacto (acentos, ñ y emoji incluidos)', async () => {
  assert.deepEqual(await decryptBackup(env, PASS), backup);
  assert.deepEqual(await decryptBackup(JSON.parse(JSON.stringify(env)), PASS), backup); // tras serializar/leer del archivo
});

test('sal e IV son aleatorios: dos cifrados del mismo respaldo difieren', async () => {
  const b = await encryptBackup(backup, PASS);
  assert.notEqual(b.salt, env.salt); assert.notEqual(b.iv, env.iv); assert.notEqual(b.ciphertext, env.ciphertext);
  assert.deepEqual(await decryptBackup(b, PASS), backup);
});

test('la contraseña se normaliza (NFKC): é compuesta y descompuesta abren lo mismo', async () => {
  const e = await encryptBackup(backup, 'contraseña-é-largo');
  assert.deepEqual(await decryptBackup(e, 'contraseña-é-largo'), backup);
});

test('contraseña incorrecta: error "auth", sin devolver datos', async () => {
  await rejects(decryptBackup(env, 'otra contraseña distinta'), 'auth');
  await rejects(decryptBackup(env, PASS + ' '), 'auth');
  await rejects(decryptBackup(env, PASS.toUpperCase()), 'auth');
});

test('contraseña vacía o demasiado corta/larga', async () => {
  await rejects(decryptBackup(env, ''), 'passphrase');
  await rejects(encryptBackup(backup, 'corta'), 'passphrase');
  await rejects(encryptBackup(backup, '123456789'), 'passphrase'); // 9 < 10
  await rejects(encryptBackup(backup, '😀😀😀😀😀😀😀😀😀'), 'passphrase'); // 9 puntos de código (18 unidades UTF-16)
  await encryptBackup(backup, '😀😀😀😀😀😀😀😀😀😀'); // 10 puntos de código: válida
  await rejects(encryptBackup(backup, 'x'.repeat(300)), 'passphrase');
});

test('alteración: cualquier byte cambiado del texto cifrado, la sal, el IV o la cabecera falla con "auth"', async () => {
  const flip = (b64, i) => { const u = fromB64(b64); u[i] ^= 1; return toB64(u); };
  const a = clone(); a.ciphertext = flip(a.ciphertext, 0); await rejects(decryptBackup(a, PASS), 'auth');
  const b = clone(); b.ciphertext = flip(b.ciphertext, fromB64(b.ciphertext).length - 1); await rejects(decryptBackup(b, PASS), 'auth'); // etiqueta GCM
  const c = clone(); c.salt = flip(c.salt, 3); await rejects(decryptBackup(c, PASS), 'auth');
  const d = clone(); d.iv = flip(d.iv, 0); await rejects(decryptBackup(d, PASS), 'auth');
  const f = clone(); f.kdf.iterations = KDF_ITERATIONS + 1; await rejects(decryptBackup(f, PASS), 'auth'); // la cabecera va autenticada (AAD)
  const g = clone(); g.exportedAt = 'x'; assert.deepEqual(await decryptBackup(g, PASS), backup); // campos ajenos a la cabecera no afectan
  const t = clone(); t.ciphertext = toB64(fromB64(t.ciphertext).subarray(0, -1)); await rejects(decryptBackup(t, PASS), 'auth'); // truncado
});

test('sobres mal formados se rechazan antes de derivar la clave', async () => {
  const m = (patch, code) => { const e = clone(); for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete e[k]; else e[k] = v; } return rejects(decryptBackup(e, PASS), code); };
  await m({ format: 'otro' }, 'format');
  await m({ v: undefined }, 'format');
  await m({ v: 'uno' }, 'format');
  await m({ v: 2 }, 'unsupported');
  await m({ cipher: 'AES-128-CBC' }, 'params');
  await m({ kdf: undefined }, 'params');
  await m({ kdf: { name: 'scrypt', hash: 'SHA-256', iterations: KDF_ITERATIONS } }, 'params');
  await m({ kdf: { name: 'PBKDF2', hash: 'SHA-1', iterations: KDF_ITERATIONS } }, 'params');
  await m({ salt: 'no es base64!' }, 'format');
  await m({ salt: toB64(new Uint8Array(4)) }, 'format');
  await m({ iv: toB64(new Uint8Array(16)) }, 'format');
  await m({ iv: 5 }, 'format');
  await m({ ciphertext: 12 }, 'format');
  await m({ ciphertext: '' }, 'format');
  await m({ ciphertext: 'AAAA' }, 'format');
  await m({ ciphertext: 'AA=A' + 'A'.repeat(40) }, 'format');
  await m({ ciphertext: 'A'.repeat(MAX_ENVELOPE_BYTES + 4) }, 'size');
  for (const bad of [null, undefined, 5, 'x', [], {}, { app: 'hv-minerva' }, { app: 'otra', format: ENC_FORMAT }]) await rejects(decryptBackup(bad, PASS), 'format');
});

test('degradación del KDF: menos iteraciones que el mínimo (o ausentes/no enteras) se rechaza; también un exceso absurdo', async () => {
  for (const it of [1, 1000, 10000, 100000, MIN_ITERATIONS - 1, 0, -5, 600000.5, '600000', null, NaN]) {
    const e = clone(); e.kdf.iterations = it;
    await rejects(decryptBackup(e, PASS), 'params');
    assert.equal(validateEnvelope(e).ok, false);
  }
  const hi = clone(); hi.kdf.iterations = MAX_ITERATIONS + 1; await rejects(decryptBackup(hi, PASS), 'params');
  // Y no se puede CREAR un sobre débil con la API.
  await rejects(encryptBackup(backup, PASS, { iterations: 1000 }), 'params');
  await rejects(encryptBackup(backup, PASS, { iterations: MAX_ITERATIONS + 1 }), 'params');
});

test('un texto claro que no es JSON se informa (sobre bien formado, contenido inválido)', async () => {
  const e = await encryptBackup('esto no es json', PASS);
  await rejects(decryptBackup(e, PASS), 'format');
});

test('isEncryptedEnvelope distingue un respaldo normal', () => {
  assert.equal(isEncryptedEnvelope(backup), false);
  assert.equal(isEncryptedEnvelope(null), false);
  assert.equal(isEncryptedEnvelope([env]), false);
});

test('base64 estricto', () => {
  assert.deepEqual([...fromB64('AQID')], [1, 2, 3]);
  for (const bad of ['A', 'AB', 'ABC', 'A===', '=AAA', 'AA=A', 'AAA*', 'AA A', 5, null]) assert.equal(fromB64(bad), null, String(bad));
  const big = new Uint8Array(200000).map((_, i) => i % 251);
  assert.deepEqual(fromB64(toB64(big)), big);
});

test('fortaleza de la contraseña: orienta, no promete', () => {
  assert.equal(passphraseStrength('').level, 0);
  assert.equal(passphraseStrength('aaaaaaaaaa').level, 0);
  assert.equal(passphraseStrength('12345678').level, 0);
  assert.equal(passphraseStrength('contraseña').level <= 1, true);
  assert.equal(passphraseStrength('abc').ok, false);
  assert.equal(passphraseStrength('corta1').ok, false);
  assert.ok(passphraseStrength('Caballo-Batería-Grapa-7').level >= 3);
  assert.ok(passphraseStrength('correcta caballo bateria grapa').level >= 3);
  assert.equal(passphraseStrength('Caballo-Batería-Grapa-7').ok, true);
});

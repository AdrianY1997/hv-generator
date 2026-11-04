// Claves y sobres de la sincronización (G04). PURO: solo WebCrypto (navegador y Node), sin DOM, sin red.
//
// Se reutiliza el formato de js/backup-crypto.js: cada trozo cifrado es un sobre `hv-minerva-enc` v1 IDÉNTICO al de un respaldo cifrado
// (PBKDF2-SHA-256 600 000 -> AES-256-GCM, cabecera como AAD), así que cualquier trozo se puede abrir con `decryptBackup` y la contraseña.
// Diferencia: la sal es la del espacio de sincronización (va en el manifiesto) y la clave se deriva UNA vez por sesión, no por trozo.
//
// De los 32 bytes de PBKDF2 salen dos claves (no extraíbles):
//  - aes: AES-256-GCM (exactamente la clave que derivaría decryptBackup con esa sal), para cifrar.
//  - mac: HMAC-SHA-256 vía HKDF(info 'hv-minerva-sync/mac/v1'), para identificar adjuntos por contenido y firmar el resumen del estado
//    sin revelar un hash del archivo en claro (un SHA-256 simple permitiría confirmar "este certificado está en la nube").
import {
  envelopeHead, envelopeAad, validateEnvelope, toB64, fromB64, normalizePassphrase, passphraseLength, CryptoBackupError,
  MIN_PASSPHRASE, MAX_PASSPHRASE, KDF_ITERATIONS, MIN_ITERATIONS, MAX_ITERATIONS, SALT_BYTES, IV_BYTES,
} from '../backup-crypto.js';

const enc = new TextEncoder(), dec = new TextDecoder('utf-8', { fatal: true });
const subtle = () => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new CryptoBackupError('unavailable', 'Este navegador no ofrece cifrado (WebCrypto). Usa un navegador actualizado y abre la app desde https.');
  return s;
};
export const AUTH_MESSAGE = 'La contraseña de sincronización no coincide con la que usaste en tus otros equipos, o los datos remotos fueron modificados. No se cambió ningún dato.';
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

/** Sal nueva (base64, 16 bytes) para un espacio de sincronización nuevo. */
export const newSalt = () => toB64(crypto.getRandomValues(new Uint8Array(SALT_BYTES)));
/** Identificador aleatorio (hex) para revisiones. */
export const randomId = (bytes = 12) => hex(crypto.getRandomValues(new Uint8Array(bytes)));

/** Valida la contraseña de sincronización. `creating`: exige el mínimo (al crear o unirse); al desbloquear solo que no esté vacía. */
export function checkSyncPassphrase(passphrase, { creating = false } = {}) {
  const p = normalizePassphrase(passphrase);
  if (!p) throw new CryptoBackupError('passphrase', 'Escribe la contraseña de sincronización.');
  if (creating && passphraseLength(p) < MIN_PASSPHRASE) throw new CryptoBackupError('passphrase', `La contraseña de sincronización debe tener al menos ${MIN_PASSPHRASE} caracteres.`);
  if (p.length > MAX_PASSPHRASE) throw new CryptoBackupError('passphrase', `La contraseña no puede pasar de ${MAX_PASSPHRASE} caracteres.`);
  return p;
}

/**
 * deriveSyncKeys(passphrase, {salt(b64), iterations, creating}) -> {aes, mac, salt, iterations}
 * Costoso a propósito (PBKDF2 600 000): se llama una vez y el resultado se guarda en memoria (o, si la persona lo pide, en IndexedDB
 * como CryptoKey NO extraíble). La contraseña no se conserva en ninguna parte.
 */
export async function deriveSyncKeys(passphrase, { salt, iterations = KDF_ITERATIONS, creating = false } = {}) {
  const pass = checkSyncPassphrase(passphrase, { creating });
  const saltBytes = fromB64(salt);
  if (!saltBytes || saltBytes.length < SALT_BYTES || saltBytes.length > 64) throw new CryptoBackupError('format', 'La sincronización remota está dañada (sal inválida).');
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) throw new CryptoBackupError('params', 'La sincronización remota usa una derivación de clave que la app no acepta.');
  const s = subtle();
  const base = await s.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await s.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations }, base, 256));
  try {
    const aes = await s.importKey('raw', bits, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const hk = await s.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
    const mac = await s.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode('hv-minerva-sync/mac/v1') }, hk, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
    return { aes, mac, salt: toB64(saltBytes), iterations };
  } finally { bits.fill(0); }
}

/** Cifra bytes con las claves de sincronización -> sobre `hv-minerva-enc` v1 (objeto). IV aleatorio en cada llamada. */
export async function sealBytes(keys, bytes) {
  const head = envelopeHead(keys.iterations);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: envelopeAad(head), tagLength: 128 }, keys.aes, bytes));
  return { ...head, salt: keys.salt, iv: toB64(iv), ciphertext: toB64(ct) };
}
export const sealJson = (keys, obj) => sealBytes(keys, enc.encode(JSON.stringify(obj)));

/**
 * Abre un sobre (objeto o texto JSON) con las claves de sincronización -> Uint8Array. Valida el sobre ANTES (versión, KDF, tamaños: la misma
 * validación que un respaldo cifrado). Una sal o unas iteraciones distintas a las de las claves -> 'auth' (la clave no puede ser la correcta).
 */
export async function openBytes(keys, envelope) {
  let env = envelope;
  if (typeof env === 'string') { try { env = JSON.parse(env); } catch { throw new CryptoBackupError('format', 'La sincronización remota está dañada (trozo ilegible).'); } }
  const v = validateEnvelope(env);
  if (!v.ok) throw new CryptoBackupError(v.code, v.error);
  if (env.salt !== keys.salt || env.kdf.iterations !== keys.iterations) throw new CryptoBackupError('auth', AUTH_MESSAGE);
  try {
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: v.iv, additionalData: envelopeAad(env), tagLength: 128 }, keys.aes, v.data));
  } catch (e) { throw new CryptoBackupError('auth', AUTH_MESSAGE, e); }
}
export async function openJson(keys, envelope) {
  const bytes = await openBytes(keys, envelope);
  try { return JSON.parse(dec.decode(bytes)); } catch (e) { throw new CryptoBackupError('format', 'La sincronización remota se descifró pero su contenido no es válido.', e); }
}

/** HMAC-SHA-256 (hex). `len` caracteres hex (por omisión 32 = 128 bits). */
export async function mac(keys, data, len = 32) {
  const bytes = typeof data === 'string' ? enc.encode(data) : data;
  return hex(await subtle().sign('HMAC', keys.mac, bytes)).slice(0, len);
}
/** Identificador de un adjunto por su contenido (HMAC con la clave del espacio; no revela un hash del archivo en claro). */
export const blobId = (keys, bytes) => mac(keys, bytes, 32);

/** Envuelve un secreto local (el token) con la clave de sincronización: sin la contraseña (o la clave recordada) no se puede usar. */
export async function wrapSecret(keys, text) { return sealBytes(keys, enc.encode(String(text))); }
export async function unwrapSecret(keys, env) { return dec.decode(await openBytes(keys, env)); }

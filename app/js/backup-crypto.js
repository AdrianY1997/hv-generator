// Cifrado opcional del respaldo (G05). Funciones PURAS sobre WebCrypto (sin DOM, sin red, sin dependencias): corren en el navegador y en Node.
//
// Sobre ("envelope") JSON versionado:
//   { app:'hv-minerva', format:'hv-minerva-enc', v:1, cipher:'AES-256-GCM',
//     kdf:{ name:'PBKDF2', hash:'SHA-256', iterations:600000 }, salt:<b64 16 B>, iv:<b64 12 B>, ciphertext:<b64> }
// Clave = PBKDF2-SHA-256(contraseña NFKC en UTF-8, salt, iteraciones) -> AES-256-GCM. El texto claro es el JSON del respaldo.
// La cabecera (app, format, v, cipher, kdf) viaja como datos autenticados adicionales (AAD): cambiarla invalida la etiqueta GCM.
// Una contraseña incorrecta y un archivo alterado dan el MISMO error (code 'auth'): GCM no distingue ni debe distinguirlos.
// Una contraseña perdida NO se puede recuperar: no hay puerta trasera.

export const ENC_FORMAT = 'hv-minerva-enc';
export const ENC_VERSION = 1;
export const KDF_ITERATIONS = 600000;           // OWASP 2023 para PBKDF2-HMAC-SHA256
export const MIN_ITERATIONS = 600000;           // un sobre con menos iteraciones se rechaza (degradación del KDF)
export const MAX_ITERATIONS = 5000000;          // tope para que un archivo hostil no deje la pestaña calculando minutos
export const SALT_BYTES = 16, IV_BYTES = 12;
export const MIN_PASSPHRASE = 10;               // caracteres Unicode (puntos de código tras NFKC) al CREAR una contraseña; al descifrar se acepta cualquier largo
export const MAX_PASSPHRASE = 256;
// El sobre pesa ~4/3 del JSON claro (base64) + cabecera. Mismo tope de texto claro que backup-validate.js (MAX_BACKUP_JSON = 50 MB).
export const MAX_PLAINTEXT_BYTES = 50 * 1024 * 1024;
export const MAX_ENVELOPE_BYTES = Math.ceil(MAX_PLAINTEXT_BYTES * 4 / 3) + 4096;

/** Error con mensaje en español para la persona. code: 'format' | 'unsupported' | 'params' | 'size' | 'passphrase' | 'auth' | 'unavailable'. */
export class CryptoBackupError extends Error {
  constructor(code, userMessage, cause) {
    super('backup-crypto:' + code);
    this.name = 'CryptoBackupError';
    this.code = code;
    this.userMessage = userMessage;
    if (cause) this.cause = cause;
  }
}

const enc = new TextEncoder(), dec = new TextDecoder('utf-8', { fatal: true });
const subtle = () => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new CryptoBackupError('unavailable', 'Este navegador no ofrece cifrado (WebCrypto). Usa un navegador actualizado y abre la app desde https o localhost.');
  return s;
};

// ---- base64 estricto (sin dependencias de DOM) ----
// Clase simple con * (sin grupos): no acumula estado de retroceso en cadenas de decenas de MB.
const B64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
export function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromB64(str) {
  if (typeof str !== 'string' || str.length % 4 !== 0 || !B64_RE.test(str)) return null;
  if (/=[^=]/.test(str.slice(-4)) || str.slice(0, -2).includes('=')) return null;
  const bin = atob(str), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const b64Len = (str) => (typeof str === 'string' && str.length % 4 === 0 ? (str.length / 4) * 3 - (str.endsWith('==') ? 2 : str.endsWith('=') ? 1 : 0) : -1);

/** Contraseña -> texto normalizado (NFKC: "é" compuesta o descompuesta da la misma clave). */
export const normalizePassphrase = (p) => String(p ?? '').normalize('NFKC');
/** Largo en caracteres (puntos de código) de la contraseña normalizada: un emoji cuenta 1, no 2. */
export const passphraseLength = (p) => Array.from(normalizePassphrase(p)).length;

/** ¿Es (la forma de) un sobre cifrado de HV Minerva? No valida el contenido: para eso está `validateEnvelope`. */
export function isEncryptedEnvelope(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x) && x.app === 'hv-minerva' && x.format === ENC_FORMAT;
}

const aadOf = (e) => enc.encode(JSON.stringify([e.app, e.format, e.v, e.cipher, e.kdf.name, e.kdf.hash, e.kdf.iterations]));
/** Cabecera de un sobre de la versión actual. La usa js/sync/sync-crypto.js para producir sobres idénticos con una clave ya derivada. */
export const envelopeHead = (iterations = KDF_ITERATIONS) => ({ app: 'hv-minerva', format: ENC_FORMAT, v: ENC_VERSION, cipher: 'AES-256-GCM', kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations } });
/** Datos autenticados adicionales (AAD) de un sobre: su cabecera serializada (misma función que usan encryptBackup/decryptBackup). */
export const envelopeAad = (e) => aadOf(e);

/**
 * Valida el sobre SIN tocar la contraseña ni derivar nada. {ok:true, salt, iv, data} | {ok:false, code, error}.
 * Rechaza: versión desconocida, cifrado/KDF/hash distintos de los esperados, iteraciones por debajo de MIN_ITERATIONS (o absurdas),
 * sal o IV con longitud inválida, base64 mal formado, texto cifrado demasiado grande o demasiado corto (la etiqueta GCM mide 16 bytes).
 */
export function validateEnvelope(e) {
  const bad = (code, error) => ({ ok: false, code, error });
  if (!isEncryptedEnvelope(e)) return bad('format', 'El archivo no es un respaldo cifrado de HV Minerva.');
  if (!Number.isInteger(e.v) || e.v < 1) return bad('format', 'El respaldo cifrado no indica su versión.');
  if (e.v > ENC_VERSION) return bad('unsupported', 'Este respaldo cifrado es de una versión más nueva de la app. Actualiza la app para abrirlo.');
  if (e.cipher !== 'AES-256-GCM') return bad('params', 'El respaldo cifrado usa un algoritmo que la app no acepta.');
  const k = e.kdf;
  if (!k || typeof k !== 'object' || k.name !== 'PBKDF2' || k.hash !== 'SHA-256') return bad('params', 'El respaldo cifrado usa una derivación de clave que la app no acepta.');
  if (!Number.isInteger(k.iterations) || k.iterations < MIN_ITERATIONS) return bad('params', `El respaldo cifrado usa una derivación de clave débil (menos de ${MIN_ITERATIONS.toLocaleString('es-CO')} iteraciones) y se rechaza por seguridad.`);
  if (k.iterations > MAX_ITERATIONS) return bad('params', 'El respaldo cifrado pide una derivación de clave demasiado costosa y se rechaza.');
  const salt = fromB64(e.salt), iv = fromB64(e.iv);
  if (!salt || salt.length < SALT_BYTES || salt.length > 64) return bad('format', 'El respaldo cifrado está dañado (sal inválida).');
  if (!iv || iv.length !== IV_BYTES) return bad('format', 'El respaldo cifrado está dañado (vector inicial inválido).');
  if (typeof e.ciphertext !== 'string') return bad('format', 'El respaldo cifrado está dañado (datos inválidos).');
  if (e.ciphertext.length > MAX_ENVELOPE_BYTES) return bad('size', 'El respaldo cifrado es demasiado grande.');
  const n = b64Len(e.ciphertext);
  if (n < 16 + 2) return bad('format', 'El respaldo cifrado está dañado (datos inválidos).');
  if (n - 16 > MAX_PLAINTEXT_BYTES) return bad('size', 'El respaldo cifrado es demasiado grande.');
  const data = fromB64(e.ciphertext);
  if (!data) return bad('format', 'El respaldo cifrado está dañado (datos inválidos).');
  return { ok: true, salt, iv, data };
}

async function deriveKey(pass, salt, iterations) {
  const s = subtle();
  const base = await s.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return s.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

function checkPassphrase(passphrase) {
  const pass = normalizePassphrase(passphrase);
  if (passphraseLength(pass) < MIN_PASSPHRASE) throw new CryptoBackupError('passphrase', `La contraseña debe tener al menos ${MIN_PASSPHRASE} caracteres.`);
  if (pass.length > MAX_PASSPHRASE) throw new CryptoBackupError('passphrase', `La contraseña no puede pasar de ${MAX_PASSPHRASE} caracteres.`);
  return pass;
}

/**
 * Cifra un respaldo (objeto o ya serializado a texto) con una contraseña. Devuelve el sobre (objeto JSON, listo para `JSON.stringify`).
 * opts.iterations (solo >= MIN_ITERATIONS) y opts.exportedAt son opcionales. Sal e IV nuevos y aleatorios en cada llamada.
 */
export async function encryptBackup(backup, passphrase, opts = {}) {
  const pass = checkPassphrase(passphrase);
  const iterations = opts.iterations ?? KDF_ITERATIONS;
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) throw new CryptoBackupError('params', 'Número de iteraciones fuera de rango.');
  const plain = enc.encode(typeof backup === 'string' ? backup : JSON.stringify(backup));
  if (plain.length > MAX_PLAINTEXT_BYTES) throw new CryptoBackupError('size', `El respaldo pesa más de ${MAX_PLAINTEXT_BYTES / 1048576} MB y no se puede cifrar.`);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES)), iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const head = envelopeHead(iterations);
  const key = await deriveKey(pass, salt, iterations);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: aadOf(head), tagLength: 128 }, key, plain));
  return { ...head, salt: toB64(salt), iv: toB64(iv), ciphertext: toB64(ct) };
}

/**
 * Descifra un sobre y devuelve el respaldo ya como objeto (JSON.parse del texto claro; la validación del contenido la hace el flujo
 * normal de importación, no esta función). Lanza CryptoBackupError: 'format'/'unsupported'/'params'/'size' (sobre inválido, ANTES de derivar la clave),
 * 'passphrase' (vacía o fuera de rango) o 'auth' (contraseña incorrecta o datos alterados: indistinguibles). No toca ningún estado.
 */
export async function decryptBackup(envelope, passphrase) {
  const v = validateEnvelope(envelope);
  if (!v.ok) throw new CryptoBackupError(v.code, v.error);
  const pass = normalizePassphrase(passphrase);
  if (!pass) throw new CryptoBackupError('passphrase', 'Escribe la contraseña del respaldo.');
  if (pass.length > MAX_PASSPHRASE) throw new CryptoBackupError('auth', AUTH_MSG);
  let plain;
  try {
    const key = await deriveKey(pass, v.salt, envelope.kdf.iterations);
    plain = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: v.iv, additionalData: aadOf(envelope), tagLength: 128 }, key, v.data));
  } catch (e) {
    if (e instanceof CryptoBackupError) throw e;
    throw new CryptoBackupError('auth', AUTH_MSG, e);
  }
  try { return JSON.parse(dec.decode(plain)); }
  catch (e) { throw new CryptoBackupError('format', 'El respaldo se descifró pero su contenido no es un JSON válido.', e); }
}
const AUTH_MSG = 'Contraseña incorrecta, o el archivo está dañado o fue modificado. No se cambió ningún dato.';

/**
 * Orientación sobre la fortaleza (estimación por entropía de un atacante que prueba al azar; NO es una garantía).
 * Devuelve { level:0..4, label, bits, ok } con `ok` = cumple el mínimo de longitud. Los patrones muy comunes (repeticiones, secuencias, palabras típicas) bajan el nivel.
 */
export function passphraseStrength(passphrase) {
  const p = normalizePassphrase(passphrase);
  const labels = ['Muy débil', 'Débil', 'Aceptable', 'Buena', 'Fuerte'];
  const done = (level, bits) => ({ level, label: labels[level], bits: Math.round(bits), ok: passphraseLength(p) >= MIN_PASSPHRASE && p.length <= MAX_PASSPHRASE });
  if (!p) return done(0, 0);
  let pool = 0;
  if (/[a-záéíóúüñ]/.test(p)) pool += 27;
  if (/[A-ZÁÉÍÓÚÜÑ]/.test(p)) pool += 27;
  if (/\d/.test(p)) pool += 10;
  if (/[^\p{L}\d]/u.test(p)) pool += 33;
  if (/[^\x00-\x7f]/.test(p.replace(/[áéíóúüñÁÉÍÓÚÜÑ]/g, ''))) pool += 50;
  const uniq = new Set(p).size;
  let bits = Math.min(p.length, uniq * 2) * Math.log2(Math.max(pool, 2));
  const low = p.toLowerCase();
  if (/^(.)\1+$/.test(p) || /^(?:0123|1234|2345|3456|4567|5678|6789|abcd|qwer|asdf)/.test(low)) bits = Math.min(bits, 20);
  if (/^(contrase|password|passw0rd|admin|hojadevida|minerva|colombia|123456)/.test(low)) bits = Math.min(bits, 28);
  const level = bits < 28 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  return done(level, bits);
}

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const SALT = 'orca-encryption-salt-v1';

let cachedKey: Buffer | undefined;

function deriveKey(secret: string): Buffer {
  if (cachedKey) return cachedKey;
  cachedKey = scryptSync(secret, SALT, 32);
  return cachedKey;
}

/**
 * Encrypt a plaintext value with AES-256-GCM. Output format:
 *   `enc:v1:<iv-base64>.<authTag-base64>.<ciphertext-base64>`
 * Detect already-encrypted strings via the `enc:v1:` prefix.
 */
export function encryptSecret(plaintext: string, secret: string): string {
  if (plaintext.startsWith('enc:v1:')) return plaintext; // already encrypted
  const key = deriveKey(secret);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
}

export function decryptSecret(value: string, secret: string): string {
  if (!value.startsWith('enc:v1:')) return value; // legacy plaintext
  const payload = value.slice('enc:v1:'.length);
  const parts = payload.split('.');
  if (parts.length !== 3) throw new Error('Invalid encrypted format');
  const [ivB64, tagB64, ctB64] = parts;
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('Invalid encrypted format');
  const key = deriveKey(secret);
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ct), decipher.final()]);
  return decrypted.toString('utf8');
}

export function isEncrypted(value: string): boolean {
  return value.startsWith('enc:v1:');
}

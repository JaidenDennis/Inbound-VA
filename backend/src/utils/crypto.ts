import crypto from 'node:crypto';
import CryptoJS from 'crypto-js';
import { env } from '../config/index.js';

// Authenticated encryption (AES-256-GCM) for secrets at rest — currently CRM
// credentials (crm_connections.credentials_encrypted). GCM provides
// confidentiality AND tamper-detection (an auth tag), unlike the previous
// unauthenticated CryptoJS AES-CBC.
//
// Wire format:  gcm.v1.<iv_b64>.<authTag_b64>.<ciphertext_b64>
// The 32-byte key is derived from ENCRYPTION_KEY via SHA-256, so any
// ENCRYPTION_KEY string (the env schema already requires ≥32 chars) works
// without changing configuration.
const GCM_PREFIX = 'gcm.v1.';

function deriveKey(): Buffer {
  return crypto.createHash('sha256').update(env.ENCRYPTION_KEY, 'utf8').digest();
}

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12); // 96-bit nonce, recommended for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${GCM_PREFIX}${iv.toString('base64')}.${authTag.toString('base64')}.${ciphertext.toString('base64')}`;
}

export function decrypt(ciphertext: string): string {
  // New authenticated format.
  if (ciphertext.startsWith(GCM_PREFIX)) {
    const [ivB64, tagB64, dataB64] = ciphertext.slice(GCM_PREFIX.length).split('.');
    if (!ivB64 || !tagB64 || !dataB64) throw new Error('Malformed ciphertext');
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64')); // throws on tamper in final()
    const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
    return decrypted.toString('utf8');
  }
  // Legacy CryptoJS AES-CBC (pre-GCM). Kept so any credentials encrypted before
  // this migration still decrypt; re-saving a CRM connection re-encrypts it as
  // GCM. Safe to remove once no legacy rows remain.
  return CryptoJS.AES.decrypt(ciphertext, env.ENCRYPTION_KEY).toString(CryptoJS.enc.Utf8);
}

export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key, 'utf8').digest('hex');
}

export function generateApiKey(): string {
  return 'gve_' + crypto.randomBytes(32).toString('hex');
}

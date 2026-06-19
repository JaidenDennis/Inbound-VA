import CryptoJS from 'crypto-js';
import { env } from '../config/index.js';

export function encrypt(plaintext: string): string {
  return CryptoJS.AES.encrypt(plaintext, env.ENCRYPTION_KEY).toString();
}

export function decrypt(ciphertext: string): string {
  const bytes = CryptoJS.AES.decrypt(ciphertext, env.ENCRYPTION_KEY);
  return bytes.toString(CryptoJS.enc.Utf8);
}

export function hashApiKey(key: string): string {
  return CryptoJS.SHA256(key).toString();
}

export function generateApiKey(): string {
  const bytes = CryptoJS.lib.WordArray.random(32);
  return 'gve_' + bytes.toString(CryptoJS.enc.Hex);
}

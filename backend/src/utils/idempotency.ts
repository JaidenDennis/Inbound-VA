import CryptoJS from 'crypto-js';

export function buildIdempotencyKey(...parts: (string | number | undefined)[]): string {
  const key = parts.filter(Boolean).join(':');
  return CryptoJS.SHA256(key).toString().slice(0, 32);
}

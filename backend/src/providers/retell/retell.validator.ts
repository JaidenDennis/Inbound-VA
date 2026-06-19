import CryptoJS from 'crypto-js';
import { env } from '../../config/index.js';

export function validateRetellSignature(
  rawBody: string,
  signature: string | undefined
): boolean {
  if (!signature) return false;

  const expected = CryptoJS.HmacSHA256(rawBody, env.RETELL_WEBHOOK_SECRET).toString(CryptoJS.enc.Hex);
  return expected === signature;
}

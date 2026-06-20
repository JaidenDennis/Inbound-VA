import Retell from 'retell-sdk';
import { env } from '../../config/index.js';

// Single shared Retell API client. Reads the key from env — never hardcoded.
export const retell = new Retell({ apiKey: env.RETELL_API_KEY });

import pino from 'pino';
import { env } from '../config/index.js';

// Paths pino replaces with `[Redacted]` in any logged object so secrets never
// reach the logs. Covers Fastify's request shape (`req.headers.*`) plus common
// secret-bearing keys used across services/payloads. Wildcards (`*.token`) catch
// one level of nesting. Shared with the Fastify request logger in app.ts.
export const LOG_REDACT_PATHS = [
  // Request headers (Fastify logs req as { headers, ... })
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-retell-signature"]',
  'req.headers["x-admin-api-key"]',
  'headers.authorization',
  'headers.cookie',
  // Bare secret-bearing keys anywhere we log an object directly
  'authorization',
  'cookie',
  'password',
  'password_hash',
  'token',
  'access_token',
  'refresh_token',
  'secret',
  'apiKey',
  'api_key',
  'credentials',
  'credentials_encrypted',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ANON_KEY',
  'RETELL_API_KEY',
  'ENCRYPTION_KEY',
  'JWT_SECRET',
  // One level of nesting (e.g. { crm: { credentials: ... } })
  '*.password',
  '*.password_hash',
  '*.token',
  '*.access_token',
  '*.refresh_token',
  '*.secret',
  '*.credentials',
  '*.credentials_encrypted',
];

export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: { paths: LOG_REDACT_PATHS, censor: '[Redacted]' },
  transport:
    env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  base: { service: 'gravvia-backend' },
});

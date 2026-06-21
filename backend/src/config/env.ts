import 'dotenv/config'; // loads backend/.env into process.env before validation
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3001),
  API_BASE_URL: z.string().url().default('http://localhost:3001'),

  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('7d'),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_ANON_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),

  REDIS_URL: z.string().default('redis://localhost:6379'),

  RETELL_API_KEY: z.string().min(1),
  // Retell signs webhooks AND custom-function calls with the API KEY via the
  // X-Retell-Signature header (v={ts},d={digest}). There is no separate webhook
  // secret in Retell, so this is optional and kept only for backward-compat.
  RETELL_WEBHOOK_SECRET: z.string().optional(),
  // Default Retell voice id, overridable per client via client_settings.
  RETELL_DEFAULT_VOICE_ID: z.string().default('11labs-Adrian'),
  // Base URL Retell calls back into (events + custom functions). Falls back to
  // API_BASE_URL when unset. e.g. https://api.gravvia.com
  WEBHOOK_BASE_URL: z.string().url().optional(),

  ENCRYPTION_KEY: z.string().min(32),

  GHL_CLIENT_ID: z.string().optional(),
  GHL_CLIENT_SECRET: z.string().optional(),
  HUBSPOT_APP_ID: z.string().optional(),
  HUBSPOT_CLIENT_SECRET: z.string().optional(),
  SF_CONSUMER_KEY: z.string().optional(),
  SF_CONSUMER_SECRET: z.string().optional(),
  ZOHO_CLIENT_ID: z.string().optional(),
  ZOHO_CLIENT_SECRET: z.string().optional(),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),

  MS_CLIENT_ID: z.string().optional(),
  MS_CLIENT_SECRET: z.string().optional(),
  MS_REDIRECT_URI: z.string().url().optional(),

  CALENDLY_CLIENT_ID: z.string().optional(),
  CALENDLY_CLIENT_SECRET: z.string().optional(),

  SMTP_HOST: z.string().default('smtp.sendgrid.net'),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().default('apikey'),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().email().default('noreply@gravvia.com'),

  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  // Stricter caps for sensitive endpoints (over RATE_LIMIT_WINDOW_MS). Login is
  // the unauthenticated brute-force surface; provisioning triggers paid Retell
  // API calls. Both are intentionally low and configurable.
  AUTH_RATE_LIMIT_MAX: z.coerce.number().default(10),
  PROVISION_RATE_LIMIT_MAX: z.coerce.number().default(30),

  // Allowed browser origins in production (comma-separated). The dashboard's
  // public URL MUST be listed here or its API calls are CORS-blocked. In
  // development all origins are reflected, so this is only read in production.
  CORS_ORIGINS: z.string().optional(),

  // Audit/event retention: rows older than this are purged by the daily
  // maintenance job (keeps audit_logs/events from growing unbounded).
  AUDIT_RETENTION_DAYS: z.coerce.number().default(90),

  // Where exhausted-retry ("manual review") job alerts are emailed. If unset,
  // failures are still recorded in failed_jobs + Sentry, just not emailed.
  ALERT_EMAIL: z.string().email().optional(),

  SENTRY_DSN: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment variables:');
    console.error(result.error.flatten().fieldErrors);
    process.exit(1);
  }
  return result.data;
}

export const env = validateEnv();

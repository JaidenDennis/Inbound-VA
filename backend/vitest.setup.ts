// Runs before any test module is imported, so config/env.ts (which validates
// process.env at import time) sees valid values instead of calling process.exit(1).
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-jwt-secret-at-least-32-chars-long';
process.env.SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'test-service-role-key';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? 'test-anon-key';
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:pass@localhost:5432/test';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
process.env.RETELL_API_KEY = process.env.RETELL_API_KEY ?? 'test-retell-api-key';
process.env.RETELL_WEBHOOK_SECRET = process.env.RETELL_WEBHOOK_SECRET ?? 'test-retell-webhook-secret-value';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? 'test-encryption-key-32-chars-pad!';

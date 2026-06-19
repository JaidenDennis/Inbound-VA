import { createClient } from '@supabase/supabase-js';
import { env } from '../config/index.js';

export const supabase = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false },
    db: { schema: 'public' },
  }
);

export type SupabaseClient = typeof supabase;

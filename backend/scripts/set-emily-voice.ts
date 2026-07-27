/**
 * Persist Bare Beauty's Retell voice as Emily so future reprovisions keep it
 * (the template uses client.retell_voice_id ?? default). One-off, idempotent.
 *   DOTENV_CONFIG_PATH=../.env npx tsx scripts/set-emily-voice.ts
 */
import 'dotenv/config';
import { supabase } from '../src/db/index.js';

async function main(): Promise<void> {
  const { data: client } = await supabase
    .from('clients')
    .select('id, retell_voice_id')
    .eq('slug', 'bare-beauty-medspa')
    .single();
  console.log('before:', client);
  const { error } = await supabase
    .from('clients')
    .update({ retell_voice_id: '11labs-Emily' })
    .eq('slug', 'bare-beauty-medspa');
  if (error) throw new Error(error.message);
  const { data: after } = await supabase
    .from('clients')
    .select('id, retell_voice_id')
    .eq('slug', 'bare-beauty-medspa')
    .single();
  console.log('after: ', after);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });

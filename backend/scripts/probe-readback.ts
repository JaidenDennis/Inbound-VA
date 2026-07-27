/**
 * Deploy check: is the DEPLOYED backend producing the new GROUPED phone readback
 * (comma groups) or the old dashed one? Signs a Retell custom-function request
 * and calls the live function endpoints, then reads the readback string back.
 * Cleans up the transient probe session it creates. No contacts/notifications.
 *   DOTENV_CONFIG_PATH=../.env npx tsx scripts/probe-readback.ts
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import { supabase } from '../src/db/index.js';

const BASE = 'https://inbound-va.onrender.com';
const KEY = process.env.RETELL_API_KEY!;
const CALL_ID = `probe-deploy-${Date.now()}`;

function sign(rawBody: string): string {
  const ts = Date.now().toString();
  const digest = crypto.createHmac('sha256', KEY).update(rawBody + ts).digest('hex');
  return `v=${ts},d=${digest}`;
}

async function call(fn: string, args: Record<string, unknown>): Promise<any> {
  const body = { name: fn, call: { call_id: CALL_ID, to_number: '+19047605971' }, args };
  const rawBody = JSON.stringify(body);
  const res = await fetch(`${BASE}/functions/retell/${fn}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-retell-signature': sign(rawBody) },
    body: rawBody,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function main(): Promise<void> {
  const health = await fetch(`${BASE}/health`).then((r) => r.status).catch(() => 'unreachable');
  console.log('deployed /health:', health);

  // 1) open a routing session, 2) report a phone slot to get the readback.
  const ri = await call('route_intent', { intent: 'book_appointment' });
  console.log('route_intent:', ri.status, ri.json?.workflow_id ?? ri.json?.guidance ?? '');
  const uw = await call('update_workflow', { slots: { phone: '9045551234' } });
  const readback = uw.json?.readback?.phone ?? '(none returned)';
  console.log('update_workflow status:', uw.status);
  console.log('\nPHONE READBACK FROM DEPLOYED BACKEND:\n  ', readback);
  console.log(
    readback.includes(',') && !readback.includes(' - ')
      ? '\n=> GROUPED (new code is DEPLOYED)'
      : readback.includes(' - ')
        ? '\n=> DASHED (old code still deployed — deploy not finished)'
        : '\n=> could not tell (no readback)'
  );

  // Clean up the transient probe session.
  await supabase.from('call_sessions').delete().eq('retell_call_id', CALL_ID);
}

main().then(() => process.exit(0)).catch((e) => { console.error('probe failed:', e.message); process.exit(1); });

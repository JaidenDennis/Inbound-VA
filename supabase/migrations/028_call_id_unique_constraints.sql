-- ============================================================
-- GRAVVIA ENGAGE – unique constraints on the three call_id tables
-- Run order: 028  (NEVER edit earlier migrations)
--
-- WHY THIS EXISTS
--
-- Migration 001 created call_summaries, call_transcripts and conversations with
-- PLAIN indexes on call_id:
--
--     CREATE INDEX idx_summaries_call ON call_summaries(call_id);
--
-- Three call sites, however, upsert into them with ON CONFLICT on that column:
--
--     .upsert(row, { onConflict: 'call_id' })     -- call.service.ts  (x2)
--                                                 -- transcript-processing.worker.ts
--
-- Postgres resolves an ON CONFLICT target at PLAN time against a UNIQUE index.
-- A plain index does not qualify, so every one of those upserts raised
--
--     42P10  there is no unique or exclusion constraint matching the
--            ON CONFLICT specification
--
-- ...from the very first call the platform ever took. The damage was invisible
-- because of WHERE the throw landed: the call_analyzed webhook handler writes
-- its call_record first (that upsert targets retell_call_id, which IS unique,
-- so it succeeded), and only then calls upsertSummary. The 42P10 aborted the
-- request before the transcript enqueue, the CRM summary push and the
-- normalizeSummary event publish. The transcript-processing worker's own write
-- did not even error visibly — it never checked the returned error.
--
-- Net effect on production as of 2026-08-09: 41 call_records, 0 call_summaries,
-- 0 call_transcripts, 0 conversations, and no call.summary events. Retell held
-- complete transcripts for every one of those calls; we simply threw them away
-- on arrival.
--
-- WHAT THIS DOES
--
-- Deduplicates each table by call_id (keeping the newest row) and promotes the
-- plain index to a UNIQUE one. Dedup is defensive: on the live database all
-- three tables are empty, precisely because nothing has ever been written to
-- them. On any environment where rows DID accumulate, the newest row is the
-- correct survivor — these are all last-write-wins caches of the final state of
-- a call, not an append-only history.
--
-- The old non-unique indexes are dropped: a UNIQUE index on the same column
-- serves every read the plain one did, so keeping both just pays for two.
--
-- Rollback: supabase/rollbacks/028_call_id_unique_constraints_rollback.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. call_summaries
-- ------------------------------------------------------------
DELETE FROM call_summaries a
  USING call_summaries b
 WHERE a.call_id = b.call_id
   AND (a.created_at, a.id) < (b.created_at, b.id);

DROP INDEX IF EXISTS idx_summaries_call;

CREATE UNIQUE INDEX IF NOT EXISTS uq_call_summaries_call
  ON call_summaries(call_id);

-- ------------------------------------------------------------
-- 2. call_transcripts
-- ------------------------------------------------------------
DELETE FROM call_transcripts a
  USING call_transcripts b
 WHERE a.call_id = b.call_id
   AND (a.created_at, a.id) < (b.created_at, b.id);

DROP INDEX IF EXISTS idx_transcripts_call;

CREATE UNIQUE INDEX IF NOT EXISTS uq_call_transcripts_call
  ON call_transcripts(call_id);

-- ------------------------------------------------------------
-- 3. conversations
--
-- One conversation row per call is already the assumption everywhere that reads
-- this table (`.eq('call_id', callId).single()` in the transcript worker), so
-- the constraint is documenting an invariant the code already relies on rather
-- than imposing a new one.
-- ------------------------------------------------------------
DELETE FROM conversations a
  USING conversations b
 WHERE a.call_id = b.call_id
   AND (a.created_at, a.id) < (b.created_at, b.id);

DROP INDEX IF EXISTS idx_conversations_call;

CREATE UNIQUE INDEX IF NOT EXISTS uq_conversations_call
  ON conversations(call_id);

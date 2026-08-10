-- Rollback for 028_call_id_unique_constraints.sql
--
-- Restores the plain (non-unique) indexes migration 001 created. Note that this
-- also restores the 42P10 failure on every `onConflict: 'call_id'` upsert —
-- transcripts and summaries will stop being written again. Roll back only if
-- the unique constraint itself is the problem (e.g. a legitimate need for more
-- than one row per call_id), and change the upsert call sites in the same move.

DROP INDEX IF EXISTS uq_call_summaries_call;
CREATE INDEX IF NOT EXISTS idx_summaries_call ON call_summaries(call_id);

DROP INDEX IF EXISTS uq_call_transcripts_call;
CREATE INDEX IF NOT EXISTS idx_transcripts_call ON call_transcripts(call_id);

DROP INDEX IF EXISTS uq_conversations_call;
CREATE INDEX IF NOT EXISTS idx_conversations_call ON conversations(call_id);

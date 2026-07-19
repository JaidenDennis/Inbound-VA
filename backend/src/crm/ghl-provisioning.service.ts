import { UnrecoverableError } from 'bullmq';
import { supabase } from '../db/index.js';
import { eventBus } from '../events/index.js';
import { buildIdempotencyKey, logger } from '../utils/index.js';
import { resolveAdapterConfig } from './credentials.js';
import {
  GhlAuthError,
  GhlProvisioningClient,
  type GhlPipelineDetail,
} from './ghl-provisioning-client.js';
import type { CrmConnection, GhlBlueprint } from '../types/index.js';

/**
 * Applies a GhlBlueprint to a connected location, idempotently and resumably.
 * One crm_sync_logs row per run (entity_type='provision_run', entity_id=runId,
 * operation='provision') carries per-step results in payload; the row is
 * persisted after every step so a BullMQ retry resumes from the first
 * incomplete step instead of redoing finished work. Every create is preceded
 * by a list + name/email match, so re-running any step is always safe.
 */

export type ProvisionStepName = 'pipeline' | 'customFields' | 'tags' | 'demoLeads' | 'opportunities';

export const PROVISION_STEPS: ProvisionStepName[] = [
  'pipeline',
  'customFields',
  'tags',
  'demoLeads',
  'opportunities',
];

export interface ProvisionStepResult {
  step: ProvisionStepName;
  status: 'pending' | 'success' | 'failed';
  created: number;
  updated: number;
  skipped: number;
  error?: string;
  /** Step-specific context reused on resume (pipelineId, stageIdByName, contactIdByEmail, warnings). */
  detail?: Record<string, unknown>;
}

export type ProvisionRunStatus = 'pending' | 'success' | 'failed' | 'manual_review';

export interface ProvisionRun {
  runId: string;
  clientId: string;
  crmConnectionId: string;
  blueprintName: string;
  status: ProvisionRunStatus;
  steps: ProvisionStepResult[];
}

export interface ApplyBlueprintOptions {
  clientId: string;
  runId: string;
  blueprint: GhlBlueprint;
  conn: CrmConnection;
  /** 1-based attempt number recorded on the run row. */
  attempt: number;
}

export function initialProvisionSteps(): ProvisionStepResult[] {
  return PROVISION_STEPS.map((step) => ({
    step,
    status: 'pending',
    created: 0,
    updated: 0,
    skipped: 0,
  }));
}

interface RunRowState {
  run: ProvisionRun;
  errorMessage: string | null;
}

async function loadRun(
  clientId: string,
  crmConnectionId: string,
  runId: string,
  blueprintName: string
): Promise<RunRowState> {
  const { data } = await supabase
    .from('crm_sync_logs')
    .select('*')
    .eq('client_id', clientId)
    .eq('entity_type', 'provision_run')
    .eq('entity_id', runId)
    .eq('operation', 'provision')
    .maybeSingle();

  const payload = (data?.payload ?? {}) as { blueprintName?: string; steps?: ProvisionStepResult[] };
  const steps =
    Array.isArray(payload.steps) && payload.steps.length === PROVISION_STEPS.length
      ? payload.steps
      : initialProvisionSteps();

  return {
    run: {
      runId,
      clientId,
      crmConnectionId,
      blueprintName: payload.blueprintName ?? blueprintName,
      status: (data?.status as ProvisionRunStatus | undefined) ?? 'pending',
      steps,
    },
    errorMessage: (data?.error_message as string | null | undefined) ?? null,
  };
}

export async function persistProvisionRun(
  run: ProvisionRun,
  opts: { attempts: number; errorMessage?: string | null }
): Promise<void> {
  const { error } = await supabase.from('crm_sync_logs').upsert(
    {
      client_id: run.clientId,
      crm_connection_id: run.crmConnectionId,
      entity_type: 'provision_run',
      entity_id: run.runId,
      operation: 'provision',
      status: run.status,
      error_message: opts.errorMessage ?? null,
      attempts: opts.attempts,
      payload: { blueprintName: run.blueprintName, steps: run.steps },
    },
    { onConflict: 'client_id,entity_type,entity_id,operation' }
  );
  if (error) {
    // The run itself may have succeeded — never fail provisioning over a log
    // write, but say so loudly.
    logger.error({ error, runId: run.runId }, 'Failed to persist provision run row');
  }
}

/** Marks a run terminal (manual_review) — used by the worker on retry exhaustion. */
export async function markRunManualReview(
  run: ProvisionRun,
  opts: { attempts: number; errorMessage: string }
): Promise<void> {
  run.status = 'manual_review';
  await persistProvisionRun(run, opts);
  await eventBus.publish({
    type: 'crm.provision.failed',
    clientId: run.clientId,
    payload: {
      runId: run.runId,
      blueprintName: run.blueprintName,
      reason: opts.errorMessage,
      steps: run.steps,
    },
    source: 'crm',
    idempotencyKey: buildIdempotencyKey('provision-failed', run.runId),
  });
}

interface PipelineContext {
  pipelineId: string;
  stageIdByName: Record<string, string>;
}

function pipelineContextFrom(pipeline: GhlPipelineDetail): PipelineContext {
  const stageIdByName: Record<string, string> = {};
  for (const stage of pipeline.stages) stageIdByName[stage.name.toLowerCase()] = stage.id;
  return { pipelineId: pipeline.id, stageIdByName };
}

/**
 * Re-derives pipeline id + stage ids from the API. Used by the opportunities
 * step even when the pipeline step ran in an earlier attempt/process, so a
 * resume never trusts possibly-stale in-memory state.
 */
async function resolvePipelineContext(
  client: GhlProvisioningClient,
  blueprint: GhlBlueprint
): Promise<PipelineContext | null> {
  const pipelines = await client.listPipelines();
  const match = pipelines.find(
    (p) => p.name.toLowerCase() === blueprint.pipeline.name.toLowerCase()
  );
  return match ? pipelineContextFrom(match) : null;
}

async function runPipelineStep(
  client: GhlProvisioningClient,
  blueprint: GhlBlueprint,
  result: ProvisionStepResult
): Promise<void> {
  const pipelines = await client.listPipelines();
  const existing = pipelines.find(
    (p) => p.name.toLowerCase() === blueprint.pipeline.name.toLowerCase()
  );

  if (!existing) {
    await client.createPipeline(blueprint.pipeline.name, blueprint.pipeline.stages);
    result.created = 1;
  } else {
    const existingNames = new Set(existing.stages.map((s) => s.name.toLowerCase()));
    const missing = blueprint.pipeline.stages.filter((s) => !existingNames.has(s.toLowerCase()));
    if (missing.length > 0) {
      // Full-replacement update: every existing stage keeps its id and its
      // position; blueprint-only stages are appended. Dropping or reordering
      // ids would delete stages and orphan their opportunities.
      await client.updatePipelineStages(existing.id, existing.name, [
        ...existing.stages.map((s, i) => ({ id: s.id, name: s.name, position: i })),
        ...missing.map((name, i) => ({ name, position: existing.stages.length + i })),
      ]);
      result.updated = 1;
    } else {
      result.skipped = 1;
    }
  }

  // Re-list for authoritative stage ids (create/update responses vary).
  const context = await resolvePipelineContext(client, blueprint);
  if (!context) {
    throw new Error(`Pipeline "${blueprint.pipeline.name}" not found after create/update`);
  }
  result.detail = { ...context };
}

async function runCustomFieldsStep(
  client: GhlProvisioningClient,
  blueprint: GhlBlueprint,
  result: ProvisionStepResult
): Promise<void> {
  const existing = await client.listCustomFields();
  const byName = new Map(existing.map((f) => [f.name.toLowerCase(), f]));
  const warnings: string[] = [];

  for (const field of blueprint.customFields) {
    const match = byName.get(field.name.toLowerCase());
    if (!match) {
      const created = await client.createCustomField(field);
      byName.set(field.name.toLowerCase(), created);
      result.created += 1;
    } else if (match.dataType !== field.dataType) {
      // Never mutate a live field's type — existing data could be lost.
      warnings.push(
        `Field "${field.name}" exists as ${match.dataType}, blueprint wants ${field.dataType} — left unchanged`
      );
      result.skipped += 1;
    } else {
      result.skipped += 1;
    }
  }

  result.detail = {
    fieldIdByName: Object.fromEntries([...byName].map(([name, f]) => [name, f.id])),
    ...(warnings.length ? { warnings } : {}),
  };
}

async function runTagsStep(
  client: GhlProvisioningClient,
  blueprint: GhlBlueprint,
  result: ProvisionStepResult
): Promise<void> {
  const existing = await client.listTags();
  // GHL stores tags lowercased; match accordingly.
  const names = new Set(existing.map((t) => t.name.toLowerCase()));
  for (const tag of blueprint.tags) {
    if (names.has(tag.toLowerCase())) {
      result.skipped += 1;
    } else {
      await client.createTag(tag);
      result.created += 1;
    }
  }
}

async function runDemoLeadsStep(
  client: GhlProvisioningClient,
  blueprint: GhlBlueprint,
  result: ProvisionStepResult
): Promise<void> {
  const leads = blueprint.demoLeads ?? [];
  if (leads.length === 0) return;

  // Field ids come fresh from the API rather than from the customFields step
  // detail — this step may run in a different attempt/process.
  const fields = await client.listCustomFields();
  const fieldIdByName = new Map(fields.map((f) => [f.name.toLowerCase(), f.id]));
  const warnings: string[] = [];
  const contactIdByEmail: Record<string, string> = {};

  for (const lead of leads) {
    const customFields: Array<{ id: string; field_value: string }> = [];
    for (const [name, value] of Object.entries(lead.customFields ?? {})) {
      const id = fieldIdByName.get(name.toLowerCase());
      if (id) {
        customFields.push({ id, field_value: value });
      } else {
        warnings.push(`Lead ${lead.email}: custom field "${name}" not found on location`);
      }
    }
    const { id, isNew } = await client.upsertContact(lead, customFields);
    contactIdByEmail[lead.email.toLowerCase()] = id;
    if (isNew) result.created += 1;
    else result.updated += 1;
  }

  result.detail = { contactIdByEmail, ...(warnings.length ? { warnings } : {}) };
}

async function runOpportunitiesStep(
  client: GhlProvisioningClient,
  blueprint: GhlBlueprint,
  run: ProvisionRun,
  result: ProvisionStepResult
): Promise<void> {
  const leads = (blueprint.demoLeads ?? []).filter((l) => l.opportunity);
  if (leads.length === 0) return;

  const context = await resolvePipelineContext(client, blueprint);
  if (!context) {
    throw new Error(
      `Pipeline "${blueprint.pipeline.name}" not found — pipeline step must succeed first`
    );
  }

  const demoLeadsDetail = run.steps.find((s) => s.step === 'demoLeads')?.detail;
  const contactIdByEmail = {
    ...((demoLeadsDetail?.contactIdByEmail as Record<string, string> | undefined) ?? {}),
  };

  for (const lead of leads) {
    const opportunity = lead.opportunity;
    if (!opportunity) continue;

    // Persisted contact map first; fall back to re-upsert (idempotent) if this
    // resume lost it.
    let contactId = contactIdByEmail[lead.email.toLowerCase()];
    if (!contactId) {
      contactId = (await client.upsertContact(lead, [])).id;
      contactIdByEmail[lead.email.toLowerCase()] = contactId;
    }

    const existing = await client.searchOpportunitiesByContact(contactId);
    if (existing.some((o) => o.pipelineId === context.pipelineId)) {
      result.skipped += 1;
      continue;
    }

    const stageId = context.stageIdByName[opportunity.stage.toLowerCase()];
    if (!stageId) {
      throw new Error(
        `Stage "${opportunity.stage}" missing from pipeline "${blueprint.pipeline.name}"`
      );
    }
    await client.createOpportunity({
      pipelineId: context.pipelineId,
      pipelineStageId: stageId,
      contactId,
      name: opportunity.name,
      monetaryValue: opportunity.monetaryValue,
    });
    result.created += 1;
  }

  result.detail = { pipelineId: context.pipelineId, contactIdByEmail };
}

export class GhlProvisioningService {
  async applyBlueprint(opts: ApplyBlueprintOptions): Promise<ProvisionRun> {
    const { clientId, runId, blueprint, conn, attempt } = opts;

    const config = await resolveAdapterConfig(conn);
    const accessToken = config.accessToken as string | undefined;
    const locationId = config.locationId as string | undefined;
    if (!accessToken || !locationId) {
      throw new Error(`CRM connection ${conn.id} has no GHL OAuth credentials`);
    }
    const client = new GhlProvisioningClient({ accessToken, locationId });

    const { run } = await loadRun(clientId, conn.id, runId, blueprint.name);
    run.status = 'pending';

    await eventBus.publish({
      type: 'crm.provision.started',
      clientId,
      payload: { runId, blueprintName: blueprint.name, attempt },
      source: 'crm',
      // Upsert on idempotency_key dedupes the started event across retries.
      idempotencyKey: buildIdempotencyKey('provision-started', runId),
    });

    for (const step of run.steps) {
      if (step.status === 'success') continue; // resume: never redo finished steps

      // Reset counters from a failed prior attempt — the step re-derives all
      // of its state, so stale numbers would double-count.
      step.status = 'pending';
      step.created = 0;
      step.updated = 0;
      step.skipped = 0;
      step.error = undefined;

      try {
        switch (step.step) {
          case 'pipeline':
            await runPipelineStep(client, blueprint, step);
            break;
          case 'customFields':
            await runCustomFieldsStep(client, blueprint, step);
            break;
          case 'tags':
            await runTagsStep(client, blueprint, step);
            break;
          case 'demoLeads':
            await runDemoLeadsStep(client, blueprint, step);
            break;
          case 'opportunities':
            await runOpportunitiesStep(client, blueprint, run, step);
            break;
        }
        step.status = 'success';
        await persistProvisionRun(run, { attempts: attempt });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        step.status = 'failed';
        step.error = message;

        if (err instanceof GhlAuthError) {
          // The install is dead — retrying cannot help. Flag the connection,
          // park the run for manual review, and stop BullMQ from retrying.
          await supabase
            .from('crm_connections')
            .update({ needs_reauth: true })
            .eq('id', conn.id);
          await markRunManualReview(run, { attempts: attempt, errorMessage: message });
          logger.warn({ runId, clientId, step: step.step }, 'GHL 401 — connection needs re-auth');
          throw new UnrecoverableError(message);
        }

        run.status = 'failed';
        await persistProvisionRun(run, { attempts: attempt, errorMessage: message });
        logger.error({ runId, clientId, step: step.step, err }, 'Provision step failed');
        throw err instanceof Error ? err : new Error(message);
      }
    }

    run.status = 'success';
    await persistProvisionRun(run, { attempts: attempt });
    await eventBus.publish({
      type: 'crm.provision.completed',
      clientId,
      payload: {
        runId,
        blueprintName: blueprint.name,
        steps: run.steps.map(({ step, created, updated, skipped }) => ({
          step,
          created,
          updated,
          skipped,
        })),
      },
      source: 'crm',
      idempotencyKey: buildIdempotencyKey('provision-completed', runId),
    });
    logger.info({ runId, clientId, blueprint: blueprint.name }, 'Provision run complete');
    return run;
  }
}

export const ghlProvisioningService = new GhlProvisioningService();

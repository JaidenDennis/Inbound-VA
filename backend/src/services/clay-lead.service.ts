import { z } from 'zod';
import { supabase } from '../db/index.js';
import { crmSyncQueue } from '../queues/index.js';
import { buildIdempotencyKey, logger } from '../utils/index.js';
import { env } from '../config/index.js';
import { contactService } from './contact.service.js';
import type { CrmConnection } from '../types/index.js';

/**
 * Clay → CRM outbound lead ingest.
 *
 * Clay's HTTP API column fires one request per table row as the row finishes
 * enriching. This turns that row into a contact in our database and hands the
 * CRM write to the crm-sync queue, so the lead inherits the same retries,
 * idempotency, dead-lettering and crm_sync_logs trail as voice-captured leads
 * instead of depending on Clay to get the write right.
 *
 * Nothing here is CRM-specific: the queue resolves whichever adapter the
 * client's active connection names.
 */

/** Clay writes empty cells as "" — treat those as absent, not as bad input. */
function optional<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    schema.optional()
  );
}

export const clayLeadSchema = z
  .object({
    /** Defaults to CLAY_DEFAULT_CLIENT_ID (Gravvia's own outbound sub-account). */
    clientId: optional(z.string().uuid()),
    /** Clay's row id — the idempotency anchor for re-runs of the same row. */
    recordId: optional(z.string()),

    firstName: optional(z.string().trim()),
    lastName: optional(z.string().trim()),
    /** Used when Clay only has a single name column. */
    fullName: optional(z.string().trim()),
    email: optional(z.string().trim().email()),
    phone: optional(z.string().trim()),

    company: optional(z.string().trim()),
    jobTitle: optional(z.string().trim()),
    industry: optional(z.string().trim()),
    linkedinUrl: optional(z.string().trim()),
    website: optional(z.string().trim()),
    callVolume: optional(z.coerce.number().int().nonnegative()),
    /** Free text: the CRM validates it against its own picklist. */
    interest: optional(z.string().trim()),

    /** Opportunity title; defaults to "<company or name> — <configured label>". */
    opportunityName: optional(z.string().trim()),
    value: optional(z.coerce.number().nonnegative()),
    source: optional(z.string().trim()),
    tags: optional(z.array(z.string().trim().min(1))),
    /** Research/context from Clay — lands as a note on the CRM contact. */
    notes: optional(z.string().trim()),
    /** Extra CRM custom fields, keyed by the names in custom_field_mapping. */
    customFields: optional(z.record(z.unknown())),
  })
  .refine((v) => Boolean(v.email || v.phone), {
    message: 'A lead needs at least an email or a phone number',
  });

export type ClayLeadInput = z.infer<typeof clayLeadSchema>;

export interface ClayLeadResult {
  queued: true;
  clientId: string;
  contactId: string;
  jobId: string;
  noteJobId?: string;
}

/** Ingest failure with the HTTP status the route should answer with. */
export class ClayIngestError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
    this.name = 'ClayIngestError';
  }
}

const DEFAULT_SOURCE = 'clay-outbound';
const DEFAULT_OPPORTUNITY_LABEL = 'Outbound Lead';
const DEFAULT_TAGS = ['clay', 'outbound-lead'];

/**
 * Internal custom-field names for the enrichment Clay supplies. These are
 * translated to CRM field keys by crm_connections.custom_field_mapping, and
 * the names themselves are overridable per connection via
 * crm_config.clayFieldNames so no client's field naming lives in source.
 */
const DEFAULT_FIELD_NAMES = {
  industry: 'Company Industry',
  callVolume: 'Current Call Volume',
  interest: 'Interest Level',
} as const;

export class ClayLeadService {
  async ingest(input: ClayLeadInput): Promise<ClayLeadResult> {
    const clientId = input.clientId ?? env.CLAY_DEFAULT_CLIENT_ID;
    if (!clientId) {
      throw new ClayIngestError(
        400,
        'No clientId in the payload and CLAY_DEFAULT_CLIENT_ID is not set'
      );
    }

    const conn = await activeConnection(clientId);
    if (!conn) {
      throw new ClayIngestError(404, `No active CRM connection for client ${clientId}`);
    }
    if (conn.needs_reauth) {
      throw new ClayIngestError(
        409,
        'CRM connection needs re-authorization — re-run the install before ingesting leads'
      );
    }

    const crmConfig = conn.crm_config ?? {};
    const { firstName, lastName } = splitName(input);
    const phone = normalizePhone(input.phone);
    const email = input.email?.toLowerCase();
    const source = input.source ?? DEFAULT_SOURCE;

    const fieldNames = {
      ...DEFAULT_FIELD_NAMES,
      ...((crmConfig.clayFieldNames as Record<string, string> | undefined) ?? {}),
    };
    const customFields: Record<string, unknown> = {
      ...(input.industry ? { [fieldNames.industry]: input.industry } : {}),
      ...(input.callVolume !== undefined
        ? { [fieldNames.callVolume]: String(input.callVolume) }
        : {}),
      ...(input.interest ? { [fieldNames.interest]: input.interest } : {}),
      ...(input.customFields ?? {}),
    };

    // Only write fields this payload actually carries: a lead can arrive from
    // Clay more than once with different columns filled in (and may already
    // exist from an inbound call), so absent values must not blank the record.
    const contact = await contactService.upsertByIdentity(
      clientId,
      { phone, email },
      {
        ...(firstName ? { first_name: firstName } : {}),
        ...(lastName ? { last_name: lastName } : {}),
        ...(email ? { email } : {}),
        ...(input.company ? { company: input.company } : {}),
        tags: [...new Set([...DEFAULT_TAGS, ...(input.tags ?? [])])],
        ...(Object.keys(customFields).length ? { custom_fields: customFields } : {}),
      }
    );

    // Re-running the same Clay row must not create a second opportunity, so the
    // job id is anchored on Clay's row id when it sends one.
    const anchor = input.recordId ?? email ?? phone ?? contact.id;
    const jobId = buildIdempotencyKey('clay-lead', clientId, anchor);

    const label = (crmConfig.outboundOpportunityLabel as string) ?? DEFAULT_OPPORTUNITY_LABEL;
    const personName = [firstName, lastName].filter(Boolean).join(' ').trim();
    const subject = input.company ?? (personName || email);

    await crmSyncQueue.add(
      'clay-lead',
      {
        clientId,
        crmConnectionId: conn.id,
        entityType: 'lead',
        entityId: contact.id,
        operation: 'create',
        payload: {
          contactId: contact.id,
          title: input.opportunityName ?? `${subject} — ${label}`,
          source,
          ...(input.value !== undefined ? { value: input.value } : {}),
          // Outbound belongs in its own pipeline/stage when configured;
          // otherwise the connection's defaults apply (adapter-side).
          ...(crmConfig.outboundPipelineId
            ? { pipelineId: crmConfig.outboundPipelineId as string }
            : {}),
          ...(crmConfig.outboundStageId ? { stageId: crmConfig.outboundStageId as string } : {}),
        },
        idempotencyKey: jobId,
      },
      { jobId }
    );

    // Clay's research is what makes the lead actionable for a rep, so it rides
    // along as a CRM note rather than being dropped on the floor.
    const noteBody = buildNoteBody(input, source);
    let noteJobId: string | undefined;
    if (noteBody) {
      noteJobId = buildIdempotencyKey('clay-lead-note', clientId, anchor);
      await crmSyncQueue.add(
        'clay-lead-note',
        {
          clientId,
          crmConnectionId: conn.id,
          entityType: 'note',
          entityId: contact.id,
          operation: 'create',
          payload: { contactId: contact.id, body: noteBody, createdAt: new Date().toISOString() },
          idempotencyKey: noteJobId,
        },
        { jobId: noteJobId }
      );
    }

    logger.info({ clientId, contactId: contact.id, jobId, source }, 'Clay lead queued for CRM sync');
    return { queued: true, clientId, contactId: contact.id, jobId, ...(noteJobId ? { noteJobId } : {}) };
  }
}

/** The client's active CRM connection, whichever adapter it names. */
async function activeConnection(clientId: string): Promise<CrmConnection | null> {
  const { data } = await supabase
    .from('crm_connections')
    .select('*')
    .eq('client_id', clientId)
    .eq('is_active', true)
    .maybeSingle();
  return (data as CrmConnection | null) ?? null;
}

/** Explicit first/last wins; otherwise split a single name column on the first space. */
function splitName(input: ClayLeadInput): { firstName: string; lastName: string } {
  if (input.firstName || input.lastName) {
    return { firstName: input.firstName ?? '', lastName: input.lastName ?? '' };
  }
  const parts = (input.fullName ?? '').split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') };
}

/**
 * Best-effort E.164. Clay exports arrive in mixed shapes ("(904) 760-5971",
 * "9047605971"); anything already carrying a country code is left alone, and
 * unrecognized shapes pass through for the CRM to judge.
 */
function normalizePhone(raw?: string): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (trimmed.startsWith('+')) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return trimmed;
}

/** Rep-facing context that has no dedicated CRM field. */
function buildNoteBody(input: ClayLeadInput, source: string): string | null {
  const lines = [
    input.company ? `Company: ${input.company}` : null,
    input.jobTitle ? `Title: ${input.jobTitle}` : null,
    input.linkedinUrl ? `LinkedIn: ${input.linkedinUrl}` : null,
    input.website ? `Website: ${input.website}` : null,
    input.notes ? `\n${input.notes}` : null,
  ].filter(Boolean);

  if (lines.length === 0) return null;
  return `🧪 Lead from ${source}\n\n${lines.join('\n')}`;
}

export const clayLeadService = new ClayLeadService();

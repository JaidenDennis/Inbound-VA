import axios, { type AxiosInstance, type AxiosRequestConfig, isAxiosError } from 'axios';
import { createRateLimiter, logger } from '../utils/index.js';
import type { GhlBlueprintCustomField, GhlBlueprintDemoLead } from '../types/index.js';

/**
 * Thin GHL v2 client for blueprint provisioning (pipelines, custom fields,
 * tags, contacts, opportunities). Deliberately separate from the
 * GoHighLevelAdapter: adapters return CrmSyncResult envelopes for the
 * cross-CRM sync path, while provisioning needs raw responses and thrown
 * typed errors so the service can distinguish auth failures (re-install
 * required) from retryable ones.
 */

const DEFAULT_BASE_URL = 'https://services.leadconnectorhq.com';
const API_VERSION = '2021-07-28';

// GHL allows ~100 requests / 10 s burst per location; 200 ms spacing (≤5/s)
// stays well under it. Limiters are shared per location so concurrent runs
// (or a run + smoke test) against the same sub-account share one budget.
const MIN_REQUEST_INTERVAL_MS = 200;
const limiters = new Map<string, () => Promise<void>>();

function limiterFor(locationId: string): () => Promise<void> {
  let limiter = limiters.get(locationId);
  if (!limiter) {
    limiter = createRateLimiter(MIN_REQUEST_INTERVAL_MS);
    limiters.set(locationId, limiter);
  }
  return limiter;
}

const RETRY_AFTER_CAP_MS = 30_000;
const MAX_429_RETRIES = 2;

export class GhlApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: unknown
  ) {
    super(message);
    this.name = 'GhlApiError';
  }
}

/** 401: the OAuth install is dead (revoked/uninstalled) — re-install required. */
export class GhlAuthError extends GhlApiError {
  constructor(message: string, body?: unknown) {
    super(message, 401, body);
    this.name = 'GhlAuthError';
  }
}

export interface GhlPipelineStage {
  id: string;
  name: string;
  position?: number;
}

export interface GhlPipelineDetail {
  id: string;
  name: string;
  stages: GhlPipelineStage[];
}

export interface GhlCustomField {
  id: string;
  name: string;
  dataType: string;
}

export interface GhlTag {
  id: string;
  name: string;
}

export interface GhlOpportunity {
  id: string;
  name: string;
  pipelineId: string;
  contactId?: string;
}

export interface GhlProvisioningConfig {
  accessToken: string;
  locationId: string;
  baseUrl?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class GhlProvisioningClient {
  private readonly http: AxiosInstance;
  private readonly locationId: string;
  private readonly throttle: () => Promise<void>;

  constructor(config: GhlProvisioningConfig) {
    this.locationId = config.locationId;
    this.throttle = limiterFor(config.locationId);
    this.http = axios.create({
      baseURL: config.baseUrl ?? DEFAULT_BASE_URL,
      timeout: 15000,
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        Version: API_VERSION,
        'Content-Type': 'application/json',
      },
    });
  }

  private async request<T>(config: AxiosRequestConfig, attempt = 0): Promise<T> {
    await this.throttle();
    try {
      const { data } = await this.http.request<T>(config);
      return data;
    } catch (err) {
      if (!isAxiosError(err)) throw err;
      const status = err.response?.status;
      const body: unknown = err.response?.data;

      if (status === 401) {
        throw new GhlAuthError(`GHL rejected credentials for ${config.url}`, body);
      }
      if (status === 429 && attempt < MAX_429_RETRIES) {
        const retryAfterSec = Number(err.response?.headers?.['retry-after']);
        const waitMs = Math.min(
          Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : 10_000,
          RETRY_AFTER_CAP_MS
        );
        logger.warn(
          { url: config.url, waitMs, attempt: attempt + 1 },
          'GHL rate limit hit — backing off'
        );
        await sleep(waitMs);
        return this.request<T>(config, attempt + 1);
      }
      throw new GhlApiError(
        `GHL ${config.method ?? 'GET'} ${config.url} failed${status ? ` (${status})` : ''}: ${err.message}`,
        status,
        body
      );
    }
  }

  async listPipelines(): Promise<GhlPipelineDetail[]> {
    const data = await this.request<{ pipelines?: GhlPipelineDetail[] }>({
      method: 'GET',
      url: '/opportunities/pipelines',
      params: { locationId: this.locationId },
    });
    return (data.pipelines ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      stages: (p.stages ?? []).map((s) => ({ id: s.id, name: s.name, position: s.position })),
    }));
  }

  async createPipeline(name: string, stageNames: string[]): Promise<GhlPipelineDetail> {
    const data = await this.request<{ pipeline?: GhlPipelineDetail } & Partial<GhlPipelineDetail>>({
      method: 'POST',
      url: '/opportunities/pipelines',
      data: {
        locationId: this.locationId,
        name,
        stages: stageNames.map((stageName, position) => ({ name: stageName, position })),
      },
    });
    return (data.pipeline ?? data) as GhlPipelineDetail;
  }

  /**
   * Full-replacement stage update. Callers MUST pass every existing stage
   * with its id (in existing order) plus any new stages — a stage omitted
   * from the array is deleted and its opportunities orphaned.
   */
  async updatePipelineStages(
    pipelineId: string,
    name: string,
    stages: Array<{ id?: string; name: string; position: number }>
  ): Promise<void> {
    await this.request({
      method: 'PUT',
      url: `/opportunities/pipelines/${pipelineId}`,
      data: { locationId: this.locationId, name, stages },
    });
  }

  async listCustomFields(): Promise<GhlCustomField[]> {
    const data = await this.request<{ customFields?: GhlCustomField[] }>({
      method: 'GET',
      url: `/locations/${this.locationId}/customFields`,
      params: { model: 'contact' },
    });
    return data.customFields ?? [];
  }

  async createCustomField(field: GhlBlueprintCustomField): Promise<GhlCustomField> {
    const data = await this.request<{ customField?: GhlCustomField } & Partial<GhlCustomField>>({
      method: 'POST',
      url: `/locations/${this.locationId}/customFields`,
      data: {
        name: field.name,
        dataType: field.dataType,
        model: 'contact',
        ...(field.options ? { options: field.options } : {}),
      },
    });
    return (data.customField ?? data) as GhlCustomField;
  }

  async listTags(): Promise<GhlTag[]> {
    const data = await this.request<{ tags?: GhlTag[] }>({
      method: 'GET',
      url: `/locations/${this.locationId}/tags`,
    });
    return data.tags ?? [];
  }

  async createTag(name: string): Promise<GhlTag> {
    const data = await this.request<{ tag?: GhlTag } & Partial<GhlTag>>({
      method: 'POST',
      url: `/locations/${this.locationId}/tags`,
      data: { name },
    });
    return (data.tag ?? data) as GhlTag;
  }

  /**
   * Upserts by email OR phone (GHL-side dedupe). customFields must already be
   * mapped from blueprint field names to GHL field ids by the caller.
   */
  async upsertContact(
    lead: GhlBlueprintDemoLead,
    customFields: Array<{ id: string; field_value: string }>
  ): Promise<{ id: string; isNew: boolean }> {
    const data = await this.request<{ contact?: { id: string }; new?: boolean }>({
      method: 'POST',
      url: '/contacts/upsert',
      data: {
        locationId: this.locationId,
        firstName: lead.firstName,
        lastName: lead.lastName,
        email: lead.email,
        phone: lead.phone,
        ...(lead.tags?.length ? { tags: lead.tags } : {}),
        ...(customFields.length ? { customFields } : {}),
      },
    });
    const id = data.contact?.id;
    if (!id) throw new GhlApiError('GHL contact upsert returned no contact id', undefined, data);
    return { id, isNew: data.new === true };
  }

  async searchOpportunitiesByContact(contactId: string): Promise<GhlOpportunity[]> {
    const data = await this.request<{ opportunities?: GhlOpportunity[] }>({
      method: 'GET',
      url: '/opportunities/search',
      params: { location_id: this.locationId, contact_id: contactId },
    });
    return data.opportunities ?? [];
  }

  async createOpportunity(opportunity: {
    pipelineId: string;
    pipelineStageId: string;
    contactId: string;
    name: string;
    monetaryValue?: number;
  }): Promise<GhlOpportunity> {
    const data = await this.request<{ opportunity?: GhlOpportunity } & Partial<GhlOpportunity>>({
      method: 'POST',
      url: '/opportunities/',
      data: {
        locationId: this.locationId,
        pipelineId: opportunity.pipelineId,
        pipelineStageId: opportunity.pipelineStageId,
        contactId: opportunity.contactId,
        name: opportunity.name,
        status: 'open',
        ...(opportunity.monetaryValue !== undefined
          ? { monetaryValue: opportunity.monetaryValue }
          : {}),
      },
    });
    return (data.opportunity ?? data) as GhlOpportunity;
  }

  /** Smoke-test cleanup only. */
  async deleteContact(contactId: string): Promise<void> {
    await this.request({ method: 'DELETE', url: `/contacts/${contactId}` });
  }

  /** Smoke-test cleanup only. */
  async deleteOpportunity(opportunityId: string): Promise<void> {
    await this.request({ method: 'DELETE', url: `/opportunities/${opportunityId}` });
  }
}

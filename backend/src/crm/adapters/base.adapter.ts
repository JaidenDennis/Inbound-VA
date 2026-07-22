import axios, { type AxiosInstance } from 'axios';
import { logger } from '../../utils/index.js';
import type { CrmSyncResult } from '../../types/index.js';

// Note: concrete adapters extend this and satisfy ICrmAdapter structurally.
// The base intentionally does not `implements ICrmAdapter` since it only
// provides shared helpers + the abstract testConnection().
export abstract class BaseCrmAdapter {
  abstract readonly name: string;
  protected http: AxiosInstance;
  protected config: Record<string, unknown>;

  constructor(config: Record<string, unknown>) {
    this.config = config;
    this.http = axios.create({ timeout: 15000 });
    this.http.interceptors.response.use(
      (r) => r,
      (err) => {
        logger.error(
          { adapter: this.name, status: err.response?.status, url: err.config?.url },
          'CRM HTTP error'
        );
        return Promise.reject(err);
      }
    );
  }

  protected success(externalId?: string, metadata?: Record<string, unknown>): CrmSyncResult {
    return { success: true, externalId, metadata };
  }

  protected failure(error: unknown): CrmSyncResult {
    // Surface the CRM's own error body (e.g. GHL's { message }) not just
    // "Request failed with status code 4xx" — essential for diagnosing sync
    // failures in production logs and manual-review triage.
    const ax = error as {
      response?: { status?: number; data?: { message?: string | string[]; error?: string } };
    };
    const body = ax.response?.data;
    const detail =
      (Array.isArray(body?.message) ? body?.message.join('; ') : body?.message) ??
      body?.error ??
      (error instanceof Error ? error.message : String(error));
    const status = ax.response?.status;
    return { success: false, error: status ? `${status}: ${detail}` : detail };
  }

  abstract testConnection(): Promise<boolean>;
}

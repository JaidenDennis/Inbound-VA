import axios, { type AxiosInstance } from 'axios';
import { logger } from '../../utils/index.js';

// Concrete adapters extend this and satisfy ICalendarAdapter structurally.
export abstract class BaseCalendarAdapter {
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
          'Calendar HTTP error'
        );
        return Promise.reject(err);
      }
    );
  }

  abstract testConnection(): Promise<boolean>;
}

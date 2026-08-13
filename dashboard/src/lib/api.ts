import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('gravvia_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/**
 * The backend's Zod handler (backend/src/app.ts) answers a failed `.parse()`
 * with `{ error: 'Validation failed', details: { field: [message, ...] } }`.
 * Reading only `.error` throws away the one part a person can act on, so the
 * user is told a validation failed without being told which field — and so is
 * anyone trying to diagnose it from a bug report.
 *
 * Field names are the API's snake_case keys rather than the form's labels.
 * That is deliberate: it keeps the message truthful about what the server
 * rejected, and a mapping table here would silently rot as fields are added.
 */
export function errorMessage(e: unknown, fallback = 'Something went wrong'): string {
  const data = (e as { response?: { data?: { error?: string; details?: unknown } } })?.response?.data;
  if (!data) return fallback;

  const base = data.error ?? fallback;
  const details = data.details;
  if (!details || typeof details !== 'object') return base;

  const fields = Object.entries(details as Record<string, unknown>)
    .map(([field, messages]) => {
      const first = Array.isArray(messages) ? messages[0] : messages;
      return typeof first === 'string' ? `${field} — ${first}` : field;
    })
    // Two named fields is enough to act on; a wall of them is not readable in
    // a toast, and the rest are usually the same mistake repeated.
    .slice(0, 2);

  return fields.length ? `${base}: ${fields.join('; ')}` : base;
}

/**
 * Pull the filename out of a Content-Disposition header.
 *
 * The server names exports after the business, and a blob download only keeps
 * that name if `link.download` is set from it — anything else silently
 * overrides the header. Reading it back keeps one source of truth.
 *
 * Requires `content-disposition` in the API's CORS `exposedHeaders`; without
 * that the browser hides it from JS and this quietly returns the fallback.
 * Handles RFC 5987 `filename*=UTF-8''…` first, since a business name with an
 * accent arrives that way.
 */
export function filenameFromDisposition(header: unknown, fallback: string): string {
  if (typeof header !== 'string') return fallback;

  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (encoded?.[1]) {
    try {
      return decodeURIComponent(encoded[1].trim());
    } catch {
      // A malformed escape sequence is not worth failing a download over.
    }
  }

  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1]?.trim() || fallback;
}

api.interceptors.response.use(
  (r) => r,
  (err) => {
    // A 401 from the login attempt itself must surface as a form error, not a
    // redirect — reloading /login here wipes the "Invalid credentials" message.
    const isLoginRequest = err.config?.url?.includes('/auth/login');
    if (
      err.response?.status === 401 &&
      typeof window !== 'undefined' &&
      !isLoginRequest &&
      window.location.pathname !== '/login'
    ) {
      localStorage.removeItem('gravvia_token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

/**
 * Deep redaction for anything persisted to `system_errors`.
 *
 * pino's redact only covers what goes to stdout. Error rows are different: they
 * are stored, queryable, and readable by anyone holding `system:read`. Error
 * contexts routinely carry live credentials — a CRM adapter throwing with the
 * request config attached, an OAuth refresh failing with the token in the
 * message — so everything is scrubbed on the way in, not on the way out.
 */

const REDACTED = '[Redacted]';

/** Key names whose value is always a secret, matched case-insensitively. */
const SECRET_KEY_PATTERN =
  /(authorization|cookie|password|passwd|pwd|token|secret|api[-_]?key|credential|private[-_]?key|client[-_]?secret|session[-_]?id|signature)/i;

/** PII that must not accumulate in an error store. */
const PII_KEY_PATTERN = /(^|_)(dob|date_of_birth|ssn|social_security)($|_)/i;

/**
 * Secret-shaped values, for when the secret is in free text rather than under a
 * telling key — `Bearer eyJ...`, a raw JWT, a `pit-`/`sk_` style API key.
 */
const VALUE_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /Basic\s+[A-Za-z0-9+/]+=*/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, // JWT
  // Provider keys keep an environment segment (`sk_live_…`, `pit-…`), so the
  // tail has to allow separators, not just alphanumerics.
  /\b(?:sk|pk|pit|rk|key)[-_][A-Za-z0-9][A-Za-z0-9_-]{15,}\b/gi,
  /\bghp_[A-Za-z0-9]{20,}\b/g,
];

const MAX_DEPTH = 6;
const MAX_STRING_LENGTH = 8_000;

/** Scrub secret-shaped substrings out of free text. */
export function redactText(input: string): string {
  let out = input;
  for (const pattern of VALUE_PATTERNS) out = out.replace(pattern, REDACTED);
  return out.length > MAX_STRING_LENGTH ? out.slice(0, MAX_STRING_LENGTH) + '…[truncated]' : out;
}

function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactText(value.message),
      stack: value.stack ? redactText(value.stack) : undefined,
    };
  }

  if (depth >= MAX_DEPTH) return '[Truncated: max depth]';

  if (typeof value === 'object') {
    // Cycles are common in error contexts (axios attaches request → response →
    // request). Without this the redactor would recurse until the stack blows.
    if (seen.has(value as object)) return '[Circular]';
    seen.add(value as object);

    if (Array.isArray(value)) {
      return value.slice(0, 100).map((v) => redactValue(v, depth + 1, seen));
    }

    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(key) || PII_KEY_PATTERN.test(key)) {
        out[key] = REDACTED;
        continue;
      }
      const redacted = redactValue(v, depth + 1, seen);
      if (redacted !== undefined) out[key] = redacted;
    }
    return out;
  }

  return String(value);
}

/** Redact an arbitrary object destined for the `context` column. */
export function redactContext(context: unknown): Record<string, unknown> {
  const result = redactValue(context ?? {}, 0, new WeakSet());
  return typeof result === 'object' && result !== null && !Array.isArray(result)
    ? (result as Record<string, unknown>)
    : { value: result };
}

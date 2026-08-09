import { supabase } from '../db/index.js';
import { env } from '../config/index.js';
import { logger, sendMail } from '../utils/index.js';
import { integrationHealth } from './integrationHealth.service.js';

/**
 * Threshold alerting (migration 027).
 *
 * The dashboard tells whoever opens it what happened. Most owners do not open
 * it — the design doc says so itself — so a containment collapse or a dead CRM
 * sync sits unnoticed until a customer complains. This is the half of the
 * product that works when nobody is looking.
 *
 * THREE THINGS THAT MAKE ALERTING TRUSTWORTHY, all enforced here:
 *
 *  - It does not nag. A condition that persists fires once per cooldown, not
 *    once per sweep. An alert that arrives every five minutes gets filtered, and
 *    a filtered alert is worse than none because everyone believes it is on.
 *  - It does not fire on nothing. Every metric has a minimum sample below which
 *    it stays quiet: one transferred call out of two is not a containment
 *    collapse, and a rule that cries wolf on a slow morning gets turned off.
 *  - It records what it sent. `client_alert_events` keeps the observed value
 *    beside the threshold, and whether the email actually went out — the mailer
 *    degrades to a no-op without SMTP_PASS, so "we alerted" and "they were told"
 *    are different facts.
 */

export const ALERT_METRICS = [
  'containment_drop',
  'integration_down',
  'escalation_spike',
  'missed_revenue',
] as const;

export type AlertMetric = (typeof ALERT_METRICS)[number];

export interface AlertRule {
  id: string;
  client_id: string;
  metric: AlertMetric;
  threshold: number;
  window_minutes: number;
  cooldown_minutes: number;
  enabled: boolean;
  recipients: string[];
  last_fired_at: string | null;
}

/**
 * What each metric means, which way it fires, and the sample it needs.
 *
 * `minSample` is the anti-noise floor and the most important column here. It is
 * per metric because the meaningful sample differs: two calls can tell you a CRM
 * is down, and cannot tell you anything about a containment rate.
 */
const METRIC_SPEC: Record<
  AlertMetric,
  { label: string; unit: string; direction: 'below' | 'above'; minSample: number; describe: (observed: number, threshold: number) => string }
> = {
  containment_drop: {
    label: 'Containment dropped',
    unit: '%',
    direction: 'below',
    minSample: 10,
    describe: (o, t) =>
      `The agent handled ${o}% of calls without a person, below your ${t}% threshold. ` +
      'Check the escalation reasons on the Business page — a single missing fact often explains a run of transfers.',
  },
  integration_down: {
    label: 'An integration stopped working',
    unit: '',
    direction: 'above',
    minSample: 0,
    describe: (o) =>
      `${o} integration${o === 1 ? ' is' : 's are'} failing or stalled. ` +
      'Open Connections to see which, and when it last worked.',
  },
  escalation_spike: {
    label: 'Escalations spiked',
    unit: '',
    direction: 'above',
    minSample: 5,
    describe: (o, t) =>
      `${o} calls reached a person, above your threshold of ${t}. ` +
      'This usually means the agent is missing something it is being asked for repeatedly.',
  },
  missed_revenue: {
    label: 'Requested services you do not offer',
    unit: '',
    direction: 'above',
    minSample: 0,
    describe: (o, t) =>
      `Callers asked for services worth an estimated ${o} that you do not currently sell or price, above your ${t} threshold. ` +
      'The Demand tab lists them.',
  },
};

export function metricLabel(metric: AlertMetric): string {
  return METRIC_SPEC[metric].label;
}

/** Rules due for evaluation: enabled, and past their cooldown. */
export async function dueRules(now = new Date()): Promise<AlertRule[]> {
  const { data, error } = await supabase
    .from('client_alert_rules')
    .select('id, client_id, metric, threshold, window_minutes, cooldown_minutes, enabled, recipients, last_fired_at')
    .eq('enabled', true);

  if (error) throw new Error(`Failed to read alert rules: ${error.message}`);

  return ((data ?? []) as AlertRule[]).filter((rule) => {
    if (!rule.last_fired_at) return true;
    const next = Date.parse(rule.last_fired_at) + rule.cooldown_minutes * 60_000;
    return now.getTime() >= next;
  });
}

interface Observation {
  /** null means not measurable right now — never treated as a breach. */
  value: number | null;
  /** How much data the figure rests on, against the metric's minimum. */
  sample: number;
}

/**
 * Measure one metric for one client over its window.
 *
 * Exported so the evaluator can be tested without a live database round trip
 * through the whole worker.
 */
export async function observe(rule: AlertRule, now = new Date()): Promise<Observation> {
  const to = now.toISOString();
  const from = new Date(now.getTime() - rule.window_minutes * 60_000).toISOString();

  switch (rule.metric) {
    case 'containment_drop': {
      const { data } = await supabase.rpc('report_trust', {
        p_client_id: rule.client_id,
        p_from: from,
        p_to: to,
      });
      const row = ((data ?? []) as Array<Record<string, unknown>>)[0] ?? {};
      const total = Number(row.total_calls ?? 0);
      if (total === 0) return { value: null, sample: 0 };
      const contained = total - Number(row.transferred_calls ?? 0);
      return { value: Math.round((contained / total) * 1000) / 10, sample: total };
    }

    case 'escalation_spike': {
      const { data } = await supabase.rpc('report_trust', {
        p_client_id: rule.client_id,
        p_from: from,
        p_to: to,
      });
      const row = ((data ?? []) as Array<Record<string, unknown>>)[0] ?? {};
      const total = Number(row.total_calls ?? 0);
      return { value: Number(row.transferred_calls ?? 0), sample: total };
    }

    case 'integration_down': {
      const health = await integrationHealth(rule.client_id);
      // `never` is not a fault — an integration nobody has used yet is not one
      // that stopped working, and alerting on it would fire for every new tenant
      // on their first day.
      const broken = health.filter((c) => c.status === 'failing' || c.status === 'stalled');
      return { value: broken.length, sample: health.length };
    }

    case 'missed_revenue': {
      const { data } = await supabase.rpc('report_lost_demand', {
        p_client_id: rule.client_id,
        p_from: from,
        p_to: to,
      });
      const rows = (data ?? []) as Array<Record<string, unknown>>;
      // Unpriced services contribute nothing rather than a guess.
      const value = rows.reduce((sum, r) => sum + Number(r.estimated_value ?? 0), 0);
      return { value: Math.round(value), sample: rows.length };
    }
  }
}

export function breaches(rule: AlertRule, observation: Observation): boolean {
  const spec = METRIC_SPEC[rule.metric];
  if (observation.value === null) return false;
  if (observation.sample < spec.minSample) return false;

  return spec.direction === 'below'
    ? observation.value < rule.threshold
    : observation.value > rule.threshold;
}

/** Rule recipients, or the client's notification list when none are set. */
async function recipientsFor(rule: AlertRule): Promise<string[]> {
  if (rule.recipients.length > 0) return rule.recipients;

  const { data } = await supabase
    .from('client_settings')
    .select('notification_emails')
    .eq('client_id', rule.client_id)
    .maybeSingle();

  const emails = (data as { notification_emails: string[] | null } | null)?.notification_emails ?? [];
  return emails.length > 0 ? emails : env.ALERT_EMAIL ? [env.ALERT_EMAIL] : [];
}

async function clientName(clientId: string): Promise<string> {
  const { data } = await supabase.from('clients').select('name').eq('id', clientId).maybeSingle();
  return (data as { name: string } | null)?.name ?? 'your account';
}

/**
 * Evaluate every due rule and notify on breaches.
 *
 * Returns what fired so the caller can log a count. One rule failing must not
 * stop the rest — a broken RPC for one tenant silencing every other tenant's
 * alerts is the failure mode this loop exists to avoid.
 */
export async function evaluateAlerts(now = new Date()): Promise<{ evaluated: number; fired: number }> {
  const rules = await dueRules(now);
  let fired = 0;

  for (const rule of rules) {
    try {
      const observation = await observe(rule, now);
      if (!breaches(rule, observation)) continue;

      const spec = METRIC_SPEC[rule.metric];
      const observed = observation.value as number;
      const message = spec.describe(observed, rule.threshold);
      const to = await recipientsFor(rule);
      const name = await clientName(rule.client_id);

      let notified = false;
      if (to.length > 0) {
        try {
          await sendMail({
            from: env.EMAIL_FROM,
            to: to.join(', '),
            subject: `[Gravvia] ${spec.label} — ${name}`,
            text:
              `${message}\n\n` +
              `Measured over the last ${rule.window_minutes} minutes.\n` +
              `Observed: ${observed}${spec.unit}   Threshold: ${rule.threshold}${spec.unit}\n\n` +
              `${env.DASHBOARD_URL}/dashboard/business\n\n` +
              `You are receiving this because an alert rule is set for this account. ` +
              `Change or turn it off under Settings → Alerts.`,
          });
          // sendMail resolves without sending when SMTP is unconfigured, so this
          // records "we attempted a real send", not "it was delivered".
          notified = Boolean(env.SMTP_PASS);
        } catch (err) {
          logger.error({ err, ruleId: rule.id }, 'alert email failed');
        }
      }

      await supabase.from('client_alert_events').insert({
        rule_id: rule.id,
        client_id: rule.client_id,
        metric: rule.metric,
        observed,
        threshold: rule.threshold,
        message,
        notified,
        recipients: to,
      });

      // Stamped even when the email failed: the condition was detected and
      // re-detecting it every five minutes produces a pile of rows, not a fix.
      await supabase
        .from('client_alert_rules')
        .update({ last_fired_at: now.toISOString() })
        .eq('id', rule.id);

      fired += 1;
    } catch (err) {
      logger.error({ err, ruleId: rule.id, metric: rule.metric }, 'alert rule evaluation failed');
    }
  }

  return { evaluated: rules.length, fired };
}

export const alertService = {
  evaluateAlerts,
  observe,
  breaches,
  dueRules,
  metricLabel,
  ALERT_METRICS,
};

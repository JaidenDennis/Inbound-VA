'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { Bot, BookOpen, ListChecks, Plug, Save } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { StatusPill } from '@/components/StatusPill';
import { useSession } from '@/lib/SessionProvider';
import { clientStatusTerm } from '@/lib/vocabulary';
import { BrandingPanel } from './BrandingPanel';

/**
 * The client record: who this tenant is and how calls reach them.
 *
 * Agent behaviour is *not* edited here. It lives at /clients/:id/agent, which
 * renders the real template, validates it, and publishes to Retell — this page
 * used to carry a raw `agent_prompt` textarea that bypassed all of that and
 * silently disagreed with what callers actually heard.
 *
 * Onboarding stages and client action items moved to /dashboard/onboarding/:id
 * for the same reason: one editor per thing, not two that drift.
 */

interface ClientSettings {
  booking_enabled: boolean;
  crm_type: string | null;
  notification_emails: string[] | null;
}

interface ClientDetail {
  id: string;
  name: string;
  slug: string;
  industry: string | null;
  timezone: string;
  phone_numbers: string[] | null;
  status: string;
  retell_agent_id: string | null;
  settings: ClientSettings | null;
}

const STATUSES = ['active', 'inactive', 'suspended'] as const;

const inputCls =
  'w-full border border-panel-300 bg-surface-raised px-3 py-2 text-sm text-ink-900 ' +
  'placeholder:text-panel-400 transition-colors duration-150 hover:border-panel-400 ' +
  'focus:border-signal-600 focus:outline-none focus:ring-2 focus:ring-signal-600/25 ' +
  'disabled:cursor-not-allowed disabled:bg-panel-50 disabled:text-panel-500';

function Field({
  label,
  id,
  hint,
  children,
}: {
  label: string;
  id: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink-800">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-panel-500">{hint}</p>}
    </div>
  );
}

/** Cards to the surfaces that own the rest of this client's configuration. */
function JumpCard({ href, icon: Icon, title, body }: { href: string; icon: typeof Bot; title: string; body: string }) {
  return (
    <Link
      href={href}
      className="group flex items-start gap-3 border border-panel-200 bg-surface-raised p-4 transition-colors duration-150 hover:border-panel-300 hover:bg-panel-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600"
    >
      <Icon className="mt-0.5 h-5 w-5 flex-shrink-0 text-panel-500 transition-colors group-hover:text-ink-700" aria-hidden strokeWidth={1.75} />
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink-900">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-panel-500">{body}</p>
      </div>
    </Link>
  );
}

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const canWrite = can('clients:write');

  const [client, setClient] = useState<ClientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingClient, setSavingClient] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [timezone, setTimezone] = useState('');
  const [phones, setPhones] = useState('');
  const [status, setStatus] = useState('active');

  const [bookingEnabled, setBookingEnabled] = useState(false);
  const [notifyEmails, setNotifyEmails] = useState('');

  useEffect(() => {
    api
      .get(`/clients/${id}`)
      .then((r) => {
        const c: ClientDetail = r.data;
        setClient(c);
        setName(c.name);
        setIndustry(c.industry ?? '');
        setTimezone(c.timezone ?? '');
        setPhones((c.phone_numbers ?? []).join(', '));
        setStatus(c.status);
        setBookingEnabled(!!c.settings?.booking_enabled);
        setNotifyEmails((c.settings?.notification_emails ?? []).join(', '));
      })
      .catch(() => setClient(null))
      .finally(() => setLoading(false));
  }, [id]);

  const saveClient = async () => {
    setSavingClient(true);
    try {
      await api.patch(`/clients/${id}`, {
        name,
        industry: industry || undefined,
        timezone: timezone || undefined,
        phone_numbers: phones.split(',').map((p) => p.trim()).filter(Boolean),
        status,
      });
      toast.success('Business details saved');
    } catch (e) {
      toast.error(errorMessage(e, 'Could not save'));
    } finally {
      setSavingClient(false);
    }
  };

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      await api.patch(`/clients/${id}/settings`, {
        booking_enabled: bookingEnabled,
        notification_emails: notifyEmails.split(',').map((e) => e.trim()).filter(Boolean),
      });
      toast.success('Operations settings saved');
    } catch (e) {
      toast.error(errorMessage(e, 'Could not save'));
    } finally {
      setSavingSettings(false);
    }
  };

  if (loading) return <div className="h-64 animate-pulse bg-panel-100" />;
  if (!client) {
    return (
      <div role="alert" className="border border-lamp-bad-rim bg-lamp-bad-wash px-4 py-3 text-sm text-lamp-bad-ink">
        That client could not be found.
      </div>
    );
  }

  const saveButtonCls =
    'flex cursor-pointer items-center gap-2 bg-action px-4 py-2 text-sm font-semibold text-[rgb(var(--action-contrast-rgb))] ' +
    'transition-colors duration-150 hover:bg-action-800 focus-visible:outline-none focus-visible:ring-2 ' +
    'focus-visible:ring-signal-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={client.name}
        description="The tenant record — identity, routing, and who gets notified."
        breadcrumbs={[
          { label: 'Clients', href: '/dashboard/clients' },
          { label: client.name },
        ]}
        action={
          <StatusPill
            tone={status === 'active' ? 'success' : status === 'suspended' ? 'warning' : 'neutral'}
            label={clientStatusTerm(status).label}
          />
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <JumpCard
          href={`/dashboard/clients/${id}/agent`}
          icon={Bot}
          title="Agent configuration"
          body="Voice, behaviour, greeting, and what gets published to Retell."
        />
        <JumpCard
          href={`/dashboard/knowledge?clientId=${id}`}
          icon={BookOpen}
          title="Knowledge base"
          body="FAQs, services, pricing, policies — what the agent can answer."
        />
        <JumpCard
          href={`/dashboard/onboarding/${id}`}
          icon={ListChecks}
          title="Onboarding"
          body="Launch stages and what you're waiting on this client for."
        />
        <JumpCard
          href={`/dashboard/connections?clientId=${id}`}
          icon={Plug}
          title="Connections"
          body="CRM and calendar integrations for this client."
        />
      </div>

      <section className="mb-6 border border-panel-200 bg-surface-raised">
        <h2 className="border-b border-panel-200 px-6 py-4 font-heading text-sm font-semibold text-ink-900">
          Business
        </h2>
        <div className="space-y-5 p-6">
          <Field label="Business name" id="name">
            <input id="name" className={inputCls} disabled={!canWrite} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Industry" id="industry" hint="Selects the agent template family.">
              <input id="industry" className={inputCls} disabled={!canWrite} value={industry} onChange={(e) => setIndustry(e.target.value)} />
            </Field>
            <Field label="Timezone" id="timezone" hint="Used for hours, bookings, and reporting.">
              <input id="timezone" className={inputCls} disabled={!canWrite} value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="America/New_York" />
            </Field>
          </div>

          <Field
            label="Phone numbers"
            id="phones"
            hint="Comma separated, E.164 (+15551234567). A number here must also exist in Retell — listing it alone does not route calls."
          >
            <input id="phones" className={inputCls} disabled={!canWrite} value={phones} onChange={(e) => setPhones(e.target.value)} />
          </Field>

          <Field label="Status" id="status">
            <select id="status" className={`${inputCls} cursor-pointer`} disabled={!canWrite} value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{clientStatusTerm(s).label}</option>)}
            </select>
          </Field>
          {status !== 'active' && (
            <p className="border border-lamp-fair-rim bg-lamp-fair-wash px-3 py-2 text-xs text-lamp-fair-ink">
              A non-active client is not matched to inbound calls. Callers reach no agent.
            </p>
          )}

          {canWrite && (
            <button type="button" onClick={saveClient} disabled={savingClient} className={saveButtonCls}>
              <Save className="h-4 w-4" aria-hidden />
              {savingClient ? 'Saving…' : 'Save business details'}
            </button>
          )}
        </div>
      </section>

      <section className="border border-panel-200 bg-surface-raised">
        <h2 className="border-b border-panel-200 px-6 py-4 font-heading text-sm font-semibold text-ink-900">
          Operations
        </h2>
        <div className="space-y-5 p-6">
          <div className="flex items-start gap-3">
            <input
              id="booking_enabled"
              type="checkbox"
              disabled={!canWrite}
              checked={bookingEnabled}
              onChange={(e) => setBookingEnabled(e.target.checked)}
              className="mt-0.5 h-4 w-4 cursor-pointer border-panel-300 text-ink-800 focus:ring-2 focus:ring-signal-600"
            />
            <label htmlFor="booking_enabled" className="cursor-pointer">
              <span className="block text-sm font-medium text-ink-800">Booking enabled</span>
              <span className="block text-xs text-panel-500">
                Lets the agent offer and hold appointment slots during a call.
              </span>
            </label>
          </div>

          <Field
            label="Notification emails"
            id="notify"
            hint="Comma separated. Where handoff requests and new bookings are sent."
          >
            <input id="notify" className={inputCls} disabled={!canWrite} value={notifyEmails} onChange={(e) => setNotifyEmails(e.target.value)} />
          </Field>

          {canWrite && (
            <button type="button" onClick={saveSettings} disabled={savingSettings} className={saveButtonCls}>
              <Save className="h-4 w-4" aria-hidden />
              {savingSettings ? 'Saving…' : 'Save operations'}
            </button>
          )}
        </div>
      </section>

      {canWrite && (
        <div className="mt-6">
          <BrandingPanel clientId={id} />
        </div>
      )}
    </div>
  );
}

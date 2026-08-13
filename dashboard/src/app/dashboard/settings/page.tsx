'use client';

import { Suspense } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { Tabs, useActiveTab, type TabSpec } from '@/components/Tabs';
import { ClientPicker, useClientScope } from '@/components/ClientPicker';
import { useSession } from '@/lib/SessionProvider';
import type { Permission } from '@/lib/session';
import { BusinessProfile } from './BusinessProfile';
import { FailedJobs } from './FailedJobs';
import UsersPage from '../users/page';
import ConnectionsPage from '../connections/page';

/**
 * Settings — the things you configure once.
 *
 * Team, Connections and Billing used to each hold a slot in the rail, which
 * pushed the daily work down a list an owner reads every morning to make room
 * for pages they visit twice a year. They are gathered here, and Settings sits
 * in the rail's footer beside Sign out.
 *
 * Tab selection lives in the URL (`?tab=`), so a tab is a place: it survives a
 * reload and can be linked to from an onboarding step.
 */

interface SettingsTab extends TabSpec {
  /** Omitted means every signed-in user who can reach Settings may see it. */
  permission?: Permission;
  /** Platform staff only, regardless of permission. */
  platformOnly?: boolean;
}

const TABS: SettingsTab[] = [
  { key: 'profile', label: 'Business Profile' },
  { key: 'team', label: 'Team', permission: 'users:read' },
  { key: 'connections', label: 'Connections', permission: 'crm:read' },
  { key: 'billing', label: 'Billing' },
  // The failed-job console that used to be the whole of this page. Kept, and
  // kept platform-only: it is the queue's manual-review path, not a client
  // setting, and it was only ever reachable by staff.
  { key: 'jobs', label: 'Jobs', platformOnly: true, permission: 'system:read' },
];

function SettingsBody() {
  const { can, isPlatform } = useSession();
  const { clientId } = useClientScope();

  const visible = TABS.filter(
    (t) => (!t.platformOnly || isPlatform) && (!t.permission || can(t.permission))
  );
  const active = useActiveTab(visible.map(({ key, label }) => ({ key, label })));

  return (
    <div>
      <PageHeader
        eyebrow={isPlatform ? 'Platform console' : 'Account'}
        title="Settings"
        description="Your business details, the people who can sign in, the systems you are connected to, and billing."
        action={isPlatform ? <ClientPicker /> : undefined}
      />

      <Tabs tabs={visible.map(({ key, label }) => ({ key, label }))} />

      {active === 'profile' && <BusinessProfile clientId={clientId} />}
      {active === 'team' && <UsersPage />}
      {active === 'connections' && <ConnectionsPage />}
      {active === 'billing' && <BillingPlaceholder />}
      {active === 'jobs' && <FailedJobs />}
    </div>
  );
}

/**
 * Billing is wired but has no payment provider behind it yet.
 *
 * Rather than render invented figures — a fabricated "next payment" date is
 * worse than none, because a customer will believe it — this states plainly
 * what is not connected. It is replaced by the real tabs when the
 * subscriptions and payments tables land.
 */
function BillingPlaceholder() {
  return (
    <div className="max-w-2xl border border-hairline bg-surface-raised px-5 py-6">
      <p className="font-mono text-2xs uppercase tracking-[0.16em] text-text-muted">Billing</p>
      <p className="mt-2 text-base text-text">Not connected yet.</p>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-text-secondary">
        Subscription, payment history and billing notifications will appear here once the
        payment provider is connected. Nothing is shown in the meantime rather than showing
        figures that are not real.
      </p>
      <p className="mt-4 text-sm text-text-secondary">
        For a billing question in the meantime, contact{' '}
        <a
          href="mailto:hello@gravvia.com?subject=Billing%20question"
          className="text-action underline decoration-action/40 underline-offset-2 transition-colors hover:decoration-action"
        >
          hello@gravvia.com
        </a>
        .
      </p>
    </div>
  );
}

export default function SettingsPage() {
  // useActiveTab and ClientPicker both read search params.
  return (
    <Suspense fallback={<div className="h-64 animate-pulse bg-panel-100" />}>
      <SettingsBody />
    </Suspense>
  );
}

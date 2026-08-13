'use client';

import { Suspense } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { Tabs, useActiveTab, type TabSpec } from '@/components/Tabs';
import { ClientPicker, useClientScope } from '@/components/ClientPicker';
import { useSession } from '@/lib/SessionProvider';
import type { Permission } from '@/lib/session';
import { BusinessProfile } from './BusinessProfile';
import { Billing } from './Billing';
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
      {active === 'billing' && <Billing clientId={clientId} />}
      {active === 'jobs' && <FailedJobs />}
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

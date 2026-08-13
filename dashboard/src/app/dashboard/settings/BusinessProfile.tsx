'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Building2, Save } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useSession } from '@/lib/SessionProvider';

/**
 * Who the account belongs to, and where the business is.
 *
 * Every field is optional. This is filled in during onboarding, often across
 * more than one sitting, and a form that refuses a partial save is a form
 * people abandon half-done and never return to.
 */

interface Profile {
  contact_first_name?: string;
  contact_last_name?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  region?: string;
  postal_code?: string;
  country?: string;
}

/** Labelled for the country the business is in, not for the developer's. */
const FIELDS: Array<{
  key: keyof Profile;
  label: string;
  hint?: string;
  span?: 'full' | 'half';
  maxLength: number;
}> = [
  { key: 'contact_first_name', label: 'First name', span: 'half', maxLength: 100 },
  { key: 'contact_last_name', label: 'Last name', span: 'half', maxLength: 100 },
  { key: 'address_line1', label: 'Address', span: 'full', maxLength: 200 },
  { key: 'address_line2', label: 'Address line 2', hint: 'Optional', span: 'full', maxLength: 200 },
  { key: 'city', label: 'City', span: 'half', maxLength: 100 },
  {
    key: 'region',
    label: 'State / Province / Region',
    span: 'half',
    maxLength: 100,
  },
  { key: 'postal_code', label: 'Postal / ZIP code', span: 'half', maxLength: 20 },
  {
    key: 'country',
    label: 'Country',
    hint: 'Two-letter code, e.g. US, GB, CA',
    span: 'half',
    maxLength: 2,
  },
];

export function BusinessProfile({ clientId }: { clientId: string | null }) {
  const { can } = useSession();
  const [profile, setProfile] = useState<Profile>({});
  const [businessName, setBusinessName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const writable = can('settings:write');

  // State is set only after the request settles, never synchronously in the
  // effect body — a sync setState there triggers a cascading render. The
  // cancelled flag stops a slow response for a previous client landing on top
  // of a faster one for the client now selected.
  useEffect(() => {
    let cancelled = false;

    api
      .get('/business-profile', { params: clientId ? { clientId } : {} })
      .then((r) => {
        if (cancelled) return;
        setProfile(r.data.profile ?? {});
        setBusinessName(r.data.business_name ?? '');
        setDirty(false);
      })
      .catch((e) => {
        if (!cancelled) toast.error(errorMessage(e, 'Could not load the business profile'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const set = (key: keyof Profile, value: string) => {
    setProfile((p) => ({ ...p, [key]: value }));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.put('/business-profile', profile, {
        params: clientId ? { clientId } : {},
      });
      setProfile(data.profile ?? {});
      setDirty(false);
      toast.success('Business profile saved');
    } catch (e) {
      toast.error(errorMessage(e, 'Could not save the business profile'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="h-72 animate-pulse bg-panel-100" />;

  return (
    <div className="max-w-2xl">
      <div className="mb-6 flex items-start gap-3 border border-hairline bg-action-50 px-4 py-3">
        <Building2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-text-muted" aria-hidden strokeWidth={1.75} />
        <div className="min-w-0">
          <p className="font-mono text-2xs uppercase tracking-[0.16em] text-text-muted">Business</p>
          <p className="mt-0.5 truncate text-base font-medium text-text">{businessName || '—'}</p>
          {/* The name identifies the tenant across the whole product, so it is
              shown for context but changed on the client record, not here. */}
          <p className="mt-1 text-xs text-text-muted">
            Your business name is used across the product. Ask your account manager to change it.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
        {FIELDS.map((field) => (
          <div key={field.key} className={field.span === 'full' ? 'sm:col-span-2' : undefined}>
            <label
              htmlFor={`bp-${field.key}`}
              className="mb-1.5 flex items-baseline justify-between gap-2"
            >
              <span className="font-mono text-2xs uppercase tracking-[0.16em] text-text-secondary">
                {field.label}
              </span>
              {field.hint && <span className="text-2xs text-text-muted">{field.hint}</span>}
            </label>
            <input
              id={`bp-${field.key}`}
              value={profile[field.key] ?? ''}
              maxLength={field.maxLength}
              disabled={!writable}
              onChange={(e) => set(field.key, e.target.value)}
              className="w-full border border-rule bg-surface-raised px-3 py-2.5 text-sm text-text transition-colors duration-150 placeholder:text-text-muted hover:border-text-faint focus:border-action focus:outline-none focus:ring-2 focus:ring-action/25 disabled:cursor-not-allowed disabled:text-text-muted"
            />
          </div>
        ))}
      </div>

      {writable && (
        <div className="mt-6 flex items-center gap-3 border-t border-hairline pt-5">
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className="group flex cursor-pointer items-center gap-2 border border-action bg-action px-4 py-2.5 text-sm font-medium text-[rgb(var(--action-contrast-rgb))] transition-colors duration-150 hover:bg-transparent hover:text-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action disabled:cursor-not-allowed disabled:border-rule disabled:bg-transparent disabled:text-text-muted"
          >
            <Save className="h-4 w-4 text-current" aria-hidden strokeWidth={1.75} />
            {saving ? 'Saving…' : 'Save profile'}
          </button>
          {dirty && !saving && (
            <span className="font-mono text-2xs uppercase tracking-[0.16em] text-text-muted">
              Unsaved changes
            </span>
          )}
        </div>
      )}
    </div>
  );
}

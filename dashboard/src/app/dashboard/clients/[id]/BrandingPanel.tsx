'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';

/**
 * White-label branding, staff-only.
 *
 * The accent rule is the interesting part and the reason this is not a client
 * self-serve field: green, amber and red mean good, fair and bad on every screen
 * in this product, so an accent inside those hue ranges turns branded controls
 * into status claims. The API rejects one with an explanation, and this panel
 * shows that explanation rather than a generic "invalid" — a client told "no"
 * without a reason concludes the product cannot do it.
 */

interface Branding {
  logo_url: string | null;
  primary_hex: string | null;
  wordmark_text: string | null;
}

const inputCls =
  'w-full rounded-md border border-panel-300 bg-white px-3 py-2 text-sm text-ink-900 ' +
  'placeholder:text-panel-400 focus:border-signal-600 focus:outline-none focus:ring-2 focus:ring-signal-600/25';

export function BrandingPanel({ clientId }: { clientId: string }) {
  const [branding, setBranding] = useState<Branding>({ logo_url: null, primary_hex: null, wordmark_text: null });
  const [rejection, setRejection] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    api
      .get('/branding', { params: { clientId } })
      .then((r) => setBranding(r.data))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(load, [load]);

  const save = async () => {
    setSaving(true);
    setRejection(null);
    try {
      const { data } = await api.put('/branding', branding, { params: { clientId } });
      setBranding(data);
      toast.success('Branding saved');
    } catch (e) {
      const response = (e as { response?: { status?: number; data?: { error?: string } } })?.response;
      // 422 is the design-rule refusal. It carries a real explanation, so show
      // it in place rather than as a toast that disappears.
      if (response?.status === 422) setRejection(response.data?.error ?? 'That value was refused.');
      else toast.error(response?.data?.error ?? 'Could not save branding');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="h-48 animate-pulse rounded-xl bg-panel-100" />;

  return (
    <section className="rounded-xl border border-panel-200 bg-white p-5">
      <h2 className="font-heading text-base font-semibold text-ink-900">Branding</h2>
      <p className="mt-0.5 max-w-xl text-sm leading-relaxed text-panel-600">
        Applies to this client&apos;s login screen, the rail, and their weekly digest email.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink-800">Wordmark</span>
          <input
            className={inputCls}
            placeholder="Gravvia"
            value={branding.wordmark_text ?? ''}
            onChange={(e) => setBranding((b) => ({ ...b, wordmark_text: e.target.value || null }))}
          />
          <span className="mt-1.5 block text-xs text-panel-500">Replaces the product name in the header.</span>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink-800">Logo URL</span>
          <input
            className={inputCls}
            placeholder="https://…/logo.png"
            value={branding.logo_url ?? ''}
            onChange={(e) => setBranding((b) => ({ ...b, logo_url: e.target.value || null }))}
          />
          <span className="mt-1.5 block text-xs text-panel-500">Must be https. Replaces the monogram tile.</span>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink-800">Accent colour</span>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={branding.primary_hex ?? '#2F6FED'}
              onChange={(e) => setBranding((b) => ({ ...b, primary_hex: e.target.value }))}
              className="h-9 w-12 cursor-pointer rounded border border-panel-300 bg-white"
              aria-label="Accent colour"
            />
            <input
              className={inputCls}
              placeholder="#2F6FED"
              value={branding.primary_hex ?? ''}
              onChange={(e) => setBranding((b) => ({ ...b, primary_hex: e.target.value || null }))}
            />
          </div>
          <span className="mt-1.5 block text-xs leading-relaxed text-panel-500">
            Used on the login panel and the digest header only — never on a control. Greens, ambers
            and reds are reserved for status and will be refused.
          </span>
        </label>
      </div>

      {rejection && (
        <div role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-lamp-fair-rim bg-lamp-fair-wash px-4 py-3 text-sm leading-relaxed text-lamp-fair-ink">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
          <p>{rejection}</p>
        </div>
      )}

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="mt-4 cursor-pointer rounded-md bg-ink-800 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {saving ? 'Saving…' : 'Save branding'}
      </button>
    </section>
  );
}

'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, ClipboardCheck, Info, Save, Volume2 } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Tabs, useActiveTab, type TabSpec } from '@/components/Tabs';
import { SyncBadge } from '@/components/StatusPill';
import { ClientPicker, ChooseClientPrompt, useClientScope } from '@/components/ClientPicker';
import { useSession } from '@/lib/SessionProvider';
import { GreetingSuggestions } from './GreetingSuggestions';
import { ReviewChanges, ManagedByGravvia } from './ReviewChanges';

/**
 * "My Agent" — everything a client may change about how their agent sounds and
 * behaves.
 *
 * The prompt is deliberately absent. It is our IP, free text in it is the one
 * edit that can quietly make an agent say something the business would not
 * stand behind, and it stays on the staff-only editor. The greeting — the part
 * that is genuinely theirs and that every caller hears — is fully editable here.
 */

const TABS: TabSpec[] = [
  { key: 'greeting', label: 'Greeting' },
  { key: 'voice', label: 'Voice & feel' },
  { key: 'character', label: 'Character' },
  { key: 'abilities', label: 'What it can do' },
  { key: 'booking', label: 'Booking rules' },
  { key: 'alerts', label: 'Alerts' },
  { key: 'pronunciation', label: 'Pronunciation' },
];

interface VoiceOption { id: string; label: string; description: string }

interface AgentState {
  business_name: string;
  agent_name: string;
  opening_message: string | null;
  agent_personality: string;
  agent_tone: string;
  agent_response_style: string;
  voice_id: string;
  responsiveness: number | null;
  interruption_sensitivity: number | null;
  voice_temperature: number | null;
  booking_enabled: boolean;
  transfer_enabled: boolean;
  transfer_number: string | null;
  callback_enabled: boolean;
  waitlist_enabled: boolean;
  take_messages: boolean;
  advance_booking_hours: number | null;
  max_advance_booking_days: number | null;
  buffer_minutes: number | null;
  cancellation_notice_hours: number | null;
  cancellation_policy: string | null;
  notification_emails: string[];
  pronunciation_dictionary: Array<{ word: string; alphabet: 'ipa' | 'cmu'; phoneme: string }>;
}

interface Options {
  voices: VoiceOption[];
  tones: string[];
  styles: string[];
  personalities: string[];
}

const inputCls =
  'w-full border border-panel-300 bg-surface-raised px-3 py-2 text-sm text-ink-900 ' +
  'placeholder:text-panel-400 transition-colors duration-150 hover:border-panel-400 ' +
  'focus:border-signal-600 focus:outline-none focus:ring-2 focus:ring-signal-600/25 ' +
  'disabled:cursor-not-allowed disabled:bg-panel-50 disabled:text-panel-500';

function Field({ label, id, hint, children }: { label: string; id: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink-800">{label}</label>
      {children}
      {hint && <p className="mt-1.5 text-xs leading-relaxed text-panel-500">{hint}</p>}
    </div>
  );
}

function Toggle({
  id, label, hint, checked, disabled, onChange,
}: {
  id: string; label: string; hint: string; checked: boolean; disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 cursor-pointer border-panel-300 text-ink-800 focus:ring-2 focus:ring-signal-600 disabled:cursor-not-allowed"
      />
      <label htmlFor={id} className="cursor-pointer">
        <span className="block text-sm font-medium text-ink-800">{label}</span>
        <span className="block text-xs leading-relaxed text-panel-500">{hint}</span>
      </label>
    </div>
  );
}

/** A labelled slider — the numbers are meaningless, the ends are not. */
function Slider({
  id, label, low, high, value, fallback, disabled, min, max, onChange,
}: {
  id: string; label: string; low: string; high: string;
  value: number | null; fallback: number; disabled: boolean;
  min: number; max: number; onChange: (v: number) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink-800">{label}</label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={0.05}
        value={value ?? fallback}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full cursor-pointer accent-ink-700 disabled:cursor-not-allowed"
      />
      <div className="mt-1 flex justify-between text-xs text-panel-500">
        <span>{low}</span>
        <span>{high}</span>
      </div>
      {value === null && (
        <p className="mt-1 text-xs text-panel-400">Using the platform default.</p>
      )}
    </div>
  );
}

function AgentCustomiserInner() {
  const tab = useActiveTab(TABS);
  const { can } = useSession();
  const canWrite = can('knowledge:write');
  // The reviewed path is gated on `agents:write` — the grant migration 022 made
  // client-reachable for agent configuration. Held by owners and admins, not by
  // managers, who can edit knowledge but do not configure the agent.
  const canReview = can('agents:write');
  const { clientId, needsChoice, ready } = useClientScope();
  const [reviewing, setReviewing] = useState(false);

  const [agent, setAgent] = useState<AgentState | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [syncState, setSyncState] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ rendered: string; mentionsRecording: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [emailsRaw, setEmailsRaw] = useState('');

  const load = useCallback(() => {
    if (!clientId) return;
    setLoading(true);
    api
      .get('/my-agent', { params: { clientId } })
      .then((r) => {
        setAgent(r.data.agent);
        setOptions(r.data.options);
        setSyncState(r.data.sync?.state ?? null);
        setEmailsRaw((r.data.agent.notification_emails ?? []).join(', '));
        setDirty(false);
      })
      .catch(() => setAgent(null))
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(load, [load]);

  const loadPreview = useCallback(() => {
    if (!clientId) return;
    api
      .get('/my-agent/greeting-preview', { params: { clientId } })
      .then((r) => setPreview(r.data))
      .catch(() => setPreview(null));
  }, [clientId]);

  useEffect(() => { if (tab === 'greeting') loadPreview(); }, [tab, loadPreview]);

  const set = <K extends keyof AgentState>(key: K, value: AgentState[K]) => {
    setAgent((a) => (a ? { ...a, [key]: value } : a));
    setDirty(true);
  };

  /**
   * The editor's state as the API wants it.
   *
   * One builder for both paths — saving directly and staging a review — because
   * two would eventually disagree about which fields get sent, and the review
   * screen would then describe a change that is not the one published.
   */
  const payload = useCallback((): Record<string, unknown> | null => {
    if (!agent) return null;
    const emails = emailsRaw.split(',').map((e) => e.trim()).filter(Boolean);
    return {
      business_name: agent.business_name || undefined,
      agent_name: agent.agent_name || undefined,
      opening_message: agent.opening_message?.trim() ? agent.opening_message.trim() : null,
      agent_personality: agent.agent_personality || undefined,
      agent_tone: agent.agent_tone || undefined,
      agent_response_style: agent.agent_response_style || undefined,
      voice_id: agent.voice_id || undefined,
      ...(agent.responsiveness != null ? { responsiveness: agent.responsiveness } : {}),
      ...(agent.interruption_sensitivity != null ? { interruption_sensitivity: agent.interruption_sensitivity } : {}),
      ...(agent.voice_temperature != null ? { voice_temperature: agent.voice_temperature } : {}),
      booking_enabled: agent.booking_enabled,
      transfer_enabled: agent.transfer_enabled,
      transfer_number: agent.transfer_number?.trim() || null,
      callback_enabled: agent.callback_enabled,
      waitlist_enabled: agent.waitlist_enabled,
      take_messages: agent.take_messages,
      ...(agent.advance_booking_hours != null ? { advance_booking_hours: agent.advance_booking_hours } : {}),
      ...(agent.max_advance_booking_days != null ? { max_advance_booking_days: agent.max_advance_booking_days } : {}),
      ...(agent.buffer_minutes != null ? { buffer_minutes: agent.buffer_minutes } : {}),
      ...(agent.cancellation_notice_hours != null ? { cancellation_notice_hours: agent.cancellation_notice_hours } : {}),
      cancellation_policy: agent.cancellation_policy?.trim() || null,
      notification_emails: emails,
      pronunciation_dictionary: agent.pronunciation_dictionary.filter((p) => p.word && p.phoneme),
    };
  }, [agent, emailsRaw]);

  const save = async () => {
    const body = payload();
    if (!body || !clientId) return;
    setSaving(true);
    try {
      await api.patch('/my-agent', body, { params: { clientId } });
      setSyncState('pending');
      setDirty(false);
      toast.success('Saved — your agent updates on new calls within about a minute');
      if (tab === 'greeting') loadPreview();
    } catch (e) {
      toast.error(errorMessage(e, 'Could not save those changes'));
    } finally {
      setSaving(false);
    }
  };

  if (!ready) return <div className="h-64 animate-pulse bg-panel-100" />;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="My Agent"
        description="How your agent sounds, what it says first, and what it's allowed to do on a call."
        action={syncState ? <SyncBadge state={syncState} /> : undefined}
      />

      <ClientPicker label="Customising agent for" />

      {needsChoice || !clientId ? (
        <ChooseClientPrompt what="Agent customisation" />
      ) : loading ? (
        <div className="h-64 animate-pulse bg-panel-100" />
      ) : !agent || !options ? (
        <div role="alert" className="border border-lamp-bad-rim bg-lamp-bad-wash px-4 py-3 text-sm text-lamp-bad-ink">
          Could not load this agent.
        </div>
      ) : (
        <>
          {!canWrite && (
            <div className="mb-4 flex items-start gap-2 border border-panel-200 bg-panel-50 px-4 py-3 text-sm text-panel-700">
              <Info className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
              <p>You have read-only access. Ask an account owner to make changes.</p>
            </div>
          )}

          <Tabs tabs={TABS} />

          <div className="space-y-6 border border-panel-200 bg-surface-raised p-6">
            {tab === 'greeting' && (
              <>
                <Field
                  label="Opening line"
                  id="opening_message"
                  hint="The first thing every caller hears. Leave blank to use the standard greeting. Type {business} or {agent} and they'll be filled in automatically."
                >
                  <textarea
                    id="opening_message"
                    rows={3}
                    disabled={!canWrite}
                    value={agent.opening_message ?? ''}
                    onChange={(e) => set('opening_message', e.target.value)}
                    placeholder="Thank you for calling {business}, this is {agent}. How can I help you today?"
                    className={`${inputCls} resize-y`}
                  />
                </Field>

                {canWrite && (
                  <GreetingSuggestions
                    clientId={clientId}
                    onPick={(text) => set('opening_message', text)}
                  />
                )}

                {preview && (
                  <div className="border border-panel-200 bg-panel-25 p-4">
                    <p className="mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.07em] text-panel-500">
                      <Volume2 className="h-3.5 w-3.5" aria-hidden /> What callers hear
                    </p>
                    <p className="text-sm leading-relaxed text-ink-800">{preview.rendered}</p>
                  </div>
                )}

                {preview && !preview.mentionsRecording && (
                  <div role="alert" className="flex items-start gap-2 border border-lamp-fair-rim bg-lamp-fair-wash px-4 py-3 text-sm text-lamp-fair-ink">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
                    <p>
                      This greeting doesn&apos;t mention that the call is recorded. Many states require
                      callers to be told before recording — add a line like &ldquo;this call is recorded&rdquo;
                      unless you&apos;ve confirmed you don&apos;t need it.
                    </p>
                  </div>
                )}

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Business name" id="business_name" hint="How the agent says your business name.">
                    <input id="business_name" className={inputCls} disabled={!canWrite}
                      value={agent.business_name} onChange={(e) => set('business_name', e.target.value)} />
                  </Field>
                  <Field label="Agent name" id="agent_name" hint="The name your agent gives callers.">
                    <input id="agent_name" className={inputCls} disabled={!canWrite}
                      value={agent.agent_name} onChange={(e) => set('agent_name', e.target.value)} />
                  </Field>
                </div>
              </>
            )}

            {tab === 'voice' && (
              <>
                <Field label="Voice" id="voice_id" hint="Changes take effect on the next call after saving.">
                  <select id="voice_id" className={`${inputCls} cursor-pointer`} disabled={!canWrite}
                    value={agent.voice_id} onChange={(e) => set('voice_id', e.target.value)}>
                    <option value="">Platform default</option>
                    {options.voices.map((v) => (
                      <option key={v.id} value={v.id}>{v.label} — {v.description}</option>
                    ))}
                  </select>
                </Field>

                <Slider
                  id="responsiveness" label="How quickly it replies"
                  low="Takes its time" high="Jumps straight in"
                  value={agent.responsiveness} fallback={0.85} min={0.3} max={1}
                  disabled={!canWrite} onChange={(v) => set('responsiveness', v)}
                />
                <Slider
                  id="interruption" label="How easily callers can interrupt"
                  low="Finishes its sentence" high="Stops immediately"
                  value={agent.interruption_sensitivity} fallback={0.95} min={0.3} max={1}
                  disabled={!canWrite} onChange={(v) => set('interruption_sensitivity', v)}
                />
                <Slider
                  id="temperature" label="Vocal expressiveness"
                  low="Even and steady" high="Varied and animated"
                  value={agent.voice_temperature} fallback={0.6} min={0.2} max={1.2}
                  disabled={!canWrite} onChange={(v) => set('voice_temperature', v)}
                />
              </>
            )}

            {tab === 'character' && (
              <div className="grid gap-5 sm:grid-cols-3">
                <Field label="Personality" id="personality">
                  <select id="personality" className={`${inputCls} cursor-pointer`} disabled={!canWrite}
                    value={agent.agent_personality} onChange={(e) => set('agent_personality', e.target.value)}>
                    <option value="">Default</option>
                    {options.personalities.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </Field>
                <Field label="Tone" id="tone">
                  <select id="tone" className={`${inputCls} cursor-pointer`} disabled={!canWrite}
                    value={agent.agent_tone} onChange={(e) => set('agent_tone', e.target.value)}>
                    <option value="">Default</option>
                    {options.tones.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Field>
                <Field label="Response style" id="style">
                  <select id="style" className={`${inputCls} cursor-pointer`} disabled={!canWrite}
                    value={agent.agent_response_style} onChange={(e) => set('agent_response_style', e.target.value)}>
                    <option value="">Default</option>
                    {options.styles.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
              </div>
            )}

            {tab === 'abilities' && (
              <>
                <Toggle id="booking_enabled" label="Book appointments"
                  hint="The agent can offer times and hold a booking during the call."
                  checked={agent.booking_enabled} disabled={!canWrite} onChange={(v) => set('booking_enabled', v)} />
                <Toggle id="transfer_enabled" label="Transfer to a human"
                  hint="The agent can hand the call to a person when the caller asks or the situation needs it."
                  checked={agent.transfer_enabled} disabled={!canWrite} onChange={(v) => set('transfer_enabled', v)} />
                {agent.transfer_enabled && (
                  <Field label="Transfer number" id="transfer_number" hint="E.164 format, e.g. +15551234567.">
                    <input id="transfer_number" className={inputCls} disabled={!canWrite}
                      value={agent.transfer_number ?? ''} onChange={(e) => set('transfer_number', e.target.value)} />
                  </Field>
                )}
                <Toggle id="callback_enabled" label="Schedule a callback"
                  hint="When nobody is available, the agent can arrange for someone to call back."
                  checked={agent.callback_enabled} disabled={!canWrite} onChange={(v) => set('callback_enabled', v)} />
                <Toggle id="waitlist_enabled" label="Add callers to a waitlist"
                  hint="If nothing suitable is free, the agent can take their details for a cancellation slot."
                  checked={agent.waitlist_enabled} disabled={!canWrite} onChange={(v) => set('waitlist_enabled', v)} />
                <Toggle id="take_messages" label="Take messages"
                  hint="The agent can take a message for a named person or team."
                  checked={agent.take_messages} disabled={!canWrite} onChange={(v) => set('take_messages', v)} />
              </>
            )}

            {tab === 'booking' && (
              <>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Minimum notice (hours)" id="advance" hint="How far ahead a caller must book. 0 allows same-hour.">
                    <input id="advance" type="number" min={0} max={720} className={inputCls} disabled={!canWrite}
                      value={agent.advance_booking_hours ?? ''} onChange={(e) => set('advance_booking_hours', e.target.value === '' ? null : Number(e.target.value))} />
                  </Field>
                  <Field label="Book up to (days ahead)" id="maxadvance" hint="How far into the future the agent will offer.">
                    <input id="maxadvance" type="number" min={1} max={365} className={inputCls} disabled={!canWrite}
                      value={agent.max_advance_booking_days ?? ''} onChange={(e) => set('max_advance_booking_days', e.target.value === '' ? null : Number(e.target.value))} />
                  </Field>
                  <Field label="Gap between appointments (minutes)" id="buffer" hint="Padding left after each booking.">
                    <input id="buffer" type="number" min={0} max={120} className={inputCls} disabled={!canWrite}
                      value={agent.buffer_minutes ?? ''} onChange={(e) => set('buffer_minutes', e.target.value === '' ? null : Number(e.target.value))} />
                  </Field>
                  <Field label="Cancellation notice (hours)" id="cancelnotice" hint="Below this, the agent states your cancellation policy.">
                    <input id="cancelnotice" type="number" min={0} max={336} className={inputCls} disabled={!canWrite}
                      value={agent.cancellation_notice_hours ?? ''} onChange={(e) => set('cancellation_notice_hours', e.target.value === '' ? null : Number(e.target.value))} />
                  </Field>
                </div>
                <Field label="Cancellation policy" id="cancelpolicy" hint="Said aloud when a caller cancels inside the notice window.">
                  <textarea id="cancelpolicy" rows={2} className={`${inputCls} resize-y`} disabled={!canWrite}
                    value={agent.cancellation_policy ?? ''} onChange={(e) => set('cancellation_policy', e.target.value)}
                    placeholder="Cancellations under 24 hours are charged a $50 fee." />
                </Field>
              </>
            )}

            {tab === 'alerts' && (
              <Field
                label="Notification emails"
                id="emails"
                hint="Comma separated. Where new bookings, messages, and handoff requests are sent."
              >
                <input id="emails" className={inputCls} disabled={!canWrite}
                  value={emailsRaw} onChange={(e) => { setEmailsRaw(e.target.value); setDirty(true); }} />
              </Field>
            )}

            {tab === 'pronunciation' && (
              <>
                <p className="text-sm leading-relaxed text-panel-600">
                  Fix any word the agent mispronounces — your business name, a treatment, a surname.
                  Write the phonetic spelling the way it should sound.
                </p>
                {agent.pronunciation_dictionary.length === 0 && (
                  <p className="text-sm text-panel-500">Nothing set. The agent uses its standard pronunciation.</p>
                )}
                {agent.pronunciation_dictionary.map((entry, i) => (
                  <div key={i} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                    <input
                      aria-label={`Word ${i + 1}`} className={inputCls} disabled={!canWrite} placeholder="Word"
                      value={entry.word}
                      onChange={(e) => set('pronunciation_dictionary', agent.pronunciation_dictionary.map((p, j) => j === i ? { ...p, word: e.target.value } : p))}
                    />
                    <input
                      aria-label={`Pronunciation ${i + 1}`} className={inputCls} disabled={!canWrite} placeholder="How it should sound"
                      value={entry.phoneme}
                      onChange={(e) => set('pronunciation_dictionary', agent.pronunciation_dictionary.map((p, j) => j === i ? { ...p, phoneme: e.target.value } : p))}
                    />
                    {canWrite && (
                      <button
                        type="button"
                        onClick={() => set('pronunciation_dictionary', agent.pronunciation_dictionary.filter((_, j) => j !== i))}
                        className="cursor-pointer border border-panel-300 px-3 py-2 text-xs font-medium text-panel-600 transition-colors hover:bg-lamp-bad-wash hover:text-lamp-bad-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lamp-bad"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
                {canWrite && (
                  <button
                    type="button"
                    onClick={() => set('pronunciation_dictionary', [...agent.pronunciation_dictionary, { word: '', alphabet: 'ipa' as const, phoneme: '' }])}
                    className="cursor-pointer border border-panel-300 bg-surface-raised px-3 py-2 text-sm font-medium text-ink-800 transition-colors hover:border-panel-400 hover:bg-panel-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600"
                  >
                    Add a word
                  </button>
                )}
              </>
            )}

            {canWrite && (
              <div className="flex flex-wrap items-center gap-3 border-t border-panel-200 pt-5">
                {/* Review leads. Publishing straight from the form is still one
                    click away for the rename-the-agent case, but the default
                    action is the one that shows you what you are about to do. */}
                {canReview && (
                  <button
                    type="button"
                    onClick={() => setReviewing(true)}
                    disabled={saving || !dirty}
                    className="flex cursor-pointer items-center gap-2 bg-action px-4 py-2 text-sm font-semibold text-[rgb(var(--action-contrast-rgb))] transition-colors hover:bg-action-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ClipboardCheck className="h-4 w-4" aria-hidden /> Review changes
                  </button>
                )}
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || !dirty}
                  className={
                    canReview
                      ? 'flex cursor-pointer items-center gap-2 border border-panel-300 bg-surface-raised px-4 py-2 text-sm font-medium text-ink-800 transition-colors hover:border-panel-400 hover:bg-panel-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600 disabled:cursor-not-allowed disabled:opacity-40'
                      : 'flex cursor-pointer items-center gap-2 bg-action px-4 py-2 text-sm font-semibold text-[rgb(var(--action-contrast-rgb))] transition-colors hover:bg-action-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40'
                  }
                >
                  <Save className="h-4 w-4" aria-hidden /> {saving ? 'Saving…' : canReview ? 'Save without reviewing' : 'Save changes'}
                </button>
                {dirty && <span className="text-xs text-lamp-fair-ink">Unsaved changes</span>}
              </div>
            )}
          </div>

          <ManagedByGravvia />

          {reviewing && clientId && payload() && (
            <ReviewChanges
              clientId={clientId}
              payload={payload() as Record<string, unknown>}
              onClose={() => setReviewing(false)}
              onPublished={() => {
                setReviewing(false);
                setSyncState('pending');
                setDirty(false);
                load();
                if (tab === 'greeting') loadPreview();
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

export default function AgentCustomiserPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse bg-panel-100" />}>
      <AgentCustomiserInner />
    </Suspense>
  );
}

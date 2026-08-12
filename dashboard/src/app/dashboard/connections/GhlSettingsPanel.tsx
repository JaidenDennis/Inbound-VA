'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';

/**
 * Where GoHighLevel puts what the agent captures.
 *
 * Pipelines and calendars cannot be created through the GHL API — they are made
 * inside the sub-account — so this only ever *chooses* among what already exists
 * there. The refresh control matters: someone creating a pipeline in GHL then
 * finding it absent here, with no way to re-fetch, is the obvious dead end.
 */

interface Pipeline { id: string; name: string; stages: Array<{ id: string; name: string }> }
interface Calendar { id: string; name: string }

const selectCls =
  'mt-1 w-full cursor-pointer border border-panel-300 bg-surface-raised px-2.5 py-2 text-sm text-ink-900 ' +
  'transition-colors hover:border-panel-400 focus:border-signal-600 focus:outline-none focus:ring-2 ' +
  'focus:ring-signal-600/25 disabled:cursor-not-allowed disabled:bg-panel-50 disabled:text-panel-400';

export function GhlSettingsPanel({ clientId, canWrite }: { clientId: string; canWrite: boolean }) {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [pipelineId, setPipelineId] = useState('');
  const [stageId, setStageId] = useState('');
  const [calendarId, setCalendarId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: status } = await api.get(`/crm/${clientId}/gohighlevel/status`);
      setPipelineId(status.pipelineId ?? '');
      setStageId(status.stageId ?? '');
      setCalendarId(status.calendarId ?? '');

      const [p, c] = await Promise.all([
        api.get(`/crm/${clientId}/gohighlevel/pipelines`),
        api.get(`/crm/${clientId}/gohighlevel/calendars`),
      ]);
      setPipelines(p.data ?? []);
      setCalendars(c.data ?? []);
    } catch {
      setPipelines([]);
      setCalendars([]);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      await api.post(`/crm/${clientId}/gohighlevel/config`, {
        ...(pipelineId ? { pipelineId } : {}),
        ...(stageId ? { stageId } : {}),
        ...(calendarId ? { calendarId } : {}),
      });
      toast.success('GoHighLevel settings saved');
    } catch (e) {
      toast.error(
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          'Could not save GoHighLevel settings'
      );
    } finally {
      setSaving(false);
    }
  };

  const stages = pipelines.find((p) => p.id === pipelineId)?.stages ?? [];

  if (loading) return <div className="mt-4 h-24 animate-pulse bg-panel-100" />;

  return (
    <div className="mt-4 border-t border-panel-200 pt-4">
      <p className="mb-3 text-xs leading-relaxed text-panel-500">
        Pipelines and calendars are created inside the GoHighLevel sub-account — they cannot be made
        through the API. Create them there, refresh, then choose where leads and bookings land.
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs font-medium text-ink-800">
          Lead pipeline
          <select
            value={pipelineId}
            disabled={!canWrite}
            onChange={(e) => { setPipelineId(e.target.value); setStageId(''); }}
            className={selectCls}
          >
            <option value="">— none —</option>
            {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>

        <label className="text-xs font-medium text-ink-800">
          Entry stage
          <select
            value={stageId}
            disabled={!canWrite || !pipelineId}
            onChange={(e) => setStageId(e.target.value)}
            className={selectCls}
          >
            <option value="">— first stage —</option>
            {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>

        <label className="text-xs font-medium text-ink-800">
          Booking calendar
          <select
            value={calendarId}
            disabled={!canWrite}
            onChange={(e) => setCalendarId(e.target.value)}
            className={selectCls}
          >
            <option value="">— none —</option>
            {calendars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      </div>

      {canWrite && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="cursor-pointer bg-action px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-action-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600 focus-visible:ring-offset-2 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save settings'}
          </button>
          <button
            type="button"
            onClick={load}
            className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-panel-600 transition-colors hover:text-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Refresh pipelines &amp; calendars
          </button>
        </div>
      )}
    </div>
  );
}

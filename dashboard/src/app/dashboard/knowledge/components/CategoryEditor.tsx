'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/SessionProvider';

interface Category {
  id: string;
  name: string;
  sort_order: number;
  active: boolean;
}

function errorMessage(err: unknown, fallback: string): string {
  const response = (err as { response?: { status?: number; data?: { error?: string } } })?.response;
  if (response?.status === 409) return 'That category already exists';
  return response?.data?.error ?? fallback;
}

/**
 * Staff-only editor for a client's FAQ category list — the options the FAQ
 * dropdown offers.
 *
 * Every mutation here (create/rename/remove) 403s at the API for a client
 * user, so this gates on `isPlatform` itself rather than trusting every
 * caller to only mount it for staff — a client landing on this component
 * would otherwise see buttons that always fail.
 */
export function CategoryEditor({ clientId, onChanged }: { clientId: string; onChanged?: () => void }) {
  const { isPlatform } = useSession();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  // `loading` starts true and is only cleared here — never set back to true
  // on a refresh triggered by add/rename/remove, so those refreshes don't
  // flash the skeleton back in.
  const load = useCallback(() => {
    api
      .get('/knowledge/categories', { params: { clientId } })
      .then((r) => setCategories(r.data.data ?? []))
      .catch(() => setCategories([]))
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(() => {
    if (isPlatform) load();
  }, [load, isPlatform]);

  // The API 403s a client user on every write here, so a client should never
  // see the controls in the first place.
  if (!isPlatform) return null;

  const add = async () => {
    const name = newName.trim();
    if (!name) return;
    setSaving(true);
    try {
      await api.post('/knowledge/categories', { name }, { params: { clientId } });
      setNewName('');
      load();
      onChanged?.();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not add category'));
    } finally {
      setSaving(false);
    }
  };

  const startRename = (c: Category) => {
    setEditingId(c.id);
    setEditValue(c.name);
  };

  const cancelRename = () => {
    setEditingId(null);
    setEditValue('');
  };

  const rename = async (id: string) => {
    const name = editValue.trim();
    if (!name) return;
    if (!window.confirm('Renaming this category updates every FAQ currently using it. Continue?')) return;
    setSaving(true);
    try {
      const res = await api.patch(`/knowledge/categories/${id}`, { name });
      cancelRename();
      load();
      onChanged?.();
      // The rename succeeds on its own; moving the FAQs filed under the old
      // name is a second step that can fail independently, and the API says so
      // with a 200 + `warning` rather than a 400 that denies the rename it just
      // made. Same amber treatment PoliciesEditor uses for the same shape —
      // this is not a success and it is not a failure.
      const warning = res.data?.warning as string | undefined;
      if (warning) {
        toast(warning, {
          icon: '⚠️',
          duration: 10000,
          style: { background: 'var(--lamp-fair-wash)', color: 'rgb(var(--lamp-fair-ink-rgb))', border: '1px solid var(--lamp-fair-rim)' },
        });
      }
    } catch (err) {
      toast.error(errorMessage(err, 'Could not rename category'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (
      !window.confirm(
        'Remove this category? FAQs already using it keep their text, but it will no longer be a selectable option.'
      )
    )
      return;
    try {
      await api.delete(`/knowledge/categories/${id}`);
      load();
      onChanged?.();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not remove category'));
    }
  };

  if (loading) return <div className="mb-6 h-32 animate-pulse bg-panel-100" />;

  return (
    <div className="mb-6 border border-panel-200 bg-surface-raised">
      <div className="border-b border-panel-200 px-5 py-3.5">
        <h2 className="font-heading text-sm font-semibold text-ink-900">FAQ categories</h2>
        <p className="mt-0.5 text-xs text-panel-500">
          The options offered in the FAQ category dropdown. Renaming one updates every FAQ that uses it.
        </p>
      </div>

      {categories.length === 0 ? (
        <p className="px-5 py-6 text-center text-sm text-panel-500">No categories yet. Add one below.</p>
      ) : (
        <ul className="divide-y divide-panel-100">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center gap-2 px-5 py-2.5">
              {editingId === c.id ? (
                <>
                  <label htmlFor={`category-rename-${c.id}`} className="sr-only">
                    Rename {c.name}
                  </label>
                  <input
                    id={`category-rename-${c.id}`}
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    className="flex-1 border border-panel-300 bg-surface-raised px-2.5 py-1.5 text-sm text-ink-900 transition-colors hover:border-panel-400 focus:border-signal-600 focus:outline-none focus:ring-2 focus:ring-signal-600/25"
                  />
                  <button
                    type="button"
                    onClick={() => rename(c.id)}
                    disabled={saving}
                    aria-label="Save category name"
                    className="cursor-pointer border border-action bg-action p-1.5 text-[rgb(var(--action-contrast-rgb))] transition-colors duration-150 hover:bg-transparent hover:text-action focus:outline-none focus:ring-2 focus:ring-action disabled:opacity-50"
                  >
                    <Check className="h-4 w-4 text-current" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={cancelRename}
                    disabled={saving}
                    aria-label="Cancel rename"
                    className="cursor-pointer p-1.5 text-panel-500 transition-colors hover:bg-panel-100 hover:text-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600 disabled:opacity-50"
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm text-ink-800">{c.name}</span>
                  <button
                    type="button"
                    onClick={() => startRename(c)}
                    aria-label={`Rename ${c.name}`}
                    className="cursor-pointer p-1.5 text-panel-500 transition-colors hover:bg-panel-100 hover:text-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600"
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(c.id)}
                    aria-label={`Remove ${c.name}`}
                    className="cursor-pointer p-1.5 text-panel-500 transition-colors hover:bg-lamp-bad-wash hover:text-lamp-bad-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lamp-bad"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2 border-t border-panel-200 px-5 py-3.5">
        <label htmlFor="new-category-name" className="sr-only">
          New category name
        </label>
        <input
          id="new-category-name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New category"
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
          className="flex-1 border border-panel-300 bg-surface-raised px-2.5 py-1.5 text-sm text-ink-900 transition-colors hover:border-panel-400 focus:border-signal-600 focus:outline-none focus:ring-2 focus:ring-signal-600/25"
        />
        <button
          type="button"
          onClick={add}
          disabled={saving || !newName.trim()}
          className="flex cursor-pointer items-center gap-1.5 border border-panel-300 bg-surface-raised px-3 py-2 text-sm font-medium text-ink-800 transition-colors hover:border-panel-400 hover:bg-panel-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-4 w-4" aria-hidden /> Add
        </button>
      </div>
    </div>
  );
}

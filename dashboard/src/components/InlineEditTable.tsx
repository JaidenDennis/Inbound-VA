'use client';

import { useState, type ReactNode } from 'react';
import toast from 'react-hot-toast';
import { Plus, Trash2, Check, X, Pencil } from 'lucide-react';

export interface FieldSpec {
  key: string;
  label: string;
  type?: 'text' | 'textarea' | 'number';
  required?: boolean;
  placeholder?: string;
  /** Column width hint for the table header. */
  width?: string;
  render?: (value: unknown) => ReactNode;
}

export interface InlineEditTableProps<T extends { id: string }> {
  rows: T[];
  fields: FieldSpec[];
  loading?: boolean;
  readOnly?: boolean;
  emptyMessage?: string;
  onCreate: (values: Record<string, string>) => Promise<void>;
  onUpdate: (id: string, values: Record<string, string>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

/**
 * Editable table for the knowledge base.
 *
 * Writes are optimistic in feel — the row exits edit mode immediately — but the
 * refresh is driven by the parent's reload, so a rejected write cannot leave the
 * table showing a value the server never accepted. Failures surface as a toast
 * and the row is restored.
 */
export function InlineEditTable<T extends { id: string }>({
  rows,
  fields,
  loading,
  readOnly,
  emptyMessage = 'Nothing here yet.',
  onCreate,
  onUpdate,
  onDelete,
}: InlineEditTableProps<T>) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  const inputCls =
    'w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';

  const startEdit = (row: T) => {
    setCreating(false);
    setEditingId(row.id);
    setDraft(
      Object.fromEntries(
        fields.map((f) => [f.key, String((row as Record<string, unknown>)[f.key] ?? '')])
      )
    );
  };

  const startCreate = () => {
    setEditingId(null);
    setCreating(true);
    setDraft(Object.fromEntries(fields.map((f) => [f.key, ''])));
  };

  const cancel = () => {
    setEditingId(null);
    setCreating(false);
    setDraft({});
  };

  const save = async () => {
    const missing = fields.filter((f) => f.required && !draft[f.key]?.trim());
    if (missing.length > 0) {
      toast.error(`${missing.map((f) => f.label).join(', ')} required`);
      return;
    }

    setSaving(true);
    try {
      if (creating) await onCreate(draft);
      else if (editingId) await onUpdate(editingId, draft);
      cancel();
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg ?? 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await onDelete(id);
    } catch {
      toast.error('Could not remove that item');
    }
  };

  const renderInput = (field: FieldSpec) =>
    field.type === 'textarea' ? (
      <textarea
        id={`field-${field.key}`}
        className={inputCls}
        rows={2}
        placeholder={field.placeholder}
        value={draft[field.key] ?? ''}
        onChange={(e) => setDraft((d) => ({ ...d, [field.key]: e.target.value }))}
      />
    ) : (
      <input
        id={`field-${field.key}`}
        type={field.type === 'number' ? 'number' : 'text'}
        inputMode={field.type === 'number' ? 'decimal' : undefined}
        className={inputCls}
        placeholder={field.placeholder}
        value={draft[field.key] ?? ''}
        onChange={(e) => setDraft((d) => ({ ...d, [field.key]: e.target.value }))}
      />
    );

  if (loading) {
    return (
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-14 animate-pulse border-b border-gray-100 bg-gray-50 last:border-0" />
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wide text-gray-700">
                {fields.map((f) => (
                  <th key={f.key} scope="col" className="px-4 py-3" style={{ width: f.width }}>
                    {f.label}
                  </th>
                ))}
                {!readOnly && (
                  <th scope="col" className="px-4 py-3 text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) =>
                editingId === row.id ? (
                  <tr key={row.id} className="bg-primary-50/40">
                    {fields.map((f) => (
                      <td key={f.key} className="px-4 py-3 align-top">
                        <label htmlFor={`field-${f.key}`} className="sr-only">{f.label}</label>
                        {renderInput(f)}
                      </td>
                    ))}
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <RowActions saving={saving} onSave={save} onCancel={cancel} />
                    </td>
                  </tr>
                ) : (
                  <tr key={row.id} className="text-sm transition-colors hover:bg-gray-50">
                    {fields.map((f) => {
                      const value = (row as Record<string, unknown>)[f.key];
                      return (
                        <td key={f.key} className="px-4 py-3 text-gray-800">
                          {f.render ? f.render(value) : (value as ReactNode) ?? <span className="text-gray-400">—</span>}
                        </td>
                      );
                    })}
                    {!readOnly && (
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => startEdit(row)}
                          aria-label="Edit row"
                          className="cursor-pointer rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
                        >
                          <Pencil className="h-4 w-4" aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(row.id)}
                          aria-label="Remove row"
                          className="ml-1 cursor-pointer rounded p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-red-500"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                      </td>
                    )}
                  </tr>
                )
              )}

              {creating && (
                <tr className="bg-primary-50/40">
                  {fields.map((f) => (
                    <td key={f.key} className="px-4 py-3 align-top">
                      <label htmlFor={`field-${f.key}`} className="sr-only">{f.label}</label>
                      {renderInput(f)}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <RowActions saving={saving} onSave={save} onCancel={cancel} />
                  </td>
                </tr>
              )}

              {rows.length === 0 && !creating && (
                <tr>
                  <td colSpan={fields.length + 1} className="px-4 py-10 text-center text-gray-400">
                    {emptyMessage}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!readOnly && !creating && (
        <button
          type="button"
          onClick={startCreate}
          className="mt-3 flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <Plus className="h-4 w-4" aria-hidden /> Add
        </button>
      )}
    </div>
  );
}

function RowActions({ saving, onSave, onCancel }: { saving: boolean; onSave: () => void; onCancel: () => void }) {
  return (
    <>
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        aria-label="Save row"
        className="cursor-pointer rounded p-1.5 text-emerald-600 transition-colors hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
      >
        <Check className="h-4 w-4" aria-hidden />
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={saving}
        aria-label="Cancel editing"
        className="ml-1 cursor-pointer rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </>
  );
}

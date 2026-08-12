'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '@/lib/api';
import { Plus, UserPlus } from 'lucide-react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Table, TableEmpty, TableShell, TBody, TD, TH, THead, TR } from '@/components/Table';
import { useSession } from '@/lib/SessionProvider';
import { PLATFORM_ROLES, CLIENT_ROLES, roleLabel, type UserRole } from '@/lib/session';

interface AppUser {
  id: string;
  email: string;
  name: string;
  role: string;
  client_id: string | null;
  is_active: boolean;
  last_login_at: string | null;
}

export default function UsersPage() {
  const { isPlatform, auth, loading: sessionLoading } = useSession();
  // Only roles from the caller's own family are offered. The API rejects the
  // other family anyway; showing them would just produce a confusing 403.
  const roles: readonly UserRole[] = isPlatform ? PLATFORM_ROLES : CLIENT_ROLES;
  const defaultRole: UserRole = isPlatform ? 'support_agent' : 'client_viewer';

  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [pendingDisable, setPendingDisable] = useState<AppUser | null>(null);
  const [toggling, setToggling] = useState(false);

  // new user form
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>(defaultRole);
  const [saving, setSaving] = useState(false);

  // edit-in-place form
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState<UserRole>('client_viewer');
  const [editPassword, setEditPassword] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => setRole(defaultRole), [defaultRole]);

  const load = () => {
    setLoading(true);
    api.get('/users').then((r) => setUsers(r.data.data ?? [])).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await api.post('/users', { email, name, password, role });
      setEmail(''); setName(''); setPassword(''); setRole(defaultRole);
      setShowForm(false);
      load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? 'Failed to create user');
    } finally {
      setSaving(false);
    }
  };

  // Derive the edit target state. Computed at component level so both the role control
  // visibility (JSX) and the request routing (saveEdit) read the same value. Uses a union
  // type to distinguish three states: 'unknown' (loading), 'self', 'other'. This ensures:
  // - role control only renders for 'other' (positive test, 'unknown' never falls through)
  // - saveEdit only allows submission for 'self' or 'other' (not 'unknown')
  // - routing/payload logic correctly handles all three cases
  const editTarget: 'none' | 'unknown' | 'self' | 'other' =
    !editing ? 'none'
    : sessionLoading ? 'unknown'
    : editing.id === auth?.sub ? 'self'
    : 'other';

  // The edit form's role dropdown must offer the TARGET's role family, not the
  // caller's. Platform staff can see and edit client users (the list applies no
  // client_id filter for them), so using `roles` (the actor's family) here would
  // render platform-only options for a client user — the selected value would
  // match none of them, and saving would send a platform role for a tenant user,
  // which validateRoleScope rejects with a 400.
  const editRoles: readonly UserRole[] = editing?.client_id ? CLIENT_ROLES : PLATFORM_ROLES;

  const startEdit = (u: AppUser) => {
    setEditing(u);
    setEditEmail(u.email);
    setEditRole(u.role as UserRole);
    setEditPassword('');
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    // Explicit guard: do not allow submission until edit target is known (self or other).
    // If still loading ('unknown'), we do not know whether this is a self-edit, so reject.
    if (editTarget === 'unknown') return;
    setSavingEdit(true);
    try {
      // Role is omitted for yourself: the API rejects a self-role change with
      // 403, and offering a control that always fails is worse than not
      // offering it. /me also only accepts { name?, email?, password? }.
      const payload: Record<string, unknown> = { email: editEmail };
      if (editPassword) payload.password = editPassword;
      if (editTarget !== 'self') payload.role = editRole;

      await api.patch(editTarget === 'self' ? '/me' : `/users/${editing.id}`, payload);
      toast.success('User updated');
      setEditing(null);
      load();
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      toast.error(
        status === 409
          ? 'That email is already in use'
          : status === 403
            ? 'You do not have permission to make that change'
            : 'Could not update user'
      );
    } finally {
      setSavingEdit(false);
    }
  };

  /**
   * Disabling revokes a person's access, so it asks first. Enabling restores it
   * and is harmless, so it does not. The previous version did neither, and also
   * swallowed failures: a rejected patch left the row unchanged with no message,
   * so an admin could believe they had revoked access that was still live.
   */
  const applyToggle = async (u: AppUser) => {
    setToggling(true);
    try {
      await api.patch(`/users/${u.id}`, { is_active: !u.is_active });
      toast.success(u.is_active ? `${u.name || u.email} disabled` : `${u.name || u.email} enabled`);
      setPendingDisable(null);
      load();
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg ?? 'Could not change that user');
    } finally {
      setToggling(false);
    }
  };

  const toggleActive = (u: AppUser) => {
    if (u.is_active) setPendingDisable(u);
    else void applyToggle(u);
  };

  const inputCls = 'w-full border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Users</h1>
        <button onClick={() => setShowForm((s) => !s)}
          className="flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold px-4 py-2 transition">
          <Plus className="w-4 h-4" /> New User
        </button>
      </div>

      {showForm && (
        <form onSubmit={createUser} className="bg-surface-raised border border-gray-200 p-5 mb-6 grid grid-cols-2 gap-3">
          <div className="col-span-2 flex items-center gap-2 text-gray-700 font-medium"><UserPlus className="w-4 h-4" /> Invite a user</div>
          <input className={inputCls} placeholder="Name" required value={name} onChange={(e) => setName(e.target.value)} />
          <input className={inputCls} type="email" placeholder="Email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className={inputCls} type="password" placeholder="Temp password (min 8)" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          <div>
            <label htmlFor="new-user-role" className="sr-only">Role</label>
            <select
              id="new-user-role"
              className={inputCls}
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
            >
              {roles.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
            </select>
          </div>
          {error && <p role="alert" className="col-span-2 text-sm text-red-600">{error}</p>}
          <div className="col-span-2">
            <button type="submit" disabled={saving}
              className="bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold px-5 py-2 transition disabled:opacity-50">
              {saving ? 'Creating...' : 'Create User'}
            </button>
          </div>
        </form>
      )}

      {editing && (
        <form onSubmit={saveEdit} className="bg-surface-raised border border-gray-200 p-5 mb-6 grid grid-cols-2 gap-3">
          <div className="col-span-2 text-gray-700 font-medium">Edit {editing.name || editing.email}</div>
          <input
            className={inputCls}
            type="email"
            placeholder="Email"
            required
            value={editEmail}
            onChange={(e) => setEditEmail(e.target.value)}
          />
          <input
            className={inputCls}
            type="password"
            placeholder="New password (leave blank to keep)"
            minLength={8}
            value={editPassword}
            onChange={(e) => setEditPassword(e.target.value)}
          />
          {editTarget === 'other' && (
            <div>
              <label htmlFor="edit-user-role" className="sr-only">Role</label>
              <select
                id="edit-user-role"
                className={inputCls}
                value={editRole}
                onChange={(e) => setEditRole(e.target.value as UserRole)}
              >
                {editRoles.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
              </select>
            </div>
          )}
          <div className="col-span-2 flex gap-2">
            <button type="submit" disabled={savingEdit || sessionLoading}
              className="bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold px-5 py-2 transition disabled:opacity-50">
              {savingEdit ? 'Saving...' : 'Save'}
            </button>
            <button type="button" onClick={() => setEditing(null)}
              className="border border-gray-300 text-sm font-semibold px-5 py-2 transition hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <TableShell>
          <div aria-hidden className="divide-y divide-panel-100">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="px-5 py-4">
                <div className="h-3.5 w-1/2 animate-pulse bg-panel-200" />
              </div>
            ))}
          </div>
          <span className="sr-only" role="status">Loading users</span>
        </TableShell>
      ) : users.length === 0 ? (
        <TableEmpty
          title="No users yet"
          body="Invite someone with the button above to give them console access."
        />
      ) : (
        <TableShell>
          <Table caption={`${users.length} users`}>
            <THead>
              <TH>Name</TH>
              <TH>Email</TH>
              <TH>Role</TH>
              <TH>Status</TH>
              <TH align="right" srOnly>Actions</TH>
            </THead>
            <TBody>
              {users.map((u) => (
                <TR key={u.id}>
                  <TD className="font-medium text-ink-900">{u.name}</TD>
                  <TD className="text-panel-600">{u.email}</TD>
                  <TD>
                    <span className="rounded-full border border-panel-200 bg-panel-100 px-2.5 py-1 text-2xs font-medium text-panel-700">
                      {roleLabel(u.role as UserRole)}
                    </span>
                  </TD>
                  <TD>
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${u.is_active ? 'border-lamp-good-rim bg-lamp-good-wash text-lamp-good-ink' : 'border-panel-200 bg-panel-100 text-panel-700'}`}>
                      {u.is_active ? 'Active' : 'Disabled'}
                    </span>
                  </TD>
                  <TD align="right">
                    <button
                      onClick={() => startEdit(u)}
                      className="cursor-pointer whitespace-nowrap px-1.5 py-1 text-xs font-medium text-ink-800 underline decoration-panel-300 underline-offset-2 transition-colors hover:text-ink-900 hover:decoration-panel-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => toggleActive(u)}
                      className="ml-3 cursor-pointer whitespace-nowrap px-1.5 py-1 text-xs font-medium text-ink-800 underline decoration-panel-300 underline-offset-2 transition-colors hover:text-ink-900 hover:decoration-panel-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-600"
                    >
                      {u.is_active ? 'Disable' : 'Enable'}
                    </button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableShell>
      )}

      <ConfirmDialog
        open={!!pendingDisable}
        title="Disable this user?"
        body={
          pendingDisable
            ? `${pendingDisable.name || pendingDisable.email} will lose access to the console immediately. Any session they have open stops working on their next request. You can re-enable them later.`
            : ''
        }
        confirmLabel="Disable user"
        busy={toggling}
        onConfirm={() => pendingDisable && void applyToggle(pendingDisable)}
        onCancel={() => setPendingDisable(null)}
      />
    </div>
  );
}

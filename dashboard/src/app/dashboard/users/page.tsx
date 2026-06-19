'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Plus, UserPlus } from 'lucide-react';

interface AppUser {
  id: string;
  email: string;
  name: string;
  role: string;
  client_id: string | null;
  is_active: boolean;
  last_login_at: string | null;
}

const ROLES = ['admin', 'agent', 'viewer', 'super_admin'];

export default function UsersPage() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');

  // new user form
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('agent');
  const [saving, setSaving] = useState(false);

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
      setEmail(''); setName(''); setPassword(''); setRole('agent');
      setShowForm(false);
      load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? 'Failed to create user');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (u: AppUser) => {
    await api.patch(`/users/${u.id}`, { is_active: !u.is_active });
    load();
  };

  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Users</h1>
        <button onClick={() => setShowForm((s) => !s)}
          className="flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold px-4 py-2 rounded-lg transition">
          <Plus className="w-4 h-4" /> New User
        </button>
      </div>

      {showForm && (
        <form onSubmit={createUser} className="bg-white rounded-xl border border-gray-200 p-5 mb-6 grid grid-cols-2 gap-3">
          <div className="col-span-2 flex items-center gap-2 text-gray-700 font-medium"><UserPlus className="w-4 h-4" /> Invite a user</div>
          <input className={inputCls} placeholder="Name" required value={name} onChange={(e) => setName(e.target.value)} />
          <input className={inputCls} type="email" placeholder="Email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className={inputCls} type="password" placeholder="Temp password (min 8)" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          {error && <p className="col-span-2 text-red-500 text-sm">{error}</p>}
          <div className="col-span-2">
            <button type="submit" disabled={saving}
              className="bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold px-5 py-2 rounded-lg transition disabled:opacity-50">
              {saving ? 'Creating...' : 'Create User'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="text-gray-400 animate-pulse">Loading users...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Email</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Role</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-800">{u.name}</td>
                  <td className="px-4 py-3 text-gray-600">{u.email}</td>
                  <td className="px-4 py-3"><span className="px-2 py-0.5 bg-gray-100 rounded-full text-xs">{u.role}</span></td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${u.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
                      {u.is_active ? 'active' : 'disabled'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => toggleActive(u)} className="text-xs text-brand-600 hover:underline">
                      {u.is_active ? 'Disable' : 'Enable'}
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No users</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

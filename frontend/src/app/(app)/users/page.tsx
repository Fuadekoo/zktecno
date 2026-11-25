'use client';

import { useState, type FormEvent } from 'react';
import { Icon } from '@/components/icons';
import { Alert, ConfirmDialog, Field, Modal, PageHeader, Spinner, TableState, useToast } from '@/components/ui';
import { useUser } from '@/components/user-context';
import { api, ApiError, type FieldErrors } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { AppUser } from '@/lib/types';

type Form = { username: string; full_name: string; role: 'admin' | 'viewer'; is_active: boolean; password: string };
const EMPTY: Form = { username: '', full_name: '', role: 'viewer', is_active: true, password: '' };

export default function UsersPage() {
  const { user: me, isAdmin } = useUser();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<{ data: AppUser[] }>(isAdmin ? '/users' : null);

  const [editing, setEditing] = useState<AppUser | 'new' | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [fields, setFields] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<AppUser | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  if (!isAdmin) {
    return <Alert>Only administrators can manage users.</Alert>;
  }

  function open(u: AppUser | 'new') {
    setEditing(u);
    setFields({});
    setFormError(null);
    setForm(u === 'new' ? EMPTY : { username: u.username, full_name: u.full_name ?? '', role: u.role, is_active: u.is_active, password: '' });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFields({});
    setFormError(null);
    try {
      if (editing === 'new') {
        await api('/users', { method: 'POST', body: { username: form.username, full_name: form.full_name || null, role: form.role, password: form.password } });
        toast(`User ${form.username} created`);
      } else if (editing) {
        const body: Record<string, unknown> = { full_name: form.full_name || null, role: form.role, is_active: form.is_active };
        if (form.password) body.password = form.password;
        await api(`/users/${editing.id}`, { method: 'PATCH', body });
        toast(`User ${editing.username} updated`);
      }
      setEditing(null);
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFields(err.fields);
      setFormError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api(`/users/${deleting.id}`, { method: 'DELETE' });
      toast(`User ${deleting.username} deleted`);
      setDeleting(null);
      reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Delete failed', 'error');
    } finally {
      setDeleteBusy(false);
    }
  }

  const isSelf = editing !== 'new' && editing?.id === me?.id;

  return (
    <>
      <PageHeader
        title="Users"
        description="People who can sign in to this dashboard. Admins can change data; viewers can only look."
        actions={
          <button className="btn-primary" onClick={() => open('new')}>
            <Icon name="plus" className="h-4 w-4" />
            New user
          </button>
        }
      />

      <div className="card">
        <TableState loading={loading} error={error} empty={!data?.data.length} onRetry={reload}>
          <table className="table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Name</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last sign-in</th>
                <th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {data?.data.map((u) => (
                <tr key={u.id}>
                  <td className="font-medium text-slate-900">
                    {u.username}
                    {u.id === me?.id && <span className="ml-2 text-xs text-slate-400">(you)</span>}
                  </td>
                  <td>{u.full_name || '—'}</td>
                  <td>
                    <span className={`badge ${u.role === 'admin' ? 'bg-sky-50 text-sky-700' : 'bg-slate-100 text-slate-700'}`}>{u.role}</span>
                  </td>
                  <td>
                    <span className={`badge ${u.is_active ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-700'}`}>{u.is_active ? 'Active' : 'Disabled'}</span>
                  </td>
                  <td title={u.last_login_at ?? ''}>{timeAgo(u.last_login_at)}</td>
                  <td className="text-right">
                    <button className="btn-ghost" onClick={() => open(u)} aria-label={`Edit ${u.username}`}>
                      <Icon name="edit" className="h-4 w-4" />
                    </button>
                    {u.id !== me?.id && (
                      <button className="btn-ghost text-red-600 hover:bg-red-50" onClick={() => setDeleting(u)} aria-label={`Delete ${u.username}`}>
                        <Icon name="trash" className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableState>
      </div>

      <Modal
        open={editing !== null}
        title={editing === 'new' ? 'New user' : `Edit ${editing?.username ?? ''}`}
        onClose={() => setEditing(null)}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </button>
            <button className="btn-primary" form="user-form" disabled={saving}>
              {saving && <Spinner className="h-4 w-4 text-white" />}
              Save
            </button>
          </>
        }
      >
        <form id="user-form" onSubmit={save} className="space-y-4">
          {formError && <Alert>{formError}</Alert>}
          <Field label="Username" error={fields.username}>
            <input
              className="input"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              disabled={editing !== 'new'}
              required
              minLength={3}
              maxLength={64}
              pattern="[A-Za-z0-9._\-]+"
              autoComplete="off"
            />
          </Field>
          <Field label="Full name" error={fields.full_name}>
            <input className="input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} maxLength={128} />
          </Field>
          <Field label="Role" error={fields.role}>
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Form['role'] })}>
              <option value="viewer">Viewer: can see everything, change nothing</option>
              <option value="admin">Admin: full access, including users</option>
            </select>
          </Field>
          <Field
            label={editing === 'new' ? 'Password' : 'New password'}
            error={fields.password}
            hint={editing === 'new' ? 'At least 8 characters' : 'Leave empty to keep the current password'}
          >
            <input
              className="input"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required={editing === 'new'}
              minLength={8}
              autoComplete="new-password"
            />
          </Field>
          {editing !== 'new' && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 accent-brand-600"
                checked={form.is_active}
                disabled={isSelf}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              />
              Account active {isSelf && <span className="text-xs text-slate-400">(you can’t disable yourself)</span>}
            </label>
          )}
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete user"
        message={
          <>
            Delete <strong>{deleting?.username}</strong>? They will no longer be able to sign in.
          </>
        }
        busy={deleteBusy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}

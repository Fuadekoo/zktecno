'use client';

import { useState, type FormEvent } from 'react';
import { api, ApiError, type FieldErrors } from '@/lib/api';
import { useApi, useDebounced } from '@/lib/hooks';
import type { OrgUnit } from '@/lib/types';
import { Icon } from './icons';
import { Alert, ConfirmDialog, Field, Modal, PageHeader, Spinner, TableState, useToast } from './ui';
import { useUser } from './user-context';

interface Props {
  title: string;
  singular: string;
  description: string;
  resource: 'departments' | 'areas' | 'positions';
  prefix: 'dept' | 'area' | 'position';
  parentKey: 'parent_dept' | 'parent_area' | 'parent_position';
}

type Form = { code: string; name: string; parent: string };

/** Parent can come back as an id or as a nested object depending on the endpoint. */
function parentId(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') return (value as { id?: number }).id ?? null;
  return Number(value);
}

export default function OrgUnitPage({ title, singular, description, resource, prefix, parentKey }: Props) {
  const toast = useToast();
  const { isAdmin } = useUser();
  const codeKey = `${prefix}_code`;
  const nameKey = `${prefix}_name`;
  const { data, error, loading, reload } = useApi<{ data: OrgUnit[] }>(`/${resource}/all`);
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim().toLowerCase(), 200);

  const [editing, setEditing] = useState<OrgUnit | 'new' | null>(null);
  const [form, setForm] = useState<Form>({ code: '', name: '', parent: '' });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<OrgUnit | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const items = data?.data ?? [];
  const byId = new Map(items.map((i) => [i.id, i]));
  const label = (i?: OrgUnit) => (i ? `${String(i[nameKey])} (${String(i[codeKey])})` : '');
  const filtered = items.filter((i) => !q || [i[codeKey], i[nameKey]].some((v) => String(v ?? '').toLowerCase().includes(q)));

  function openForm(item: OrgUnit | 'new') {
    setEditing(item);
    setFieldErrors({});
    setFormError(null);
    setForm(
      item === 'new'
        ? { code: '', name: '', parent: '' }
        : { code: String(item[codeKey] ?? ''), name: String(item[nameKey] ?? ''), parent: String(parentId(item[parentKey]) ?? '') },
    );
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFieldErrors({});
    setFormError(null);
    const body = { [codeKey]: form.code.trim(), [nameKey]: form.name.trim(), [parentKey]: form.parent ? Number(form.parent) : null };
    try {
      if (editing === 'new') await api(`/${resource}`, { method: 'POST', body });
      else if (editing) await api(`/${resource}/${editing.id}`, { method: 'PATCH', body });
      toast(`${singular} ${editing === 'new' ? 'created' : 'updated'}`);
      setEditing(null);
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFieldErrors(err.fields);
      setFormError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api(`/${resource}/${deleting.id}`, { method: 'DELETE' });
      toast(`${singular} deleted`);
      setDeleting(null);
      reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Delete failed', 'error');
    } finally {
      setDeleteBusy(false);
    }
  }

  // An item cannot be its own parent (or a parent of its ancestors, but BioTime validates that).
  const parentOptions = items.filter((i) => editing === 'new' || !editing || i.id !== editing.id);

  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={
          isAdmin && (
          <button className="btn-primary" onClick={() => openForm('new')}>
            <Icon name="plus" className="h-4 w-4" />
            New {singular.toLowerCase()}
          </button>
          )
        }
      />

      <div className="card">
        <div className="border-b border-slate-200 p-4">
          <div className="relative max-w-sm">
            <Icon name="search" className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input className="input pl-9" placeholder="Search code or name" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <TableState loading={loading} error={error} empty={!filtered.length} onRetry={reload} emptyTitle={`No ${title.toLowerCase()} found`}>
          <table className="table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Parent</th>
                {isAdmin && <th className="w-24" />}
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => {
                const pid = parentId(item[parentKey]);
                return (
                  <tr key={item.id}>
                    <td className="font-mono text-xs">{String(item[codeKey])}</td>
                    <td className="font-medium text-slate-900">{String(item[nameKey])}</td>
                    <td className="text-slate-600">{pid ? String(byId.get(pid)?.[nameKey] ?? item[`${parentKey}_name`] ?? pid) : '—'}</td>
                    {isAdmin && <td className="text-right">
                      <button className="btn-ghost" onClick={() => openForm(item)} aria-label={`Edit ${String(item[nameKey])}`}>
                        <Icon name="edit" className="h-4 w-4" />
                      </button>
                      <button className="btn-ghost text-red-600 hover:bg-red-50" onClick={() => setDeleting(item)} aria-label={`Delete ${String(item[nameKey])}`}>
                        <Icon name="trash" className="h-4 w-4" />
                      </button>
                    </td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableState>
      </div>

      <Modal
        open={editing !== null}
        title={editing === 'new' ? `New ${singular.toLowerCase()}` : `Edit ${singular.toLowerCase()}`}
        onClose={() => setEditing(null)}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </button>
            <button className="btn-primary" form="org-unit-form" disabled={saving}>
              {saving && <Spinner className="h-4 w-4 text-white" />}
              Save
            </button>
          </>
        }
      >
        <form id="org-unit-form" onSubmit={save} className="space-y-4">
          {formError && <Alert>{formError}</Alert>}
          <Field label="Code" error={fieldErrors[codeKey]}>
            <input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required maxLength={50} />
          </Field>
          <Field label="Name" error={fieldErrors[nameKey]}>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={100} />
          </Field>
          <Field label={`Parent ${singular.toLowerCase()}`} error={fieldErrors[parentKey]}>
            <select className="input" value={form.parent} onChange={(e) => setForm({ ...form, parent: e.target.value })}>
              <option value="">None</option>
              {parentOptions.map((i) => (
                <option key={i.id} value={i.id}>
                  {label(i)}
                </option>
              ))}
            </select>
          </Field>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        title={`Delete ${singular.toLowerCase()}`}
        message={
          <>
            Delete <strong>{label(deleting ?? undefined)}</strong>? BioTime will refuse if employees or devices still use it.
          </>
        }
        busy={deleteBusy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}

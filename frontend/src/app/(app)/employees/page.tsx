'use client';

import { useState, type FormEvent } from 'react';
import { EmployeeDevicesModal } from '@/components/device-control';
import { Icon } from '@/components/icons';
import { Alert, ConfirmDialog, Field, Modal, PageHeader, Pagination, Spinner, TableState, useToast } from '@/components/ui';
import { useUser } from '@/components/user-context';
import { api, ApiError, type FieldErrors, type Paginated } from '@/lib/api';
import { fullName, initials } from '@/lib/format';
import { useApi, useDebounced } from '@/lib/hooks';
import type { Employee, OrgUnit, SystemStatus } from '@/lib/types';

const PAGE_SIZE = 20;

const PRIVILEGES = [
  { value: '0', label: 'Employee' },
  { value: '2', label: 'Enroller' },
  { value: '6', label: 'Administrator' },
  { value: '14', label: 'Super administrator' },
];

type Form = {
  emp_code: string;
  first_name: string;
  last_name: string;
  department: string;
  position: string;
  area: string[];
  hire_date: string;
  gender: string;
  card_no: string;
  device_password: string;
  dev_privilege: string;
  mobile: string;
  email: string;
  enable_att: boolean;
};

const EMPTY: Form = {
  emp_code: '',
  first_name: '',
  last_name: '',
  department: '',
  position: '',
  area: [],
  hire_date: '',
  gender: '',
  card_no: '',
  device_password: '',
  dev_privilege: '0',
  mobile: '',
  email: '',
  enable_att: true,
};

const idOf = (v: unknown) => (v && typeof v === 'object' ? String((v as { id: number }).id) : v == null ? '' : String(v));

export default function EmployeesPage() {
  const toast = useToast();
  const { isAdmin } = useUser();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [department, setDepartment] = useState('');
  const [page, setPage] = useState(1);
  const dCode = useDebounced(code.trim());
  const dName = useDebounced(name.trim());

  const { data, error, loading, reload } = useApi<Paginated<Employee>>('/employees', {
    emp_code: dCode,
    first_name: dName,
    department,
    page,
    page_size: PAGE_SIZE,
  });
  const departments = useApi<{ data: OrgUnit[] }>('/departments/all');
  const positions = useApi<{ data: OrgUnit[] }>('/positions/all');
  const areas = useApi<{ data: OrgUnit[] }>('/areas/all');
  // Without BioTime, employees come from the devices: they can be edited here but not added or deleted.
  const status = useApi<SystemStatus>('/system/status');
  const fromDevices = status.data ? !status.data.biotime.enabled : false;

  const [editingId, setEditingId] = useState<number | 'new' | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [loadingForm, setLoadingForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Employee | null>(null);
  const [devicesFor, setDevicesFor] = useState<number | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  async function openForm(id: number | 'new') {
    setEditingId(id);
    setFieldErrors({});
    setFormError(null);
    if (id === 'new') {
      const firstDept = departments.data?.data[0];
      const firstArea = areas.data?.data[0];
      setForm({ ...EMPTY, department: firstDept ? String(firstDept.id) : '', area: firstArea ? [String(firstArea.id)] : [] });
      return;
    }
    // The detail endpoint returns plain ids for department/position/area: ideal for the form.
    setLoadingForm(true);
    try {
      const e = await api<Employee>(`/employees/${id}`);
      setForm({
        emp_code: e.emp_code ?? '',
        first_name: e.first_name ?? '',
        last_name: e.last_name ?? '',
        department: idOf(e.department),
        position: idOf(e.position),
        area: (e.area ?? []).map(idOf),
        hire_date: e.hire_date ?? '',
        gender: e.gender ?? '',
        card_no: e.card_no ?? '',
        device_password: e.device_password ?? '',
        dev_privilege: e.dev_privilege == null ? '0' : String(e.dev_privilege),
        mobile: e.mobile ?? '',
        email: e.email ?? '',
        enable_att: e.enable_att ?? true,
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not load employee');
    } finally {
      setLoadingForm(false);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFieldErrors({});
    setFormError(null);
    const body = {
      ...form,
      department: form.department ? Number(form.department) : fromDevices ? null : Number(form.department),
      position: form.position ? Number(form.position) : '',
      area: form.area.map(Number),
      dev_privilege: Number(form.dev_privilege),
    };
    try {
      if (editingId === 'new') {
        const created = await api<Employee>('/employees', { method: 'POST', body });
        if (fromDevices) {
          toast('Employee saved and sent to your devices. Now enroll their fingerprint or face.');
          // Straight to the enrollment steps and the delivery status
          setDevicesFor(created.id);
        } else toast('Employee created and sent to devices in the selected areas');
      } else {
        await api(`/employees/${editingId}`, { method: 'PATCH', body });
        toast(fromDevices ? 'Employee updated and sent to your devices' : 'Employee updated');
      }
      setEditingId(null);
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
      await api(`/employees/${deleting.id}`, { method: 'DELETE' });
      toast('Employee deleted');
      setDeleting(null);
      reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Delete failed', 'error');
    } finally {
      setDeleteBusy(false);
    }
  }

  const deptName = (e: Employee) => e.dept_name || (typeof e.department === 'object' ? e.department?.dept_name : '') || '—';
  const areaNames = (e: Employee) =>
    e.area_name || (e.area ?? []).map((a) => (typeof a === 'object' ? a.area_name : a)).join(', ') || '—';

  return (
    <>
      <PageHeader
        title="Employees"
        description={
          fromDevices
            ? 'Add people here and they are sent to every device; then enroll their fingerprint or face on the device. People enrolled directly on a device appear here too.'
            : 'People enrolled in BioTime. New employees are pushed to the devices in their areas.'
        }
        actions={
          isAdmin && (
          <button className="btn-primary" onClick={() => openForm('new')}>
            <Icon name="plus" className="h-4 w-4" />
            New employee
          </button>
          )
        }
      />

      <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-3">
        <label>
          <span className="label">Employee code</span>
          <input className="input" placeholder="e.g. 1001" value={code} onChange={(e) => { setCode(e.target.value); setPage(1); }} />
        </label>
        <label>
          <span className="label">First name</span>
          <input className="input" placeholder="Search name" value={name} onChange={(e) => { setName(e.target.value); setPage(1); }} />
        </label>
        <label>
          <span className="label">Department</span>
          <select className="input" value={department} onChange={(e) => { setDepartment(e.target.value); setPage(1); }}>
            <option value="">All departments</option>
            {departments.data?.data.map((d) => (
              <option key={d.id} value={d.id}>
                {String(d.dept_name)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="card">
        <TableState loading={loading} error={error} empty={!data?.data.length} onRetry={reload} emptyTitle="No employees found" emptyHint="Clear the filters or add a new employee.">
          <table className="table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Code</th>
                <th>Department</th>
                <th>Position</th>
                <th>Areas</th>
                <th>Card</th>
                {fromDevices && <th>Biometrics</th>}
                {fromDevices && <th>On devices</th>}
                <th>Attendance</th>
                {(isAdmin || fromDevices) && <th className="w-32" />}
              </tr>
            </thead>
            <tbody>
              {data?.data.map((e) => (
                <tr key={e.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
                        {initials(fullName(e) || e.emp_code)}
                      </div>
                      <div>
                        <div className="font-medium text-slate-900">{fullName(e) || '—'}</div>
                        {e.mobile && <div className="text-xs text-slate-500">{e.mobile}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="font-mono text-xs">{e.emp_code}</td>
                  <td>{deptName(e)}</td>
                  <td className="text-slate-600">{e.position_name || '—'}</td>
                  <td className="max-w-48 truncate text-slate-600">{areaNames(e)}</td>
                  <td className="text-slate-600">{e.card_no || '—'}</td>
                  {fromDevices && (
                    <td className="whitespace-nowrap text-xs text-slate-600">
                      {e.biometrics && (e.biometrics.fingerprints || e.biometrics.faces) ? (
                        <span className="flex items-center gap-1.5">
                          <Icon name="fingerprint" className="h-3.5 w-3.5 text-brand-600" />
                          {[e.biometrics.fingerprints && `${e.biometrics.fingerprints} finger${e.biometrics.fingerprints === 1 ? '' : 's'}`, e.biometrics.faces && 'face'].filter(Boolean).join(' + ')}
                        </span>
                      ) : (
                        <span className="text-slate-400">Not enrolled</span>
                      )}
                    </td>
                  )}
                  {fromDevices && (
                    <td className="whitespace-nowrap">
                      {!e.device_sync ? (
                        <span className="text-xs text-slate-400">—</span>
                      ) : e.device_sync.failed ? (
                        <span className="badge bg-red-50 text-red-700">Failed on {e.device_sync.failed}</span>
                      ) : e.device_sync.pending ? (
                        <span className="badge bg-amber-50 text-amber-700">Sending… {e.device_sync.done}/{e.device_sync.devices}</span>
                      ) : (
                        <span className="badge bg-brand-50 text-brand-700">{e.device_sync.done}/{e.device_sync.devices} devices</span>
                      )}
                    </td>
                  )}
                  <td>
                    <span className={`badge ${e.enable_att !== false ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-500'}`}>
                      {e.enable_att !== false ? 'Enabled' : 'Disabled'}
                    </span>
                  </td>
                  {(isAdmin || fromDevices) && <td className="whitespace-nowrap text-right">
                    {fromDevices && (
                      <button className="btn-ghost" onClick={() => setDevicesFor(e.id)} aria-label={`Devices and biometrics for ${e.emp_code}`} title="Devices, fingerprints & face">
                        <Icon name="fingerprint" className="h-4 w-4" />
                      </button>
                    )}
                    {isAdmin && (
                      <button className="btn-ghost" onClick={() => openForm(e.id)} aria-label={`Edit ${e.emp_code}`}>
                        <Icon name="edit" className="h-4 w-4" />
                      </button>
                    )}
                    {isAdmin && (
                      <button className="btn-ghost text-red-600 hover:bg-red-50" onClick={() => setDeleting(e)} aria-label={`Delete ${e.emp_code}`}>
                        <Icon name="trash" className="h-4 w-4" />
                      </button>
                    )}
                  </td>}
                </tr>
              ))}
            </tbody>
          </table>
        </TableState>
        {data && data.count > 0 && <Pagination page={page} pageSize={PAGE_SIZE} count={data.count} onPage={setPage} />}
      </div>

      <Modal
        wide
        open={editingId !== null}
        title={editingId === 'new' ? 'New employee' : 'Edit employee'}
        onClose={() => setEditingId(null)}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setEditingId(null)} disabled={saving}>
              Cancel
            </button>
            <button className="btn-primary" form="employee-form" disabled={saving || loadingForm}>
              {saving && <Spinner className="h-4 w-4 text-white" />}
              Save
            </button>
          </>
        }
      >
        {loadingForm ? (
          <div className="flex justify-center py-12">
            <Spinner className="h-7 w-7" />
          </div>
        ) : (
          <form id="employee-form" onSubmit={save} className="space-y-5">
            {formError && <Alert>{formError}</Alert>}

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Employee code *" error={fieldErrors.emp_code} hint={fromDevices ? (editingId === 'new' ? 'User ID on the device: digits, up to 9' : 'User ID on the device (can’t change)') : 'The ID people use on the device'}>
                <input
                  className="input"
                  disabled={fromDevices && editingId !== 'new'}
                  value={form.emp_code}
                  onChange={(e) => set('emp_code', e.target.value)}
                  required
                  inputMode={fromDevices ? 'numeric' : undefined}
                  maxLength={fromDevices ? 9 : 20}
                  pattern={fromDevices ? '[0-9]+' : '[A-Za-z0-9]+'}
                  title={fromDevices ? 'Digits only' : 'Letters and numbers only'}
                />
              </Field>
              <Field label="First name" error={fieldErrors.first_name}>
                <input className="input" value={form.first_name} onChange={(e) => set('first_name', e.target.value)} maxLength={25} />
              </Field>
              <Field label="Last name" error={fieldErrors.last_name}>
                <input className="input" value={form.last_name} onChange={(e) => set('last_name', e.target.value)} maxLength={25} />
              </Field>

              <Field label={fromDevices ? 'Department' : 'Department *'} error={fieldErrors.department}>
                <select className="input" value={form.department} onChange={(e) => set('department', e.target.value)} required={!fromDevices}>
                  <option value="">{fromDevices ? 'None' : 'Select…'}</option>
                  {departments.data?.data.map((d) => (
                    <option key={d.id} value={d.id}>
                      {String(d.dept_name)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Position" error={fieldErrors.position}>
                <select className="input" value={form.position} onChange={(e) => set('position', e.target.value)}>
                  <option value="">None</option>
                  {positions.data?.data.map((p) => (
                    <option key={p.id} value={p.id}>
                      {String(p.position_name)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Hire date" error={fieldErrors.hire_date}>
                <input className="input" type="date" value={form.hire_date} onChange={(e) => set('hire_date', e.target.value)} />
              </Field>

              <Field label="Gender" error={fieldErrors.gender}>
                <select className="input" value={form.gender} onChange={(e) => set('gender', e.target.value)}>
                  <option value="">Not set</option>
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                </select>
              </Field>
              <Field label="Mobile" error={fieldErrors.mobile}>
                <input className="input" value={form.mobile} onChange={(e) => set('mobile', e.target.value)} maxLength={20} />
              </Field>
              <Field label="Email" error={fieldErrors.email}>
                <input className="input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
              </Field>
            </div>

            <div>
              <p className="label">Device settings</p>
              <div className="grid gap-4 rounded-lg border border-slate-200 p-4 sm:grid-cols-3">
                {fromDevices && <p className="text-xs text-slate-500 sm:col-span-3">Name, card, password and role are sent to every device when you save. Fingerprint and face are enrolled on the device.</p>}
                <Field label="Card number" error={fieldErrors.card_no}>
                  <input className="input" value={form.card_no} onChange={(e) => set('card_no', e.target.value)} inputMode="numeric" maxLength={20} />
                </Field>
                <Field label="Device password" error={fieldErrors.device_password} hint="PIN typed on the device">
                  <input className="input" value={form.device_password} onChange={(e) => set('device_password', e.target.value)} inputMode="numeric" maxLength={8} autoComplete="off" />
                </Field>
                <Field label="Device role" error={fieldErrors.dev_privilege}>
                  <select className="input" value={form.dev_privilege} onChange={(e) => set('dev_privilege', e.target.value)}>
                    {PRIVILEGES.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-3">
                  <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={form.enable_att} onChange={(e) => set('enable_att', e.target.checked)} />
                  Track attendance for this person
                </label>
              </div>
            </div>

            <div>
              <p className="label">{fromDevices ? 'Areas (for reports)' : 'Areas (devices this person is sent to)'} {fieldErrors.area && <span className="text-red-600">— {fieldErrors.area}</span>}</p>
              <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 p-3">
                {areas.data?.data.length ? (
                  areas.data.data.map((a) => {
                    const id = String(a.id);
                    const checked = form.area.includes(id);
                    return (
                      <label
                        key={a.id}
                        className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${checked ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600'}`}
                      >
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 accent-brand-600"
                          checked={checked}
                          onChange={() => set('area', checked ? form.area.filter((x) => x !== id) : [...form.area, id])}
                        />
                        {String(a.area_name)}
                      </label>
                    );
                  })
                ) : (
                  <span className="text-sm text-slate-500">No areas yet. Create one on the Areas page.</span>
                )}
              </div>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete employee"
        message={
          <>
            Delete <strong>{deleting ? fullName(deleting) || deleting.emp_code : ''}</strong> ({deleting?.emp_code}) {fromDevices ? 'and remove them, with their fingerprints and face, from every device' : 'from BioTime'}? This cannot be undone.
          </>
        }
        busy={deleteBusy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />

      <EmployeeDevicesModal employeeId={devicesFor} onClose={() => setDevicesFor(null)} onChanged={reload} />
    </>
  );
}

'use client';

import { useState, type FormEvent } from 'react';
import { Icon } from '@/components/icons';
import { Alert, ConfirmDialog, Field, Modal, PageHeader, Pagination, Spinner, TableState, useToast } from '@/components/ui';
import { useUser } from '@/components/user-context';
import { api, ApiError, type FieldErrors, type Paginated } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { DeliveryStatus, WebhookDeliveryRow, WebhookEventName, WebhookRow } from '@/lib/types';

const EVENTS: { value: WebhookEventName; label: string; hint: string }[] = [
  { value: 'punch.created', label: 'New punches', hint: 'Sent as punches arrive: within seconds for devices that push (ADMS), and after each sync for devices that are read. Up to 100 per request.' },
  { value: 'sync.completed', label: 'Sync completed', hint: 'A summary after every successful punch sync.' },
  { value: 'sync.failed', label: 'Sync failed', hint: 'When a device (or BioTime) could not be reached or a sync errored.' },
];

const STATUS_STYLE: Record<DeliveryStatus, string> = {
  success: 'bg-brand-50 text-brand-700',
  pending: 'bg-amber-50 text-amber-700',
  failed: 'bg-red-50 text-red-700',
};

type Form = { name: string; url: string; events: WebhookEventName[]; is_active: boolean; send_days: number };
const EMPTY: Form = { name: '', url: '', events: ['punch.created'], is_active: true, send_days: 1 };
const PAST_OPTIONS = [
  { days: 0, label: 'No, only new punches from now on' },
  { days: 1, label: 'Yes, today’s punches' },
  { days: 7, label: 'Yes, the last 7 days' },
  { days: 30, label: 'Yes, the last 30 days' },
];
const PAGE = 20;

export default function WebhooksPage() {
  const { isAdmin } = useUser();
  const toast = useToast();
  const hooks = useApi<{ data: WebhookRow[]; limits: { max_attempts: number; punches_per_delivery: number } }>(isAdmin ? '/webhooks' : null);

  const [filterHook, setFilterHook] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [page, setPage] = useState(1);
  const deliveries = useApi<Paginated<WebhookDeliveryRow>>(isAdmin ? '/webhooks/deliveries' : null, {
    webhook_id: filterHook,
    status: filterStatus,
    page,
    page_size: PAGE,
  });

  const [editing, setEditing] = useState<WebhookRow | 'new' | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [fields, setFields] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [secretView, setSecretView] = useState<{ name: string; secret: string } | null>(null);
  const [deleting, setDeleting] = useState<WebhookRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [detail, setDetail] = useState<WebhookDeliveryRow | null>(null);

  if (!isAdmin) return <Alert>Only administrators can manage webhooks.</Alert>;

  const reloadAll = () => {
    hooks.reload();
    deliveries.reload();
  };

  function open(h: WebhookRow | 'new') {
    setEditing(h);
    setFields({});
    setFormError(null);
    setForm(h === 'new' ? EMPTY : { name: h.name, url: h.url, events: h.events, is_active: h.is_active, send_days: 0 });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFields({});
    setFormError(null);
    try {
      if (editing === 'new') {
        const created = await api<WebhookRow & { past_punches: { punches: number } | null }>('/webhooks', { method: 'POST', body: form });
        setSecretView({ name: created.name, secret: created.secret });
        toast(created.past_punches ? `Webhook created. Sending ${created.past_punches.punches} saved punch(es) now…` : 'Webhook created');
      } else if (editing) {
        const { send_days: _ignored, ...changes } = form;
        await api(`/webhooks/${editing.id}`, { method: 'PATCH', body: changes });
        toast('Webhook updated');
      }
      setEditing(null);
      reloadAll();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFields(err.fields);
      setFormError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function run<T>(key: string, fn: () => Promise<T>, ok: (r: T) => string) {
    setBusy(key);
    try {
      const r = await fn();
      toast(ok(r));
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed', 'error');
    } finally {
      setBusy(null);
      reloadAll();
    }
  }

  const sendTest = (h: WebhookRow) =>
    run(
      `test-${h.id}`,
      () => api<WebhookDeliveryRow>(`/webhooks/${h.id}/test`, { method: 'POST' }),
      (d) => (d.status === 'success' ? `Test delivered (HTTP ${d.response_status})` : `Test failed: ${d.error}`),
    );

  const [pastFor, setPastFor] = useState<WebhookRow | null>(null);
  const [pastDays, setPastDays] = useState(1);
  const sendPast = () => {
    const h = pastFor;
    if (!h) return;
    setPastFor(null);
    return run(
      `past-${h.id}`,
      () => api<{ punches: number; deliveries: number }>(`/webhooks/${h.id}/send-past`, { method: 'POST', body: { days: pastDays } }),
      (r) => (r.punches ? `Sending ${r.punches} punch(es) to ${h.name} (${r.deliveries} request(s))` : 'No punches in that period'),
    );
  };

  const redeliver = (d: WebhookDeliveryRow) =>
    run(
      `re-${d.id}`,
      () => api<WebhookDeliveryRow>(`/webhooks/deliveries/${d.id}/redeliver`, { method: 'POST' }),
      (r) => (r.status === 'success' ? `Delivered (HTTP ${r.response_status})` : `Still failing: ${r.error}`),
    );

  async function showSecret(h: WebhookRow) {
    try {
      const full = await api<WebhookRow>(`/webhooks/${h.id}`);
      setSecretView({ name: full.name, secret: full.secret });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed', 'error');
    }
  }

  async function rotate() {
    if (editing === 'new' || !editing) return;
    try {
      const updated = await api<WebhookRow>(`/webhooks/${editing.id}`, { method: 'PATCH', body: { rotate_secret: true } });
      setEditing(null);
      setSecretView({ name: updated.name, secret: updated.secret });
      toast('New secret generated. Update it in the receiving system.');
      reloadAll();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed', 'error');
    }
  }

  async function openDetail(d: WebhookDeliveryRow) {
    try {
      setDetail(await api<WebhookDeliveryRow>(`/webhooks/deliveries/${d.id}`));
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed', 'error');
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api(`/webhooks/${deleting.id}`, { method: 'DELETE' });
      toast('Webhook deleted');
      setDeleting(null);
      reloadAll();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Delete failed', 'error');
    } finally {
      setDeleteBusy(false);
    }
  }

  const limits = hooks.data?.limits;

  return (
    <>
      <PageHeader
        title="Webhooks"
        description="Send new punches and sync results to other systems (school software, SMS, payroll). Every delivery is saved and retried if it fails."
        actions={
          <button className="btn-primary" onClick={() => open('new')}>
            <Icon name="plus" className="h-4 w-4" />
            New webhook
          </button>
        }
      />

      <div className="card mb-6">
        <TableState
          loading={hooks.loading}
          error={hooks.error}
          empty={!hooks.data?.data.length}
          onRetry={hooks.reload}
          emptyTitle="No webhooks yet"
          emptyHint="Add one to send new punches to another system automatically, as they arrive."
        >
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>URL</th>
                <th>Events</th>
                <th>Status</th>
                <th>Last 24 h</th>
                <th>Last delivery</th>
                <th className="w-44" />
              </tr>
            </thead>
            <tbody>
              {hooks.data?.data.map((h) => (
                <tr key={h.id}>
                  <td className="font-medium text-slate-900">{h.name}</td>
                  <td className="max-w-64 truncate font-mono text-xs" title={h.url}>
                    {h.url}
                  </td>
                  <td className="text-xs text-slate-600">{h.events.join(', ')}</td>
                  <td>
                    <span className={`badge ${h.is_active ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-500'}`}>{h.is_active ? 'Active' : 'Paused'}</span>
                  </td>
                  <td className="text-xs tabular-nums">
                    <span className="text-brand-700">{h.last_24h?.success ?? 0} ok</span>
                    {' · '}
                    <span className={h.last_24h?.failed ? 'text-red-700' : 'text-slate-400'}>{h.last_24h?.failed ?? 0} failed</span>
                    {h.last_24h?.pending ? <span className="text-amber-700"> · {h.last_24h.pending} retrying</span> : null}
                  </td>
                  <td>
                    {h.last_status && <span className={`badge mr-1 ${STATUS_STYLE[h.last_status]}`}>{h.last_status}</span>}
                    <span className="text-xs text-slate-500">{timeAgo(h.last_delivery_at)}</span>
                  </td>
                  <td className="text-right">
                    <button className="btn-secondary px-2.5 py-1" onClick={() => sendTest(h)} disabled={busy === `test-${h.id}`}>
                      {busy === `test-${h.id}` ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="send" className="h-3.5 w-3.5" />}
                      Test
                    </button>
                    {h.events.includes('punch.created') && (
                      <button className="btn-ghost" onClick={() => { setPastDays(1); setPastFor(h); }} disabled={busy === `past-${h.id}` || !h.is_active} title="Send punches already saved" aria-label={`Send past punches to ${h.name}`}>
                        {busy === `past-${h.id}` ? <Spinner className="h-4 w-4" /> : <Icon name="clock" className="h-4 w-4" />}
                      </button>
                    )}
                    <button className="btn-ghost" onClick={() => showSecret(h)} title="Show signing secret" aria-label={`Secret for ${h.name}`}>
                      <Icon name="shield" className="h-4 w-4" />
                    </button>
                    <button className="btn-ghost" onClick={() => open(h)} aria-label={`Edit ${h.name}`}>
                      <Icon name="edit" className="h-4 w-4" />
                    </button>
                    <button className="btn-ghost text-red-600 hover:bg-red-50" onClick={() => setDeleting(h)} aria-label={`Delete ${h.name}`}>
                      <Icon name="trash" className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableState>
      </div>

      <section className="card">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="font-semibold text-slate-900">Delivery log</h2>
            <p className="text-sm text-slate-500">
              Every request sent, with the receiver&apos;s answer. Failed requests are retried automatically
              {limits ? ` (up to ${limits.max_attempts} attempts over about 8 hours)` : ''}.
            </p>
          </div>
          <div className="flex gap-2">
            <select className="input w-44" value={filterHook} onChange={(e) => { setFilterHook(e.target.value); setPage(1); }}>
              <option value="">All webhooks</option>
              {hooks.data?.data.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
            <select className="input w-36" value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}>
              <option value="">Any status</option>
              <option value="success">Success</option>
              <option value="pending">Retrying</option>
              <option value="failed">Failed</option>
            </select>
            <button className="btn-secondary" onClick={deliveries.reload} aria-label="Refresh deliveries">
              <Icon name="refresh" className="h-4 w-4" />
            </button>
          </div>
        </div>
        <TableState loading={deliveries.loading} error={deliveries.error} empty={!deliveries.data?.data.length} onRetry={deliveries.reload} emptyTitle="No deliveries yet">
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Created</th>
                <th>Webhook</th>
                <th>Event</th>
                <th>Status</th>
                <th className="text-right">Attempts</th>
                <th>Response</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {deliveries.data?.data.map((d) => (
                <tr key={d.id} className="cursor-pointer" onClick={() => openDetail(d)}>
                  <td className="text-xs text-slate-500">{d.id}</td>
                  <td className="tabular-nums">{d.created_at}</td>
                  <td>{d.webhook_name}</td>
                  <td className="font-mono text-xs">{d.event}</td>
                  <td>
                    <span className={`badge ${STATUS_STYLE[d.status]}`}>{d.status === 'pending' ? 'retrying' : d.status}</span>
                  </td>
                  <td className="text-right tabular-nums">{d.attempts}</td>
                  <td className="max-w-72 truncate text-xs text-slate-600" title={d.error ?? ''}>
                    {d.response_status ? `HTTP ${d.response_status}` : ''}
                    {d.error ? ` ${d.error}` : d.duration_ms !== null ? ` · ${d.duration_ms} ms` : ''}
                  </td>
                  <td className="text-right" onClick={(e) => e.stopPropagation()}>
                    {d.status !== 'success' && (
                      <button className="btn-secondary px-2.5 py-1" onClick={() => redeliver(d)} disabled={busy === `re-${d.id}`}>
                        {busy === `re-${d.id}` ? <Spinner className="h-3.5 w-3.5" /> : 'Resend'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableState>
        {deliveries.data && deliveries.data.count > PAGE && <Pagination page={page} pageSize={PAGE} count={deliveries.data.count} onPage={setPage} />}
      </section>

      {/* Create / edit */}
      <Modal
        open={editing !== null}
        title={editing === 'new' ? 'New webhook' : `Edit ${editing?.name ?? ''}`}
        onClose={() => setEditing(null)}
        footer={
          <>
            {editing !== 'new' && (
              <button className="btn-secondary mr-auto" onClick={rotate} disabled={saving}>
                New secret
              </button>
            )}
            <button className="btn-secondary" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </button>
            <button className="btn-primary" form="webhook-form" disabled={saving}>
              {saving && <Spinner className="h-4 w-4 text-white" />}
              Save
            </button>
          </>
        }
      >
        <form id="webhook-form" onSubmit={save} className="space-y-4">
          {formError && <Alert>{formError}</Alert>}
          <Field label="Name" error={fields.name}>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={100} placeholder="e.g. School management system" />
          </Field>
          <Field label="URL" error={fields.url} hint="We POST JSON to this address">
            <input className="input font-mono text-xs" type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} required placeholder="https://example.com/hooks/attendance" />
          </Field>
          <div>
            <p className="label">Events {fields.events && <span className="text-red-600">— {fields.events}</span>}</p>
            <div className="space-y-2 rounded-lg border border-slate-200 p-3">
              {EVENTS.map((ev) => (
                <label key={ev.value} className="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-brand-600"
                    checked={form.events.includes(ev.value)}
                    onChange={(e) =>
                      setForm({ ...form, events: e.target.checked ? [...form.events, ev.value] : form.events.filter((x) => x !== ev.value) })
                    }
                  />
                  <span>
                    <span className="text-sm font-medium text-slate-800">{ev.label}</span>{' '}
                    <span className="font-mono text-xs text-slate-400">{ev.value}</span>
                    <span className="block text-xs text-slate-500">{ev.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
            Active
          </label>
          {editing === 'new' && form.events.includes('punch.created') && (
            <Field label="Also send punches that are already saved?" hint="New punches are always sent automatically as they arrive (live from devices, and at every sync).">
              <select className="input" value={form.send_days} onChange={(e) => setForm({ ...form, send_days: Number(e.target.value) })}>
                {PAST_OPTIONS.map((o) => (
                  <option key={o.days} value={o.days}>{o.label}</option>
                ))}
              </select>
            </Field>
          )}
        </form>
      </Modal>

      {/* Send punches already saved */}
      <Modal
        open={Boolean(pastFor)}
        title={`Send past punches: ${pastFor?.name ?? ''}`}
        onClose={() => setPastFor(null)}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setPastFor(null)}>Cancel</button>
            <button className="btn-primary" onClick={sendPast}>
              <Icon name="send" className="h-4 w-4" />
              Send
            </button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-slate-600">
          <p>Send punches that are already saved to this webhook, for example after setting up the receiver or after it was down. They go out in batches of up to 100, with automatic retries. The receiver should ignore punch ids it already has.</p>
          <Field label="Period">
            <select className="input" value={pastDays} onChange={(e) => setPastDays(Number(e.target.value))}>
              {PAST_OPTIONS.filter((o) => o.days > 0).map((o) => (
                <option key={o.days} value={o.days}>{o.label.replace('Yes, ', '').replace(/^t/, 'T')}</option>
              ))}
            </select>
          </Field>
        </div>
      </Modal>

      {/* Signing secret */}
      <Modal open={Boolean(secretView)} title={`Signing secret: ${secretView?.name ?? ''}`} onClose={() => setSecretView(null)} wide>
        {secretView && (
          <div className="space-y-4 text-sm">
            <p className="text-slate-600">Give this secret to the receiving system so it can check each request really came from here.</p>
            <div className="flex gap-2">
              <code className="flex-1 break-all rounded-lg bg-slate-100 px-3 py-2 font-mono text-xs">{secretView.secret}</code>
              <button
                className="btn-secondary"
                onClick={() => navigator.clipboard.writeText(secretView.secret).then(() => toast('Copied'))}
              >
                Copy
              </button>
            </div>
            <div>
              <p className="label">How the receiver verifies a request</p>
              <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">{`// Headers sent with every request:
//   X-Webhook-Event:     punch.created | sync.completed | sync.failed | webhook.test
//   X-Webhook-Delivery:  delivery id (use it to ignore duplicates)
//   X-Webhook-Timestamp: unix seconds
//   X-Webhook-Signature: sha256=<hex>

const expected = 'sha256=' + crypto
  .createHmac('sha256', SECRET)
  .update(timestamp + '.' + rawBody)
  .digest('hex');
if (expected !== req.headers['x-webhook-signature']) reject();
// Answer with any 2xx status. Anything else is retried.`}</pre>
            </div>
          </div>
        )}
      </Modal>

      {/* Delivery detail */}
      <Modal open={Boolean(detail)} title={`Delivery #${detail?.id ?? ''}`} onClose={() => setDetail(null)} wide>
        {detail && (
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
              {[
                ['Event', detail.event],
                ['Status', detail.status],
                ['Attempts', detail.attempts],
                ['HTTP', detail.response_status ?? '—'],
                ['Created', detail.created_at],
                ['Delivered', detail.delivered_at ?? '—'],
                ['Next retry', detail.next_attempt_at ?? '—'],
                ['Sync run', detail.sync_run_id ?? '—'],
              ].map(([k, v]) => (
                <div key={String(k)}>
                  <dt className="text-xs text-slate-500">{k}</dt>
                  <dd className="text-slate-900">{String(v)}</dd>
                </div>
              ))}
            </dl>
            {detail.error && <Alert>{detail.error}</Alert>}
            <div>
              <p className="label">Payload sent</p>
              <pre className="max-h-80 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{JSON.stringify(detail.payload, null, 2)}</pre>
            </div>
            {detail.response_body && (
              <div>
                <p className="label">Receiver response</p>
                <pre className="max-h-40 overflow-auto rounded-lg bg-slate-100 p-3 text-xs">{detail.response_body}</pre>
              </div>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete webhook"
        message={
          <>
            Delete <strong>{deleting?.name}</strong> and its delivery history? Nothing more will be sent to this URL.
          </>
        }
        busy={deleteBusy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}

'use client';

import { useState } from 'react';
import { DeviceStatus } from '@/components/badges';
import { Icon } from '@/components/icons';
import { Modal, PageHeader, TableState } from '@/components/ui';
import { shortDateTime } from '@/lib/format';
import { useApi, useDebounced } from '@/lib/hooks';
import type { Device } from '@/lib/types';

export default function DevicesPage() {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Device | null>(null);
  const q = useDebounced(search.trim().toLowerCase(), 200);
  const { data, error, loading, reload } = useApi<{ data: Device[] }>('/devices/all');

  const devices = (data?.data ?? []).filter(
    (d) => !q || [d.sn, d.alias, d.ip_address, d.area_name].some((v) => v?.toLowerCase().includes(q)),
  );

  return (
    <>
      <PageHeader
        title="Devices"
        description="ZKTeco terminals registered in BioTime. Add or remove devices in BioTime itself."
        actions={
          <button className="btn-secondary" onClick={reload} disabled={loading}>
            <Icon name="refresh" className="h-4 w-4" />
            Refresh
          </button>
        }
      />

      <div className="card">
        <div className="border-b border-slate-200 p-4">
          <div className="relative max-w-sm">
            <Icon name="search" className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input className="input pl-9" placeholder="Search serial, name, IP, area" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <TableState loading={loading} error={error} empty={!devices.length} onRetry={reload} emptyTitle="No devices found" emptyHint="Devices appear here once they connect to BioTime via ADMS/PUSH.">
          <table className="table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Name</th>
                <th>Serial number</th>
                <th>IP address</th>
                <th>Area</th>
                <th className="text-right">Users</th>
                <th className="text-right">Fingerprints</th>
                <th className="text-right">Faces</th>
                <th className="text-right">Punches</th>
                <th>Last activity</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id} className="cursor-pointer" onClick={() => setSelected(d)}>
                  <td>
                    <DeviceStatus state={d.state} />
                  </td>
                  <td className="font-medium text-slate-900">{d.alias || '—'}</td>
                  <td className="font-mono text-xs">{d.sn}</td>
                  <td>{d.ip_address || '—'}</td>
                  <td>{d.area_name || d.area?.area_name || '—'}</td>
                  <td className="text-right tabular-nums">{d.user_count ?? '—'}</td>
                  <td className="text-right tabular-nums">{d.fp_count ?? '—'}</td>
                  <td className="text-right tabular-nums">{d.face_count ?? '—'}</td>
                  <td className="text-right tabular-nums">{d.transaction_count ?? '—'}</td>
                  <td>{shortDateTime(d.last_activity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableState>
      </div>

      <Modal open={Boolean(selected)} title={selected?.alias || selected?.sn || 'Device'} onClose={() => setSelected(null)}>
        {selected && (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            {[
              ['Serial number', selected.sn],
              ['Status', <DeviceStatus key="s" state={selected.state} />],
              ['IP address', selected.ip_address],
              ['Area', selected.area_name || selected.area?.area_name],
              ['Firmware', selected.fw_ver],
              ['Push version', selected.push_ver],
              ['Time zone', selected.terminal_tz],
              ['Attendance device', selected.is_attendance ? 'Yes' : 'No'],
              ['Transfer times', selected.transfer_time],
              ['Transfer interval', selected.transfer_interval ? `${selected.transfer_interval} min` : null],
              ['Last activity', selected.last_activity],
              ['Last push', selected.push_time],
              ['Users', selected.user_count],
              ['Fingerprints', selected.fp_count],
              ['Faces', selected.face_count],
              ['Palms', selected.palm_count],
              ['Punches', selected.transaction_count],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <dt className="text-xs text-slate-500">{label}</dt>
                <dd className="mt-0.5 text-slate-900">{value === null || value === undefined || value === '' ? '—' : value}</dd>
              </div>
            ))}
          </dl>
        )}
      </Modal>
    </>
  );
}

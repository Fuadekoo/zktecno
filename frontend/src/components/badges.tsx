import { deviceOnline } from '@/lib/format';

export function PunchBadge({ state, label }: { state: string; label: string }) {
  const tone =
    state === '0' || state === '4'
      ? 'bg-brand-50 text-brand-700'
      : state === '1' || state === '5'
        ? 'bg-slate-100 text-slate-700'
        : 'bg-amber-50 text-amber-700';
  return <span className={`badge ${tone}`}>{label}</span>;
}

export function DeviceStatus({ state }: { state: number | string | null }) {
  const online = deviceOnline(state);
  return (
    <span className={`badge ${online ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-700'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-brand-500' : 'bg-red-500'}`} />
      {online ? 'Online' : 'Offline'}
    </span>
  );
}

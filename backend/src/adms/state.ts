/** Live view of devices pushing over ADMS (since the server started). Shared by the receiver and the command queue. */

/** What a device reports about itself in the INFO= parameter of /iclock/getrequest. */
export interface AdmsDeviceInfo {
  firmware: string | null;
  users: number | null;
  fingerprints: number | null;
  punches: number | null;
  ip: string | null;
  faces: number | null;
}

export interface AdmsDeviceState {
  sn: string;
  ip: string | null;
  allowed: boolean;
  first_seen: string;
  last_seen: string;
  /** Epoch ms of the last request, for "is it polling right now" checks */
  last_seen_ms: number;
  last_attlog_at: string | null;
  punches_received: number;
  punches_saved: number;
  /** Users and fingerprint/face templates uploaded since start */
  users_received: number;
  templates_received: number;
  commands_sent: number;
  info: AdmsDeviceInfo | null;
  last_forward_status: number | null;
  last_error: string | null;
}

export const admsDevices = new Map<string, AdmsDeviceState>();

/** A push device counts as connected if it asked for commands recently (it polls every ~10 s). */
export function isPolling(sn: string | null | undefined, withinMs = 5 * 60_000) {
  const d = sn ? admsDevices.get(sn) : undefined;
  return Boolean(d && Date.now() - d.last_seen_ms < withinMs);
}

const num = (v: string | undefined) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? n : null;
};

/**
 * INFO=Ver 8.0.4.2-20190415,4,3,104,192.168.1.201,10,7,15,2,111
 * firmware, users, fingerprints, punches, IP, FP algorithm, face algorithm, face templates per person, faces, functions
 */
export function parseInfo(value: string): AdmsDeviceInfo | null {
  const f = value.split(',').map((x) => x.trim());
  if (f.length < 4) return null;
  return {
    firmware: f[0] || null,
    users: num(f[1]),
    fingerprints: num(f[2]),
    punches: num(f[3]),
    ip: f[4] || null,
    faces: num(f[8]),
  };
}

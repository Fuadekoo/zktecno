/**
 * Finds ZKTeco devices on this PC's local networks.
 *
 * 1. Every address of each local IPv4 /24 network is probed on port 4370: a TCP connect, and for hosts
 *    that don't take TCP, a UDP "connect" packet (older devices only speak UDP).
 * 2. Each address that answers is then asked for its serial number, model and counts (zk.status).
 * 3. Devices already pushing to this server over ADMS are included too, even when their port is closed.
 */
import dgram from 'node:dgram';
import net from 'node:net';
import os from 'node:os';
import { adms } from '../adms/server.js';
import { zk, type ZkDeviceStatus } from './client.js';

export interface FoundDevice {
  ip: string;
  port: number;
  /** How it was found: answered on the network, and/or is pushing to this server */
  via: ('tcp' | 'udp' | 'push')[];
  serial_number: string | null;
  model: string | null;
  firmware: string | null;
  user_count: number | null;
  log_count: number | null;
  /** Answered the port scan but refused the details request (busy, or Comm Key set) */
  error: string | null;
  last_push_at: string | null;
}

export interface ScanResult {
  networks: string[];
  scanned: number;
  ms: number;
  devices: FoundDevice[];
}

const PORT = 4370;
const VIRTUAL_ADAPTER = /vmware|virtualbox|vbox|hyper-v|vethernet|wsl|docker|loopback|npcap/i;

/** The /24 networks of this PC's real network adapters, e.g. "192.168.100". */
export function localNetworks(): { prefix: string; self: string; name: string }[] {
  const out: { prefix: string; self: string; name: string }[] = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    // Virtual adapters (VMs, WSL, Docker) can't have attendance devices on them
    if (VIRTUAL_ADAPTER.test(name)) continue;
    for (const i of list ?? []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      if (i.address.startsWith('169.254.')) continue; // no DHCP answer, nothing to find
      const prefix = i.address.split('.').slice(0, 3).join('.');
      if (!out.some((n) => n.prefix === prefix)) out.push({ prefix, self: i.address, name });
    }
  }
  return out;
}

function probeTcp(ip: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ host: ip, port: PORT });
    const done = (ok: boolean) => {
      s.removeAllListeners();
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(timeoutMs, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

/** ZK protocol header: command, checksum, session id, reply id (little-endian 16-bit each). */
function zkPacket(command: number) {
  const buf = Buffer.alloc(8);
  buf.writeUInt16LE(command, 0);
  buf.writeUInt16LE(0, 2);
  buf.writeUInt16LE(0, 4);
  buf.writeUInt16LE(0xfffe, 6);
  // Checksum over the packet with the checksum field zeroed
  let sum = 0;
  for (let i = 0; i < buf.length; i += 2) sum += buf.readUInt16LE(i);
  while (sum > 0xffff) sum = (sum & 0xffff) + (sum >>> 16);
  buf.writeUInt16LE(~sum & 0xffff, 2);
  return buf;
}
const CMD_CONNECT = 1000;
const CMD_EXIT = 1001;
const REPLY_OK = new Set([2000, 2005]); // ACK_OK, ACK_UNAUTH (device is there, wants a Comm Key)

function probeUdp(ip: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    const t = setTimeout(() => finish(false), timeoutMs);
    function finish(ok: boolean) {
      clearTimeout(t);
      try {
        if (ok) sock.send(zkPacket(CMD_EXIT), PORT, ip, () => sock.close());
        else sock.close();
      } catch {
        // already closed
      }
      resolve(ok);
    }
    sock.on('message', (msg) => finish(msg.length >= 8 && REPLY_OK.has(msg.readUInt16LE(0))));
    sock.on('error', () => finish(false));
    sock.send(zkPacket(CMD_CONNECT), PORT, ip, (err) => err && finish(false));
  });
}

/** Run `fn` over `items` with at most `limit` at a time. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

export interface ScanEvents {
  /** Scan started: which networks, how many addresses */
  onStart?: (info: { networks: string[]; total: number }) => void;
  /** Addresses checked so far */
  onProgress?: (done: number, total: number) => void;
  /** A device was found (sent as soon as its details are read) */
  onDevice?: (device: FoundDevice) => void;
  /** Stop early (e.g. the person pressed Pause or closed the window) */
  signal?: AbortSignal;
}

/**
 * Scan this PC's networks. Devices are reported through `onDevice` as they are found, and also
 * returned at the end.
 */
export async function scanNetwork(events: ScanEvents = {}, timeoutMs = 700): Promise<ScanResult> {
  const started = Date.now();
  const nets = localNetworks();
  const own = new Set(nets.map((n) => n.self));
  const targets = nets.flatMap((n) => Array.from({ length: 254 }, (_, i) => `${n.prefix}.${i + 1}`)).filter((ip) => !own.has(ip));
  const networks = nets.map((n) => `${n.prefix}.0/24 (${n.name})`);
  const stopped = () => Boolean(events.signal?.aborted);
  events.onStart?.({ networks, total: targets.length });

  const devices: FoundDevice[] = [];
  const pushing = adms.devices();
  const emit = (d: FoundDevice) => {
    // Pushing to us too? Then say so, and fill in the serial number from the push
    const p = pushing.find((x) => (d.serial_number && x.sn === d.serial_number) || (x.ip && x.ip === d.ip));
    if (p) {
      if (!d.via.includes('push')) d.via.push('push');
      d.last_push_at = p.last_seen;
      d.serial_number ??= p.sn;
    }
    devices.push(d);
    events.onDevice?.(d);
  };

  // Details are read one device at a time (devices accept a single connection), while probing goes on
  let details = Promise.resolve();
  const found = (ip: string, via: 'tcp' | 'udp') => {
    details = details.then(async () => {
      if (stopped()) return;
      const s: ZkDeviceStatus = await zk.status({ ip, port: PORT, timeoutMs: 5000 });
      emit({
        ip,
        port: PORT,
        via: [via],
        serial_number: s.serial_number,
        model: s.device_name,
        firmware: s.firmware,
        user_count: s.user_count,
        log_count: s.log_count,
        error: s.online ? null : s.error,
        last_push_at: null,
      });
    });
  };

  // 1. TCP on every address, then UDP on the ones that didn't take TCP (older devices)
  let done = 0;
  const tick = () => {
    done++;
    if (done % 16 === 0 || done === targets.length * 2) events.onProgress?.(Math.min(done, targets.length * 2), targets.length * 2);
  };
  const tcpHits = new Set<string>();
  await pool(targets, 128, async (ip) => {
    if (stopped()) return;
    if (await probeTcp(ip, timeoutMs)) {
      tcpHits.add(ip);
      found(ip, 'tcp');
    }
    tick();
  });
  await pool(targets, 64, async (ip) => {
    if (stopped()) return;
    if (!tcpHits.has(ip) && (await probeUdp(ip, timeoutMs))) found(ip, 'udp');
    tick();
  });
  await details;

  // 2. Devices pushing to this server that weren't found on the network (other network, port closed)
  if (!stopped()) {
    for (const p of pushing) {
      if (devices.some((d) => d.serial_number === p.sn || (p.ip && d.ip === p.ip))) continue;
      emit({ ip: p.ip ?? '', port: PORT, via: ['push'], serial_number: p.sn, model: null, firmware: null, user_count: null, log_count: null, error: null, last_push_at: p.last_seen });
    }
  }

  devices.sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }));
  return { networks, scanned: targets.length, ms: Date.now() - started, devices };
}

/**
 * Commands for attendance devices: add/update/remove people, copy fingerprints and faces between devices,
 * start fingerprint enrollment, fetch punches or users on demand, reboot.
 *
 * Every command is a row in device_commands, so nothing is lost while a device is offline, and the
 * dashboard can show what reached which device.
 *
 *  - Push devices (ADMS / "Cloud Server Setting") can sit behind NAT: the server can't reach them, so the
 *    command waits until the device polls GET /iclock/getrequest (every ~10 s), and the device reports
 *    the result on POST /iclock/devicecmd. Data a query asks for arrives on POST /iclock/cdata.
 *  - Pull devices are reached by the server on TCP/UDP 4370. Their commands run here right away and are
 *    retried for a while if the device is unreachable.
 */
import { isPolling } from '../adms/state.js';
import { config } from '../config.js';
import { dbNow, toDbFromInstant } from '../db/time.js';
import { biometricsRepo, type BiometricTemplate } from '../repositories/biometrics.js';
import { deviceCommandsRepo, type CommandChannel, type CommandKind } from '../repositories/deviceCommands.js';
import { employeeName, employeesRepo, type Employee } from '../repositories/employees.js';
import { punchesRepo } from '../repositories/punches.js';
import { zkDevicesRepo, type ZkDevice } from '../repositories/zkDevices.js';
import { HttpError } from '../utils/http.js';
import { zk, type ZkDeviceAddress } from '../zk/client.js';
import { syncService } from './sync.service.js';
import { realtime } from '../realtime.js';
import { webhookService } from './webhook.service.js';

/** What can only travel over ADMS (zkteco-js can't write templates or start enrollment). */
const PUSH_ONLY: CommandKind[] = ['template_upsert', 'enroll_fp', 'reboot', 'check'];
/** Wait before retrying an unreachable pull device: 1, 2, 5, 10, 30 minutes, then give up. */
const RETRY_MINUTES = [1, 2, 5, 10, 30];
/** A push device that took a command but never answered. */
const SENT_TIMEOUT_MS = 15 * 60_000;
const KEEP_DAYS = 60;

export const KIND_LABEL: Record<CommandKind, string> = {
  user_upsert: 'Add / update person',
  user_delete: 'Remove person',
  template_upsert: 'Copy fingerprint / face',
  enroll_fp: 'Enroll fingerprint',
  query_attlog: 'Fetch punches',
  query_users: 'Fetch users',
  reboot: 'Reboot',
  check: 'Upload new data',
};

/** Values go into tab-separated key=value lines: tabs and line breaks would break the format. */
const v = (x: unknown) => (x === null || x === undefined ? '' : String(x).replace(/[\t\r\n]/g, ' ').trim());

/** The name a device shows: 24 characters at most. */
const deviceName = (e: Employee) => (employeeName(e) || e.empCode).slice(0, 24);

/** ADMS is answering devices itself (not just relaying them to BioTime), so it can hand out commands. */
function pushAvailable() {
  return config.adms.enabled && !config.adms.forward;
}

function address(d: ZkDevice): ZkDeviceAddress {
  return { ip: d.ip!, port: d.port, timeoutMs: d.timeoutMs, chunkSize: d.chunkSize };
}

/**
 * How to reach a device for this kind of command, or why it can't be reached.
 * "Both" devices use ADMS while they are polling (faster, works for everything), else the network.
 */
export function channelFor(d: ZkDevice, kind: CommandKind): { channel: CommandChannel } | { error: string } {
  if (!d.enabled) return { error: `${d.name} is disabled in Settings > Devices` };
  const canPush = d.mode !== 'pull' && Boolean(d.serialNumber);
  const canPull = d.mode !== 'push' && Boolean(d.ip);
  const pushReason = !pushAvailable()
    ? config.adms.enabled
      ? 'ADMS is forwarding to BioTime, so BioTime sends the device commands'
      : 'ADMS push is turned off (Settings > ADMS)'
    : null;
  if (PUSH_ONLY.includes(kind)) {
    if (!canPush) return { error: `${KIND_LABEL[kind]} needs ADMS push: set ${d.name} to mode Push or Both, with its serial number` };
    if (pushReason) return { error: pushReason };
    return { channel: 'push' };
  }
  if (canPush && !pushReason && (!canPull || isPolling(d.serialNumber))) return { channel: 'push' };
  if (canPull) return { channel: 'pull' };
  if (canPush && pushReason) return { error: pushReason };
  return { error: `${d.name} has no IP address or serial number` };
}

// ---- ADMS command text ----

function userCommand(e: Employee) {
  return [
    `DATA UPDATE USERINFO PIN=${v(e.empCode)}`,
    `Name=${v(deviceName(e))}`,
    `Pri=${e.devPrivilege ?? 0}`,
    `Passwd=${v(e.devicePassword)}`,
    `Card=${v(e.cardNo)}`,
    'Grp=1',
    'TZ=0000000100000000',
    'Verify=0',
  ].join('\t');
}

/** Send a template back exactly the way a device uploaded it. */
function templateCommand(t: BiometricTemplate) {
  const table = t.format;
  const fields = (t.fields as [string, string][]).map(([k, val]) => `${k}=${v(val)}`);
  return `DATA UPDATE ${table} ${[...fields, `${t.tmpKey}=${t.template}`].join('\t')}`;
}

function describe(kind: CommandKind, p: Record<string, unknown>) {
  switch (kind) {
    case 'user_upsert':
      return `Add/update user ${p.emp_code} (${p.name})`;
    case 'user_delete':
      return `Remove user ${p.emp_code}`;
    case 'query_attlog':
      return `Read punches ${p.from} to ${p.to}`;
    case 'query_users':
      return 'Read all users';
    default:
      return KIND_LABEL[kind];
  }
}

export interface QueueOptions {
  empCode?: string | null;
  createdBy?: string | null;
  /** ADMS text (push) */
  command?: string;
  /** What a pull command needs */
  payload?: Record<string, unknown>;
}

class DeviceCommandService {
  private timer: NodeJS.Timeout | null = null;
  private working = false;
  private again = false;

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), 30_000);
    this.timer.unref();
    void this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick() {
    try {
      const expired = await deviceCommandsRepo.expireSent(toDbFromInstant(new Date(Date.now() - SENT_TIMEOUT_MS)));
      if (expired.count) console.warn(`[commands] ${expired.count} push command(s) got no reply from the device`);
      await deviceCommandsRepo.pruneBefore(toDbFromInstant(new Date(Date.now() - KEEP_DAYS * 86_400_000)));
    } catch (err) {
      console.error('[commands] Housekeeping failed:', (err as Error).message);
    }
    this.kick();
  }

  /** Queue one command for one device. Throws HttpError when the device can't take it. */
  async queue(d: ZkDevice, kind: CommandKind, o: QueueOptions) {
    const how = channelFor(d, kind);
    if ('error' in how) throw new HttpError(400, how.error);
    if (how.channel === 'push' && !o.command) throw new HttpError(400, `${KIND_LABEL[kind]} can’t be sent over ADMS`);
    const row = await deviceCommandsRepo.create({
      deviceId: d.id,
      channel: how.channel,
      kind,
      command: how.channel === 'push' ? o.command! : describe(kind, o.payload ?? {}),
      payload: o.payload,
      empCode: o.empCode ?? null,
      createdBy: o.createdBy ?? null,
    });
    if (how.channel === 'pull') this.kick();
    return row;
  }

  /** Every enabled device. */
  private async activeDevices() {
    return (await zkDevicesRepo.list()).filter((d) => d.enabled);
  }

  // ---- People ----

  /**
   * Send a person to every device (and, on push devices, their saved fingerprints/faces).
   * Devices that can't take it are reported, not fatal.
   */
  async pushEmployee(e: Employee, createdBy?: string | null, withTemplates = true) {
    const devices = await this.activeDevices();
    const templates = withTemplates ? await biometricsRepo.forEmployee(e.empCode) : [];
    const queued: number[] = [];
    const skipped: string[] = [];
    for (const d of devices) {
      try {
        const payload = { emp_code: e.empCode, name: deviceName(e), password: e.devicePassword, role: e.devPrivilege, card_no: e.cardNo };
        const row = await this.queue(d, 'user_upsert', { empCode: e.empCode, createdBy, command: userCommand(e), payload });
        queued.push(row.id);
        if (row.channel === 'push') {
          for (const t of templates) {
            if (t.sourceSn && t.sourceSn === d.serialNumber) continue;
            await this.queue(d, 'template_upsert', { empCode: e.empCode, createdBy, command: templateCommand(t) });
          }
        }
      } catch (err) {
        skipped.push((err as Error).message);
      }
    }
    return { queued: queued.length, skipped };
  }

  /** Remove a person from every device. */
  async removeEmployee(empCode: string, createdBy?: string | null) {
    const devices = await this.activeDevices();
    let queued = 0;
    const skipped: string[] = [];
    for (const d of devices) {
      try {
        await this.queue(d, 'user_delete', { empCode, createdBy, command: `DATA DELETE USERINFO PIN=${v(empCode)}`, payload: { emp_code: empCode } });
        queued++;
      } catch (err) {
        skipped.push((err as Error).message);
      }
    }
    await biometricsRepo.removeForEmployee(empCode);
    return { queued, skipped };
  }

  /** Ask a push device to start fingerprint enrollment for a person (the person then scans the finger 3 times). */
  async enrollFingerprint(d: ZkDevice, empCode: string, finger: number, createdBy?: string | null) {
    return this.queue(d, 'enroll_fp', {
      empCode,
      createdBy,
      command: `ENROLL_FP PIN=${v(empCode)}\tFID=${finger}\tRETRY=3\tOVERWRITE=1`,
    });
  }

  /** A template a device uploaded that is new or changed: copy it to every other push device. */
  async spreadTemplate(t: BiometricTemplate, fromSn: string) {
    if (!pushAvailable()) return 0;
    let n = 0;
    for (const d of await this.activeDevices()) {
      if (!d.serialNumber || d.serialNumber === fromSn || d.mode === 'pull') continue;
      try {
        await this.queue(d, 'template_upsert', { empCode: t.empCode, createdBy: `device ${fromSn}`, command: templateCommand(t) });
        n++;
      } catch {
        // device can't take templates right now: nothing to do
      }
    }
    return n;
  }

  // ---- Asking a device for data ----

  async fetchPunches(d: ZkDevice, from: string, to: string, createdBy?: string | null) {
    return this.queue(d, 'query_attlog', {
      createdBy,
      command: `DATA QUERY ATTLOG StartTime=${from}\tEndTime=${to}`,
      payload: { from, to },
    });
  }

  async fetchUsers(d: ZkDevice, createdBy?: string | null) {
    return this.queue(d, 'query_users', { createdBy, command: 'DATA QUERY USERINFO', payload: {} });
  }

  /** Send everyone to one device (e.g. a new or replaced device). */
  async sendAllEmployees(d: ZkDevice, createdBy?: string | null) {
    const people = await employeesRepo.active();
    let queued = 0;
    for (const e of people) {
      const payload = { emp_code: e.empCode, name: deviceName(e), password: e.devicePassword, role: e.devPrivilege, card_no: e.cardNo };
      const row = await this.queue(d, 'user_upsert', { empCode: e.empCode, createdBy, command: userCommand(e), payload });
      queued++;
      if (row.channel === 'push') {
        for (const t of await biometricsRepo.forEmployee(e.empCode)) {
          if (t.sourceSn && t.sourceSn === d.serialNumber) continue;
          await this.queue(d, 'template_upsert', { empCode: e.empCode, createdBy, command: templateCommand(t) });
          queued++;
        }
      }
    }
    return queued;
  }

  simple(d: ZkDevice, kind: 'reboot' | 'check', createdBy?: string | null) {
    return this.queue(d, kind, { createdBy, command: kind === 'reboot' ? 'REBOOT' : 'CHECK' });
  }

  // ---- ADMS side (called by the push receiver) ----

  /** Lines for GET /iclock/getrequest: "C:<id>:<command>", or nothing. */
  async nextForDevice(sn: string) {
    if (!pushAvailable()) return [];
    const d = (await zkDevicesRepo.list()).find((x) => x.serialNumber === sn && x.enabled && x.mode !== 'pull');
    if (!d) return [];
    const rows = await deviceCommandsRepo.nextPush(d.id);
    if (rows.length) realtime.emit('commands', { device_id: d.id, ids: rows.map((r) => r.id), status: 'sent' });
    return rows.map((r) => `C:${r.id}:${r.command}`);
  }

  /** POST /iclock/devicecmd body: one "ID=12&Return=0&CMD=DATA" line per finished command. */
  async recordResults(sn: string, body: string) {
    const d = (await zkDevicesRepo.list()).find((x) => x.serialNumber === sn);
    if (!d) return 0;
    let n = 0;
    for (const line of body.split(/\r?\n/)) {
      if (!line.includes('ID=')) continue;
      const q = new URLSearchParams(line.trim());
      const id = Number(q.get('ID'));
      const ret = Number(q.get('Return'));
      if (!Number.isInteger(id) || !Number.isFinite(ret)) continue;
      const result = ret >= 0 ? `Done (${q.get('CMD') ?? 'command'}, return ${ret})` : `The device returned error ${ret} (${q.get('CMD') ?? 'command'})`;
      if (await deviceCommandsRepo.complete(id, d.id, ret, result)) {
        n++;
        realtime.emit('commands', { device_id: d.id, ids: [id], status: ret >= 0 ? 'success' : 'failed', result });
      }
    }
    return n;
  }

  // ---- Pull side ----

  /** Run waiting pull commands one at a time (devices take one connection at a time anyway). */
  kick() {
    if (this.working) {
      this.again = true;
      return;
    }
    this.working = true;
    void (async () => {
      try {
        do {
          this.again = false;
          for (let next = await deviceCommandsRepo.nextPull(); next; next = await deviceCommandsRepo.nextPull()) {
            await this.runPull(next);
          }
        } while (this.again);
      } catch (err) {
        console.error('[commands] Pull worker failed:', (err as Error).message);
      } finally {
        this.working = false;
      }
    })();
  }

  private async runPull(c: NonNullable<Awaited<ReturnType<typeof deviceCommandsRepo.nextPull>>>) {
    const attempts = c.attempts + 1;
    const d = c.device;
    if (!d.ip) {
      await deviceCommandsRepo.finish(c.id, false, 'The device has no IP address', attempts);
      return;
    }
    const p = (c.payload ?? {}) as Record<string, unknown>;
    try {
      let result: string;
      switch (c.kind as CommandKind) {
        case 'user_upsert': {
          const r = await zk.upsertUser(address(d), {
            emp_code: String(p.emp_code),
            name: String(p.name ?? p.emp_code),
            password: (p.password as string | null) ?? null,
            role: Number(p.role ?? 0),
            card_no: (p.card_no as string | null) ?? null,
          });
          result = r.created ? `Added to the device (slot ${r.uid})` : `Updated on the device (slot ${r.uid})`;
          break;
        }
        case 'user_delete': {
          const r = await zk.deleteUser(address(d), String(p.emp_code));
          result = r.deleted ? 'Removed from the device' : 'Was not on the device';
          break;
        }
        case 'query_attlog': {
          const { serial, punches } = await zk.readPunches(address(d));
          const from = String(p.from);
          const to = String(p.to);
          const inRange = punches.filter((x) => x.punch_time >= from && x.punch_time <= to);
          const ids = await syncService.exclusivePunchWrite(() => punchesRepo.insertFromDevice(inRange, null, dbNow()));
          if (ids.length) await webhookService.queuePunches(await punchesRepo.byIds(ids), null);
          result = `${punches.length} punches on ${serial}, ${inRange.length} in range, ${ids.length} new`;
          break;
        }
        case 'query_users': {
          const users = await zk.readUsers(address(d));
          const r = await employeesRepo.upsertFromDevice(users, dbNow());
          realtime.emit('employees', { count: users.length, source: d.serialNumber ?? d.name });
          result =`${users.length} users on the device, ${r.created} new`;
          break;
        }
        default:
          throw Object.assign(new Error(`${KIND_LABEL[c.kind as CommandKind] ?? c.kind} can’t run over the network`), { permanent: true });
      }
      await deviceCommandsRepo.finish(c.id, true, result, attempts);
      realtime.emit('commands', { device_id: d.id, ids: [c.id], status: 'success', result });
      await zkDevicesRepo.markSeen(d.id, {}).catch(() => {});
      console.log(`[commands] #${c.id} ${d.name}: ${result}`);
    } catch (err) {
      const message = (err as Error).message;
      const wait = RETRY_MINUTES[attempts - 1];
      if ((err as { permanent?: boolean }).permanent || wait === undefined) {
        await deviceCommandsRepo.finish(c.id, false, message, attempts);
        realtime.emit('commands', { device_id: d.id, ids: [c.id], status: 'failed', result: message });
        console.warn(`[commands] #${c.id} ${d.name} failed: ${message}`);
      } else {
        await deviceCommandsRepo.retryLater(c.id, attempts, toDbFromInstant(new Date(Date.now() + wait * 60_000)), `${message} (retrying in ${wait} min)`);
        console.warn(`[commands] #${c.id} ${d.name}: ${message}; retrying in ${wait} min`);
        realtime.emit('commands', { device_id: d.id, ids: [c.id], status: 'pending', result: `${message} (retrying in ${wait} min)` });
      }
    }
  }
}

export const deviceCommands = new DeviceCommandService();

/** "YYYY-MM-DD" dates to the device's "YYYY-MM-DD HH:mm:ss" range. */
export const rangeOf = (startDate: string, endDate: string) => ({ from: `${startDate} 00:00:00`, to: `${endDate} 23:59:59` });

import type { Request, Response } from 'express';
import { admsDevices } from '../adms/state.js';
import { config } from '../config.js';
import { fromDb } from '../db/time.js';
import { auditRepo } from '../repositories/audit.js';
import { biometricsRepo, toApi as templateApi } from '../repositories/biometrics.js';
import { deviceCommandsRepo, toApi as commandApi, type CommandStatus } from '../repositories/deviceCommands.js';
import { employeeName, employeesRepo } from '../repositories/employees.js';
import { zkDevicesRepo, type ZkDevice } from '../repositories/zkDevices.js';
import { channelFor, deviceCommands, KIND_LABEL, rangeOf } from '../services/deviceCommands.service.js';
import { HttpError, pagination, parseId, str } from '../utils/http.js';

async function deviceOr404(id: number) {
  const d = await zkDevicesRepo.get(id);
  if (!d) throw new HttpError(404, 'Device not found');
  return d;
}

/** What each kind of command can do on this device right now (to enable/disable buttons). */
function capabilities(d: ZkDevice) {
  const can = (kind: Parameters<typeof channelFor>[1]) => {
    const r = channelFor(d, kind);
    return 'error' in r ? { ok: false, via: null, reason: r.error } : { ok: true, via: r.channel, reason: null };
  };
  return {
    users: can('user_upsert'),
    query_attlog: can('query_attlog'),
    query_users: can('query_users'),
    templates: can('template_upsert'),
    enroll: can('enroll_fp'),
    reboot: can('reboot'),
  };
}

const who = (req: Request) => req.user?.username ?? null;

const STATUSES: CommandStatus[] = ['pending', 'sent', 'success', 'failed', 'cancelled'];

export const deviceControlController = {
  /** Devices from Settings, with live ADMS state, what the device reports, waiting commands, and capabilities. */
  async devices(_req: Request, res: Response) {
    const [rows, pending] = await Promise.all([zkDevicesRepo.list(), deviceCommandsRepo.pendingByDevice()]);
    res.json({
      adms: { enabled: config.adms.enabled, forwarding: config.adms.forward, port: config.adms.port },
      biotime_enabled: config.biotime.enabled,
      data: rows.map((d) => {
        const push = d.serialNumber ? admsDevices.get(d.serialNumber) : undefined;
        return {
          id: d.id,
          name: d.name,
          mode: d.mode,
          ip: d.ip,
          port: d.port,
          serial_number: d.serialNumber,
          location: d.location,
          enabled: d.enabled,
          model: d.model,
          firmware: d.firmware ?? push?.info?.firmware ?? null,
          last_seen_at: fromDb(d.lastSeenAt),
          push: push
            ? {
                last_seen: push.last_seen,
                polling: Date.now() - push.last_seen_ms < 5 * 60_000,
                ip: push.ip,
                info: push.info,
                punches_received: push.punches_received,
                users_received: push.users_received,
                templates_received: push.templates_received,
                commands_sent: push.commands_sent,
                last_error: push.last_error,
              }
            : null,
          pending_commands: pending.get(d.id) ?? 0,
          capabilities: capabilities(d),
        };
      }),
    });
  },

  async commands(req: Request, res: Response) {
    const { page, pageSize } = pagination(req.query, 25);
    const status = str(req.query.status as string) as CommandStatus | undefined;
    if (status && !STATUSES.includes(status)) throw new HttpError(400, 'Unknown status');
    const deviceId = req.query.device_id ? parseId(req.query.device_id) : undefined;
    res.json(await deviceCommandsRepo.page({ deviceId, empCode: str(req.query.emp_code as string), status, kind: str(req.query.kind as string) }, page, pageSize));
  },

  /** Ask a device for data, send it everyone, or reboot it. */
  async run(req: Request, res: Response) {
    const d = await deviceOr404(parseId(req.params.id));
    const b = req.body as { action: string; start_date?: string; end_date?: string };
    let summary: string;
    let created: { id: number } | null = null;
    let count = 1;
    switch (b.action) {
      case 'fetch_punches': {
        const { from, to } = rangeOf(b.start_date!, b.end_date!);
        created = await deviceCommands.fetchPunches(d, from, to, who(req));
        summary = `Asked ${d.name} for punches ${b.start_date} to ${b.end_date}`;
        break;
      }
      case 'fetch_users':
        created = await deviceCommands.fetchUsers(d, who(req));
        summary = `Asked ${d.name} for its users`;
        break;
      case 'send_all_employees':
        count = await deviceCommands.sendAllEmployees(d, who(req));
        summary = `Sent all employees to ${d.name} (${count} command(s))`;
        break;
      case 'reboot':
      case 'check':
        created = await deviceCommands.simple(d, b.action, who(req));
        summary = `${KIND_LABEL[b.action]} on ${d.name}`;
        break;
      default:
        throw new HttpError(400, 'Unknown action');
    }
    await auditRepo.log(req, { action: 'command', entity: 'device', entityId: d.id, summary });
    const row = created ? await deviceCommandsRepo.get(created.id) : null;
    res.status(201).json({ queued: count, command: row ? commandApi(row) : null, message: summary });
  },

  async retry(req: Request, res: Response) {
    const c = await deviceCommandsRepo.get(parseId(req.params.id));
    if (!c) throw new HttpError(404, 'Command not found');
    if (c.status === 'pending') throw new HttpError(400, 'This command is already waiting');
    await deviceCommandsRepo.requeue(c.id);
    if (c.channel === 'pull') deviceCommands.kick();
    await auditRepo.log(req, { action: 'retry', entity: 'device_command', entityId: c.id, summary: `Retried command #${c.id} (${c.kind})` });
    res.json(commandApi((await deviceCommandsRepo.get(c.id))!));
  },

  async cancel(req: Request, res: Response) {
    const id = parseId(req.params.id);
    const r = await deviceCommandsRepo.cancel(id);
    if (!r.count) throw new HttpError(400, 'Only waiting commands can be cancelled');
    res.json(commandApi((await deviceCommandsRepo.get(id))!));
  },

  /** One person on the devices: what reached each device, and their fingerprints/faces. */
  async employee(req: Request, res: Response) {
    const e = await employeesRepo.byIdAny(parseId(req.params.id));
    if (!e || e.isDeleted) throw new HttpError(404, 'Employee not found');
    const [devices, latest, templates, recent] = await Promise.all([
      zkDevicesRepo.list(),
      deviceCommandsRepo.latestUserCommands([e.empCode]),
      biometricsRepo.forEmployee(e.empCode),
      deviceCommandsRepo.page({ empCode: e.empCode }, 1, 15),
    ]);
    res.json({
      employee: { id: e.id, emp_code: e.empCode, name: employeeName(e) },
      devices: devices.map((d) => {
        const last = latest.find((c) => c.device_id === d.id);
        return {
          id: d.id,
          name: d.name,
          mode: d.mode,
          enabled: d.enabled,
          serial_number: d.serialNumber,
          status: last ? { kind: last.kind, status: last.status, result: last.result, at: fromDb(last.created_at) } : null,
          capabilities: capabilities(d),
        };
      }),
      templates: templates.map(templateApi),
      commands: recent.data,
    });
  },

  /** Send a person (and their templates) to every device again. */
  async pushEmployee(req: Request, res: Response) {
    const e = await employeesRepo.byIdAny(parseId(req.params.id));
    if (!e || e.isDeleted) throw new HttpError(404, 'Employee not found');
    const r = await deviceCommands.pushEmployee(e, who(req));
    await auditRepo.log(req, { action: 'command', entity: 'employee', entityId: e.id, summary: `Sent ${employeeName(e) || e.empCode} (${e.empCode}) to the devices` });
    res.json(r);
  },

  /** Start fingerprint enrollment for a person on a push device. */
  async enroll(req: Request, res: Response) {
    const e = await employeesRepo.byIdAny(parseId(req.params.id));
    if (!e || e.isDeleted) throw new HttpError(404, 'Employee not found');
    const b = req.body as { device_id: number; finger: number };
    const d = await deviceOr404(b.device_id);
    const row = await deviceCommands.enrollFingerprint(d, e.empCode, b.finger, who(req));
    await auditRepo.log(req, { action: 'command', entity: 'employee', entityId: e.id, summary: `Started fingerprint enrollment (finger ${b.finger}) for ${e.empCode} on ${d.name}` });
    res.status(201).json(commandApi((await deviceCommandsRepo.get(row.id))!));
  },
};

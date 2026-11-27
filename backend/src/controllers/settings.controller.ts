import type { Request, Response } from 'express';
import { adms } from '../adms/server.js';
import { BioTimeClient } from '../biotime/client.js';
import { Prisma } from '../db/prisma.js';
import { auditRepo } from '../repositories/audit.js';
import { toApi, zkDevicesRepo, type ZkDeviceInput } from '../repositories/zkDevices.js';
import { settingsService, type BioTimeSettings, type SettingsSection } from '../services/settings.service.js';
import { syncService } from '../services/sync.service.js';
import { HttpError, parseId } from '../utils/http.js';
import { zk } from '../zk/client.js';
import { scanNetwork } from '../zk/scan.js';

const SECTION_LABEL: Record<SettingsSection, string> = { biotime: 'BioTime', adms: 'ADMS push', sync: 'Sync', company: 'Company info', appearance: 'Theme colour' };

/** A second device with the same serial number is the usual unique-key clash: say so next to the field. */
function serialClash(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    throw new HttpError(409, 'Another device already has this serial number', { serial_number: 'Already used by another device' });
  }
  throw err;
}

/** Devices with what we know live: last ADMS push for push devices. */
async function devicesWithLive() {
  const pushes = new Map(adms.devices().map((d) => [d.sn, d]));
  return (await zkDevicesRepo.list()).map((d) => {
    const push = d.serialNumber ? pushes.get(d.serialNumber) : undefined;
    return { ...toApi(d), last_push_at: push?.last_seen ?? null, last_push_ip: push?.ip ?? null };
  });
}

export const settingsController = {
  async get(_req: Request, res: Response) {
    res.json({
      settings: settingsService.get(),
      devices: await devicesWithLive(),
      network: settingsService.network(),
      // Devices that pushed to us but are not in the list yet (offer to add them)
      unknown_push_devices: await (async () => {
        const known = new Set((await zkDevicesRepo.list()).map((d) => d.serialNumber).filter(Boolean));
        return adms.devices().filter((d) => !known.has(d.sn)).map((d) => ({ sn: d.sn, ip: d.ip, last_seen: d.last_seen }));
      })(),
    });
  },

  async update(req: Request, res: Response) {
    const section = req.params.section as SettingsSection;
    const changed = await settingsService.update(section, req.body);
    if (changed.length) {
      await auditRepo.log(req, { action: 'update', entity: 'settings', summary: `Changed ${SECTION_LABEL[section]} settings: ${changed.join(', ')}` });
    }
    res.json({ settings: settingsService.get(), network: settingsService.network(), changed });
  },

  /** Try BioTime with the values in the form (unsaved), falling back to the saved password. */
  async testBiotime(req: Request, res: Response) {
    const s = settingsService.biotimeWith(req.body as Partial<BioTimeSettings>);
    const client = new BioTimeClient({ enabled: true, baseUrl: s.url.replace(/\/+$/, ''), username: s.username, password: s.password, authType: s.auth_type, timeoutMs: s.timeout_ms });
    try {
      const r = await client.ping();
      res.json({ ok: true, latency_ms: r.latencyMs, message: `Connected to BioTime in ${r.latencyMs} ms` });
    } catch (err) {
      res.json({ ok: false, message: (err as Error).message });
    }
  },

  async listDevices(_req: Request, res: Response) {
    res.json({ data: await devicesWithLive() });
  },

  async createDevice(req: Request, res: Response) {
    const input = req.body as ZkDeviceInput;
    const d = await zkDevicesRepo.create(input).catch(serialClash);
    await settingsService.reloadDevices();
    await auditRepo.log(req, { action: 'create', entity: 'device_settings', entityId: d.id, summary: `Added device ${d.name} (${d.mode}${d.ip ? `, ${d.ip}:${d.port}` : ''}${d.serialNumber ? `, SN ${d.serialNumber}` : ''})` });
    // A new device to read: fetch its users and punches now rather than at the next interval
    if (d.enabled && d.mode !== 'push') void syncService.runCycle({ trigger: 'manual', forceEmployees: true });
    res.status(201).json(toApi(d));
  },

  async updateDevice(req: Request, res: Response) {
    const id = parseId(req.params.id);
    const d = await zkDevicesRepo.update(id, req.body as ZkDeviceInput).catch(serialClash);
    await settingsService.reloadDevices();
    await auditRepo.log(req, { action: 'update', entity: 'device_settings', entityId: id, summary: `Updated device ${d.name}` });
    res.json(toApi(d));
  },

  async removeDevice(req: Request, res: Response) {
    const id = parseId(req.params.id);
    const d = await zkDevicesRepo.remove(id);
    await settingsService.reloadDevices();
    await auditRepo.log(req, { action: 'delete', entity: 'device_settings', entityId: id, summary: `Removed device ${d.name}` });
    res.status(204).end();
  },

  /**
   * Look for devices on this PC's local networks; marks the ones already in the list.
   * With ?stream=1 the answer is a stream of JSON lines (start, progress, device…, done), so the page
   * can show each device the moment it is found. Closing the request stops the scan.
   */
  async scan(req: Request, res: Response) {
    const saved = await zkDevicesRepo.list();
    const mark = <T extends { ip: string; serial_number: string | null }>(d: T) => {
      const existing = saved.find((s) => (d.serial_number && s.serialNumber === d.serial_number) || (d.ip && s.ip === d.ip));
      return { ...d, added: existing ? { id: existing.id, name: existing.name } : null };
    };

    if (req.query.stream !== '1') {
      const result = await scanNetwork();
      return void res.json({ ...result, devices: result.devices.map(mark) });
    }

    const abort = new AbortController();
    res.on('close', () => abort.abort());
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    const send = (o: object) => !res.writableEnded && res.write(JSON.stringify(o) + '\n');
    try {
      const result = await scanNetwork({
        signal: abort.signal,
        onStart: (info) => send({ type: 'start', ...info }),
        onProgress: (done, total, ip) => send({ type: 'progress', done, total, ip }),
        onDevice: (d) => send({ type: 'device', device: mark(d) }),
      });
      send({ type: 'done', scanned: result.scanned, ms: result.ms, count: result.devices.length, stopped: abort.signal.aborted });
    } catch (err) {
      send({ type: 'error', message: (err as Error).message });
    }
    res.end();
  },

  /** Test a device from the form before saving. Returns what it reports (serial, model, firmware, counts). */
  async testAddress(req: Request, res: Response) {
    const b = req.body as { ip: string; port: number; timeout_ms: number; chunk_size?: number | null };
    res.json(await zk.status({ ip: b.ip, port: b.port, timeoutMs: b.timeout_ms, chunkSize: b.chunk_size ?? null }));
  },

  /** Test a saved device; on success remember its model, firmware and serial number. */
  async testDevice(req: Request, res: Response) {
    const d = await zkDevicesRepo.get(parseId(req.params.id));
    if (!d) throw new HttpError(404, 'Device not found');
    if (!d.ip) throw new HttpError(400, 'This device has no IP address (push only), so it can’t be tested over the network. Check “Last push” instead.');
    const status = await zk.status({ ip: d.ip, port: d.port, timeoutMs: d.timeoutMs, chunkSize: d.chunkSize });
    if (status.online) {
      await zkDevicesRepo
        .markSeen(d.id, { model: status.device_name, firmware: status.firmware, serialNumber: d.serialNumber ? null : status.serial_number })
        .catch(() => zkDevicesRepo.markSeen(d.id, { model: status.device_name, firmware: status.firmware }));
      await settingsService.reloadDevices();
    }
    res.json(status);
  },
};

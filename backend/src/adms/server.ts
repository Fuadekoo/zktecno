/**
 * ADMS push receiver (ZKTeco "Cloud Server" / iclock protocol).
 *
 * Devices are pointed at this server instead of BioTime. Every request is:
 *   1. read: punches in `POST /iclock/cdata?SN=…&table=ATTLOG` are saved to PostgreSQL right away
 *      (de-duplicated, announced by webhook), and
 *   2. forwarded unchanged to BioTime (ADMS_FORWARD_URL), whose reply goes back to the device.
 *      BioTime keeps receiving everything and stays in charge of device commands.
 *
 * If BioTime can't be reached, the device gets an error, keeps the punches and sends them again later,
 * so BioTime never misses any. The local copy is already saved; the resend is ignored as a duplicate.
 * With ADMS_FORWARD=false this server answers the device itself (standalone, no BioTime).
 */
import type { Server } from 'node:http';
import os from 'node:os';
import express, { type Request, type Response } from 'express';
import { config } from '../config.js';
import { prisma } from '../db/prisma.js';
import { dbNow } from '../db/time.js';
import { punchesRepo } from '../repositories/punches.js';
import { syncService } from '../services/sync.service.js';
import { webhookService } from '../services/webhook.service.js';
import type { ZkPunch } from '../zk/client.js';
import { localDateTime } from '../utils/http.js';

export interface AdmsDeviceState {
  sn: string;
  ip: string | null;
  allowed: boolean;
  first_seen: string;
  last_seen: string;
  last_attlog_at: string | null;
  punches_received: number;
  punches_saved: number;
  last_forward_status: number | null;
  last_error: string | null;
}

/** Live view of pushing devices (since the server started). */
const devices = new Map<string, AdmsDeviceState>();

/** Headers that belong to one connection and must not be forwarded. */
const HOP_BY_HOP = new Set([
  'host', 'connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer',
  'content-length', 'content-encoding',
]);

const TIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/** ATTLOG body: one punch per line, tab-separated: PIN, time, state, verify, workcode, … */
export function parseAttlog(body: string, sn: string): ZkPunch[] {
  const out: ZkPunch[] = [];
  for (const line of body.split(/\r?\n/)) {
    const f = line.split('\t').map((x) => x.trim());
    const [pin, time, state, verify, workCode] = f;
    if (!pin || !time || !TIME_RE.test(time)) continue;
    const v = Number(verify);
    out.push({
      emp_code: pin,
      punch_time: time,
      punch_state: state || '0',
      verify_type: Number.isFinite(v) ? v : 0,
      terminal_sn: sn,
      work_code: workCode && workCode !== '0' ? workCode : null,
    });
  }
  return out;
}

/** Which serial numbers may write punches: ADMS_ALLOWED_SN, or else the devices BioTime knows. */
let knownSn: { at: number; set: Set<string> } = { at: 0, set: new Set() };
async function isAllowed(sn: string) {
  if (config.adms.allowedSn.includes('*')) return true;
  if (config.adms.allowedSn.length) return config.adms.allowedSn.includes(sn);
  if (Date.now() - knownSn.at > 5 * 60_000) {
    const rows = await prisma.device.findMany({ select: { sn: true } });
    knownSn = { at: Date.now(), set: new Set(rows.map((r) => r.sn)) };
  }
  return knownSn.set.has(sn);
}

function track(sn: string, req: Request): AdmsDeviceState {
  const now = localDateTime();
  let d = devices.get(sn);
  if (!d) {
    d = { sn, ip: null, allowed: false, first_seen: now, last_seen: now, last_attlog_at: null, punches_received: 0, punches_saved: 0, last_forward_status: null, last_error: null };
    devices.set(sn, d);
    console.log(`[adms] Device ${sn} connected from ${req.ip}`);
  }
  d.ip = req.ip ?? null;
  d.last_seen = now;
  return d;
}

async function savePunches(state: AdmsDeviceState, punches: ZkPunch[]) {
  state.punches_received += punches.length;
  state.last_attlog_at = localDateTime();
  const ids = await syncService.exclusivePunchWrite(() => punchesRepo.insertFromDevice(punches, null, dbNow()));
  state.punches_saved += ids.length;
  if (ids.length) {
    await webhookService.queuePunches(await punchesRepo.byIds(ids), null);
    console.log(`[adms] ${state.sn}: ${punches.length} punch(es) received, ${ids.length} new`);
  }
}

/** Replies used when not forwarding (ADMS_FORWARD=false). */
function standaloneReply(req: Request, res: Response, sn: string, attlogLines: number) {
  res.type('text/plain');
  if (req.path === '/iclock/cdata' && req.method === 'GET') {
    const tz = -new Date().getTimezoneOffset() / 60;
    return res.send(
      [
        `GET OPTION FROM: ${sn}`,
        'ATTLOGStamp=None',
        'OPERLOGStamp=9999',
        'ATTPHOTOStamp=None',
        'ErrorDelay=30',
        'Delay=10',
        'TransTimes=00:00;14:05',
        'TransInterval=1',
        'TransFlag=TransData AttLog',
        `TimeZone=${tz}`,
        'Realtime=1',
        'Encrypt=None',
      ].join('\n'),
    );
  }
  if (req.path === '/iclock/cdata' && req.method === 'POST' && attlogLines) return res.send(`OK: ${attlogLines}`);
  return res.send('OK');
}

async function forward(req: Request, res: Response, body: Buffer, state: AdmsDeviceState | null) {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined || HOP_BY_HOP.has(k.toLowerCase())) continue;
    headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  }
  if (req.ip) headers.set('x-forwarded-for', req.ip);
  try {
    const r = await fetch(config.adms.forwardUrl + req.originalUrl, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : new Uint8Array(body),
      redirect: 'manual',
      signal: AbortSignal.timeout(config.adms.forwardTimeoutMs),
    });
    const reply = Buffer.from(await r.arrayBuffer());
    if (state) {
      state.last_forward_status = r.status;
      if (r.ok) state.last_error = null;
    }
    res.status(r.status);
    r.headers.forEach((v, k) => {
      if (!HOP_BY_HOP.has(k.toLowerCase())) res.setHeader(k, v);
    });
    res.send(reply);
  } catch (err) {
    const msg = `BioTime (${config.adms.forwardUrl}) unreachable: ${(err as Error).message}`;
    if (state) {
      state.last_forward_status = null;
      state.last_error = msg;
    }
    console.warn(`[adms] ${msg}`);
    // Not "OK": the device keeps the data and retries, so BioTime receives it once it's back.
    res.status(502).type('text/plain').send('ERROR');
  }
}

export function createAdmsApp() {
  const app = express();
  app.disable('x-powered-by');
  app.disable('etag');
  // Device bodies are plain text (sometimes not UTF-8): keep the exact bytes so forwarding is lossless.
  app.use(express.raw({ type: () => true, limit: '50mb' }));

  app.use(async (req, res) => {
    // Only device (iclock) traffic belongs here. Anything else, e.g. the BioTime REST API, means a URL is
    // pointing at this port by mistake: say so instead of answering "OK".
    if (!req.path.startsWith('/iclock/') || req.path.startsWith('/iclock/api/')) {
      return res
        .status(404)
        .type('text/plain')
        .send(`This is the ADMS device push port (${config.adms.port}), not BioTime. Point BIOTIME_URL at the BioTime server.`);
    }
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const sn = String(req.query.SN ?? req.query.sn ?? '').trim();
    const state = sn ? track(sn, req) : null;
    let attlogLines = 0;

    if (state && req.method === 'POST' && req.path === '/iclock/cdata' && String(req.query.table ?? '').toUpperCase() === 'ATTLOG') {
      const punches = parseAttlog(body.toString('utf8'), sn);
      attlogLines = punches.length;
      try {
        state.allowed = await isAllowed(sn);
        if (!state.allowed) {
          state.last_error = `Serial ${sn} is not allowed: punches not saved locally (add it to ADMS_ALLOWED_SN, or sync devices from BioTime)`;
          console.warn(`[adms] ${state.last_error}`);
        } else if (punches.length) {
          await savePunches(state, punches);
        }
      } catch (err) {
        // Never block the device or BioTime because of a local problem; the next sync picks it up from BioTime.
        state.last_error = `Saving punches failed: ${(err as Error).message}`;
        console.error(`[adms] ${sn}: ${state.last_error}`);
      }
    }

    if (config.adms.forward) await forward(req, res, body, state);
    else standaloneReply(req, res, sn, attlogLines);
  });

  return app;
}

/** True if `url` is this machine on ADMS_PORT (a misconfiguration). */
function pointsAtThisPort(url: string) {
  try {
    const u = new URL(url);
    const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
    if (port !== config.adms.port) return false;
    const local = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', os.hostname().toLowerCase()]);
    for (const list of Object.values(os.networkInterfaces())) for (const i of list ?? []) local.add(i.address);
    return local.has(u.hostname.toLowerCase().replace(/^\[|\]$/g, ''));
  } catch {
    return false;
  }
}

export const adms = {
  devices: () => [...devices.values()].sort((a, b) => a.sn.localeCompare(b.sn)),

  start(): Server | null {
    if (!config.adms.enabled) return null;
    const self = pointsAtThisPort(config.biotime.baseUrl);
    if (self) console.warn(`[adms] WARNING: BIOTIME_URL (${config.biotime.baseUrl}) is this server's ADMS push port. BioTime sync will fail: set BIOTIME_URL to the real BioTime server.`);
    if (config.adms.forward && pointsAtThisPort(config.adms.forwardUrl)) {
      console.error(`[adms] ADMS_FORWARD_URL (${config.adms.forwardUrl}) points back at this push port, which would loop. Set it to BioTime's address. Not starting ADMS.`);
      return null;
    }
    const server = createAdmsApp().listen(config.adms.port, config.host, () => {
      console.log(
        `[adms] Listening for device pushes on port ${config.adms.port}` +
          (config.adms.forward ? `, forwarding to BioTime at ${config.adms.forwardUrl}` : ' (standalone, not forwarding)'),
      );
    });
    server.on('error', (err: NodeJS.ErrnoException) => {
      console.error(err.code === 'EADDRINUSE' ? `[adms] Port ${config.adms.port} is already in use. Change ADMS_PORT.` : err);
    });
    return server;
  },
};

/**
 * ADMS push receiver (ZKTeco "Cloud Server" / iclock protocol).
 *
 * Devices are pointed at this server instead of BioTime. Every request is:
 *   1. read: punches in `POST /iclock/cdata?SN=…&table=ATTLOG` are saved to MySQL right away
 *      (de-duplicated, announced by webhook), and
 *   2. forwarded unchanged to BioTime (ADMS_FORWARD_URL), whose reply goes back to the device.
 *      BioTime keeps receiving everything and stays in charge of device commands.
 *
 * If BioTime can't be reached, the device gets an error, keeps the punches and sends them again later,
 * so BioTime never misses any. The local copy is already saved; the resend is ignored as a duplicate.
 * With ADMS_FORWARD=false this server answers the device itself (standalone, no BioTime), and also:
 *   - hands out queued commands on GET /iclock/getrequest (add/remove people, copy templates, queries…)
 *   - records the device's answers from POST /iclock/devicecmd
 *   - saves users and fingerprint/face templates uploaded on POST /iclock/cdata (OPERLOG / BIODATA tables)
 *     and copies new templates to the other push devices.
 */
import type { Server } from 'node:http';
import os from 'node:os';
import express, { type Request, type Response } from 'express';
import { config } from '../config.js';
import { prisma } from '../db/prisma.js';
import { dbNow } from '../db/time.js';
import { biometricsRepo, type TemplateInput } from '../repositories/biometrics.js';
import { employeesRepo } from '../repositories/employees.js';
import { punchesRepo } from '../repositories/punches.js';
import { deviceCommands } from '../services/deviceCommands.service.js';
import { syncService } from '../services/sync.service.js';
import { webhookService } from '../services/webhook.service.js';
import type { ZkPunch } from '../zk/client.js';
import { localDateTime } from '../utils/http.js';
import { admsDevices as devices, parseInfo, type AdmsDeviceState } from './state.js';

export type { AdmsDeviceState };

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

/** "PIN=1\tName=Ann\t…" → ordered [key, value] pairs (values may contain "="). */
function kvPairs(s: string): [string, string][] {
  return s
    .split('\t')
    .map((part) => {
      const i = part.indexOf('=');
      return i > 0 ? ([part.slice(0, i).trim(), part.slice(i + 1).trim()] as [string, string]) : null;
    })
    .filter((x): x is [string, string] => x !== null);
}

const get = (pairs: [string, string][], ...names: string[]) => {
  const lower = names.map((n) => n.toLowerCase());
  return pairs.find(([k]) => lower.includes(k.toLowerCase()))?.[1];
};

export interface OperlogContent {
  users: { emp_code: string; name: string | null; card_no: string | null }[];
  templates: TemplateInput[];
  lines: number;
}

/**
 * Operation-log uploads: "USER PIN=…", "FP PIN=…\tFID=…\tTMP=…", "FACE PIN=…", "BIODATA Pin=…\tType=…\tTmp=…".
 * Other lines (OPLOG, USERPIC, BIOPHOTO…) are counted and ignored. A table name without a line prefix
 * (table=USERINFO, FINGERTMP, BIODATA) tells what bare "PIN=…" lines are.
 */
export function parseOperlog(body: string, sn: string, table: string): OperlogContent {
  const out: OperlogContent = { users: [], templates: [], lines: 0 };
  const bare = table === 'USERINFO' ? 'USER' : table === 'FINGERTMP' ? 'FP' : table === 'BIODATA' ? 'BIODATA' : table === 'FACE' ? 'FACE' : '';
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    out.lines++;
    // "USER PIN=…" has a prefix; a bare "PIN=…" line takes its kind from the table name
    const m = /^([A-Z]+)\s+(.*)$/.exec(line);
    const kind = m?.[1] ?? bare;
    const pairs = kvPairs(m?.[2] ?? line);
    const pin = get(pairs, 'PIN')?.trim();
    if (!pin) continue;
    const tmpKey = pairs.find(([k]) => k.toLowerCase() === 'tmp')?.[0];
    const template = tmpKey ? get(pairs, 'TMP') : undefined;
    const fields = pairs.filter(([k]) => k !== tmpKey);
    if (kind === 'USER') {
      const card = get(pairs, 'Card');
      out.users.push({ emp_code: pin.slice(0, 32), name: get(pairs, 'Name') || null, card_no: card && card !== '0' ? card : null });
    } else if ((kind === 'FP' || kind === 'FACE' || kind === 'BIODATA') && template && tmpKey) {
      const n = (x: string | undefined) => (Number.isFinite(Number(x)) ? Number(x) : 0);
      if (kind === 'BIODATA') {
        out.templates.push({ empCode: pin, bioType: n(get(pairs, 'Type')), bioIndex: n(get(pairs, 'No')), subIndex: n(get(pairs, 'Index')), format: 'BIODATA', fields, tmpKey, template, sourceSn: sn });
      } else if (kind === 'FP') {
        out.templates.push({ empCode: pin, bioType: 1, bioIndex: n(get(pairs, 'FID')), subIndex: 0, format: 'FINGERTMP', fields, tmpKey, template, sourceSn: sn });
      } else {
        out.templates.push({ empCode: pin, bioType: 2, bioIndex: 0, subIndex: n(get(pairs, 'FID')), format: 'FACE', fields, tmpKey, template, sourceSn: sn });
      }
    }
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
    d = {
      sn, ip: null, allowed: false, first_seen: now, last_seen: now, last_seen_ms: Date.now(), last_attlog_at: null,
      punches_received: 0, punches_saved: 0, users_received: 0, templates_received: 0, commands_sent: 0, info: null,
      last_forward_status: null, last_error: null,
    };
    devices.set(sn, d);
    console.log(`[adms] Device ${sn} connected from ${req.ip}`);
  }
  d.ip = req.ip ?? null;
  d.last_seen = now;
  d.last_seen_ms = Date.now();
  const info = typeof req.query.INFO === 'string' ? parseInfo(req.query.INFO) : null;
  if (info) d.info = info;
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

/** Users and templates a device uploaded: save them, and copy new templates to the other devices. */
async function saveOperlog(state: AdmsDeviceState, content: OperlogContent, stamp: string | null) {
  if (content.users.length) {
    // A user seen on several lines of one upload is saved once (the last one wins)
    const byCode = new Map(content.users.map((u) => [u.emp_code, u]));
    await employeesRepo.upsertFromDevice([...byCode.values()], dbNow());
    state.users_received += byCode.size;
  }
  let changed = 0;
  let copies = 0;
  for (const t of content.templates) {
    const saved = await biometricsRepo.upsert(t);
    if (!saved) continue;
    changed++;
    copies += await deviceCommands.spreadTemplate(saved, state.sn);
  }
  state.templates_received += content.templates.length;
  if (stamp) await prisma.zkDevice.updateMany({ where: { serialNumber: state.sn }, data: { operlogStamp: stamp.slice(0, 32) } });
  if (content.users.length || content.templates.length) {
    console.log(
      `[adms] ${state.sn}: ${content.users.length} user(s), ${content.templates.length} template(s) uploaded` +
        (changed ? `, ${changed} new/changed, ${copies} copy command(s) queued for other devices` : ''),
    );
  }
}

/** Replies used when not forwarding (ADMS_FORWARD=false). */
async function standaloneReply(req: Request, res: Response, sn: string, dataLines: number) {
  res.type('text/plain');
  if (req.path === '/iclock/cdata' && req.method === 'GET') {
    const tz = -new Date().getTimezoneOffset() / 60;
    // Devices in the list send their users and templates (operation log) from where they left off;
    // others keep the old behaviour (no operation log).
    const known = sn ? await prisma.zkDevice.findFirst({ where: { serialNumber: sn }, select: { operlogStamp: true } }).catch(() => null) : null;
    return res.send(
      [
        `GET OPTION FROM: ${sn}`,
        'ATTLOGStamp=None',
        `OPERLOGStamp=${known ? known.operlogStamp || 'None' : '9999'}`,
        'ATTPHOTOStamp=None',
        'ErrorDelay=30',
        'Delay=10',
        'TransTimes=00:00;14:05',
        'TransInterval=1',
        // AttLog = punches; OpLog/EnrollUser/ChgUser = users; EnrollFP/ChgFP/FACE = fingerprint and face templates
        'TransFlag=TransData AttLog\tOpLog\tEnrollUser\tChgUser\tEnrollFP\tChgFP\tFACE',
        `TimeZone=${tz}`,
        'Realtime=1',
        'Encrypt=None',
      ].join('\n'),
    );
  }
  if (req.path === '/iclock/getrequest' && sn) {
    // Commands waiting for this device, one per line; "OK" = nothing to do
    const lines = await deviceCommands.nextForDevice(sn).catch((err) => {
      console.error(`[adms] ${sn}: reading the command queue failed: ${(err as Error).message}`);
      return [] as string[];
    });
    if (lines.length) {
      const state = devices.get(sn);
      if (state) state.commands_sent += lines.length;
      console.log(`[adms] ${sn}: sent ${lines.length} command(s)`);
      return res.send(lines.join('\n') + '\n');
    }
    return res.send('OK');
  }
  if (req.path === '/iclock/devicecmd' && req.method === 'POST' && sn) {
    const n = await deviceCommands.recordResults(sn, (Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)).toString('utf8')).catch((err) => {
      console.error(`[adms] ${sn}: saving command results failed: ${(err as Error).message}`);
      return 0;
    });
    if (n) console.log(`[adms] ${sn}: ${n} command result(s)`);
    return res.send('OK');
  }
  if (req.path === '/iclock/cdata' && req.method === 'POST' && dataLines) return res.send(`OK: ${dataLines}`);
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
        .send(`This is the ADMS device push port (${config.adms.port}), not BioTime. Set the real BioTime address in Settings > BioTime.`);
    }
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const sn = String(req.query.SN ?? req.query.sn ?? '').trim();
    const state = sn ? track(sn, req) : null;
    let attlogLines = 0;
    const table = String(req.query.table ?? '').toUpperCase();

    if (state && req.method === 'POST' && req.path === '/iclock/cdata' && table && table !== 'ATTLOG') {
      const content = parseOperlog(body.toString('utf8'), sn, table);
      attlogLines = content.lines;
      try {
        state.allowed = await isAllowed(sn);
        if (state.allowed) await saveOperlog(state, content, typeof req.query.Stamp === 'string' ? req.query.Stamp : null);
      } catch (err) {
        state.last_error = `Saving users/templates failed: ${(err as Error).message}`;
        console.error(`[adms] ${sn}: ${state.last_error}`);
      }
    }

    if (state && req.method === 'POST' && req.path === '/iclock/cdata' && table === 'ATTLOG') {
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
    else await standaloneReply(req, res, sn, attlogLines);
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

let current: Server | null = null;

export const adms = {
  listening: () => current?.listening ?? false,

  /** Stop listening (resolves once the port is free). */
  stop(): Promise<void> {
    const s = current;
    current = null;
    if (!s) return Promise.resolve();
    return new Promise((resolve) => {
      s.close(() => resolve());
      s.closeAllConnections?.();
    });
  },

  /** Apply new ADMS settings: stop, then start again if enabled. */
  async restart() {
    await this.stop();
    return this.start();
  },

  devices: () => [...devices.values()].sort((a, b) => a.sn.localeCompare(b.sn)),

  start(): Server | null {
    if (current) return current;
    if (!config.adms.enabled) return null;
    const self = pointsAtThisPort(config.biotime.baseUrl);
    if (self) console.warn(`[adms] WARNING: The BioTime address (${config.biotime.baseUrl}) is this server's ADMS push port. BioTime sync will fail: set the real BioTime address in Settings > BioTime.`);
    if (config.adms.forward && pointsAtThisPort(config.adms.forwardUrl)) {
      console.error(`[adms] The forward address (${config.adms.forwardUrl}) points back at this push port, which would loop. Set it to BioTime's address. Not starting ADMS.`);
      return null;
    }
    const server = createAdmsApp().listen(config.adms.port, config.host, () => {
      console.log(
        `[adms] Listening for device pushes on port ${config.adms.port}` +
          (config.adms.forward ? `, forwarding to BioTime at ${config.adms.forwardUrl}` : ' (standalone, not forwarding)'),
      );
    });
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (current === server) current = null;
      console.error(err.code === 'EADDRINUSE' ? `[adms] Port ${config.adms.port} is already in use. Change it in Settings > ADMS.` : err);
    });
    current = server;
    return server;
  },
};

# ZKTeco BioTime 8.5 Attendance Dashboard

A web dashboard for ZKTeco attendance devices, built on the **BioTime 8.5 REST API**.

- **Backend:** Node.js + Express + TypeScript + **Prisma ORM** + **PostgreSQL**
- **Frontend:** Next.js (TypeScript, Tailwind)

```
ZKTeco devices ──ADMS──▶ BioTime 8.5 ──REST──▶ Express API ──Prisma──▶ PostgreSQL
                                   ▲             │    (sync every hour + "Sync now")
                                   └ live edits ─┘
                                                 │──▶ Webhooks: new punches POSTed to your URLs
                                                 ▲
                               Next.js dashboard ┘  (/api proxied, cookie login)
```

- Devices upload punches to **BioTime**. BioTime must be running, with the devices online in it.
- Every hour the backend copies **punches, employees and devices** from BioTime into **PostgreSQL**.
  Admins can click **Sync now** at any time.
- **Every sync run is saved** (`sync_runs`): what was read, what was new, how long it took, and any error.
- **New punches go out by webhook** to any URLs you configure. Every delivery and retry is saved (`webhook_deliveries`).
- **Dashboard, Punch Logs and Attendance Report read from PostgreSQL**, so they are fast and keep working while BioTime is briefly down.
- **Employees, departments, positions and areas are edited live in BioTime** (the source of truth). PostgreSQL refreshes right after each change.

## Features

| Page | What it does |
| --- | --- |
| Dashboard | Present today, not punched yet, punches today, devices online, latest punches, last-sync time, **Sync now**. |
| Punch Logs | Search by code or name, filter by department, device and dates. CSV export. |
| Attendance Report | Per person per day: first in, last out, hours worked, Present / Missing punch / Absent. CSV export. |
| Employees | Create, edit and delete in BioTime: department, position, areas, card, device PIN, device role. |
| Departments / Positions / Areas | Create, edit and delete, with parent levels. |
| Devices | Live status from BioTime, plus full device details. |
| Sync & Activity | Status of each sync job, **sync history**, manual sync, re-import of a date range, activity log. |
| Webhooks | Add receiving URLs, choose events, send a test, see the signing secret, view every delivery with its payload and response, resend failures. |
| Users | Dashboard accounts. **Admin** = full access; **Viewer** = read-only (no webhooks, users or syncing). |

## Requirements

- Node.js 18.17+ (tested on Node 24)
- PostgreSQL 13+ (tested on PostgreSQL 17). Prisma creates the database and tables.
- BioTime 8.5 reachable from the backend machine, plus a BioTime system (admin) user

## Setup

```bash
npm run setup            # installs everything (and generates the Prisma client)
```

Edit **`backend/.env`** (copy `backend/.env.example` if it's missing):

```ini
# BioTime
BIOTIME_URL=http://192.168.1.20:8090
BIOTIME_USERNAME=admin
BIOTIME_PASSWORD=your-biotime-password

# PostgreSQL (used by both the server and Prisma)
DB_HOST=127.0.0.1
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your-postgres-password
DB_NAME=zkteco_attendance

# Sync (3600 = every hour)
SYNC_INTERVAL_SECONDS=3600
SYNC_INITIAL_DAYS=30            # history imported on the very first run

# First dashboard admin (created once, on first start). Min 8 characters.
ADMIN_USERNAME=admin
ADMIN_PASSWORD=pick-a-strong-password
APP_JWT_SECRET=<long random string>
```

```bash
npm run dev              # backend :4000 + frontend :3000
```

Open http://localhost:3000 and sign in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`. On first start:
1. `prisma migrate deploy` creates the database and all tables
2. the first admin user is created
3. BioTime is checked (`[biotime] Connected OK`)
4. the first sync imports the last `SYNC_INITIAL_DAYS` days of punches (no webhooks for this history import)

### Open it from other devices (phone, other PCs)

`npm run dev` and `npm start` listen on all network addresses, so the dashboard opens at `http://<this-computer-ip>:3000`.
The backend prints the exact addresses at startup (`[server] On your network: …`).
Only port **3000** needs to be reachable; the browser never talks to the backend directly.

If other devices can't connect, allow the port in Windows Firewall (PowerShell **as Administrator**):

```powershell
New-NetFirewallRule -DisplayName "Attendance dashboard (3000)" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Private
```

To keep everything on this computer only, set `HOST=127.0.0.1` in `backend/.env` and remove `-H 0.0.0.0` from `frontend/package.json`.

### Commands (run in `backend/`)

| Command | What it does |
| --- | --- |
| `npm run dev` | Apply migrations, then run with auto-reload |
| `npm run build` then `npm start` | Generate the Prisma client and compile to `dist/`; start applies migrations, then runs |
| `npm run db:deploy` | Apply pending migrations (creates the database if needed) |
| `npm run db:migrate:dev -- --name <change>` | After editing `prisma/schema.prisma`: create a new migration |
| `npm run db:studio` | Open Prisma Studio to browse the tables in a browser |
| `npm run db:seed` | Add demo data (30 employees, 3 devices, 14 days of punches, a `viewer` / `viewer123` user). Safe to run again. `-- --days 30` for more history |
| `npm run db:seed:clear` | Remove all demo data (real BioTime data is never touched) |
| `npm run typecheck` | Type-check only |
| `npm run user:reset-password -- admin NewPass123` | Locked out? Resets the password and re-enables the account (creates it as admin if missing) |

## How the sync works

| Job | When | What |
| --- | --- | --- |
| Devices | every run | Upserts devices and status; devices removed from BioTime are deleted |
| Employees | every `SYNC_EMPLOYEES_MINUTES` (60), and right after any personnel edit | Upserts employees; ones removed from BioTime are marked deleted |
| Punches | every run | Reads from the last successful sync minus `SYNC_LOOKBACK_HOURS` (48 h), so punches that offline devices upload late are still caught. Punches are keyed by BioTime's transaction id, so nothing is ever duplicated. Only truly new punches are inserted and announced. |

- Every run is a row in `sync_runs`: trigger (startup, scheduled, manual, after edit, re-import), status, fetched, new, removed, webhooks queued, duration and error. Each punch records the run that first saved it (`punches.sync_run_id`).
- Older history, or a device back after a long outage: **Sync & Activity → Re-import punches for a date range**. New punches found this way are sent to webhooks.
- Runs never overlap. If the server stops mid-sync, the run is marked "Interrupted" on the next start.
- Sync history is kept 90 days; successful webhook deliveries 30 days, failed ones 90 days.
- **Times** are stored exactly as BioTime reports them (local wall-clock time). Prisma would normally convert to UTC; `src/db/time.ts` prevents that, so 08:30 stays 08:30.

## ADMS push: devices send punches to this server (and it forwards them to BioTime)

```
ZKTeco device ──ADMS push──▶ this backend :8082 ──forwards the same request──▶ BioTime
                                   │ saves punches to PostgreSQL right away + webhooks
```

Punches reach the dashboard and webhooks within seconds instead of at the next hourly sync. BioTime keeps receiving everything,
and its commands (user changes, etc.) still reach the devices, because every reply the device gets comes from BioTime.

**1. Backend (`backend/.env`), then restart:**

```ini
ADMS_ENABLED=true
ADMS_PORT=8082
ADMS_FORWARD=true
# The Server Address/Port the devices use NOW (write it down before changing the device). Empty = BIOTIME_URL.
ADMS_FORWARD_URL=http://192.168.100.29:8081
# Serials allowed to save punches. Empty = devices BioTime knows (from the devices sync). * = any device (for testing).
ADMS_ALLOWED_SN=
```

The log shows `[adms] Listening for device pushes on port 8082, forwarding to BioTime at …`.

**2. Firewall** on the backend PC (PowerShell as Administrator):

```powershell
New-NetFirewallRule -DisplayName "ZKTeco ADMS (8082)" -Direction Inbound -Protocol TCP -LocalPort 8082 -Action Allow
```

**3. On each device:** **Menu → COMM. → Cloud Server Setting**

1. **Write down** the current Server Address and Server Port. That is BioTime's address, so it goes in `ADMS_FORWARD_URL`.
2. Server Mode: **ADMS**. Enable Domain Name: **off**. Server Address: **the backend PC's IP**. Server Port: **8082**. Proxy: **off**.
3. Save. The cloud icon on the device's screen shows it is connected.

**4. Check:** the backend log prints `[adms] Device <SN> connected`. **Sync & Activity → Devices pushing (ADMS)** shows each device,
its last contact, the punches received and saved, and BioTime's reply status. Punch on the device and it appears in Punch Logs right away.
In BioTime, the device should still show as online.

How it behaves:

- Punches in `POST /iclock/cdata?table=ATTLOG` are saved as `source = device` and sent to webhooks immediately. The hourly BioTime
  sync later swaps in BioTime's row for the same punch (no duplicate row, no second webhook).
- **If BioTime is down,** punches are still saved locally, and the device gets an error reply, so it keeps the punches and resends
  them until BioTime takes them. BioTime never misses a punch. The resends are ignored locally as duplicates.
- **If this backend is down,** the devices can't reach BioTime either. Keep it running (e.g. as a Windows service), or point devices back
  at BioTime's address to undo.
- **BioTime sees the backend PC's IP** as the device's IP address, because the requests now come from the backend.
- `ADMS_FORWARD=false` turns it into a standalone ADMS server (no BioTime): it answers the devices itself.

## Reading devices directly (zkteco-js), alongside BioTime

The backend can also read punches straight from the devices over TCP port 4370, using
[zkteco-js](https://github.com/coding-libs/zkteco-js). It runs in addition to BioTime: devices keep pushing to BioTime,
and this catches punches BioTime hasn't uploaded yet, plus devices that aren't in BioTime at all.

```ini
# backend/.env: comma-separated "ip" or "ip:port" (default port 4370). Empty = off.
ZK_DEVICES=192.168.1.201,192.168.1.202:4370
ZK_TIMEOUT_MS=10000
```

- Each sync cycle runs a fourth job, **`device_punches`**, after the BioTime punch sync. It uses the same cursor, lookback,
  first-run history (`SYNC_INITIAL_DAYS`, no webhooks) and webhooks as the BioTime job.
- Devices return their **whole log** every time (the protocol has no date filter). Only records inside the sync window are saved.
- **No duplicates across sources.** A punch is the same if it has the same `emp_code`, `punch_time` and device serial.
  A device punch already in PostgreSQL is skipped. When BioTime later reports a punch that was first read from the device,
  the BioTime row replaces it (`punches.source` goes from `device` to `biotime`) and **no second webhook is sent**.
- Device-read punches have **negative ids** so they can never collide with BioTime transaction ids.
- If one device is unreachable, the others are still read. The run succeeds with a warning, and fails only if every device failed.
- **Sync & Activity** shows the job, a **Devices read directly** panel (**Check devices** = live status: serial, time, users, log count),
  and a **From source** choice for date-range re-imports.
- API: `GET /api/system/zk-devices` (live status), `POST /api/system/sync` with `{ "job": "device_punches" }` (optionally with `start_date`/`end_date`).
- Employees, departments and device info still come from BioTime. The device user id (PIN) must equal the BioTime `emp_code`.
  The library reads at most 9 characters of it.

## Webhooks

Add them on the **Webhooks** page (admin). Each webhook has a URL, the events it wants, and a signing secret.

| Event | Sent when | `data` |
| --- | --- | --- |
| `punch.created` | A sync found new punches (up to 100 per request; large batches are split) | `{ count, punches: [...] }` |
| `sync.completed` | A punch sync succeeded | the sync run (fetched, created, duration, …) |
| `sync.failed` | A punch sync failed (e.g. BioTime unreachable) | the sync run, including `error` |
| `webhook.test` | You clicked **Test** | a message |

Example `punch.created` request body:

```json
{
  "delivery_id": 42,
  "event": "punch.created",
  "created_at": "2026-11-25 08:31:02",
  "sync_run_id": 118,
  "batch": { "index": 1, "total": 1 },
  "data": {
    "count": 1,
    "punches": [
      {
        "id": 98231, "emp_code": "1001", "employee_name": "Aisha Khan", "department": "Grade 5",
        "punch_time": "2026-11-25 07:58:12", "punch_state": "0", "punch_state_label": "Check In",
        "verify_type": 15, "verify_type_label": "Face",
        "terminal_sn": "ACEZ185060382", "terminal_alias": "Main Gate", "area_alias": null
      }
    ]
  }
}
```

**Headers:** `X-Webhook-Event`, `X-Webhook-Delivery` (use it to ignore duplicates), `X-Webhook-Timestamp` (unix seconds),
`X-Webhook-Signature: sha256=<hex>`.

**Verifying the signature** (Node.js):

```js
const expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(`${timestamp}.${rawBody}`).digest('hex');
if (expected !== req.headers['x-webhook-signature']) return res.sendStatus(401);
res.sendStatus(200); // any 2xx = delivered
```

**Delivery and retries:** any 2xx response counts as delivered. Anything else (error status, timeout after 10 s, connection failure)
is retried after 1 min, 5 min, 30 min, 2 h and 6 h, so 6 attempts over about 8.5 hours. After that the delivery is marked *failed*,
and you can **Resend** it from the delivery log. Every attempt's status code, response body, error and timing is saved.

## Database (Prisma schema: `backend/prisma/schema.prisma`)

| Table | Contents |
| --- | --- |
| `users` | Dashboard accounts (scrypt-hashed passwords, role, active flag) |
| `punches` | Every punch (BioTime id, emp_code, punch_time, state, verify type, device, `sync_run_id`) |
| `employees` | Employee mirror (code, name, department, position, areas, card, …) |
| `devices` | Device mirror (SN, alias, IP, state, counts, last activity) |
| `sync_runs` | Every sync run and its results |
| `webhooks` | Webhook URLs, events, signing secret, active flag |
| `webhook_deliveries` | Every webhook request: payload, status, attempts, next retry, response, error |
| `audit_logs` | Sign-ins, failed sign-ins, every create/update/delete, manual syncs, webhook changes |
| `_prisma_migrations` | Applied migrations (managed by Prisma) |

## Backend structure

```
backend/
  prisma/schema.prisma        data model (source of truth for tables)
  prisma/migrations/          generated SQL migrations
  prisma.config.ts            Prisma CLI config (builds the URL from DB_* in .env)
  src/
    server.ts                 startup: DB → seed admin → HTTP → sync → webhook worker
    app.ts                    Express app (helmet, cors, json, cookies, logging)
    config.ts                 .env parsed and validated with zod
    routes/                   URL → middleware → controller   (index.ts is the API map)
    controllers/              HTTP layer: read the request, call services/repositories, respond
    services/                 sync, webhooks (queue, sign, retry), attendance report, dashboard, auth, user rules
    repositories/             all database access through Prisma, one file per table
    validators/schemas.ts     zod schemas for every request body
    middleware/               auth (cookie/Bearer + roles), validation, error handler
    biotime/                  BioTime API client (token refresh, paging, errors), types, label maps
    db/prisma.ts              Prisma client (MariaDB driver adapter) + friendly DB errors
    db/time.ts                wall-clock ⇄ Prisma date conversion
    generated/prisma/         generated Prisma client (created by `prisma generate`, not committed)
```

## API (all under `/api`)

Sign in with `POST /api/auth/login` `{ "username", "password" }`. The response sets a cookie and also returns a
`token` you can send as `Authorization: Bearer <token>` from other systems.

| Method | Route | Role | Source |
| --- | --- | --- | --- |
| GET | `/health` | public | |
| POST | `/auth/login`, `/auth/logout`, `/auth/change-password`; GET `/auth/me` | any | PostgreSQL |
| GET | `/dashboard` | any | PostgreSQL |
| GET | `/transactions?search=&emp_code=&department=&terminal_sn=&start_time=&end_time=&page=&page_size=` | any | PostgreSQL |
| GET | `/transactions/export?start_time=&end_time=…` (CSV) | any | PostgreSQL |
| GET | `/reports/daily?start_date=&end_date=&department=&emp_code=&include_absent=true`, `/reports/daily/export` | any | PostgreSQL |
| GET | `/employees`, `/employees/all`, `/employees/:id` (same for `departments`, `areas`, `positions`, `devices`) | any | BioTime |
| POST / PATCH / DELETE | `/employees`, `/departments`, `/areas`, `/positions` | admin | BioTime |
| GET | `/system/status`, `/system/sync-runs?job=&page=`, `/system/biotime-health` | any | PostgreSQL |
| POST | `/system/sync` `{ "job": "all"\|"punches"\|"employees"\|"devices", "start_date"?, "end_date"? }` | admin | |
| GET | `/system/audit?page=&entity=` | admin | PostgreSQL |
| GET / POST | `/webhooks` | admin | PostgreSQL |
| GET / PATCH / DELETE | `/webhooks/:id` (PATCH accepts `rotate_secret: true`) | admin | PostgreSQL |
| POST | `/webhooks/:id/test` | admin | |
| GET | `/webhooks/deliveries?webhook_id=&status=&page=`, `/webhooks/deliveries/:id` | admin | PostgreSQL |
| POST | `/webhooks/deliveries/:id/redeliver` | admin | |
| GET / POST / PATCH / DELETE | `/users`, `/users/:id` | admin | PostgreSQL |

## Production

```bash
npm run build    # backend: prisma generate + tsc; frontend: next build
npm start        # backend applies migrations, then both start
```

- Set `NODE_ENV=production`. The backend refuses to start without a real `APP_JWT_SECRET`.
- **`BACKEND_URL` is read when the frontend is built.** If the backend isn't at `http://localhost:4000`, run
  `BACKEND_URL=http://host:4000 npm run build` (or set it in `frontend/.env`).
- Use a dedicated PostgreSQL user instead of `postgres`:
  ```sql
  CREATE USER zkteco WITH PASSWORD 'strong-password';
  CREATE DATABASE zkteco_attendance OWNER zkteco;
  ```
  Then set `DB_USER=zkteco`. `prisma migrate dev` also needs permission to create a temporary "shadow" database (`ALTER USER zkteco CREATEDB;`). `migrate deploy` (used in production) does not.
- Put HTTPS (nginx, IIS, Caddy) in front of port 3000 only. Webhook receivers should use `https://` URLs.

## Troubleshooting

| Message | Fix |
| --- | --- |
| `PostgreSQL rejected the login …` | Wrong `DB_USER` / `DB_PASSWORD` in `backend/.env`. |
| `PostgreSQL is not reachable …` | The PostgreSQL service is stopped (Windows: Services → postgresql-x64-17 → Start), or wrong host/port. |
| `Tables are missing` / `Database … does not exist` | Run `npm run db:deploy` in `backend/`. |
| `Cannot reach BioTime server at …` | Wrong `BIOTIME_URL`, BioTime stopped, or a firewall. Open the URL in a browser on the backend machine. |
| `BioTime rejected the login …` | Wrong `BIOTIME_USERNAME` / `BIOTIME_PASSWORD`. Use a BioTime **system user**, not an employee. |
| `401` with `BIOTIME_AUTH_TYPE=jwt` | Some builds only allow the general token. Set `BIOTIME_AUTH_TYPE=token`. |
| Dashboard shows "No data has been synced yet" | Click **Sync now**, or see errors under **Sync & Activity → Sync history**. |
| Webhook deliveries keep failing | Open the delivery in the log: it shows the receiver's status code and response. Fix the receiver, then **Resend**. |
| Receiver says the signature is wrong | Sign `timestamp + "." + rawBody` (the exact bytes received, before JSON parsing) with the current secret. After **New secret**, update the receiver. |
| `Port 4000 is already in use` | Another copy of the backend is running. Stop it, or change `PORT`. |
| Forgot the admin password | `cd backend && npm run user:reset-password -- admin NewPass123` |

/**
 * Demo data so the dashboard, punch logs and reports can be tried before BioTime is connected.
 *
 *   npm run db:seed                    # 14 days of demo data (safe to run again)
 *   npm run db:seed -- --days 30       # more history
 *   npm run db:seed:clear              # remove all demo data
 *
 * Safety: every demo row uses ids >= 900,000,000 and employee codes starting with "D", so it can never
 * collide with real BioTime data. No sync runs are created, so the first real sync still imports
 * the full SYNC_INITIAL_DAYS of history. A real employee/device sync marks demo employees as
 * deleted and removes demo devices automatically; demo punches stay until you run --clear.
 */
import { authService } from '../services/auth.service.js';
import { usersRepo } from '../repositories/users.js';
import { localDate } from '../utils/http.js';
import { connectDatabase, describeDbError, disconnectDatabase, prisma } from './prisma.js';
import { dbNow, toDb } from './time.js';

const DEMO_ID = 900_000_000;
const WEEKEND = new Set([0, 6]); // Sunday, Saturday. Change to [5, 6] for a Friday/Saturday weekend.

// ---- Small deterministic random generator, so every run produces the same data ----
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n: number) => String(n).padStart(2, '0');
const at = (date: string, minutes: number, seconds: number) =>
  `${date} ${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:${pad(seconds)}`;

const DEPARTMENTS = [
  { id: DEMO_ID + 1, name: 'Administration' },
  { id: DEMO_ID + 2, name: 'Teaching Staff' },
  { id: DEMO_ID + 3, name: 'Support Staff' },
  { id: DEMO_ID + 4, name: 'Security' },
];

/** [first, last, department index, position, shift start (minutes), shift end] */
const PEOPLE: [string, string, number, string, number, number][] = [
  ['Amina', 'Hassan', 0, 'Principal', 450, 960],
  ['Yusuf', 'Ali', 0, 'Accountant', 480, 990],
  ['Khadija', 'Omar', 0, 'Secretary', 480, 990],
  ['Ibrahim', 'Abdi', 0, 'IT Officer', 480, 990],
  ['Fatima', 'Noor', 1, 'Teacher', 450, 930],
  ['Ahmed', 'Farah', 1, 'Teacher', 450, 930],
  ['Maryam', 'Said', 1, 'Teacher', 450, 930],
  ['Hassan', 'Mohamed', 1, 'Teacher', 450, 930],
  ['Zainab', 'Ismail', 1, 'Teacher', 450, 930],
  ['Omar', 'Yusuf', 1, 'Teacher', 450, 930],
  ['Aisha', 'Ahmed', 1, 'Teacher', 450, 930],
  ['Bilal', 'Osman', 1, 'Teacher', 450, 930],
  ['Hafsa', 'Ibrahim', 1, 'Teacher', 450, 930],
  ['Abdullahi', 'Nur', 1, 'Teacher', 450, 930],
  ['Ruqia', 'Mahad', 1, 'Teacher', 450, 930],
  ['Salman', 'Haji', 1, 'Teacher', 450, 930],
  ['Sumaya', 'Adan', 1, 'Teacher', 450, 930],
  ['Idris', 'Warsame', 1, 'Teacher', 450, 930],
  ['Nasra', 'Jama', 1, 'Teacher', 450, 930],
  ['Hamza', 'Elmi', 1, 'Teacher', 450, 930],
  ['Safiya', 'Guled', 2, 'Librarian', 480, 990],
  ['Musa', 'Dahir', 2, 'Driver', 390, 900],
  ['Halima', 'Barre', 2, 'Cleaner', 420, 900],
  ['Abdirahman', 'Kassim', 2, 'Cleaner', 420, 900],
  ['Layla', 'Hirsi', 2, 'Cook', 420, 870],
  ['Mahmoud', 'Awale', 2, 'Maintenance', 480, 990],
  ['Ismail', 'Roble', 3, 'Guard', 360, 1080],
  ['Abdikarim', 'Yonis', 3, 'Guard', 360, 1080],
  ['Sahra', 'Mire', 3, 'Guard', 360, 1080],
  ['Khalid', 'Ugas', 3, 'Supervisor', 420, 1020],
];

const DEVICES = [
  { id: DEMO_ID + 1, sn: 'DEMO0000001', alias: 'Main Gate', ip: '192.168.1.201', state: 1, area: 'Main Campus' },
  { id: DEMO_ID + 2, sn: 'DEMO0000002', alias: 'Staff Room', ip: '192.168.1.202', state: 1, area: 'Main Campus' },
  { id: DEMO_ID + 3, sn: 'DEMO0000003', alias: 'Back Gate', ip: '192.168.1.203', state: 0, area: 'Main Campus' },
];

const VERIFY = [15, 15, 15, 1, 1, 4]; // mostly face, some fingerprint, a few cards

async function clear() {
  const [p, e, d] = await prisma.$transaction([
    prisma.punch.deleteMany({ where: { id: { gte: DEMO_ID } } }),
    prisma.employee.deleteMany({ where: { id: { gte: DEMO_ID } } }),
    prisma.device.deleteMany({ where: { id: { gte: DEMO_ID } } }),
  ]);
  console.log(`[seed] Removed demo data: ${p.count} punches, ${e.count} employees, ${d.count} devices.`);
}

async function seed(days: number) {
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const today = localDate(now);
  const syncedAt = dbNow();

  // ---- Devices ----
  for (const d of DEVICES) {
    const data = {
      sn: d.sn,
      alias: d.alias,
      ipAddress: d.ip,
      state: d.state,
      areaName: d.area,
      fwVer: 'Ver 6.60 (demo)',
      lastActivity: d.state === 1 ? syncedAt : toDb(`${localDate(new Date(now.getTime() - 2 * 86400_000))} 16:42:10`),
      userCount: PEOPLE.length,
      fpCount: 22,
      faceCount: 27,
      transactionCount: null,
      syncedAt,
    };
    await prisma.device.upsert({ where: { id: d.id }, create: { id: d.id, ...data }, update: data });
  }

  // ---- Employees ----
  const hire = localDate(new Date(now.getTime() - 400 * 86400_000));
  const employees = PEOPLE.map(([first, last, dept, position], i) => ({
    id: DEMO_ID + 1 + i,
    empCode: `D${1001 + i}`,
    firstName: first,
    lastName: last,
    departmentId: DEPARTMENTS[dept]!.id,
    departmentName: DEPARTMENTS[dept]!.name,
    positionName: position,
    areaNames: 'Main Campus',
    cardNo: String(4000100 + i),
    mobile: `+25261${String(5000000 + i * 7919).slice(0, 7)}`,
    email: `${first}.${last}@example.com`.toLowerCase(),
    gender: i % 3 === 0 ? 'F' : i % 3 === 1 ? 'M' : 'F',
    hireDate: hire,
    enableAtt: true,
    isDeleted: false,
    syncedAt,
  }));
  for (const e of employees) {
    const { id, ...data } = e;
    await prisma.employee.upsert({ where: { id }, create: e, update: data });
  }

  // ---- Punches ----
  const punches: {
    id: number;
    empCode: string;
    punchTime: Date;
    punchState: string;
    verifyType: number;
    terminalSn: string;
    terminalAlias: string;
    areaAlias: string;
    uploadTime: Date;
    syncedAt: Date;
  }[] = [];
  let workdays = 0;

  for (let back = days - 1; back >= 0; back--) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
    if (WEEKEND.has(day.getDay())) continue;
    workdays++;
    const date = localDate(day);
    const dayNumber = Math.floor(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) / 86400_000);

    PEOPLE.forEach(([, , , , start, end], i) => {
      const r = rng(dayNumber * 100 + i);
      const roll = r();
      if (roll < 0.06) return; // absent
      const late = roll > 0.9; // about 1 in 10 arrives late
      const inMin = start - 20 + Math.floor(r() * 30) + (late ? 25 + Math.floor(r() * 40) : 0);
      const outMin = end - 5 + Math.floor(r() * 45);
      const forgotOut = roll > 0.06 && roll < 0.1; // about 4% forget to punch out
      const staffRoom = i >= 4 && i < 20 && r() < 0.35; // teachers sometimes use the staff room device
      const device = staffRoom ? DEVICES[1]! : DEVICES[0]!;
      const verifyType = VERIFY[Math.floor(r() * VERIFY.length)]!;
      const base = DEMO_ID + 10_000_000 + (dayNumber % 100_000) * 100 + i * 3;

      const add = (k: number, minutes: number, state: string) => {
        if (date === today && minutes > nowMinutes) return; // no punches in the future
        const time = at(date, minutes, Math.floor(r() * 60));
        punches.push({
          id: base + k,
          empCode: employees[i]!.empCode,
          punchTime: toDb(time),
          punchState: state,
          verifyType,
          terminalSn: device.sn,
          terminalAlias: device.alias,
          areaAlias: device.area,
          uploadTime: toDb(time),
          syncedAt,
        });
      };

      add(0, inMin, '0');
      // Security and support staff often take a break punch
      if (i >= 20 && r() < 0.5) add(1, 720 + Math.floor(r() * 20), '2');
      if (!forgotOut) add(2, outMin, '1');
    });
  }

  let created = 0;
  for (let i = 0; i < punches.length; i += 1000) {
    const r = await prisma.punch.createMany({ data: punches.slice(i, i + 1000), skipDuplicates: true });
    created += r.count;
  }

  // ---- A read-only demo user (only if it doesn't exist) ----
  let viewerNote = 'already existed';
  if (!(await usersRepo.findByUsername('viewer'))) {
    await usersRepo.create({ username: 'viewer', password: 'viewer123', full_name: 'Demo Viewer', role: 'viewer' });
    viewerNote = 'created (password: viewer123)';
  }

  console.log(`[seed] Devices: ${DEVICES.length} (1 shown offline)`);
  console.log(`[seed] Employees: ${employees.length} in ${DEPARTMENTS.length} departments (codes D1001-D${1000 + employees.length})`);
  console.log(`[seed] Punches: ${punches.length} over ${workdays} working days, ${created} new (${punches.length - created} already there)`);
  console.log(`[seed] User "viewer": ${viewerNote}`);
  console.log('[seed] Done. Remove all demo data later with: npm run db:seed:clear');
}

async function main() {
  const args = process.argv.slice(2);
  const daysArg = args.indexOf('--days');
  const days = daysArg >= 0 ? Math.min(92, Math.max(1, Number(args[daysArg + 1]) || 14)) : 14;

  try {
    await connectDatabase();
  } catch (err) {
    console.error(`[seed] ${describeDbError(err)}`);
    process.exit(1);
  }

  try {
    if (args.includes('--clear')) {
      await clear();
    } else {
      await authService.seedAdminIfEmpty(); // so there is someone to sign in as
      await seed(days);
    }
  } catch (err) {
    console.error(`[seed] Failed: ${describeDbError(err)}`);
    process.exitCode = 1;
  } finally {
    await disconnectDatabase();
  }
}

void main();

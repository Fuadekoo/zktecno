import { z } from 'zod';

const trimmed = (max: number) => z.string().trim().max(max);
const nullableId = z.union([z.coerce.number().int().positive(), z.literal(''), z.null()]).transform((v) => (v === '' ? null : v));
const optionalDate = z
  .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'), z.literal(''), z.null()])
  .transform((v) => (v === '' ? null : v));

// ---- Auth & users ----
export const loginSchema = z.object({
  username: trimmed(64).min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required').max(200),
});

const password = z.string().min(8, 'At least 8 characters').max(200);
const role = z.enum(['admin', 'viewer']);

export const createUserSchema = z.object({
  username: trimmed(64)
    .min(3, 'At least 3 characters')
    .regex(/^[A-Za-z0-9._-]+$/, 'Letters, numbers, dot, dash and underscore only'),
  full_name: trimmed(128).optional().nullable(),
  password,
  role: role.default('viewer'),
});

export const updateUserSchema = z
  .object({
    full_name: trimmed(128).nullable(),
    role,
    is_active: z.boolean(),
    password,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const changePasswordSchema = z.object({
  current_password: z.string().min(1, 'Current password is required'),
  new_password: password,
});

/** A signed-in user editing their own profile. */
export const profileSchema = z.object({
  full_name: trimmed(100),
});

// ---- BioTime personnel ----
export const employeeSchema = z.object({
  emp_code: trimmed(20)
    .min(1, 'Employee code is required')
    .regex(/^[A-Za-z0-9]+$/, 'Letters and numbers only'),
  first_name: trimmed(25).optional(),
  last_name: trimmed(25).optional(),
  nickname: trimmed(25).optional(),
  // Required by BioTime; optional when employees are kept here (BioTime off)
  department: nullableId.optional(),
  position: nullableId.optional(),
  area: z.array(z.coerce.number().int().positive()).optional(),
  hire_date: optionalDate.optional(),
  birthday: optionalDate.optional(),
  gender: z.union([z.enum(['M', 'F']), z.literal(''), z.null()]).transform((v) => (v === '' ? null : v)).optional(),
  card_no: trimmed(20).optional(),
  device_password: trimmed(8).optional(),
  dev_privilege: z.coerce.number().int().optional(),
  mobile: trimmed(20).optional(),
  email: z.union([z.string().trim().email('Invalid email'), z.literal('')]).optional(),
  contact_tel: trimmed(20).optional(),
  office_tel: trimmed(20).optional(),
  national: trimmed(50).optional(),
  city: trimmed(50).optional(),
  address: trimmed(200).optional(),
  postcode: trimmed(10).optional(),
  ssn: trimmed(20).optional(),
  religion: trimmed(20).optional(),
  enable_att: z.boolean().optional(),
  enable_overtime: z.boolean().optional(),
  enable_holiday: z.boolean().optional(),
});
export const employeeUpdateSchema = employeeSchema.partial();

// ---- Device commands ----
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const deviceActionSchema = z
  .object({
    action: z.enum(['fetch_punches', 'fetch_users', 'send_all_employees', 'reboot', 'check']),
    start_date: day.optional(),
    end_date: day.optional(),
  })
  .refine((v) => v.action !== 'fetch_punches' || (v.start_date && v.end_date), { message: 'Pick a start and end date', path: ['start_date'] })
  .refine((v) => !v.start_date || !v.end_date || v.start_date <= v.end_date, { message: 'The start date must be before the end date', path: ['end_date'] });

export const enrollSchema = z.object({
  device_id: z.coerce.number().int().positive('Pick a device'),
  /** 0-9: left little finger … right little finger, as numbered on ZKTeco devices */
  finger: z.coerce.number().int().min(0).max(9).default(6),
});

const orgUnit = (prefix: 'dept' | 'area' | 'position', parentKey: string) =>
  z.object({
    [`${prefix}_code`]: trimmed(50).min(1, 'Code is required'),
    [`${prefix}_name`]: trimmed(100).min(1, 'Name is required'),
    [parentKey]: nullableId.optional(),
  });

export const departmentSchema = orgUnit('dept', 'parent_dept');
export const areaSchema = orgUnit('area', 'parent_area');
export const positionSchema = orgUnit('position', 'parent_position');

// ---- Webhooks ----
const webhookUrl = z
  .string()
  .trim()
  .max(2048)
  .url('Enter a full URL, e.g. https://example.com/hooks/attendance')
  .refine((u) => /^https?:\/\//i.test(u), 'Only http:// and https:// URLs are allowed');
const webhookEvents = z
  .array(z.enum(['punch.created', 'sync.completed', 'sync.failed']))
  .min(1, 'Pick at least one event')
  .transform((list) => [...new Set(list)]);

export const createWebhookSchema = z.object({
  name: trimmed(100).min(1, 'Name is required'),
  url: webhookUrl,
  events: webhookEvents,
  is_active: z.boolean().default(true),
  /** Also send punches already saved: 0 = none, 1 = today, N = last N days */
  send_days: z.coerce.number().int().min(0).max(90).default(0),
});

export const sendPastPunchesSchema = z.object({
  days: z.coerce.number().int().min(1, 'At least 1 day').max(90, 'At most 90 days'),
});

export const updateWebhookSchema = z
  .object({
    name: trimmed(100).min(1, 'Name is required'),
    url: webhookUrl,
    events: webhookEvents,
    is_active: z.boolean(),
    rotate_secret: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

// ---- System ----
export const syncRequestSchema = z
  .object({
    job: z.enum(['all', 'devices', 'employees', 'punches', 'device_punches']).default('all'),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
  })
  .refine((v) => !v.start_date === !v.end_date, { message: 'Give both start_date and end_date, or neither', path: ['end_date'] })
  .refine((v) => !v.start_date || !v.end_date || v.start_date <= v.end_date, {
    message: 'start_date must be on or before end_date',
    path: ['end_date'],
  });

// ---- Settings (stored in the database, edited on the Settings page) ----
const intIn = (min: number, max: number, label = 'Value') =>
  z.coerce.number().int('Whole numbers only').min(min, `${label} must be at least ${min}`).max(max, `${label} must be at most ${max}`);
const httpUrl = z
  .string()
  .trim()
  .max(512)
  .refine((v) => /^https?:\/\/[^\s/]+/i.test(v), 'Use a full address like http://192.168.1.10:8081');
const ipOrHost = z
  .string()
  .trim()
  .max(64)
  .regex(/^[A-Za-z0-9.\-:]+$/, 'Use an IP address like 192.168.1.201 (or a host name)');
const blankToNull = <T extends z.ZodType>(s: T) =>
  z.union([s, z.literal(''), z.null()]).optional().transform((v) => (v === '' || v === undefined ? null : v));

export const biotimeSettingsSchema = z
  .object({
    enabled: z.boolean(),
    url: httpUrl,
    username: trimmed(64).min(1, 'Username is required'),
    /** Empty = keep the current password */
    password: z.string().max(200),
    auth_type: z.enum(['jwt', 'token']),
    timeout_ms: intIn(1000, 120_000, 'Timeout'),
  })
  .partial();

export const admsSettingsSchema = z
  .object({
    enabled: z.boolean(),
    port: intIn(1, 65535, 'Port'),
    forward: z.boolean(),
    forward_url: z.union([httpUrl, z.literal('')]),
    forward_timeout_ms: intIn(1000, 120_000, 'Timeout'),
    accept_any: z.boolean(),
  })
  .partial();

export const syncSettingsSchema = z
  .object({
    enabled: z.boolean(),
    interval_seconds: intIn(60, 86_400, 'Interval'),
    employees_minutes: intIn(1, 10_080, 'Employee refresh'),
    initial_days: intIn(1, 3650, 'First import'),
    lookback_hours: intIn(1, 720, 'Look-back'),
    device_timeout_ms: intIn(1000, 120_000, 'Timeout'),
  })
  .partial();

/** Logo as a data: URL. ~500 KB file at most (base64 is 4/3 larger). */
const logoDataUrl = z
  .string()
  .max(700_000, 'The logo is too large. Use an image under 500 KB.')
  .regex(/^(data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+)?$/, 'The logo must be a PNG, JPEG, WebP or SVG image');

export const companySettingsSchema = z
  .object({
    name: trimmed(120),
    name_am: trimmed(120),
    name_om: trimmed(120),
    slogan: trimmed(160),
    email: z.union([z.string().trim().email('Invalid email').max(120), z.literal('')]),
    phone: trimmed(30),
    phone2: trimmed(30),
    website: z.union([z.string().trim().url('Enter a full address, e.g. https://example.com').max(200), z.literal('')]),
    tin: trimmed(30),
    license_no: trimmed(60),
    code: trimmed(30),
    city: trimmed(80),
    subcity: trimmed(80),
    address: trimmed(200),
    logo: logoDataUrl,
  })
  .partial();

const hexColor = z.union([z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #1b2a4a'), z.literal('')]);
export const appearanceSettingsSchema = z
  .object({
    brand_color: hexColor,
    sidebar_mode: z.enum(['light', 'brand', 'custom']),
    sidebar_color: hexColor,
  })
  .partial();

const deviceFields = z.object({
  name: trimmed(100).min(1, 'Give the device a name'),
  mode: z.enum(['pull', 'push', 'both']),
  ip: blankToNull(ipOrHost),
  port: intIn(1, 65535, 'Port').default(4370),
  serial_number: blankToNull(trimmed(64).regex(/^[A-Za-z0-9\-_]+$/, 'Letters, numbers, dash and underscore only')),
  location: blankToNull(trimmed(128)),
  timeout_ms: intIn(1000, 120_000, 'Timeout').default(10_000),
  chunk_size: blankToNull(intIn(1024, 65_472, 'Chunk size')),
  enabled: z.boolean().default(true),
});

const deviceRules = (d: { mode?: string; ip?: string | null; serial_number?: string | null }, ctx: z.RefinementCtx) => {
  if ((d.mode === 'pull' || d.mode === 'both') && !d.ip) ctx.addIssue({ code: 'custom', path: ['ip'], message: 'The IP address is needed to read the device' });
  if ((d.mode === 'push' || d.mode === 'both') && !d.serial_number)
    ctx.addIssue({ code: 'custom', path: ['serial_number'], message: 'The serial number is needed to accept pushes (Test connection fills it in)' });
};

export const zkDeviceSchema = deviceFields.superRefine(deviceRules);

/** "Test connection" before saving: only what is needed to reach the device. */
export const zkDeviceTestSchema = z.object({
  ip: ipOrHost.min(1, 'IP address is required'),
  port: intIn(1, 65535, 'Port').default(4370),
  timeout_ms: intIn(1000, 120_000, 'Timeout').default(10_000),
  chunk_size: blankToNull(intIn(1024, 65_472, 'Chunk size')).optional(),
});

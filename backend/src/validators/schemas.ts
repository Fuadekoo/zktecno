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

// ---- BioTime personnel ----
export const employeeSchema = z.object({
  emp_code: trimmed(20)
    .min(1, 'Employee code is required')
    .regex(/^[A-Za-z0-9]+$/, 'Letters and numbers only'),
  first_name: trimmed(25).optional(),
  last_name: trimmed(25).optional(),
  nickname: trimmed(25).optional(),
  department: z.coerce.number().int().positive('Department is required'),
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

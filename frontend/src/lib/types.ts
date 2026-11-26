export interface AreaRef {
  id: number;
  area_code: string;
  area_name: string;
}

export interface Device {
  id: number;
  sn: string;
  ip_address: string | null;
  alias: string | null;
  terminal_name: string | null;
  fw_ver: string | null;
  push_ver: string | null;
  state: number;
  terminal_tz: number | null;
  area: AreaRef | null;
  area_name: string | null;
  last_activity: string | null;
  user_count: number | null;
  fp_count: number | null;
  face_count: number | null;
  palm_count: number | null;
  transaction_count: number | null;
  push_time: string | null;
  transfer_time: string | null;
  transfer_interval: number | null;
  is_attendance: boolean;
}

export interface Employee {
  id: number;
  emp_code: string;
  first_name: string | null;
  last_name: string | null;
  nickname: string | null;
  card_no: string | null;
  device_password: string | null;
  department: { id: number; dept_code: string; dept_name: string } | number | null;
  dept_name?: string | null;
  position: { id: number; position_code: string; position_name: string } | number | null;
  position_name?: string | null;
  hire_date: string | null;
  birthday: string | null;
  gender: string | null;
  mobile: string | null;
  email: string | null;
  contact_tel: string | null;
  office_tel: string | null;
  national: string | null;
  city: string | null;
  address: string | null;
  postcode: string | null;
  ssn: string | null;
  religion: string | null;
  dev_privilege: number | null;
  verify_mode: number | null;
  emp_type: number | null;
  enable_att: boolean;
  enable_overtime: boolean;
  enable_holiday: boolean;
  area: (AreaRef | number)[];
  area_name?: string | null;
  app_status: number | null;
}

export interface Transaction {
  id: number;
  emp_code: string;
  punch_time: string;
  punch_state: string;
  punch_state_label: string;
  verify_type: number;
  verify_type_label: string;
  work_code: string | null;
  terminal_sn: string;
  terminal_alias: string | null;
  area_alias: string | null;
  employee_name: string;
  department_name: string;
  upload_time: string | null;
}

export interface OrgUnit {
  id: number;
  [key: string]: string | number | null | Record<string, unknown>;
}

export interface DailyRow {
  emp_code: string;
  employee_name: string;
  department_name: string;
  date: string;
  first_punch: string | null;
  last_punch: string | null;
  punch_count: number;
  worked_minutes: number;
  status: 'Present' | 'Missing punch' | 'Absent';
  terminals: string;
}

export interface DailyReport {
  summary: {
    start_date: string;
    end_date: string;
    days: number;
    rows: number;
    present: number;
    missing_punch: number;
    absent: number;
    total_punches: number;
  };
  data: DailyRow[];
}

export interface DeviceSummary {
  id: number;
  sn: string;
  alias: string | null;
  ip_address: string | null;
  state: number | null;
  area_name: string | null;
  last_activity: string | null;
  user_count: number | null;
  transaction_count: number | null;
  synced_at: string;
}

export interface Dashboard {
  date: string;
  devices: { total: number; online: number; list: DeviceSummary[] };
  employees: { total: number; attendance_enabled: number };
  today: {
    punches: number;
    present: number;
    absent: number;
    hourly: { hour: number; count: number }[];
    recent: Transaction[];
  };
  sync: {
    enabled: boolean;
    interval_seconds: number;
    running: boolean;
    last_success_at: string | null;
    last_error: string | null;
    never_synced: boolean;
  };
}

export type SyncJobName = 'devices' | 'employees' | 'punches' | 'device_punches';

export interface SyncJobState {
  job: SyncJobName;
  is_running: boolean;
  last_started_at: string | null;
  last_finished_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  last_count: number;
  total_runs: number;
}

export interface SystemStatus {
  biotime: { enabled: boolean; server: string; auth_type: string; user: string };
  database: { host: string; port: number; name: string };
  /** Devices read directly with zkteco-js (ZK_DEVICES), as "ip:port" */
  direct_devices: string[];
  adms: { enabled: boolean; port: number; forward_to: string | null; devices: AdmsDevice[] };
  sync: {
    enabled: boolean;
    interval_seconds: number;
    employees_minutes: number;
    lookback_hours: number;
    running: boolean;
    jobs: SyncJobState[];
  };
  totals: { punches: number; first_punch: string | null; last_punch: string | null; employees: number; devices: number };
}

export interface SyncResult {
  ok: boolean;
  results: { job: SyncJobName; ok: boolean; count: number; error?: string; ms: number }[];
}

export interface AppUser {
  id: number;
  username: string;
  full_name: string | null;
  role: 'admin' | 'viewer';
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
}

export interface AuditEntry {
  id: number;
  username: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  summary: string | null;
  ip: string | null;
  created_at: string;
}

export interface SyncRunRow {
  id: number;
  job: SyncJobName;
  trigger: 'startup' | 'schedule' | 'manual' | 'personnel_change' | 'range';
  status: 'running' | 'success' | 'failed';
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  fetched: number;
  created: number;
  updated: number;
  removed: number;
  range_from: string | null;
  range_to: string | null;
  webhooks_queued: number;
  error: string | null;
}

export type WebhookEventName = 'punch.created' | 'sync.completed' | 'sync.failed';
export type DeliveryStatus = 'pending' | 'success' | 'failed';

export interface WebhookRow {
  id: number;
  name: string;
  url: string;
  events: WebhookEventName[];
  is_active: boolean;
  secret: string;
  last_delivery_at: string | null;
  last_status: DeliveryStatus | null;
  created_at: string;
  last_24h?: { success: number; failed: number; pending: number };
}

export interface WebhookDeliveryRow {
  id: number;
  webhook_id: number;
  webhook_name?: string;
  sync_run_id: number | null;
  event: string;
  status: DeliveryStatus;
  attempts: number;
  next_attempt_at: string | null;
  response_status: number | null;
  response_body: string | null;
  error: string | null;
  duration_ms: number | null;
  created_at: string;
  delivered_at: string | null;
  payload?: unknown;
}

/** A device pushing to this server over ADMS (since the backend started). */
export interface AdmsDevice {
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

/** Live status of a device read directly over the ZKTeco protocol (GET /system/zk-devices). */
export interface ZkDeviceStatus {
  ip: string;
  port: number;
  online: boolean;
  connection: 'tcp' | 'udp' | null;
  serial_number: string | null;
  device_name: string | null;
  firmware: string | null;
  device_time: string | null;
  user_count: number | null;
  log_count: number | null;
  log_capacity: number | null;
  latency_ms: number;
  error: string | null;
}

// ---- Settings page ----
export type DeviceMode = 'pull' | 'push' | 'both';

export interface DeviceSetting {
  id: number;
  name: string;
  mode: DeviceMode;
  ip: string | null;
  port: number;
  serial_number: string | null;
  location: string | null;
  timeout_ms: number;
  chunk_size: number | null;
  enabled: boolean;
  model: string | null;
  firmware: string | null;
  last_seen_at: string | null;
  last_push_at: string | null;
  last_push_ip: string | null;
}

export interface BioTimeSettings {
  enabled: boolean;
  url: string;
  username: string;
  password: string;
  password_set: boolean;
  auth_type: 'jwt' | 'token';
  timeout_ms: number;
}

export interface AdmsSettings {
  enabled: boolean;
  port: number;
  forward: boolean;
  forward_url: string;
  forward_timeout_ms: number;
  accept_any: boolean;
}

export interface SyncSettings {
  enabled: boolean;
  interval_seconds: number;
  employees_minutes: number;
  initial_days: number;
  lookback_hours: number;
  device_timeout_ms: number;
}

export interface AppSettings {
  biotime: BioTimeSettings;
  adms: AdmsSettings;
  sync: SyncSettings;
}

export interface NetworkInfo {
  server_ips: string[];
  adms_port: number;
  adms_enabled: boolean;
  adms_listening: boolean;
  api_port: number;
}

export interface SettingsResponse {
  settings: AppSettings;
  devices: DeviceSetting[];
  network: NetworkInfo;
  unknown_push_devices: { sn: string; ip: string | null; last_seen: string }[];
}

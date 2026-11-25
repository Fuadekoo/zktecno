/** Shapes returned by the BioTime 8.5 API (only the fields this app uses are typed strictly). */

export interface BtRef {
  id: number;
  [key: string]: unknown;
}

export interface BtTerminal {
  id: number;
  sn: string;
  ip_address: string | null;
  alias: string | null;
  terminal_name: string | null;
  fw_ver: string | null;
  push_ver: string | null;
  state: number | string | null;
  terminal_tz: number | null;
  area: (BtRef & { area_code?: string; area_name?: string }) | null;
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
  is_attendance: boolean | null;
}

export interface BtEmployee {
  id: number;
  emp_code: string;
  first_name: string | null;
  last_name: string | null;
  department: (BtRef & { dept_code?: string; dept_name?: string }) | number | null;
  dept_name?: string | null;
  position: (BtRef & { position_name?: string }) | number | null;
  position_name?: string | null;
  area: Array<(BtRef & { area_name?: string }) | number> | null;
  area_name?: string | null;
  card_no: string | null;
  mobile: string | null;
  email: string | null;
  gender: string | null;
  hire_date: string | null;
  enable_att: boolean | null;
  [key: string]: unknown;
}

export interface BtTransaction {
  id: number;
  emp_code: string;
  punch_time: string;
  punch_state: string | number | null;
  verify_type: number | null;
  work_code: string | null;
  terminal_sn: string | null;
  terminal_alias: string | null;
  area_alias: string | null;
  upload_time: string | null;
  [key: string]: unknown;
}

export interface BtPage<T> {
  count: number;
  hasNext: boolean;
  hasPrevious: boolean;
  data: T[];
}

/** BioTime 8.5 REST paths (from the BioTime 8.5 API User Manual). */
export const ENDPOINTS = {
  terminals: '/iclock/api/terminals/',
  // The manual prints "transctions" in one table; the real path is "transactions".
  transactions: '/iclock/api/transactions/',
  employees: '/personnel/api/employees/',
  departments: '/personnel/api/departments/',
  areas: '/personnel/api/areas/',
  positions: '/personnel/api/positions/',
} as const;

/** punch_state values used by ZKTeco devices. */
export const PUNCH_STATES: Record<string, string> = {
  '0': 'Check In',
  '1': 'Check Out',
  '2': 'Break Out',
  '3': 'Break In',
  '4': 'Overtime In',
  '5': 'Overtime Out',
  '255': 'Unknown',
};

/** verify_type values used by ZKTeco devices. */
export const VERIFY_TYPES: Record<string, string> = {
  '0': 'Password',
  '1': 'Fingerprint',
  '2': 'Badge',
  '3': 'PIN',
  '4': 'Card',
  '15': 'Face',
  '25': 'Palm',
};

export const punchStateLabel = (s: unknown) => PUNCH_STATES[String(s)] ?? `State ${String(s)}`;
export const verifyTypeLabel = (v: unknown) => VERIFY_TYPES[String(v)] ?? `Type ${String(v)}`;

/** Minimal typings for the parts of zkteco-js this app uses (the package ships none). */
declare module 'zkteco-js' {
  export interface ZkAttendanceRecord {
    /** Record index on the device (not the serial number) */
    sn: number;
    /** Device user id (PIN), i.e. the BioTime emp_code */
    user_id: string;
    /** Local wall-clock time as Date#toString() */
    record_time: string;
    /** Verify mode (1 fingerprint, 15 face, 4 card, 0 password, …) */
    type: number;
    /** Punch state (0 check in, 1 check out, 2 break out, …) */
    state: number;
    ip: string;
  }

  export interface ZkUser {
    uid: number;
    role: number;
    password: string;
    name: string;
    cardno: number;
    userId: string;
  }

  export default class Zkteco {
    constructor(ip: string, port: number, timeout: number, inport?: number, maxChunk?: number);
    connectionType: 'tcp' | 'udp' | null;
    createSocket(cbErr?: (err: Error) => void, cbClose?: (type: string) => void): Promise<boolean>;
    disconnect(): Promise<unknown>;
    getAttendances(cb?: (progress: number, total: number) => void): Promise<{ data: ZkAttendanceRecord[]; err?: unknown }>;
    getUsers(): Promise<{ data: ZkUser[] }>;
    getInfo(): Promise<{ userCounts: number; logCounts: number; logCapacity: number }>;
    getSerialNumber(): Promise<string>;
    getDeviceName(): Promise<string>;
    getFirmware(): Promise<string>;
    getTime(): Promise<Date>;
  }
}

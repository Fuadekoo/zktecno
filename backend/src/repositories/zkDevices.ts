import { prisma } from '../db/prisma.js';
import { dbNow, fromDb } from '../db/time.js';
import type { DeviceMode, ZkDevice } from '../generated/prisma/client.js';

export type { DeviceMode, ZkDevice };

/** What the Settings page sends when adding or editing a device. */
export interface ZkDeviceInput {
  name: string;
  mode: DeviceMode;
  ip: string | null;
  port: number;
  serial_number: string | null;
  location: string | null;
  timeout_ms: number;
  chunk_size: number | null;
  enabled: boolean;
}

export function toApi(d: ZkDevice) {
  return {
    id: d.id,
    name: d.name,
    mode: d.mode,
    ip: d.ip,
    port: d.port,
    serial_number: d.serialNumber,
    location: d.location,
    timeout_ms: d.timeoutMs,
    chunk_size: d.chunkSize,
    enabled: d.enabled,
    model: d.model,
    firmware: d.firmware,
    last_seen_at: fromDb(d.lastSeenAt),
    created_at: fromDb(d.createdAt),
    updated_at: fromDb(d.updatedAt),
  };
}

function toData(i: Partial<ZkDeviceInput>) {
  return {
    ...(i.name !== undefined && { name: i.name }),
    ...(i.mode !== undefined && { mode: i.mode }),
    ...(i.ip !== undefined && { ip: i.ip }),
    ...(i.port !== undefined && { port: i.port }),
    ...(i.serial_number !== undefined && { serialNumber: i.serial_number }),
    ...(i.location !== undefined && { location: i.location }),
    ...(i.timeout_ms !== undefined && { timeoutMs: i.timeout_ms }),
    ...(i.chunk_size !== undefined && { chunkSize: i.chunk_size }),
    ...(i.enabled !== undefined && { enabled: i.enabled }),
  };
}

export const zkDevicesRepo = {
  list: () => prisma.zkDevice.findMany({ orderBy: [{ name: 'asc' }, { id: 'asc' }] }),
  count: () => prisma.zkDevice.count(),
  get: (id: number) => prisma.zkDevice.findUnique({ where: { id } }),

  create(i: ZkDeviceInput) {
    const now = dbNow();
    return prisma.zkDevice.create({ data: { ...toData(i), name: i.name, createdAt: now, updatedAt: now } });
  },

  update: (id: number, i: Partial<ZkDeviceInput>) => prisma.zkDevice.update({ where: { id }, data: { ...toData(i), updatedAt: dbNow() } }),

  remove: (id: number) => prisma.zkDevice.delete({ where: { id } }),

  /** After a successful connection test: remember what the device reported. */
  markSeen(id: number, info: { model?: string | null; firmware?: string | null; serialNumber?: string | null }) {
    return prisma.zkDevice.update({
      where: { id },
      data: {
        lastSeenAt: dbNow(),
        ...(info.model && { model: info.model.slice(0, 100) }),
        ...(info.firmware && { firmware: info.firmware.slice(0, 100) }),
        ...(info.serialNumber && { serialNumber: info.serialNumber.slice(0, 64) }),
      },
    });
  },
};

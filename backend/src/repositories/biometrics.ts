import { prisma } from '../db/prisma.js';
import { dbNow, fromDb } from '../db/time.js';
import type { BiometricTemplate } from '../generated/prisma/client.js';

export type { BiometricTemplate };

/** Biometric types as devices number them. */
export const BIO_TYPE = { fingerprint: 1, face: 2, palm: 8, visibleFace: 9 } as const;

export function bioLabel(type: number) {
  if (type === 1) return 'Fingerprint';
  if (type === 2) return 'Face (infrared)';
  if (type === 9) return 'Face (visible light)';
  if (type === 8) return 'Palm';
  return `Biometric type ${type}`;
}

export interface TemplateInput {
  empCode: string;
  bioType: number;
  bioIndex: number;
  subIndex: number;
  format: 'FINGERTMP' | 'FACE' | 'BIODATA';
  fields: [string, string][];
  tmpKey: string;
  template: string;
  sourceSn: string;
}

export function toApi(t: BiometricTemplate) {
  return {
    id: t.id,
    emp_code: t.empCode,
    bio_type: t.bioType,
    label: bioLabel(t.bioType),
    finger: t.bioType === 1 ? t.bioIndex : null,
    part: t.subIndex,
    format: t.format,
    size: t.template.length,
    source_sn: t.sourceSn,
    created_at: fromDb(t.createdAt),
    updated_at: fromDb(t.updatedAt),
  };
}

export const biometricsRepo = {
  /** Save a template. Returns it when new or changed (so it gets copied to other devices), else null. */
  async upsert(t: TemplateInput): Promise<BiometricTemplate | null> {
    const key = { empCode: t.empCode, bioType: t.bioType, bioIndex: t.bioIndex, subIndex: t.subIndex };
    const existing = await prisma.biometricTemplate.findUnique({ where: { empCode_bioType_bioIndex_subIndex: key } });
    if (existing && existing.template === t.template) return null;
    const now = dbNow();
    const data = { format: t.format, fields: t.fields, tmpKey: t.tmpKey, template: t.template, sourceSn: t.sourceSn, updatedAt: now };
    return existing
      ? prisma.biometricTemplate.update({ where: { id: existing.id }, data })
      : prisma.biometricTemplate.create({ data: { ...key, ...data, createdAt: now } });
  },

  forEmployee: (empCode: string) => prisma.biometricTemplate.findMany({ where: { empCode }, orderBy: [{ bioType: 'asc' }, { bioIndex: 'asc' }, { subIndex: 'asc' }] }),

  removeForEmployee: (empCode: string) => prisma.biometricTemplate.deleteMany({ where: { empCode } }),

  /** Fingerprint and face counts per person (a face stored in several parts counts once). */
  async counts(empCodes: string[]) {
    const out = new Map<string, { fingerprints: number; faces: number }>();
    if (!empCodes.length) return out;
    const rows = await prisma.biometricTemplate.findMany({
      where: { empCode: { in: empCodes } },
      select: { empCode: true, bioType: true, bioIndex: true },
      distinct: ['empCode', 'bioType', 'bioIndex'],
    });
    for (const r of rows) {
      const c = out.get(r.empCode) ?? { fingerprints: 0, faces: 0 };
      if (r.bioType === 1) c.fingerprints++;
      else if (r.bioType === 2 || r.bioType === 9) c.faces++;
      out.set(r.empCode, c);
    }
    return out;
  },
};

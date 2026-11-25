import type { NextFunction, Request, Response } from 'express';
import { BioTimeError } from '../biotime/client.js';
import { describeDbError, isDbUnavailable, Prisma } from '../db/prisma.js';
import { HttpError } from '../utils/http.js';

export function notFound(req: Request, res: Response) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, fields: err.fieldErrors });
  }

  if (err instanceof BioTimeError) {
    // Validation errors and "not found" from BioTime are the caller's problem: pass them through.
    if (err.status === 400 || err.status === 404) {
      return res.status(err.status).json({ error: err.message, fields: err.fieldErrors, source: 'biotime' });
    }
    console.error(`[biotime] ${err.status} ${err.message}`);
    return res.status(err.status === 503 ? 503 : 502).json({ error: err.message, source: 'biotime' });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'A record with this value already exists' });
    if (err.code === 'P2025') return res.status(404).json({ error: 'Record not found' });
  }

  if (isDbUnavailable(err)) {
    console.error(`[db] ${describeDbError(err)}`);
    return res.status(503).json({ error: `Database unavailable: ${describeDbError(err)}`, source: 'database' });
  }

  if ((err as { type?: string })?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON' });
  }

  console.error('[server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
}

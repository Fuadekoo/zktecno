import type { NextFunction, Request, Response } from 'express';
import type { z } from 'zod';
import { HttpError, type FieldErrors } from '../utils/http.js';

/** Errors not tied to one field (e.g. "nothing to update") are reported under this key. */
const FORM_KEY = 'form';

export function zodFieldErrors(error: z.ZodError): FieldErrors {
  const fields: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || FORM_KEY;
    fields[key] ??= issue.message;
  }
  return fields;
}

/** Friendlier wording than the zod default for the most common mistake: a missing field. */
const friendlyErrors = (issue: { code: string; input?: unknown }) =>
  issue.code === 'invalid_type' && issue.input === undefined ? 'This field is required' : undefined;

/** Validates and replaces req.body with the parsed (typed, trimmed, defaulted) value. */
export function validateBody(schema: z.ZodType) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body ?? {}, { error: friendlyErrors });
    if (!result.success) {
      const fields = zodFieldErrors(result.error);
      const first = Object.entries(fields)[0];
      const message = !first ? 'Invalid request' : first[0] === FORM_KEY ? first[1] : `${first[0]}: ${first[1]}`;
      return next(new HttpError(400, message, fields));
    }
    req.body = result.data;
    next();
  };
}

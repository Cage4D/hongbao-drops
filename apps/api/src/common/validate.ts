import type { z } from 'zod';
import { AppError } from './app-error.js';

/** Parse a request body with a shared Zod schema; failures become INVALID_REQUEST with issues. */
export function validate<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const r = schema.safeParse(body);
  if (!r.success) {
    throw new AppError('INVALID_REQUEST', {
      issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return r.data;
}

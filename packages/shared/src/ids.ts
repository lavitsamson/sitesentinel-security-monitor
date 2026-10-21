import { z } from 'zod';

/** A MongoDB ObjectId as 24 hex characters, the format of every resource id. */
export const objectIdSchema = z
  .string()
  .regex(/^[0-9a-f]{24}$/i, 'Must be a 24-character hex id')
  .transform((id) => id.toLowerCase());

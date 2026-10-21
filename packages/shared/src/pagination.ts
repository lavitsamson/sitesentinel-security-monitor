import { z } from 'zod';

export const MAX_PAGE_LIMIT = 100;
export const DEFAULT_PAGE_LIMIT = 20;

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  /** Opaque value from a previous page's `pageInfo.nextCursor`. */
  cursor: z.string().max(512).optional(),
});

export const pageInfoSchema = z.object({
  nextCursor: z.string().nullable(),
  hasNextPage: z.boolean(),
});
export type PageInfo = z.infer<typeof pageInfoSchema>;

/** `{ data, pageInfo }`, the envelope every list endpoint returns. */
export function paginatedSchema<T extends z.ZodType>(item: T) {
  return z.object({ data: z.array(item), pageInfo: pageInfoSchema });
}

export interface Paginated<T> {
  data: T[];
  pageInfo: PageInfo;
}

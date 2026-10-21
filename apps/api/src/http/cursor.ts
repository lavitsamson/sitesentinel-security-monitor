import { Types } from 'mongoose';
import { HttpError } from './errors.js';

/** Values a keyset can sort on. Mongo orders null before everything else. */
export type SortValue = string | number | Date | null;

export interface CursorPosition {
  /** The sort the cursor was produced for; reusing it with another sort is an error. */
  sort: string;
  value: SortValue;
  id: Types.ObjectId;
}

type EncodedValue = ['s', string] | ['n', number] | ['d', string] | ['z', null];

function encodeValue(value: SortValue): EncodedValue {
  if (value === null) return ['z', null];
  if (value instanceof Date) return ['d', value.toISOString()];
  return typeof value === 'number' ? ['n', value] : ['s', value];
}

function decodeValue([kind, raw]: [unknown, unknown]): SortValue {
  if (kind === 'z' && raw === null) return null;
  if (kind === 's' && typeof raw === 'string') return raw;
  if (kind === 'n' && typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (kind === 'd' && typeof raw === 'string' && !Number.isNaN(Date.parse(raw))) {
    return new Date(raw);
  }
  throw new Error('bad value');
}

/** Opaque, URL-safe cursor. It is not signed: it only ever narrows an owner-scoped query. */
export function encodeCursor({ sort, value, id }: CursorPosition): string {
  return Buffer.from(JSON.stringify([sort, ...encodeValue(value), id.toString()])).toString(
    'base64url',
  );
}

export function decodeCursor(cursor: string, expectedSort: string): CursorPosition {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 4) throw new Error('bad shape');
    const [sort, kind, raw, id] = parsed as unknown[];
    if (sort !== expectedSort) throw new Error('sort mismatch');
    if (typeof id !== 'string' || !/^[0-9a-f]{24}$/.test(id)) throw new Error('bad id');
    return { sort, value: decodeValue([kind, raw]), id: new Types.ObjectId(id) };
  } catch {
    throw new HttpError(
      400,
      'Bad Request',
      'Invalid cursor; it must come from a previous page with the same sort',
    );
  }
}

/**
 * The Mongo filter for "rows after this cursor" in `{ [field]: direction, _id: direction }`
 * order. Nulls sort first ascending and last descending, so they get their own branches.
 */
export function keysetFilter(
  field: string,
  direction: 1 | -1,
  { value, id }: Pick<CursorPosition, 'value' | 'id'>,
): Record<string, unknown> {
  if (direction === 1) {
    return value === null
      ? { $or: [{ [field]: null, _id: { $gt: id } }, { [field]: { $ne: null } }] }
      : { $or: [{ [field]: value, _id: { $gt: id } }, { [field]: { $gt: value } }] };
  }
  return value === null
    ? { [field]: null, _id: { $lt: id } }
    : {
        $or: [{ [field]: value, _id: { $lt: id } }, { [field]: { $lt: value } }, { [field]: null }],
      };
}

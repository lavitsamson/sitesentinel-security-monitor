import { Types } from 'mongoose';
import { decodeCursor, encodeCursor, keysetFilter } from './cursor.js';
import { HttpError } from './errors.js';

const id = new Types.ObjectId('64b7f0c2a1b2c3d4e5f60718');

describe('cursor encoding', () => {
  it.each([
    ['a string', 'Example'],
    ['a number', 87],
    ['zero', 0],
    ['a date', new Date('2026-10-01T12:00:00.000Z')],
    ['null', null],
  ])('round-trips %s', (_label, value) => {
    const cursor = encodeCursor({ sort: 'name', value, id });

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor, 'name')).toEqual({ sort: 'name', value, id });
  });

  it('rejects a cursor produced for another sort', () => {
    const cursor = encodeCursor({ sort: 'name', value: 'x', id });

    expect(() => decodeCursor(cursor, '-score')).toThrow(HttpError);
  });

  it.each([
    ['garbage', 'not-base64-json'],
    ['wrong shape', Buffer.from('{"a":1}').toString('base64url')],
    ['bad id', Buffer.from('["name","s","x","nope"]').toString('base64url')],
    ['bad kind', Buffer.from(`["name","q","x","${id.toString()}"]`).toString('base64url')],
    ['bad date', Buffer.from(`["name","d","yesterday","${id.toString()}"]`).toString('base64url')],
    [
      'operator injection',
      Buffer.from(`["name","s",{"$gt":""},"${id.toString()}"]`).toString('base64url'),
    ],
  ])('rejects %s with a 400', (_label, cursor) => {
    expect(() => decodeCursor(cursor, 'name')).toThrow(
      expect.objectContaining({ status: 400 }) as unknown as Error,
    );
  });
});

describe('keysetFilter', () => {
  it('ascending after a value: same value with a later id, or a greater value', () => {
    expect(keysetFilter('f', 1, { value: 5, id })).toEqual({
      $or: [{ f: 5, _id: { $gt: id } }, { f: { $gt: 5 } }],
    });
  });

  it('ascending after a null: later nulls, then every non-null', () => {
    expect(keysetFilter('f', 1, { value: null, id })).toEqual({
      $or: [{ f: null, _id: { $gt: id } }, { f: { $ne: null } }],
    });
  });

  it('descending after a value: smaller values, then the nulls at the end', () => {
    expect(keysetFilter('f', -1, { value: 5, id })).toEqual({
      $or: [{ f: 5, _id: { $lt: id } }, { f: { $lt: 5 } }, { f: null }],
    });
  });

  it('descending after a null: only later nulls remain', () => {
    expect(keysetFilter('f', -1, { value: null, id })).toEqual({ f: null, _id: { $lt: id } });
  });
});

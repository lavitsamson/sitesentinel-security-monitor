import {
  MANUAL_CHECK_WINDOW_MS,
  MAX_BULK_SITES,
  bulkSitesSchema,
  checkJobId,
  checkJobSchema,
  listIncidentsQuerySchema,
  listRunsQuerySchema,
  manualCheckSlot,
  objectIdSchema,
  scoreHistoryQuerySchema,
} from './index.js';

const ID = '6712f0c2a1b2c3d4e5f60718';

describe('objectIdSchema', () => {
  it('accepts 24 hex characters and lowercases them', () => {
    expect(objectIdSchema.parse(ID.toUpperCase())).toBe(ID);
  });

  it.each(['', '6712f0c2', `${ID}0`, 'zz12f0c2a1b2c3d4e5f60718'])('rejects %j', (id) => {
    expect(objectIdSchema.safeParse(id).success).toBe(false);
  });
});

describe('check job ids', () => {
  it('are built from site, type and slot', () => {
    expect(checkJobId(ID, 'TLS', '1700000000000')).toBe(`${ID}.TLS.1700000000000`);
  });

  it('give every manual check in the same 5-minute window the same slot', () => {
    const start = new Date(
      Math.ceil(Date.UTC(2026, 9, 21) / MANUAL_CHECK_WINDOW_MS) * MANUAL_CHECK_WINDOW_MS,
    );
    const later = new Date(start.getTime() + MANUAL_CHECK_WINDOW_MS - 1);
    const next = new Date(start.getTime() + MANUAL_CHECK_WINDOW_MS);

    expect(manualCheckSlot(later)).toBe(manualCheckSlot(start));
    expect(manualCheckSlot(next)).not.toBe(manualCheckSlot(start));
    expect(manualCheckSlot(start)).toMatch(/^manual-\d+$/);
  });

  it('validates job data', () => {
    expect(checkJobSchema.safeParse({ siteId: ID, type: 'TLS', trigger: 'MANUAL' }).success).toBe(
      true,
    );
    expect(
      checkJobSchema.safeParse({ siteId: ID, type: 'PORTSCAN', trigger: 'MANUAL' }).success,
    ).toBe(false);
  });
});

describe('bulkSitesSchema', () => {
  it('dedupes ids', () => {
    expect(bulkSitesSchema.parse({ action: 'PAUSE', siteIds: [ID, ID] })).toEqual({
      action: 'PAUSE',
      siteIds: [ID],
    });
  });

  it('requires a valid tag for ADD_TAG', () => {
    expect(bulkSitesSchema.parse({ action: 'ADD_TAG', siteIds: [ID], tag: ' Prod ' })).toEqual({
      action: 'ADD_TAG',
      siteIds: [ID],
      tag: 'prod',
    });
    expect(bulkSitesSchema.safeParse({ action: 'ADD_TAG', siteIds: [ID] }).success).toBe(false);
  });

  it.each([
    ['no ids', { action: 'PAUSE', siteIds: [] }],
    ['too many ids', { action: 'PAUSE', siteIds: Array(MAX_BULK_SITES + 1).fill(ID) }],
    ['a malformed id', { action: 'DELETE', siteIds: ['nope'] }],
    ['an unknown action', { action: 'SCAN_PORTS', siteIds: [ID] }],
  ])('rejects %s', (_label, body) => {
    expect(bulkSitesSchema.safeParse(body).success).toBe(false);
  });
});

describe('list query schemas', () => {
  it('rejects a run window that ends before it starts', () => {
    const query = { from: '2026-10-21T00:00:00.000Z', to: '2026-10-20T00:00:00.000Z' };
    expect(listRunsQuerySchema.safeParse(query).success).toBe(false);
  });

  it('defaults score history to 30 days and caps it at the retention period', () => {
    expect(scoreHistoryQuerySchema.parse({})).toEqual({ days: 30 });
    expect(scoreHistoryQuerySchema.safeParse({ days: '91' }).success).toBe(false);
  });

  it('parses the open flag of incident queries', () => {
    expect(listIncidentsQuerySchema.parse({ open: 'true' }).open).toBe(true);
    expect(listIncidentsQuerySchema.parse({ open: 'false' }).open).toBe(false);
    expect(listIncidentsQuerySchema.safeParse({ open: 'yes' }).success).toBe(false);
  });
});

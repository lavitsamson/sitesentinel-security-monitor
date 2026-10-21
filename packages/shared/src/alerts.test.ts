import {
  alertJobEntry,
  alertJobSchema,
  changePasswordSchema,
  createAlertChannelSchema,
  incidentAlertJobId,
  updateAlertChannelSchema,
  updateProfileSchema,
  webhookUrlSchema,
} from './index.js';

const ID = '6712f0c2a1b2c3d4e5f60718';

describe('webhookUrlSchema', () => {
  it.each(['https://hooks.slack.com/services/T0/B0/x', 'https://example.com:443/hook?a=1'])(
    'accepts %s',
    (url) => {
      expect(webhookUrlSchema.safeParse(url).success).toBe(true);
    },
  );

  it.each([
    'http://example.com/hook',
    'https://example.com:8443/hook',
    'https://user:pass@example.com/hook',
    'ftp://example.com/',
    'not a url',
    `https://example.com/${'x'.repeat(2_000)}`,
  ])('rejects %s', (url) => {
    expect(webhookUrlSchema.safeParse(url).success).toBe(false);
  });
});

describe('createAlertChannelSchema', () => {
  it('validates the target by channel type', () => {
    expect(
      createAlertChannelSchema.parse({ type: 'EMAIL', name: ' Ops ', target: ' Ops@Example.com' }),
    ).toEqual({ type: 'EMAIL', name: 'Ops', target: 'ops@example.com' });
    expect(
      createAlertChannelSchema.safeParse({ type: 'EMAIL', name: 'x', target: 'https://a.b/' })
        .success,
    ).toBe(false);
    expect(
      createAlertChannelSchema.safeParse({ type: 'WEBHOOK', name: 'x', target: 'a@b.com' }).success,
    ).toBe(false);
    expect(
      createAlertChannelSchema.safeParse({ type: 'SMS', name: 'x', target: '1' }).success,
    ).toBe(false);
  });
});

describe('update schemas', () => {
  it('reject empty patches and unknown fields', () => {
    expect(updateAlertChannelSchema.safeParse({}).success).toBe(false);
    expect(updateAlertChannelSchema.safeParse({ type: 'EMAIL' }).success).toBe(false);
    expect(updateAlertChannelSchema.parse({ active: false })).toEqual({ active: false });
    expect(updateProfileSchema.safeParse({}).success).toBe(false);
    expect(updateProfileSchema.safeParse({ email: 'a@b.com' }).success).toBe(false);
    expect(updateProfileSchema.parse({ notificationPrefs: { emailAlerts: false } })).toEqual({
      notificationPrefs: { emailAlerts: false },
    });
  });

  it('apply the password rules to the new password only', () => {
    expect(
      changePasswordSchema.safeParse({ currentPassword: 'x', newPassword: 'short' }).success,
    ).toBe(false);
    expect(
      changePasswordSchema.safeParse({ currentPassword: 'x', newPassword: 'long enough password' })
        .success,
    ).toBe(true);
  });
});

describe('alert jobs', () => {
  const now = new Date('2026-10-21T09:00:00Z');

  it('give each incident transition one deterministic job id', () => {
    const entry = alertJobEntry({ kind: 'INCIDENT', incidentId: ID, event: 'OPENED' }, now);

    expect(entry.opts.jobId).toBe(incidentAlertJobId(ID, 'OPENED'));
    expect(entry.opts.jobId).toBe(`${ID}.OPENED`);
    expect(entry.opts.attempts).toBe(5);
    expect(incidentAlertJobId(ID, 'RESOLVED')).not.toBe(entry.opts.jobId);
  });

  it('try a test send once, with an id unique to the request', () => {
    const entry = alertJobEntry({ kind: 'TEST', channelId: ID }, now);

    expect(entry.opts).toMatchObject({ attempts: 1, jobId: `test.${ID}.${now.getTime()}` });
  });

  it('validate job data', () => {
    expect(
      alertJobSchema.safeParse({ kind: 'INCIDENT', incidentId: ID, event: 'OPENED' }).success,
    ).toBe(true);
    expect(alertJobSchema.safeParse({ kind: 'INCIDENT', incidentId: ID, event: 'X' }).success).toBe(
      false,
    );
    expect(alertJobSchema.safeParse({ kind: 'TEST', channelId: 'nope' }).success).toBe(false);
  });
});

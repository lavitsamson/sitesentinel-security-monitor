import type { CheckResult, Clock, Finding } from '@sitesentinel/checks';
import { SiteModel, UserModel, connectMongo, disconnectMongo, mongoose } from '@sitesentinel/db';
import {
  checkJobId,
  verificationJobId,
  type CheckEnqueuer,
  type CheckJobRequest,
} from '@sitesentinel/shared';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { pino } from 'pino';
import type { VerificationEnqueuer, VerificationJobRequest } from '../scheduler/scheduler.js';

export const silentLogger = pino({ level: 'silent' });

/** One in-memory mongod per test file, indexes built, collections emptied between tests. */
export function useTestMongo(): void {
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await connectMongo(mongod.getUri());
    await mongoose.connection.syncIndexes();
  });

  afterEach(async () => {
    await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
  });

  afterAll(async () => {
    await disconnectMongo();
    await mongod.stop();
  });
}

/** A clock tests can move forward. */
export function manualClock(start = '2026-10-21T09:00:00.000Z') {
  let current = new Date(start);
  const clock: Clock & { advance(ms: number): void } = {
    now: () => new Date(current),
    advance(ms) {
      current = new Date(current.getTime() + ms);
    },
  };
  return clock;
}

export const MINUTE = 60_000;
export const DAY = 24 * 60 * MINUTE;

let userCounter = 0;

export async function createUser(email = `owner${++userCounter}@example.com`) {
  return UserModel.create({ email, name: 'Owner', passwordHash: 'not-a-real-hash' });
}

type SiteOverrides = Partial<{
  domain: string;
  checkIntervalMinutes: 5 | 15 | 60 | 1440;
  paused: boolean;
  demo: boolean;
  lastCheckedAt: Date | null;
  verifiedAt: Date | null;
  lastAttemptAt: Date | null;
  consecutiveFailures: number;
}>;

let siteCounter = 0;

/** A site, verified by default. */
export async function createSite(ownerId: mongoose.Types.ObjectId, overrides: SiteOverrides = {}) {
  const domain = overrides.domain ?? `site${++siteCounter}.example.com`;
  return SiteModel.create({
    ownerId,
    domain,
    displayName: domain,
    checkIntervalMinutes: overrides.checkIntervalMinutes ?? 60,
    paused: overrides.paused ?? false,
    demo: overrides.demo ?? false,
    lastCheckedAt: overrides.lastCheckedAt ?? null,
    verification: {
      method: 'DNS_TXT',
      token: 'token-123',
      verifiedAt:
        overrides.verifiedAt === undefined
          ? new Date('2026-10-01T00:00:00Z')
          : overrides.verifiedAt,
      lastAttemptAt: overrides.lastAttemptAt ?? null,
      consecutiveFailures: overrides.consecutiveFailures ?? 0,
    },
  });
}

/** Records jobs and, like BullMQ, ignores a job whose id it has already seen. */
export class MemoryEnqueuer implements CheckEnqueuer, VerificationEnqueuer {
  readonly checks = new Map<string, CheckJobRequest>();
  readonly verifications = new Map<string, VerificationJobRequest>();

  async enqueueChecks(jobs: readonly CheckJobRequest[]) {
    for (const job of jobs) {
      const id = checkJobId(job.siteId, job.type, job.slot);
      if (!this.checks.has(id)) this.checks.set(id, job);
    }
  }

  async enqueueVerifications(jobs: readonly VerificationJobRequest[]) {
    for (const job of jobs) {
      const id = verificationJobId(job.siteId, job.slot);
      if (!this.verifications.has(id)) this.verifications.set(id, job);
    }
  }
}

export function finding(severity: Finding['severity'], code = `TEST_${severity.toUpperCase()}`) {
  return { code, severity, message: `${code} message`, recommendation: 'Fix it.' };
}

export const results = {
  pass: (raw: Record<string, unknown> = {}): CheckResult => ({
    status: 'PASS',
    score: 100,
    findings: [],
    raw,
  }),
  warn: (score = 75): CheckResult => ({
    status: 'WARN',
    score,
    findings: [finding('medium')],
    raw: {},
  }),
  fail: (score = 0): CheckResult => ({
    status: 'FAIL',
    score,
    findings: [finding('high')],
    raw: {},
  }),
  error: (): CheckResult => ({
    status: 'ERROR',
    score: 0,
    findings: [finding('info', 'CHECK_ERROR')],
    raw: { error: 'TIMEOUT' },
  }),
  up: (): CheckResult => ({
    status: 'PASS',
    score: 100,
    findings: [],
    raw: { up: true, statusCode: 200, responseTimeMs: 120 },
  }),
  down: (): CheckResult => ({
    status: 'FAIL',
    score: 0,
    findings: [finding('high', 'UPTIME_UNREACHABLE')],
    raw: { up: false, statusCode: null, responseTimeMs: null },
  }),
};

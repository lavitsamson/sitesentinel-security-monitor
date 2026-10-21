import { randomBytes } from 'node:crypto';
import type { Clock, OwnershipClaim, VerificationResult } from '@sitesentinel/checks';
import {
  CheckRunModel,
  IncidentModel,
  SiteModel,
  isDuplicateKeyError,
  recordAudit,
  recordAudits,
  toSiteDto,
  type SiteDocument,
} from '@sitesentinel/db';
import {
  ATTENTION_LIMIT,
  CHECK_TYPES,
  MAX_TAGS,
  SITE_STATUSES,
  manualCheckSlot,
  type BulkSitesResult,
  type BulkSkipReason,
  type CheckEnqueuer,
  type CheckNowResult,
  type Grade,
  type ListSitesQuery,
  type Paginated,
  type Site,
  type SiteSort,
  type SiteStatus,
  type SiteSummary,
  type VerificationMethod,
  type bulkSitesSchema,
  type createSiteSchema,
  type updateSiteSchema,
} from '@sitesentinel/shared';
import { Types } from 'mongoose';
import type { z } from 'zod';
import { decodeCursor, encodeCursor, keysetFilter, type SortValue } from '../http/cursor.js';
import { HttpError } from '../http/errors.js';
import { findOwnedSite, type Actor } from './ownership.js';

export type { Actor };

export type VerifyOwnership = (claim: OwnershipClaim) => Promise<VerificationResult>;

export interface SitesServiceDeps {
  verifyOwnership: VerifyOwnership;
  /** Where check-now jobs go; the worker picks them up. */
  checks: CheckEnqueuer;
  clock: Clock;
}

const SORT_FIELDS = {
  name: 'displayName',
  score: 'currentScore',
  lastCheckedAt: 'lastCheckedAt',
} as const satisfies Record<string, keyof Site>;

function parseSort(sort: SiteSort): { field: string; direction: 1 | -1 } {
  const descending = sort.startsWith('-');
  const key = (descending ? sort.slice(1) : sort) as keyof typeof SORT_FIELDS;
  return { field: SORT_FIELDS[key], direction: descending ? -1 : 1 };
}

/** 128-bit random token, URL- and DNS-safe. */
function newVerificationToken(): string {
  return randomBytes(16).toString('hex');
}

/** Demo sites are real third-party domains, so they're only ever checked daily (CLAUDE.md §7). */
const DEMO_INTERVAL_MINUTES = 1440;

/** Why checks can't run on a site right now, or null if they can. */
function whyNotCheckable(site: SiteDocument): 'DEMO' | 'NOT_VERIFIED' | 'PAUSED' | null {
  if (site.demo) return 'DEMO';
  if (!site.verification.verifiedAt) return 'NOT_VERIFIED';
  if (site.paused) return 'PAUSED';
  return null;
}

const NOT_CHECKABLE_DETAIL = {
  DEMO: 'Demo sites are checked once a day and cannot be checked on demand',
  NOT_VERIFIED: 'Verify ownership of the domain before running checks',
  PAUSED: 'Resume monitoring of the site before running checks',
} as const;

export function createSitesService({ verifyOwnership, checks, clock }: SitesServiceDeps) {
  const audit = (actor: Actor, action: string, site: SiteDocument) =>
    recordAudit({
      ownerId: actor.userId,
      action,
      entityType: 'site',
      entityId: site.id,
      ip: actor.ip,
    });

  /** One manual job per check type; repeats within the check-now window share job ids. */
  const enqueueManualChecks = (sites: readonly SiteDocument[]) => {
    const slot = manualCheckSlot(clock.now());
    return checks.enqueueChecks(
      sites.flatMap((site) =>
        CHECK_TYPES.map((type) => ({ siteId: site.id, type, trigger: 'MANUAL' as const, slot })),
      ),
    );
  };

  /** Runs, incidents, then the sites. Jobs still queued for them are dropped by the worker. */
  const deleteWithHistory = async (siteIds: Types.ObjectId[]) => {
    await Promise.all([
      CheckRunModel.deleteMany({ siteId: { $in: siteIds } }),
      IncidentModel.deleteMany({ siteId: { $in: siteIds } }),
    ]);
    await SiteModel.deleteMany({ _id: { $in: siteIds } });
  };

  return {
    async list(actor: Actor, query: ListSitesQuery): Promise<Paginated<Site>> {
      const { field, direction } = parseSort(query.sort);
      const filter: Record<string, unknown> = { ownerId: new Types.ObjectId(actor.userId) };
      if (query.grade) filter.currentGrade = query.grade;
      if (query.status) filter.status = query.status;
      if (query.tag) filter.tags = query.tag;

      const conditions: Record<string, unknown>[] = [filter];
      if (query.cursor) {
        conditions.push(keysetFilter(field, direction, decodeCursor(query.cursor, query.sort)));
      }

      const rows = await SiteModel.find(conditions.length > 1 ? { $and: conditions } : filter)
        .sort({ [field]: direction, _id: direction })
        .limit(query.limit + 1);

      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      const hasNextPage = rows.length > query.limit;
      const nextCursor =
        hasNextPage && last
          ? encodeCursor({ sort: query.sort, value: last.get(field) as SortValue, id: last._id })
          : null;
      return { data: page.map(toSiteDto), pageInfo: { nextCursor, hasNextPage } };
    },

    /** Dashboard counts in one aggregation, plus the few sites that most need a look. */
    async summary(actor: Actor): Promise<SiteSummary> {
      const ownerId = new Types.ObjectId(actor.userId);
      const countBy = (field: string) => [{ $group: { _id: field, n: { $sum: 1 } } }];
      const [facets, needsAttention] = await Promise.all([
        SiteModel.aggregate<{
          grades: { _id: Grade | null; n: number }[];
          statuses: { _id: SiteStatus; n: number }[];
          totals: { total: number; unverified: number; paused: number }[];
        }>([
          { $match: { ownerId } },
          {
            $facet: {
              grades: countBy('$currentGrade'),
              statuses: countBy('$status'),
              totals: [
                {
                  $group: {
                    _id: null,
                    total: { $sum: 1 },
                    unverified: {
                      $sum: {
                        $cond: [
                          { $eq: [{ $ifNull: ['$verification.verifiedAt', null] }, null] },
                          1,
                          0,
                        ],
                      },
                    },
                    paused: { $sum: { $cond: ['$paused', 1, 0] } },
                  },
                },
              ],
            },
          },
        ]),
        SiteModel.find({
          ownerId,
          $or: [{ status: { $in: ['DOWN', 'DEGRADED'] } }, { currentGrade: { $in: ['D', 'F'] } }],
        })
          .sort({ currentScore: 1, _id: 1 })
          .limit(ATTENTION_LIMIT),
      ]);

      const { grades = [], statuses = [], totals = [] } = facets[0] ?? {};
      const gradeCounts: SiteSummary['grades'] = { A: 0, B: 0, C: 0, D: 0, F: 0, ungraded: 0 };
      for (const { _id, n } of grades) gradeCounts[_id ?? 'ungraded'] += n;
      const statusCounts = Object.fromEntries(SITE_STATUSES.map((s) => [s, 0])) as Record<
        SiteStatus,
        number
      >;
      for (const { _id, n } of statuses) statusCounts[_id] += n;

      return {
        total: totals[0]?.total ?? 0,
        unverified: totals[0]?.unverified ?? 0,
        paused: totals[0]?.paused ?? 0,
        grades: gradeCounts,
        statuses: statusCounts,
        needsAttention: needsAttention.map(toSiteDto),
      };
    },

    async create(actor: Actor, input: z.output<typeof createSiteSchema>): Promise<Site> {
      try {
        const site = await SiteModel.create({
          ownerId: new Types.ObjectId(actor.userId),
          domain: input.domain,
          displayName: input.displayName ?? input.domain,
          checkIntervalMinutes: input.checkIntervalMinutes,
          tags: input.tags,
          verification: { token: newVerificationToken() },
        });
        await audit(actor, 'site.create', site);
        return toSiteDto(site);
      } catch (err) {
        if (isDuplicateKeyError(err)) {
          throw new HttpError(409, 'Conflict', `You are already monitoring ${input.domain}`);
        }
        throw err;
      }
    },

    async get(actor: Actor, siteId: string): Promise<Site> {
      return toSiteDto(await findOwnedSite(actor, siteId));
    },

    async update(
      actor: Actor,
      siteId: string,
      patch: z.output<typeof updateSiteSchema>,
    ): Promise<Site> {
      const site = await findOwnedSite(actor, siteId);
      if (
        site.demo &&
        patch.checkIntervalMinutes !== undefined &&
        patch.checkIntervalMinutes !== DEMO_INTERVAL_MINUTES
      ) {
        throw new HttpError(409, 'Conflict', 'Demo sites are checked once a day');
      }
      site.set(patch);
      await site.save();
      await audit(actor, 'site.update', site);
      return toSiteDto(site);
    },

    async remove(actor: Actor, siteId: string): Promise<void> {
      const site = await findOwnedSite(actor, siteId);
      await deleteWithHistory([site._id]);
      await audit(actor, 'site.delete', site);
    },

    /**
     * Proves ownership via DNS TXT or the well-known file. Until this succeeds,
     * no check is ever run against the domain.
     */
    async verify(actor: Actor, siteId: string, method?: VerificationMethod): Promise<Site> {
      const site = await findOwnedSite(actor, siteId);
      if (site.demo) return toSiteDto(site); // pre-verified demo data

      const result = await verifyOwnership({
        domain: site.domain,
        token: site.verification.token,
        ...(method && { method }),
      });
      const now = clock.now();
      site.verification.lastAttemptAt = now;
      if (result.verified) {
        site.verification.verifiedAt = now;
        site.verification.method = result.method;
        site.verification.consecutiveFailures = 0;
      }
      await site.save();
      await audit(actor, result.verified ? 'site.verify' : 'site.verify.failed', site);

      if (!result.verified) {
        throw new HttpError(
          422,
          'Unprocessable Content',
          `Could not verify ownership of ${site.domain}`,
          undefined,
          { attempts: result.attempts },
        );
      }
      return toSiteDto(site);
    },

    /** Queues every check for one site now (rate-limited per site by the route). */
    async checkNow(actor: Actor, siteId: string): Promise<CheckNowResult> {
      const site = await findOwnedSite(actor, siteId);
      const reason = whyNotCheckable(site);
      if (reason) throw new HttpError(409, 'Conflict', NOT_CHECKABLE_DETAIL[reason]);
      await enqueueManualChecks([site]);
      return { queued: [...CHECK_TYPES] };
    },

    /**
     * Applies one action to up to 100 of the actor's sites. Sites the actor
     * doesn't own are reported as NOT_FOUND, exactly like ids that don't exist.
     */
    async bulk(actor: Actor, input: z.output<typeof bulkSitesSchema>): Promise<BulkSitesResult> {
      const ownerId = new Types.ObjectId(actor.userId);
      const owned = await SiteModel.find({
        _id: { $in: input.siteIds.map((id) => new Types.ObjectId(id)) },
        ownerId,
      });
      const byId = new Map(owned.map((site) => [site.id, site]));
      const skipped: BulkSitesResult['skipped'] = input.siteIds
        .filter((id) => !byId.has(id))
        .map((id) => ({ id, reason: 'NOT_FOUND' }));
      const reasonToSkip = (site: SiteDocument): BulkSkipReason | null => {
        if (input.action === 'CHECK_NOW') return whyNotCheckable(site);
        // A site with the tag already is a no-op; one at the tag limit can't take another.
        if (input.action === 'ADD_TAG' && site.tags.length >= MAX_TAGS) {
          return site.tags.includes(input.tag) ? null : 'TAG_LIMIT';
        }
        return null;
      };

      const targets: SiteDocument[] = [];
      for (const site of owned) {
        const reason = reasonToSkip(site);
        if (reason) skipped.push({ id: site.id, reason });
        else targets.push(site);
      }
      const ids = targets.map((site) => site._id);

      switch (input.action) {
        case 'CHECK_NOW':
          await enqueueManualChecks(targets);
          break;
        case 'PAUSE':
        case 'RESUME':
          await SiteModel.updateMany(
            { _id: { $in: ids }, ownerId },
            { $set: { paused: input.action === 'PAUSE' } },
          );
          break;
        case 'ADD_TAG':
          await SiteModel.updateMany(
            { _id: { $in: ids }, ownerId },
            { $addToSet: { tags: input.tag } },
          );
          break;
        case 'DELETE':
          await deleteWithHistory(ids);
          break;
      }

      await recordAudits(
        targets.map((site) => ({
          ownerId: actor.userId,
          action: `site.bulk.${input.action.toLowerCase()}`,
          entityType: 'site',
          entityId: site.id,
          ip: actor.ip,
        })),
      );
      return { action: input.action, succeeded: targets.map((s) => s.id), skipped };
    },
  };
}

export type SitesService = ReturnType<typeof createSitesService>;

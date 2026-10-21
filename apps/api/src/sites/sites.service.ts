import { randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import type { Clock, OwnershipClaim, VerificationResult } from '@sitesentinel/checks';
import type {
  ListSitesQuery,
  Paginated,
  Site,
  SiteSort,
  VerificationMethod,
  createSiteSchema,
  updateSiteSchema,
} from '@sitesentinel/shared';
import type { z } from 'zod';
import { decodeCursor, encodeCursor, keysetFilter, type SortValue } from '../http/cursor.js';
import { HttpError } from '../http/errors.js';
import { isDuplicateKeyError } from '../infra/mongo.js';
import { recordAudit } from '../models/audit-log.model.js';
import { SiteModel, toSiteDto, type SiteDocument } from '../models/site.model.js';

export type VerifyOwnership = (claim: OwnershipClaim) => Promise<VerificationResult>;

export interface SitesServiceDeps {
  verifyOwnership: VerifyOwnership;
  clock: Clock;
}

/** Who is acting, for ownership scoping and the audit log. */
export interface Actor {
  userId: string;
  ip?: string | undefined;
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

const notFound = () => new HttpError(404, 'Not Found', 'Site not found');

/** 128-bit random token, URL- and DNS-safe. */
function newVerificationToken(): string {
  return randomBytes(16).toString('hex');
}

export function createSitesService({ verifyOwnership, clock }: SitesServiceDeps) {
  /**
   * The single ownership gate: every read and write by id goes through here.
   * Another user's site and a malformed id both look exactly like a missing one (404).
   */
  async function findOwned(actor: Actor, siteId: string): Promise<SiteDocument> {
    if (!/^[0-9a-f]{24}$/i.test(siteId)) throw notFound();
    const site = await SiteModel.findOne({
      _id: new Types.ObjectId(siteId),
      ownerId: new Types.ObjectId(actor.userId),
    });
    if (!site) throw notFound();
    return site;
  }

  const audit = (actor: Actor, action: string, site: SiteDocument) =>
    recordAudit({
      ownerId: actor.userId,
      action,
      entityType: 'site',
      entityId: site.id,
      ip: actor.ip,
    });

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
      return toSiteDto(await findOwned(actor, siteId));
    },

    async update(
      actor: Actor,
      siteId: string,
      patch: z.output<typeof updateSiteSchema>,
    ): Promise<Site> {
      const site = await findOwned(actor, siteId);
      site.set(patch);
      await site.save();
      await audit(actor, 'site.update', site);
      return toSiteDto(site);
    },

    async remove(actor: Actor, siteId: string): Promise<void> {
      const site = await findOwned(actor, siteId);
      await site.deleteOne();
      // Runs, incidents and queued jobs for the site are cleaned up from milestone 4.
      await audit(actor, 'site.delete', site);
    },

    /**
     * Proves ownership via DNS TXT or the well-known file. Until this succeeds,
     * no check is ever run against the domain.
     */
    async verify(actor: Actor, siteId: string, method?: VerificationMethod): Promise<Site> {
      const site = await findOwned(actor, siteId);
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
  };
}

export type SitesService = ReturnType<typeof createSitesService>;

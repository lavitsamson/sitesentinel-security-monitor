import { IncidentModel, SiteModel, toIncidentDto, type IncidentDocument } from '@sitesentinel/db';
import type { Incident, ListIncidentsQuery, Paginated } from '@sitesentinel/shared';
import { Types } from 'mongoose';
import { decodeCursor, encodeCursor, keysetFilter } from '../http/cursor.js';
import { isObjectId, notFound, type Actor } from '../sites/ownership.js';

/** Cursor tag for incident pages (newest first). */
const INCIDENTS_SORT = '-openedAt';

/** Stands in for a site deleted between the two queries (incidents are deleted with it). */
const DELETED_SITE = { domain: '', displayName: 'Deleted site' };

/** Labels incidents with their site's name and domain, in one query for the whole page. */
async function withSites(incidents: IncidentDocument[]): Promise<Incident[]> {
  const siteIds = [...new Set(incidents.map((i) => i.siteId.toString()))];
  const sites = await SiteModel.find(
    { _id: { $in: siteIds.map((id) => new Types.ObjectId(id)) } },
    { domain: 1, displayName: 1 },
  ).lean();
  const byId = new Map(sites.map((s) => [s._id.toString(), s]));
  return incidents.map((i) => toIncidentDto(i, byId.get(i.siteId.toString()) ?? DELETED_SITE));
}

export function createIncidentsService() {
  return {
    async list(actor: Actor, query: ListIncidentsQuery): Promise<Paginated<Incident>> {
      // Owner-scoped: a siteId filter for someone else's site simply matches nothing.
      const filter: Record<string, unknown> = { ownerId: new Types.ObjectId(actor.userId) };
      if (query.open !== undefined) filter.resolvedAt = query.open ? null : { $ne: null };
      if (query.siteId) filter.siteId = new Types.ObjectId(query.siteId);

      const conditions: Record<string, unknown>[] = [filter];
      if (query.cursor) {
        conditions.push(keysetFilter('openedAt', -1, decodeCursor(query.cursor, INCIDENTS_SORT)));
      }
      const rows = await IncidentModel.find(conditions.length > 1 ? { $and: conditions } : filter)
        .sort({ openedAt: -1, _id: -1 })
        .limit(query.limit + 1);

      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      const hasNextPage = rows.length > query.limit;
      const nextCursor =
        hasNextPage && last
          ? encodeCursor({ sort: INCIDENTS_SORT, value: last.openedAt, id: last._id })
          : null;
      return { data: await withSites(page), pageInfo: { nextCursor, hasNextPage } };
    },

    async get(actor: Actor, incidentId: string): Promise<Incident> {
      if (!isObjectId(incidentId)) throw notFound('Incident');
      const incident = await IncidentModel.findOne({
        _id: new Types.ObjectId(incidentId),
        ownerId: new Types.ObjectId(actor.userId),
      });
      if (!incident) throw notFound('Incident');
      const site = await SiteModel.findById(incident.siteId, { domain: 1, displayName: 1 }).lean();
      return toIncidentDto(incident, site ?? DELETED_SITE);
    },
  };
}

export type IncidentsService = ReturnType<typeof createIncidentsService>;

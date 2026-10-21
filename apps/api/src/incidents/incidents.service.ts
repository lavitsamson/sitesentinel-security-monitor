import { IncidentModel, toIncidentDto } from '@sitesentinel/db';
import type { Incident, ListIncidentsQuery, Paginated } from '@sitesentinel/shared';
import { Types } from 'mongoose';
import { decodeCursor, encodeCursor, keysetFilter } from '../http/cursor.js';
import { isObjectId, notFound, type Actor } from '../sites/ownership.js';

/** Cursor tag for incident pages (newest first). */
const INCIDENTS_SORT = '-openedAt';

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
      return { data: page.map(toIncidentDto), pageInfo: { nextCursor, hasNextPage } };
    },

    async get(actor: Actor, incidentId: string): Promise<Incident> {
      if (!isObjectId(incidentId)) throw notFound('Incident');
      const incident = await IncidentModel.findOne({
        _id: new Types.ObjectId(incidentId),
        ownerId: new Types.ObjectId(actor.userId),
      });
      if (!incident) throw notFound('Incident');
      return toIncidentDto(incident);
    },
  };
}

export type IncidentsService = ReturnType<typeof createIncidentsService>;

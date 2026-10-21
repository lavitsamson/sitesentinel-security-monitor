import type { Clock } from '@sitesentinel/checks';
import { CheckRunModel, toCheckRunDto, type CheckRunDocument } from '@sitesentinel/db';
import {
  CHECK_TYPES,
  gradeFor,
  overallScore,
  type CheckRun,
  type CheckStatus,
  type CheckType,
  type ListRunsQuery,
  type Paginated,
  type ScoreHistoryPoint,
} from '@sitesentinel/shared';
import type { PipelineStage } from 'mongoose';
import { decodeCursor, encodeCursor, keysetFilter } from '../http/cursor.js';
import { findOwnedSite, type Actor } from '../sites/ownership.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Cursor tag for run pages (newest first). */
const RUNS_SORT = '-startedAt';

const startOfUtcDay = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

interface LatestScore {
  _id: CheckType;
  status: CheckStatus;
  score: number;
}

/** Newest non-ERROR status/score per check type among runs matching `match`. */
const latestPerType = (match: PipelineStage.Match['$match']): PipelineStage[] => [
  { $match: { ...match, status: { $ne: 'ERROR' } } },
  { $sort: { type: 1, startedAt: -1 } },
  { $group: { _id: '$type', status: { $first: '$status' }, score: { $first: '$score' } } },
];

/** Read side of check runs: history, latest per check, and the score trend. */
export function createResultsService({ clock }: { clock: Clock }) {
  return {
    async listRuns(
      actor: Actor,
      siteId: string,
      query: ListRunsQuery,
    ): Promise<Paginated<CheckRun>> {
      const site = await findOwnedSite(actor, siteId);
      const filter: Record<string, unknown> = { siteId: site._id };
      if (query.type) filter.type = query.type;
      if (query.from || query.to) {
        filter.startedAt = {
          ...(query.from && { $gte: new Date(query.from) }),
          ...(query.to && { $lte: new Date(query.to) }),
        };
      }
      const conditions: Record<string, unknown>[] = [filter];
      if (query.cursor) {
        conditions.push(keysetFilter('startedAt', -1, decodeCursor(query.cursor, RUNS_SORT)));
      }

      const rows = await CheckRunModel.find(conditions.length > 1 ? { $and: conditions } : filter)
        .sort({ startedAt: -1, _id: -1 })
        .limit(query.limit + 1);

      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      const hasNextPage = rows.length > query.limit;
      const nextCursor =
        hasNextPage && last
          ? encodeCursor({ sort: RUNS_SORT, value: last.startedAt, id: last._id })
          : null;
      return { data: page.map(toCheckRunDto), pageInfo: { nextCursor, hasNextPage } };
    },

    /** The newest run of each check type (ERROR runs included: they explain a stale result). */
    async latestRuns(actor: Actor, siteId: string): Promise<{ data: CheckRun[] }> {
      const site = await findOwnedSite(actor, siteId);
      const latest = await CheckRunModel.aggregate<{ run: CheckRunDocument }>([
        { $match: { siteId: site._id } },
        { $sort: { type: 1, startedAt: -1 } },
        { $group: { _id: '$type', run: { $first: '$$ROOT' } } },
      ]);
      const byType = new Map(latest.map(({ run }) => [run.type, CheckRunModel.hydrate(run)]));
      const data = CHECK_TYPES.flatMap((type) => {
        const run = byType.get(type);
        return run ? [toCheckRunDto(run)] : [];
      });
      return { data };
    },

    /**
     * One point per UTC day: the overall score from the latest result of each
     * check as of the end of that day. Results from before the window carry
     * forward, so a daily-checked site has a value on its first day.
     */
    async scoreHistory(
      actor: Actor,
      siteId: string,
      days: number,
    ): Promise<{ data: ScoreHistoryPoint[] }> {
      const site = await findOwnedSite(actor, siteId);
      const start = new Date(startOfUtcDay(clock.now()).getTime() - (days - 1) * DAY_MS);

      const [baseline, daily] = await Promise.all([
        CheckRunModel.aggregate<LatestScore>(
          latestPerType({ siteId: site._id, startedAt: { $lt: start } }),
        ),
        CheckRunModel.aggregate<{
          _id: { day: string; type: CheckType };
          status: CheckStatus;
          score: number;
        }>([
          { $match: { siteId: site._id, startedAt: { $gte: start }, status: { $ne: 'ERROR' } } },
          { $sort: { startedAt: 1 } },
          {
            $group: {
              _id: {
                day: { $dateToString: { format: '%Y-%m-%d', date: '$startedAt' } },
                type: '$type',
              },
              status: { $last: '$status' },
              score: { $last: '$score' },
            },
          },
        ]),
      ]);

      const current = new Map(baseline.map((r) => [r._id, r]));
      const byDay = new Map<string, LatestScore[]>();
      for (const { _id, status, score } of daily) {
        byDay.set(_id.day, [...(byDay.get(_id.day) ?? []), { _id: _id.type, status, score }]);
      }
      const data: ScoreHistoryPoint[] = [];
      for (let i = 0; i < days; i++) {
        const date = new Date(start.getTime() + i * DAY_MS).toISOString().slice(0, 10);
        for (const latest of byDay.get(date) ?? []) current.set(latest._id, latest);
        const score = overallScore(
          [...current.values()].map(({ _id, status, score }) => ({ type: _id, status, score })),
        );
        data.push({ date, score, grade: score === null ? null : gradeFor(score) });
      }
      return { data };
    },
  };
}

export type ResultsService = ReturnType<typeof createResultsService>;

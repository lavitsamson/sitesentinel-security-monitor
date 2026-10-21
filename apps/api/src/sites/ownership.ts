import { SiteModel, type SiteDocument } from '@sitesentinel/db';
import { Types } from 'mongoose';
import { HttpError } from '../http/errors.js';

/** Who is acting, for ownership scoping and the audit log. */
export interface Actor {
  userId: string;
  ip?: string | undefined;
}

export const notFound = (what = 'Site') => new HttpError(404, 'Not Found', `${what} not found`);

export const isObjectId = (id: string) => /^[0-9a-f]{24}$/i.test(id);

/**
 * The single ownership gate: every read and write of a site by id (and of its
 * runs) goes through here. Another user's site and a malformed id both look
 * exactly like a missing one (404).
 */
export async function findOwnedSite(actor: Actor, siteId: string): Promise<SiteDocument> {
  if (!isObjectId(siteId)) throw notFound();
  const site = await SiteModel.findOne({
    _id: new Types.ObjectId(siteId),
    ownerId: new Types.ObjectId(actor.userId),
  });
  if (!site) throw notFound();
  return site;
}

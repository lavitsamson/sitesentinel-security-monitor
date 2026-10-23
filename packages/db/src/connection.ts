import mongoose from 'mongoose';

/**
 * Both apps connect through here, so the models in this package and the
 * connection always share one mongoose instance.
 */
export async function connectMongo(url: string): Promise<typeof mongoose> {
  return mongoose.connect(url, { serverSelectionTimeoutMS: 5_000 });
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}

/** Readiness probe: rejects unless connected and the server answers a ping. */
export async function pingMongo(): Promise<void> {
  const db = mongoose.connection.db;
  if (mongoose.connection.readyState !== mongoose.ConnectionStates.connected || !db) {
    throw new Error('not connected');
  }
  await db.admin().ping();
}

/** True for a unique-index violation (E11000), e.g. a racing duplicate insert. */
export function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 11000;
}

export { mongoose };

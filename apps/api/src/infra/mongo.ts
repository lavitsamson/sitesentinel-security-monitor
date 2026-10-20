import mongoose from 'mongoose';
import type { DependencyProbe } from '../health/readiness.js';

export async function connectMongo(url: string): Promise<typeof mongoose> {
  return mongoose.connect(url, { serverSelectionTimeoutMS: 5_000 });
}

export const pingMongo: DependencyProbe = async () => {
  const db = mongoose.connection.db;
  if (mongoose.connection.readyState !== mongoose.ConnectionStates.connected || !db) {
    throw new Error('not connected');
  }
  await db.admin().ping();
};

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}

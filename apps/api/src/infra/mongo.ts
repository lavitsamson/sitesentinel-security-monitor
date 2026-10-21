import { mongoose } from '@sitesentinel/db';
import type { DependencyProbe } from '../health/readiness.js';

export const pingMongo: DependencyProbe = async () => {
  const db = mongoose.connection.db;
  if (mongoose.connection.readyState !== mongoose.ConnectionStates.connected || !db) {
    throw new Error('not connected');
  }
  await db.admin().ping();
};

import mongoose from 'mongoose';

import { databaseModels } from '../models';

const connectionStates: Record<number, string> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
  99: 'uninitialized'
};

export function getDatabaseStatus() {
  const readyState = mongoose.connection.readyState;

  return {
    state: connectionStates[readyState] ?? 'unknown',
    host: mongoose.connection.host || null,
    name: mongoose.connection.name || null
  };
}

export async function connectDatabase() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error('MONGODB_URI is not configured');
  }

  mongoose.set('strictQuery', true);

  const connection = await mongoose.connect(uri, {
    dbName: process.env.MONGODB_DB_NAME ?? 'freshfriends',
    autoIndex: process.env.NODE_ENV !== 'production'
  });

  await Promise.all(databaseModels.map((model) => model.createIndexes()));

  console.log(
    `MongoDB Atlas connected: ${connection.connection.host}/${connection.connection.name}`
  );

  return connection;
}

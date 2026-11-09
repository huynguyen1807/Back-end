import 'dotenv/config';
import mongoose from 'mongoose';
import app from '../app';

// Reuse the real HTTP application. This explicit demo entry point avoids the
// normal startup's global index deployment and background notification writes.
async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw Error('Database configuration is missing');
  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB_NAME ?? 'freshfriends', autoIndex: false, autoCreate: false });
  const port = Number(process.env.PORT ?? 4000);
  const server = app.listen(port, '0.0.0.0', () => console.log(`Family web demo API ready on port ${port}`));
  server.on('error', () => { console.error('Demo API could not listen on the configured port'); void mongoose.disconnect(); process.exitCode = 1; });
  const stop = () => { server.close(() => { void mongoose.disconnect().then(() => process.exit(0)); }); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}

run().catch(() => { console.error('Unable to start demo API; connection details suppressed'); process.exitCode = 1; });

require('dotenv').config();
const { MongoClient, ServerApiVersion } = require('mongodb');

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME || 'freshfriends';

if (!uri) {
  throw new Error('MONGODB_URI is not configured');
}

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true
  }
});

async function run() {
  try {
    await client.connect();
    await client.db(dbName).command({ ping: 1 });
    console.log(`Pinged MongoDB Atlas database: ${dbName}`);
  } finally {
    await client.close();
  }
}

run().catch(console.error);

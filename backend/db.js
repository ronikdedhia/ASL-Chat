const { MongoClient } = require('mongodb');

const hasMongoUri = Boolean(process.env.MONGODB_URI);
if (!hasMongoUri) {
  console.warn('MONGODB_URI not set — chat history will be kept in-memory only (lost on server restart) until configured.');
}

let dbPromise = null;

// Lazily connects once, reuses the same connection for the life of the process.
function getDb() {
  if (!hasMongoUri) return null;
  if (!dbPromise) {
    const client = new MongoClient(process.env.MONGODB_URI);
    dbPromise = client.connect().then(() => client.db(process.env.MONGODB_DB_NAME || 'aslchat'));
  }
  return dbPromise;
}

module.exports = { hasMongoUri, getDb };

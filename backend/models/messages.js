const { randomUUID } = require('crypto');
const { hasMongoUri, getDb } = require('../db');

// Dual-mode storage: real persistence via MongoDB when configured, otherwise an in-memory
// Map keyed by room so the chat still fully works for local/demo use without any DB setup —
// same "runs in reduced mode rather than not at all" pattern used throughout this backend.
// In-memory history is lost on server restart and is NOT shared across multiple server
// instances — fine for a single local process, not for a real multi-instance deployment.
const memoryStore = new Map(); // roomId -> array of message docs, oldest first
const MAX_MEMORY_MESSAGES_PER_ROOM = 500;

async function saveMessage({ room, senderName, userId, text, composedVia }) {
  const doc = {
    id: randomUUID(),
    room,
    senderName,
    userId: userId || null, // trusted Clerk userId when configured, null in open mode — not yet used for access control, just stored for when a real conversations/contacts model is built (ARCHITECTURE.md §8)
    text,
    composedVia, // "typed" | "mic" | "sign" — for transparency/analytics only, never changes rendering
    createdAt: new Date().toISOString(),
  };

  if (hasMongoUri) {
    const db = await getDb();
    // insertOne() mutates its argument in place, adding a Mongo-generated `_id` onto `doc`
    // itself — insert a shallow copy instead so the object we return/broadcast to clients
    // stays identical in shape whether Mongo is configured or not.
    await db.collection('messages').insertOne({ ...doc });
    return doc;
  }

  const existing = memoryStore.get(room) || [];
  existing.push(doc);
  if (existing.length > MAX_MEMORY_MESSAGES_PER_ROOM) existing.shift();
  memoryStore.set(room, existing);
  return doc;
}

async function getMessagesForRoom(room, limit = 100) {
  if (hasMongoUri) {
    const db = await getDb();
    const docs = await db
      .collection('messages')
      .find({ room })
      .sort({ createdAt: 1 })
      .limit(limit)
      .toArray();
    return docs.map(({ _id, ...rest }) => rest);
  }

  const existing = memoryStore.get(room) || [];
  return existing.slice(-limit);
}

module.exports = { saveMessage, getMessagesForRoom };

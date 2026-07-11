const { hasMongoUri, getDb } = require('../db');

// Recent-conversations list — a lightweight per-user index of "who have I talked to and in
// which room," separate from `messages` so an entry exists even before either side has sent
// a single message yet (populated at join time). Requires Mongo — silently a no-op in
// in-memory mode, same degrade pattern as the rest of this backend (the recent-list just
// doesn't show anything rather than crashing).
async function upsertConversationEntry({ userId, room, otherUserId, otherName }) {
  if (!hasMongoUri) return;
  const db = await getDb();
  await db.collection('conversations').updateOne(
    { userId, room },
    { $set: { userId, room, otherUserId, otherName, updatedAt: new Date().toISOString() } },
    { upsert: true },
  );
}

async function getRecentConversationsForUser(userId, limit = 20) {
  if (!hasMongoUri) return [];
  const db = await getDb();
  const docs = await db.collection('conversations').find({ userId }).sort({ updatedAt: -1 }).limit(limit).toArray();
  return docs.map(({ _id, ...rest }) => rest);
}

// Removes only the requesting user's own shortcut entry — never touches the counterpart's
// entry or any actual message history, same as removing a contact from a recent-calls list
// without deleting the calls themselves.
async function deleteConversationEntry({ userId, room }) {
  if (!hasMongoUri) return;
  const db = await getDb();
  await db.collection('conversations').deleteOne({ userId, room });
}

module.exports = { upsertConversationEntry, getRecentConversationsForUser, deleteConversationEntry };

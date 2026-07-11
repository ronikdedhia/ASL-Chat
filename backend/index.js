require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');
const { Server } = require('socket.io');

const { hasApiKey } = require('./llm');
const { hasMongoUri } = require('./db');
const { hasClerkKeys, verifySocketToken, requireAuth, getClerkClient } = require('./auth');
const { VOCABULARY, FINGERSPELL_CANDIDATES } = require('./vocabulary');
const { translateToSign } = require('./chains/translate');
const { checkLetter } = require('./chains/checkLetter');
const { saveMessage, getMessagesForRoom } = require('./models/messages');

if (!hasApiKey) {
  console.warn('GROQ_API_KEY is not set — /api/translate and /api/check-letter will return 500 until it is.');
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Per-IP throttling for the endpoints that spend real Groq quota — bounds the endpoint
// directly rather than trusting the client to pace itself, same reasoning as YogaPedia's
// backend (ROADMAP.md §1 there).
function makeLimiter(max) {
  return rateLimit({
    windowMs: 60_000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: 'Too many requests — please slow down and try again shortly.' }),
  });
}
const visionLimiter = makeLimiter(20); // client paces itself at ~24/min (2.5s cadence); this bounds the endpoint directly
const translateLimiter = makeLimiter(20); // one call per Send, not polled
const userSearchLimiter = makeLimiter(30); // typing in a search box, not a single click

app.post('/api/translate', translateLimiter, async (req, res) => {
  if (!hasApiKey) {
    return res.status(500).json({ error: 'Server is missing GROQ_API_KEY — set it in backend/.env.' });
  }
  const { sentence } = req.body || {};
  if (!sentence || typeof sentence !== 'string' || !sentence.trim()) {
    return res.status(400).json({ error: 'Missing "sentence" in request body.' });
  }
  if (sentence.length > 500) {
    return res.status(400).json({ error: 'Sentence is too long (max 500 characters).' });
  }

  try {
    const result = await translateToSign(sentence.trim());
    return res.json(result);
  } catch (err) {
    console.error('translateToSign failed:', err);
    const status = err?.status ?? err?.response?.status ?? err?.cause?.status;
    if (status === 429) {
      return res.status(429).json({ error: 'Text model rate limit hit — please try again shortly.' });
    }
    return res.status(502).json({ error: 'Translation request failed.' });
  }
});

app.post('/api/check-letter', visionLimiter, async (req, res) => {
  if (!hasApiKey) {
    return res.status(500).json({ error: 'Server is missing GROQ_API_KEY — set it in backend/.env.' });
  }
  const { image } = req.body || {};
  if (!image || typeof image !== 'string') {
    return res.status(400).json({ error: 'Missing "image" (base64 data URL) in request body.' });
  }

  try {
    const result = await checkLetter(image, FINGERSPELL_CANDIDATES);
    return res.json(result);
  } catch (err) {
    console.error('checkLetter failed:', err);
    const status = err?.status ?? err?.response?.status ?? err?.cause?.status;
    if (status === 429) {
      return res.status(429).json({ error: 'Vision model rate limit hit — checks will resume automatically in a moment.' });
    }
    return res.status(502).json({ error: 'Vision model request failed.' });
  }
});

app.get('/api/vocabulary', (_req, res) => res.json(VOCABULARY));

// Lets a signed-in user find someone to chat with by name/username instead of needing a
// shared room code — backed directly by Clerk's own user list (no local "users" collection
// to keep in sync, Clerk already stores this). Auth-gated: only signed-in users can search,
// and the searcher is excluded from their own results.
app.get('/api/users/search', userSearchLimiter, requireAuth(), async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q.length < 2) {
    return res.status(400).json({ error: 'Search query must be at least 2 characters.' });
  }

  try {
    const { data } = await getClerkClient().users.getUserList({ query: q, limit: 10 });
    const results = data
      .filter((u) => u.id !== req.userId)
      .map((u) => ({
        userId: u.id,
        name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || u.emailAddresses?.[0]?.emailAddress || 'User',
        username: u.username || null,
        imageUrl: u.imageUrl || null,
      }));
    return res.json(results);
  } catch (err) {
    console.error('User search failed:', err);
    return res.status(502).json({ error: 'User search failed.' });
  }
});

app.get('/api/config-status', (_req, res) =>
  res.json({ groq: hasApiKey, mongo: hasMongoUri, clerk: hasClerkKeys }),
);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 8788;
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

// Room-based chat — a room is still just a shared string both sides type in, like a
// meeting code (a formal conversations/contacts model tied to Clerk identity is a bigger
// change than adding auth itself, see ARCHITECTURE.md §8, not built here). What Clerk does
// add, when configured: the connection itself is verified, and each message is stamped
// with a trusted userId instead of only a client-supplied, unverifiable display name.
// 100, not 40 — a direct-message room derived from two Clerk user IDs (e.g.
// "dm_user_2abc..._user_2xyz...") runs well past a typed room code's length.
const ROOM_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,100}$/;

// Verifies the Clerk session token passed in the Socket.io handshake before any 'join' or
// 'message:send' is accepted — same "reject bad auth before doing any work" shape as
// requireAuthOrNotConfigured() in YogaPedia's Express-based auth.js, just adapted for
// Socket.io's connection-level middleware instead of a per-route one. In open mode (no
// Clerk keys), every connection is allowed through unverified, same as today.
io.use(async (socket, next) => {
  if (!hasClerkKeys) return next();
  const token = socket.handshake.auth?.token;
  if (!token || typeof token !== 'string') return next(new Error('Authentication required'));
  try {
    socket.data.userId = await verifySocketToken(token);
    next();
  } catch (err) {
    console.error('Socket auth failed:', err);
    next(new Error('Invalid or expired session'));
  }
});

io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('join', async ({ room, displayName } = {}, ack) => {
    if (typeof room !== 'string' || !ROOM_NAME_PATTERN.test(room)) {
      return ack?.({ error: 'Room must be 1-40 characters: letters, numbers, "-", "_".' });
    }
    const name = typeof displayName === 'string' && displayName.trim() ? displayName.trim().slice(0, 40) : 'Anonymous';

    if (currentRoom) socket.leave(currentRoom);
    socket.join(room);
    currentRoom = room;
    socket.data.displayName = name;

    try {
      const history = await getMessagesForRoom(room);
      ack?.({ ok: true, history });
      socket.to(room).emit('presence', { displayName: name, event: 'joined' });
    } catch (err) {
      console.error('Failed to load room history:', err);
      ack?.({ error: 'Could not load chat history.' });
    }
  });

  socket.on('message:send', async ({ text, composedVia } = {}, ack) => {
    if (!currentRoom) return ack?.({ error: 'Join a room first.' });
    if (typeof text !== 'string' || !text.trim()) return ack?.({ error: 'Message text is required.' });
    if (text.length > 1000) return ack?.({ error: 'Message is too long (max 1000 characters).' });

    const validComposedVia = ['typed', 'mic', 'sign'].includes(composedVia) ? composedVia : 'typed';

    try {
      const message = await saveMessage({
        room: currentRoom,
        senderName: socket.data.displayName || 'Anonymous',
        userId: socket.data.userId || null, // trusted (Clerk-verified) identity, when configured — null in open mode
        text: text.trim(),
        composedVia: validComposedVia,
      });
      io.to(currentRoom).emit('message:receive', message);
      ack?.({ ok: true, message });
    } catch (err) {
      console.error('Failed to save message:', err);
      ack?.({ error: 'Could not send message.' });
    }
  });

  socket.on('typing', ({ isTyping } = {}) => {
    if (!currentRoom) return;
    socket.to(currentRoom).emit('typing', { displayName: socket.data.displayName || 'Anonymous', isTyping: Boolean(isTyping) });
  });

  socket.on('disconnect', () => {
    if (currentRoom) socket.to(currentRoom).emit('presence', { displayName: socket.data.displayName || 'Anonymous', event: 'left' });
  });
});

httpServer.listen(PORT, () => console.log(`ASL-Chat API + Socket.io listening on http://localhost:${PORT}`));

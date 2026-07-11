require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');
const { Server } = require('socket.io');

// Logs the reason before exiting, rather than the process just silently vanishing — then
// exits deliberately (verified live: without the exit, an uncaught exception left a stuck,
// non-listening zombie process still running instead of actually going down) so Render's
// process manager restarts it cleanly, matching Node's own guidance against trying to keep
// running after an uncaught exception's state may already be corrupted.
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});

const { hasApiKey } = require('./llm');
const { hasMongoUri } = require('./db');
const { hasClerkKeys, verifySocketToken, requireAuth, getClerkClient } = require('./auth');
const { VOCABULARY, FINGERSPELL_CANDIDATES } = require('./vocabulary');
const { translateToSign } = require('./chains/translate');
const { checkLetter } = require('./chains/checkLetter');
const { saveMessage, getMessagesForRoom } = require('./models/messages');
const { upsertConversationEntry, getRecentConversationsForUser, deleteConversationEntry } = require('./models/conversations');
const { LESSONS, getLessonById, getTodaysLesson } = require('./lessons');
const { hasTelegramConfig, sendTelegramMessage, formatLessonMessage } = require('./telegram');
const { startLessonScheduler } = require('./lessonScheduler');

if (!hasApiKey) {
  console.warn('GROQ_API_KEY is not set — /api/translate and /api/check-letter will return 500 until it is.');
}

// Optional — used only for reading messages aloud ("Hear this message"), never for the
// mic/dictation input path (that stays on the browser's built-in Web Speech API, no
// external service or cost involved). Same guarded-optional pattern as Groq/Mongo/Clerk.
const hasElevenLabsKey = Boolean(process.env.ELEVENLABS_API_KEY);
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb';
if (!hasElevenLabsKey) {
  console.warn('ELEVENLABS_API_KEY not set — "Hear this message" will be unavailable until configured.');
}

// Comma-separated list of allowed frontend origins in production (e.g. your Vercel URL).
// Left unset in local dev, wide open (undefined origin check just falls through cors()'s
// default reflect-any-origin behavior) — restrict this before deploying somewhere public.
// A browser's Origin header never has a trailing slash — stripped defensively here since a
// copy-pasted URL with one (verified live: this exact mistake silently broke CORS in
// production, with no error beyond a generic client-side "connection failed") would
// otherwise never match and fail closed with no obvious cause.
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim().replace(/\/$/, ''))
  : null;
const corsOptions = allowedOrigins ? { origin: allowedOrigins } : {};

const app = express();
// Required behind Render's (or any) reverse proxy — without it, express-rate-limit and
// anything else reading req.ip sees the proxy's IP for every request instead of the real
// client's, which would silently rate-limit/key everyone as if they were one caller.
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors(corsOptions));
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
const ttsLimiter = makeLimiter(20); // one call per "Hear this message" click, not polled
// Sends into the app owner's own personal Telegram channel — this is a broadcast into a
// single external destination, not a per-user feature, so it's throttled far tighter than
// the other action endpoints to bound how much any one (still Clerk-authenticated) caller
// could spam that channel.
const telegramLimiter = makeLimiter(5);

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

// Recent conversations — Clerk-auth-gated, since it's inherently per-identity (open mode
// has no stable userId to key this list by, so there's nothing to return there).
app.get('/api/conversations', requireAuth(), async (req, res) => {
  try {
    const conversations = await getRecentConversationsForUser(req.userId);
    return res.json(conversations);
  } catch (err) {
    console.error('Failed to fetch conversations:', err);
    return res.status(502).json({ error: 'Could not fetch recent conversations.' });
  }
});

// :room is URL-encoded by the client (room names can contain the "dm_..." format with
// underscores, which is already URL-safe, but encoding defensively costs nothing).
app.delete('/api/conversations/:room', requireAuth(), async (req, res) => {
  try {
    await deleteConversationEntry({ userId: req.userId, room: req.params.room });
    return res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete conversation entry:', err);
    return res.status(502).json({ error: 'Could not remove this conversation.' });
  }
});

app.get('/api/tts-status', (_req, res) => res.json({ enabled: hasElevenLabsKey }));

app.post('/api/tts', ttsLimiter, async (req, res) => {
  if (!hasElevenLabsKey) {
    return res.status(503).json({ error: 'Text-to-speech is not configured — set ELEVENLABS_API_KEY in backend/.env.' });
  }
  const { text } = req.body || {};
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Missing "text" in request body.' });
  }
  if (text.length > 1000) {
    return res.status(400).json({ error: 'Text is too long (max 1000 characters).' });
  }

  try {
    const elevenRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({ text: text.trim(), model_id: 'eleven_flash_v2_5' }), // cheapest — 0.5x credits/char vs standard models
    });

    if (!elevenRes.ok) {
      const errBody = await elevenRes.text();
      console.error('ElevenLabs request failed:', elevenRes.status, errBody);
      return res.status(502).json({ error: 'Text-to-speech request failed.' });
    }

    const audioBuffer = Buffer.from(await elevenRes.arrayBuffer());
    res.set('Content-Type', 'audio/mpeg');
    return res.send(audioBuffer);
  } catch (err) {
    console.error('ElevenLabs request failed:', err);
    return res.status(502).json({ error: 'Text-to-speech request failed.' });
  }
});

// Public, same trust level as /api/vocabulary — lesson content (word lists) isn't sensitive.
app.get('/api/lessons', (_req, res) => res.json(LESSONS));

app.get('/api/lessons/today', (_req, res) => res.json(getTodaysLesson()));

// Gated + heavily rate-limited — see telegramLimiter above. This broadcasts into the app
// owner's own Telegram channel, not a per-user inbox, so it's intentionally not a fully
// public action even though it's reachable by any signed-in user.
app.post('/api/telegram/send-lesson', telegramLimiter, requireAuth(), async (req, res) => {
  if (!hasTelegramConfig) {
    return res.status(503).json({ error: 'Telegram is not configured — set TELEGRAM_ACCESS_TOKEN and TELEGRAM_CHANNEL_ID in backend/.env.' });
  }
  const { lessonId } = req.body || {};
  const lesson = lessonId ? getLessonById(lessonId) : getTodaysLesson();
  if (!lesson) {
    return res.status(400).json({ error: 'Unknown lessonId.' });
  }

  try {
    await sendTelegramMessage(formatLessonMessage(lesson));
    return res.json({ ok: true, lesson: lesson.title });
  } catch (err) {
    console.error('Telegram send failed:', err);
    return res.status(502).json({ error: 'Could not send to Telegram.' });
  }
});

app.get('/api/config-status', (_req, res) =>
  res.json({ groq: hasApiKey, mongo: hasMongoUri, clerk: hasClerkKeys, elevenLabs: hasElevenLabsKey, telegram: hasTelegramConfig }),
);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 8788;
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: allowedOrigins || '*' } });

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

  socket.on('join', async ({ room, displayName, otherUserId, otherName } = {}, ack) => {
    if (typeof room !== 'string' || !ROOM_NAME_PATTERN.test(room)) {
      return ack?.({ error: 'Room must be 1-100 characters: letters, numbers, "-", "_".' });
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

      // Recent-conversations bookkeeping — only present when this join came from the
      // search flow (FindUserPanel/RecentConversations pass otherUserId/otherName; a plain
      // room-code join or an auto-rejoin-on-refresh omits them, which just skips this
      // block). Upserts BOTH participants' entries so the person who got found, not only
      // whoever searched, also sees this conversation next time they open the join screen.
      // otherUserId isn't verified against a real Clerk lookup (would cost a round trip on
      // every join for what's just a convenience list, not an access boundary) — only
      // sanity-checked to look like a real Clerk ID.
      const looksLikeClerkId = typeof otherUserId === 'string' && /^user_[A-Za-z0-9]+$/.test(otherUserId);
      if (hasMongoUri && socket.data.userId && looksLikeClerkId && typeof otherName === 'string' && otherName.trim()) {
        const cleanOtherName = otherName.trim().slice(0, 80);
        await Promise.all([
          upsertConversationEntry({ userId: socket.data.userId, room, otherUserId, otherName: cleanOtherName }),
          upsertConversationEntry({ userId: otherUserId, room, otherUserId: socket.data.userId, otherName: name }),
        ]);
      }
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

  // kind distinguishes "typing" (default) from "signing" (the camera panel is open) — lets
  // the receiving end show "X is signing…" instead of a generic "X typing…", the way video
  // calls show a distinct "speaking now" cue rather than folding every activity into one.
  socket.on('typing', ({ isTyping, kind } = {}) => {
    if (!currentRoom) return;
    socket.to(currentRoom).emit('typing', {
      displayName: socket.data.displayName || 'Anonymous',
      isTyping: Boolean(isTyping),
      kind: kind === 'signing' ? 'signing' : 'typing',
    });
  });

  socket.on('disconnect', () => {
    if (currentRoom) socket.to(currentRoom).emit('presence', { displayName: socket.data.displayName || 'Anonymous', event: 'left' });
  });
});

httpServer.listen(PORT, () => console.log(`ASL-Chat API + Socket.io listening on http://localhost:${PORT}`));
startLessonScheduler();

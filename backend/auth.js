const hasClerkKeys = Boolean(process.env.CLERK_SECRET_KEY && process.env.CLERK_PUBLISHABLE_KEY);
if (!hasClerkKeys) {
  console.warn('CLERK_SECRET_KEY/CLERK_PUBLISHABLE_KEY not set — running in open mode (rooms identified by a client-chosen display name, no real accounts).');
}

// Only require() the Clerk SDK when keys are actually present — same guard pattern used
// for Groq/Mongo elsewhere in this backend, so the server always boots cleanly regardless
// of which optional integrations are configured.
let verifyToken;
let clerkClient;
if (hasClerkKeys) {
  const clerkBackend = require('@clerk/backend');
  verifyToken = clerkBackend.verifyToken;
  clerkClient = clerkBackend.createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
}

// Socket.io has no req/res to hand to @clerk/express's clerkMiddleware(), so this verifies
// the session token directly via @clerk/backend instead — the lower-level SDK
// @clerk/express itself is built on. Returns the verified Clerk userId, or throws.
async function verifySocketToken(token) {
  const { sub: userId } = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
  return userId;
}

// Same verification, exposed as an Express middleware for plain REST routes (e.g.
// /api/users/search) — reads a Bearer token instead of Socket.io's handshake auth payload.
function requireAuth() {
  if (!hasClerkKeys) {
    return (_req, res) => res.status(501).json({ error: 'Clerk is not configured — set CLERK_SECRET_KEY and CLERK_PUBLISHABLE_KEY in backend/.env.' });
  }
  return async (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Sign in required.' });
    try {
      req.userId = await verifySocketToken(token);
      next();
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired session.' });
    }
  };
}

module.exports = { hasClerkKeys, verifySocketToken, requireAuth, getClerkClient: () => clerkClient };

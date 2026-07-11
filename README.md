# ASL-Chat

Bidirectional ASL ↔ English chat. Sign to compose a message (fingerspelling, recognized live by a Groq vision-LLM), type or speak to compose it the normal way — either becomes plain text sent to the other person, who can read it or tap "View as sign" to watch it play back as ASL video.

See `ARCHITECTURE.md` for the full design rationale and history of what was built, `ROADMAP.md` for what's still open, and `MIGRATION_PLAN.md` for the translator-only plan this chat app builds on top of.

## Setup

```bash
cd backend && npm install && cp .env.example .env
# edit backend/.env — set GROQ_API_KEY (required — free at console.groq.com)
npm run dev
```

```bash
cd frontend && npm install && cp .env.example .env
npm run dev
```

Open the frontend URL printed by Vite (default `http://localhost:5174`).

- **Open mode** (no Clerk keys set): enter a name + room code, share the same code with someone else to land in the same chat.
- **Clerk mode** (see below): sign in, search for someone by name/username, click to start chatting — no code-sharing needed.

## Optional: enabling MongoDB persistence

Without it, chat history is kept in-memory (lost on server restart) — everything still works, just not durably. To persist it, add to `backend/.env`:

```
MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/
MONGODB_DB_NAME=aslchat
```

Uses one collection, `messages` — created automatically on first insert, no manual setup needed in Atlas.

## Optional: enabling real accounts (Clerk)

Without it, the app runs in open mode (free-text display name, manual room codes, no real identity). To enable sign-in and user search:

**`backend/.env`:**
```
CLERK_SECRET_KEY=sk_test_...
CLERK_PUBLISHABLE_KEY=pk_test_...
```

**`frontend/.env`:**
```
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
```

Both publishable keys must be the **same** key pair (the publishable half is meant to be public, safe to ship to the browser — the secret half stays server-side only). Once both are set, restart both servers; the app requires sign-in and shows a search-by-name box instead of the manual room code field.

## Known limitations (see `ARCHITECTURE.md` §9 and `ROADMAP.md` for the full list)

- Camera-based recognition is fingerspelling only (A-Z, 0-9) — not full word signs.
- The 151 sign videos in `frontend/public/signs/` are reused from the legacy repo with unresolved provenance (`ARCHITECTURE.md` §0.1) — a knowingly accepted risk, not a cleared license.
- No server-side check that a direct-message room's two participant IDs match who's actually connecting (`ROADMAP.md` §1).
- Refreshing the browser mid-chat drops you back to the join/search screen — no session persistence yet.

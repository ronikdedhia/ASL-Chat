# ASL-Chat

A bidirectional ASL ↔ English chat application. Compose messages by signing, speaking, or typing; every message can be read as text or watched as ASL sign-language video. Built with LangChain.js and Groq's vision and text models — no Python runtime, no pre-trained classifier to maintain.

## How it works

- **Sign to compose.** Fingerspell a letter or digit in front of your camera; a Groq vision model recognizes it live and adds it to your message.
- **Speak or type to compose.** Standard dictation (Web Speech API) or a normal text field — whichever is fastest for you.
- **Every message is playable as sign language.** Tap "View as sign" on any message to watch it rendered as a sequence of ASL video clips, with adjustable playback speed for anyone still learning to read signs at full speed.
- **Every message can be heard, too.** Optional text-to-speech via ElevenLabs reads a message aloud on demand.

Composition method is just an input choice — a signed message and a typed message are indistinguishable once sent, so chat history, search, and playback all work identically regardless of how a message was created.

## Features

**Core chat**
- Real-time messaging over Socket.io, with typing indicators
- A distinct "signing…" indicator (separate from "typing…") while the other person's camera panel is open
- One-tap quick-reply phrases for common conversational repairs ("Again," "Slow down," "I don't understand")
- A visual "new message" alert — flashes the browser tab title and fires a desktop notification when a message arrives while the tab isn't active, since a sound-based alert doesn't serve a Deaf user

**Finding people to chat with**
- Search by name or username (backed by Clerk's user directory)
- A "Recent" list of prior conversations, populated for both participants the moment either one starts a chat — not just whoever initiated it
- Sessions persist across a page refresh; closing and reopening the tab returns you to your last conversation automatically

**Vocabulary**
- A browsable vocabulary library showing every word, letter, and digit with a real sign-video clip, each previewable on tap
- Anything typed outside that vocabulary is automatically fingerspelled out, letter by letter — no silent gaps in translation

**Accounts and persistence**
- Optional Clerk authentication for real sign-in and identity; runs in an open, no-account mode without it
- Optional MongoDB persistence for chat history and recent conversations; falls back to in-memory storage (working, just not durable across restarts) without it

Every optional integration degrades gracefully — the app is fully usable with only a Groq API key configured, and each additional service (Mongo, Clerk, ElevenLabs) unlocks more capability without being required to run at all.

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Node.js, Express, Socket.io |
| LLM orchestration | LangChain.js (`@langchain/core`, `@langchain/groq`) |
| Vision (sign recognition) | Groq — `meta-llama/llama-4-scout-17b-16e-instruct` |
| Text (translation) | Groq — `llama-3.3-70b-versatile` |
| Auth | Clerk (optional) |
| Database | MongoDB Atlas (optional) |
| Text-to-speech | ElevenLabs (optional) |
| Frontend | React, Vite |

## Setup

```bash
cd backend
npm install
cp .env.example .env
# set GROQ_API_KEY in .env — free at console.groq.com
npm run dev
```

```bash
cd frontend
npm install
npm run dev
```

Open the URL Vite prints (default `http://localhost:5174`).

- **Open mode** (no Clerk keys configured): enter a display name and a room code; share the same code with someone else to land in the same conversation.
- **Clerk mode** (see below): sign in, search for someone by name, and start chatting — no code-sharing required.

## Configuration

Only `GROQ_API_KEY` is required. Everything below is optional and additive.

### MongoDB — persistent chat history and recent conversations

Without it, chat history lives in memory only (lost on server restart); everything still works, just not durably.

```
# backend/.env
MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/
MONGODB_DB_NAME=aslchat
```

Two collections — `messages` and `conversations` — are created automatically on first write; no manual setup needed in Atlas.

### Clerk — accounts, user search, and recent conversations

Without it, the app runs in open mode (free-text display name, manual room codes, no persistent identity).

```
# backend/.env
CLERK_SECRET_KEY=sk_test_...
CLERK_PUBLISHABLE_KEY=pk_test_...
```

```
# frontend/.env
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
```

Both publishable keys must come from the same Clerk application (the publishable half is safe to ship to the browser; the secret half stays server-side only). Restart both servers after setting these.

### ElevenLabs — "Hear this message"

Without it, the "Hear this message" button simply doesn't appear; everything else is unaffected.

```
# backend/.env
ELEVENLABS_API_KEY=your_key_here
ELEVENLABS_VOICE_ID=JBFqnCBsd6RMkjVDRZzb   # optional, defaults to this voice
```

Used strictly for reading messages aloud — the microphone/dictation input path always uses the browser's built-in, free Web Speech API, never ElevenLabs.

## Known limitations

- Camera-based recognition covers fingerspelling only (A–Z, 0–9), not full word-level signs — a single frame every 2.5 seconds can capture a static handshape reliably but not motion-based signs.
- The 151 sign-video clips bundled with the app were carried over from an earlier project with unresolved licensing provenance — a known, deliberately accepted risk rather than a cleared license. Revisit before any public launch.
- A direct-message room's participant IDs aren't cryptographically verified against who's actually connecting — low practical risk (an attacker would need to already know both exact Clerk user IDs), but not a formal access-control boundary.

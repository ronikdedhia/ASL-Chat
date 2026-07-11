# Roadmap — what's next

Not a record of decisions made (that's `ARCHITECTURE.md`) or things only you can do (setting up your own Groq/Mongo/Clerk credentials) — this is the backlog of what to build next, split into real gaps found in the current code, and feature ideas by effort. Items already built have been removed from this file as they land — see `ARCHITECTURE.md` for the full history of what was built and why.

---

## 1. Real gaps found by testing, not hypothetical

- **No server-side check that a `dm_` room's two IDs match who's connecting.** Anyone with both exact Clerk user IDs could join that room string directly — a low bar (you'd have to already know two specific IDs), but not a real access-control boundary. Fixing this properly means either parsing/validating the room name against the connecting user's own ID, or moving to a real `conversations` collection keyed by participant IDs instead of a derived string.
- **No session persistence across a page refresh.** Reloading the browser mid-chat drops you back to the join/search screen — nothing about "which room you were in" is stored client-side (localStorage) or resumable server-side.
- **No error monitoring/logging.** Errors currently just go to `console.error` — fine locally, invisible once deployed.
- **In-memory chat history mode has no cross-instance sharing.** Fine for a single local process; would break silently if this were ever run as more than one server instance without Mongo configured.
- **Sign-video asset provenance (`ARCHITECTURE.md` §0.1) is still unresolved.** Currently shipping anyway, risk accepted — revisit before this needs to survive real scrutiny (public launch, funding, enterprise deal).
- **The dev-only esbuild/Vite advisory** (`GHSA-67mh-4wv8-2f99`) is still present — fix requires a breaking Vite major-version bump, which needs Node ≥20.19 (this machine runs 20.15.1). Low real risk (dev server only, not production), but not resolved.

---

## 2. Feature ideas, by effort

**Small:**
- A "recent conversations" list on the join screen, so returning users don't have to re-search every time (needs a small `conversations` collection tracking who's talked to whom, deferred when user search shipped — see `ARCHITECTURE.md` §1).
- A "browsable vocabulary" reference page (which words/letters have real sign videos vs. fall back to fingerspelling) — same transparency idea as YogaPedia's `LibraryView.jsx`, not yet built here.
- Spoken output for received messages (browser `speechSynthesis`, reading translated/typed text aloud) — no new dependency, same pattern YogaPedia used for pose-check guidance.

**Medium:**
- Widen camera recognition beyond fingerspelling to static-handshape words (e.g. "Yes," "No") — untested how well a zero-shot vision-LLM holds up past the current 36 candidates (A-Z, 0-9).
- Group chat (more than 2 participants) — needs a real `conversations` collection with a participants array, not just a derived two-ID room string.
- Deploy for real (frontend → Vercel/Netlify, backend → Render/Railway/Fly.io) instead of only running locally.

**Large:**
- Replace the 151 reused sign videos with a properly licensed or self-recorded set, resolving the open provenance risk for good.
- A real per-room access-control model (formal `conversations` collection keyed by participant Clerk IDs, replacing the derived `dm_...` room-name trick) — closes gap 1 above and is a prerequisite for group chat.

---

## 3. ASL-conversation-aware features (brainstormed)

Right now this is functionally a generic chat app with translation bolted on. These are specifically about serving people actually conversing in ASL, not just general chat polish — organized by effort, distinct from §2 above.

**Easy — small, and directly serve an ASL conversation, not generic chat features:**
- **Visual "new message" alert, not just an unread badge.** Deaf users can't rely on a notification sound — flash the browser tab title and/or use the Page Visibility + Notification APIs when the tab isn't focused. The single most obviously-missing accessibility gap right now.
- **A "signing…" indicator, distinct from "typing…"** `SignCompose` opening the camera panel is a real, distinct conversational state (someone mid-fingerspell) — deserves its own visible cue, the way video calls show "speaking now." Reuses the existing typing-event plumbing.
- **Quick-reply conversational-repair phrases** — "Again" (repeat that), "Slow down," "I don't understand." One-tap buttons using words already in the 151-word vocabulary, no new signs needed. Real, common ASL conversational courtesy moves.
- **Preview what will/won't translate before hitting Send** — not just letting the receiver discover fingerspelling on tap. A small live note under the compose box ("3 signs, 2 fingerspelled: College, Yesterday"), reusing `/api/translate` proactively instead of only on-demand.
- **Playback speed control on sign video** (0.5x/1x/1.5x via `video.playbackRate`) — useful for anyone still learning to read signs at conversational speed.
- **Click any word in the caption trail to replay just that sign** — currently a one-shot auto-play sequence; `MessageBubble` already tracks `currentIndex`, just needs the trail to be clickable.
- **Show the full gloss trail as running captions**, not just the currently-playing word — closer to real captioning, easier to follow along.

**Medium:**
- **A communication-preference tag on your profile** — "Deaf," "Hard of Hearing," "Hearing (learning ASL)," "Interpreter" — shown next to your name so the other person knows how to communicate with you.
- **Read receipts** — confirms the other person actually watched the sign playback, not just that the message arrived. Matters more here than in a text-only app, since "read" and "understood the signs" aren't the same thing.
- **Export a conversation as a text transcript** — some Deaf users prefer a permanent written record over an ephemeral signed exchange. Message history already exists, just needs a download-as-text action (same pattern as YogaPedia's `formatScheduleAsText()`).

**Big — the actual gold-standard feature, not a quick add:**
- **Live peer-to-peer video calling (WebRTC) between two chat participants.** Real ASL conversation is continuous and face-to-face — turn-by-turn typed/signed messages are a reasonable MVP, but the actual thing Deaf communities use (video relay services, FaceTime) is live video. This is the feature that would make the app feel ASL-first rather than a translator with chat bolted on. Meaningfully bigger scope (WebRTC signaling, TURN/STUN, UI) — deserves its own planning pass, not folded in here.
- Group video/conference signing — same idea, harder.

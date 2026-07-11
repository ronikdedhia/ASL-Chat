# ASL-Chat — Architecture Plan

> **Framework decision: LangChain.js — done.** Same rationale as the YogaPedia rewrite: all LLM orchestration (English↔ASL translation, camera-based sign recognition) runs on **LangChain.js** (`@langchain/core` + `@langchain/groq`) inside a Node/Express backend — not Python. This is a from-scratch JS + LLM rebuild of the legacy `Sign-Language-Converter` repo, expanded in scope from "one-way translator tool" to **a bidirectional ASL↔English chat app**.
>
> **Status: built and verified.** Backend + frontend both implemented, boot-tested, and exercised against the real Groq, MongoDB Atlas, and Clerk services (not just structurally reviewed — see §9 for exactly what was verified live and two real bugs caught doing it). This document supersedes and absorbs `MIGRATION_PLAN.md` (moved into this folder unchanged in substance, see that file) plus the chat-integration discussion that followed it. See `ROADMAP.md` for what's genuinely still open — this file is the history of what was built and why, not a task list.

Rewrite goal, same as YogaPedia: kill the Python version-pinning surface (Django + NLTK + whatever the README's ML claims would have required), replace unverified/ad-hoc recognition with a hosted, swappable vision-LLM, and — new for this project — turn a one-shot translator into a real two-person conversation tool. Optimize for "least moving parts," not raw framerate.

---

## 0. Audit: what the legacy repo actually does vs. what its README claims

Read end-to-end before planning anything (`A2SL/views.py`, `A2SL/urls.py`, `templates/*.html`, `static/build.js`, `templates/main.js`, `templates/package.json`) rather than trusting the README. Findings that materially changed the plan:

| README claim | Reality found in code |
|---|---|
| "ASL Recognition — YOLOv5 and ResNet-50, 92% accuracy" | **No such code exists anywhere in the repo.** No model file, no `cv2`/`torch`/`tensorflow` import, no `requirements.txt`. Aspirational text, never implemented. |
| (not mentioned) | Real recognition feature lives at `/index/` — a **2017-era `deeplearn.js` + kNN classifier** (`templates/package.json`: `deeplearn-knn-image-classifier@^0.3.0`). User must **train their own gestures live in-browser** each session; no pretrained model, no fixed vocabulary, no server round-trip. |
| (not mentioned) | Same page embeds a **hardcoded OpenTok video-call iframe** (demo embed ID, shared `DEFAULT_ROOM`) — not a real per-session feature as shipped. |
| "Text-to-Sign Generation — NLTK preprocessing" | **Real, and matches the README.** `A2SL/views.py`: tokenize → POS-tag → tense-detect → stopword-removal → lemmatize → map each word to `assets/<word>.mp4`, falling back to spelling it letter-by-letter if no match. Gated behind Django login. |
| "200+ pre-rendered sign videos" | **151** `.mp4` files — 26 letters, 10 digits, 115 words/phrases. Full list in `MIGRATION_PLAN.md` §0 / this repo's copy. |
| Screenshots `Chat App.png` / `Chat STT.png` / `Chat TTS.png` in `message/` | **No chat code exists anywhere in `urls.py`/`views.py`.** Same pattern as the YOLOv5 claim — an intended feature that was never built. This project (`ASL-Chat`) is, in effect, finally building what those screenshots always implied. |

**Practical consequence:** there is effectively no Python ML to port. The two things worth carrying forward are (1) the NLTK text→gloss pipeline's *behavior* (real, useful, works) and (2) the pre-rendered video assets. The trainable kNN gesture demo and the video-call embed are both dropped rather than ported — neither was a real working recognizer/feature.

**Also found, dropped regardless of migration path:** `A2SL/abc.cpp` (unrelated competitive-programming hash snippet), `templates/base2.html`/`ppp.html`/`animate.html` (orphaned, nothing references them), `templates/node_modules/` (68M, 10,583 files committed to git), duplicate `static/`/`assets/` trees, `db.sqlite3`, no `.gitignore` anywhere.

### 0.1 Sign-video asset provenance — investigated, unresolved, risk accepted

No license/attribution file exists near `assets/*.mp4` in the legacy repo. Investigated further:
- GitHub code search found this **exact 151-file list** (same order, same odd entries like `Glitter.mp4`, `Does Not.mp4`) duplicated verbatim across at least 7 unrelated student repos (`jalajsc/Audio-to-SignLanguage-Converter`, `zekwoa/ASL-translator`, `TArOoO2/Sign-Language-Recognizer`, `bryanjohn05/SignSerenade-Phase1`, `muzamilaminmir/SignTogether`, `truly-vivek/signproject`, `manikchadgal/Echogesture`). Origin is **untraceable**, not merely undocumented — it's a widely-recopied academic/tutorial dataset with no one along the chain crediting the actual source.
- Considered **WLASL** (~2,000-word open ASL video corpus) as a licensed replacement/expansion. **Ruled out**: licensed under **C-UDA** (academic/research use only, no commercial use), and even that only covers WLASL's own index — the underlying clips are scraped from ~20 third-party sites (YouTube channels, ASLU, ASL-LEX, SigningSavvy), each retaining its own separate copyright that WLASL never cleared. Not a viable swap-in for a real product.

**Decision: reuse the existing 151 clips as-is anyway, risk knowingly accepted rather than papered over.** If this ever needs to withstand real scrutiny (public launch, funding, enterprise customer), revisit — either re-record a small owned set or find a dataset with an explicit permissive license (not just "free to download," which WLASL and its Kaggle mirrors are not).

---

## 1. Decisions locked in

| Question | Decision |
|---|---|
| Framework | **LangChain.js** on Node/Express — one language across the whole backend, same reasoning as YogaPedia. |
| Text→Sign pipeline (was NLTK) | One **Groq text-LLM call** (`llama-3.3-70b-versatile` or similar) takes the sentence + the fixed 151-item vocabulary and returns `{ tense, glossWords: string[] }`, constrained to that vocabulary. Letter-spelling fallback for out-of-vocabulary words stays in **plain JS**, not the LLM — deterministic, matches the original behavior. |
| Gesture/letter recognition (was `deeplearn.js` kNN) | Zero-shot **Groq vision-LLM** (`meta-llama/llama-4-scout-17b-16e-instruct`), webcam snapshot every ~2.5s, classified against a **fixed candidate list** — no more "train 30 samples before you can use it." |
| Recognition vocabulary scope | **Fingerspelling first (A–Z, 0–9).** A snapshot-cadence zero-shot vision-LLM can plausibly read a static handshape (a letter) but not a motion-based word sign from one frame every 2.5s. Widening to include static-handshape words (e.g. "Yes," "No") is a possible v2 expansion, untested — see Open Items. |
| Video-call feature (OpenTok iframe) | **Dropped.** Hardcoded demo credentials, not a real working feature as shipped. |
| Sign-video assets (151 `.mp4`s) | **Reused as-is.** Provenance untraceable (§0.1) — risk accepted explicitly, not by omission. |
| Auth | **Clerk — implemented, not just planned.** Graceful degradation preserved throughout: with no Clerk keys the app runs in open mode (free-text display name, manual room codes); with keys set, sign-in is required, the Socket.io connection itself is token-verified server-side (`io.use()` middleware in `index.js`), and each message is stamped with a trusted `userId`. |
| Persistence | **MongoDB Atlas — implemented**, dual-mode: falls back to in-memory storage automatically when `MONGODB_URI` isn't set (chat still fully works, just doesn't survive a restart). One database, one `messages` collection — no separate `conversations`/`contacts` collections were needed in the end (see User discovery row below for why). |
| Real-time delivery | **Socket.io** on the same Express backend — no new language/service, fits "least moving parts." |
| How signing and translation attach to chat | **Reframed as input/output modalities, not a new message type or a live-video pipe** — see §4, this is the key architectural decision for this project. |
| User discovery ("how do I find someone to chat with?") | **Search Clerk's own user list directly, no local sync.** Originally the plan assumed a room-code-only model (§8 open item 2, since resolved). Once real usage revealed "how do I find that person" as a real question, the fix turned out not to need a `conversations`/`contacts` collection at all: `GET /api/users/search` queries Clerk's existing user list live, and clicking a result derives a **deterministic room ID** from both people's sorted Clerk user IDs (`dm_<idA>_<idB>`) — reuses 100% of the existing room-based chat plumbing, zero new socket events, zero new Mongo collections. |

---

## 2. Target architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  Browser (React + Vite) — frontend/                                   │
│                                                                         │
│  Compose (ASL → English, becomes the outgoing message):                │
│   consent modal → getUserMedia() → snapshot every 2.5s                  │
│   → POST /api/check-letter → confirmed letters accumulate into a         │
│     text buffer in the compose box (alternative to typing/mic input)     │
│   → user hits Send → plain English text goes out over the socket         │
│                                                                         │
│  Render (English → ASL, per received message):                          │
│   message bubble has a "▶ view as sign" toggle                          │
│   → POST /api/translate → ordered gloss word list                        │
│   → auto-plays matching .mp4 clips inline in that bubble                  │
│                                                                         │
│  Chat UI: conversation list, message thread, Socket.io client            │
└───────────────────────────┬─────────────────────────────────────────────┘
                            │ HTTPS + WebSocket
┌───────────────────────────▼─────────────────────────────────────────────┐
│  Express + Socket.io — backend/                                          │
│  — holds GROQ_API_KEY server-side only                                    │
│  — GET  /api/vocabulary    → the 151 known sign labels                     │
│  — POST /api/translate     → LangChain.js text chain: sentence +            │
│                              vocabulary → tense + gloss word list            │
│  — POST /api/check-letter  → LangChain.js vision chain: frame →              │
│                              recognized letter (A-Z, 0-9)                     │
│  — Socket.io namespace: message send/receive, presence, typing indicator      │
│  — REST: conversations, message history, contacts (Clerk-authenticated)        │
└───────────────────────────┬─────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼──────────────────┬───────────────────┐
 ┌──────▼──────┐    ┌───────▼─────┐    ┌────────▼────────┐  ┌───────▼──────┐
 │  Groq API   │    │  Groq API   │    │  MongoDB Atlas   │  │    Clerk     │
 │ vision model│    │  text model │    │ conversations/   │  │ identity/    │
 │(check-letter)│   │ (translate) │    │ messages/contacts│  │ auth session │
 └─────────────┘    └─────────────┘    └──────────────────┘  └──────────────┘

Static data loaded server-side at boot:
- backend/vocabulary.js  — 151 known words/letters/digits, ground-truthed
                           from assets/*.mp4 filenames, not the README's
                           inaccurate "200+" claim
public/signs/*.mp4       — the 151 sign videos, reused as-is (§0.1)
```

No Python at runtime. No committed `node_modules`. No client-trained classifier. No hardcoded third-party video-call embed. No live video streaming or server-side video processing — recognition happens on discrete snapshots, translation output is always pre-rendered clips, never generated video.

---

## 3. Components

### 3.1 Frontend — React + Vite (as actually built)
- `main.jsx` — conditionally mounts `ClerkProvider` (lazy-loaded) only if `VITE_CLERK_PUBLISHABLE_KEY` is set; otherwise renders `App` directly in open mode. Same graceful-degradation shape as the backend.
- `AuthedGate.jsx` — only rendered inside `ClerkProvider`; shows Clerk's `<SignIn/>` when signed out, otherwise resolves the signed-in user's name + a token-getter and hands them to `App`.
- `App.jsx` — top-level state: join/leave, message list, typing users. Owns the single shared `socket` instance's lifecycle (connect on join, disconnect on leave).
- `JoinScreen.jsx` — in Clerk mode, shows `FindUserPanel` by default with a "or enter a room code manually" fallback; in open mode, shows the original free-text name + room code form (search doesn't make sense without real identities to search).
- `FindUserPanel.jsx` — debounced search against `GET /api/users/search`; clicking a result derives the deterministic `dm_...` room ID (see Decisions table) and joins immediately — no separate "start conversation" step.
- `ChatRoom.jsx` — message list (with a "Leave" button back to the join/search screen — a real gap caught during testing, not in the original plan), typing indicator, mounts `ComposeBox`.
- `ComposeBox.jsx` — text input, mic button (Web Speech API, same as legacy `webkitSpeechRecognition`), **and** a "Sign" button that opens `SignCompose.jsx` — all three just fill the same text buffer before Send, tagged with how it was composed (`typed`/`mic`/`sign`).
- `SignCompose.jsx` — consent modal, webcam capture (mirrored, both the `<video>` display and the captured frame — same left/right-consistency fix YogaPedia's pose-check needed), snapshot loop → recognized letters accumulate, Space/Backspace/Done controls (camera can't detect word boundaries itself).
- `MessageBubble.jsx` — renders text normally; "View as sign ▸" toggle triggers `/api/translate` + inline `.mp4` queue playback.
- Not built: a `VocabularyLibrary.jsx`/browsable sign reference, and a `ConversationList.jsx`/recent-chats view — both real, scoped-out ideas, see `ROADMAP.md`.

### 3.2 Backend — Express + Socket.io (as actually built)
- `GET /api/vocabulary` — the 151 labels, single source of truth.
- `POST /api/translate` — body `{ sentence }` → `chains/translate.js` (LangChain.js + Groq text model) → `{ tense, glossWords, segments, playSequence }`, constrained to the vocabulary; out-of-vocabulary words spelled out in plain JS, not by the LLM. Deterministic first-person pronoun substitution ("I" → "ME") and tense-marker insertion ("Before"/"Will"/"Now") also happen in plain code, not left to the LLM.
- `POST /api/check-letter` — body `{ image: base64 }` → `chains/checkLetter.js` (LangChain.js + Groq vision model) → `{ letter, confidence }`, candidates restricted to A-Z/0-9, with a `normalizeLetter()` exact/case-insensitive safety net — same reasoning as YogaPedia's `normalizePoseName()` (§9.6 of that plan), vision-LLMs don't always echo the candidate string verbatim.
- `GET /api/users/search` — Clerk-auth-gated (`requireAuth()` middleware, Bearer token), queries `clerkClient.users.getUserList({ query })` directly, excludes the searcher from their own results.
- `GET /api/config-status` — reports which of `groq`/`mongo`/`clerk` are configured.
- Socket.io: `join` (room + display name, token-verified via `io.use()` when Clerk is configured) / `message:send` / `message:receive` / `typing` / `presence`, all room-scoped.
- Not built: separate REST endpoints for conversations/contacts — the deterministic-room-ID trick (see Decisions table) made a formal conversations model unnecessary for this scope.

### 3.3 Data
- `backend/vocabulary.js` — the 151 real labels, ground-truthed from `assets/*.mp4` filenames (verified byte-for-byte against the actual copied files, not assumed).
- `frontend/public/signs/*.mp4` — the 151 videos (§0.1, reused as-is).
- MongoDB: one collection, `messages` — `{ id, room, senderName, userId, text, composedVia, createdAt }`. `userId` is the trusted Clerk ID when configured (null in open mode) — stored for a future conversations/contacts model, not yet used for access control (see `ROADMAP.md`). `composedVia` ("typed"|"mic"|"sign") is transparency/analytics only — it never changes how a message is *rendered*; a signed-then-recognized message is stored as plain text exactly like a typed one (see §4).

---

## 4. Chat integration — the core design decision

**Signing is an input modality. ASL playback is an output/render modality. Neither is a new message type, and the chat backend never needs to know how a message was composed.**

```
SENDING (ASL → English → wire message):
  User signs in front of camera on the compose screen
  → same Groq vision-LLM chain (2.5s snapshot cadence, A-Z/0-9 candidates)
  → confirmed letters accumulate in the compose text buffer
  → user hits Send → PLAIN ENGLISH TEXT is what actually transmits
  (same slot as the legacy mic-input button — a new input modality,
   not a new message type)

RECEIVING (English → ASL, rendered per message, on demand):
  Message arrives over Socket.io as plain text, same as any chat message
  → recipient's bubble has a "▶ view as sign" toggle
  → on tap: same text→gloss chain already built for compose-side reuse
  → auto-plays matching .mp4 clips inline in that bubble
```

Because the transmitted/stored message is always plain English text, the chat backend stays completely ordinary: normal history, search, multi-device sync, notifications all just work without any special-casing. No video message type, no server-side video storage or streaming pipeline to build — a deliberate simplification, not a missing feature.

### 4.1 Why not translate live video frame-by-frame instead?
Considered and rejected: streaming raw video and running per-frame recognition server-side (or on the recipient's device) would mean sending far more data, running many more LLM calls per message, and still landing on the same result — text. Recognizing at compose time, before Send, gets the same outcome with a fraction of the compute and no video infrastructure at all. This mirrors the "least moving parts" principle from the YogaPedia rewrite.

### 4.2 Tradeoffs, stated plainly
- **Composing by signing is slow** — spelling a sentence at ~2.5s/letter is fine for short messages ("Hi," "Thanks," "Call me"), rough for long ones. A visible "spelling..." indicator in the compose box avoids it feeling broken.
- **Concurrent signers consume Groq's free-tier ~30 req/min ceiling faster** than a single-user translator page — every person actively composing by camera burns that quota simultaneously. Fine for a small group, needs a paid tier at real scale.
- **Two people signing to each other, neither typing** — both directions run at once (A signs → text → B; B's toggle renders that text back as video). No architectural problem, just doubles LLM call volume for that conversation.
- **Recognition accuracy is a vision-LLM's zero-shot judgment**, not a verified classifier — same category of tradeoff already accepted in the underlying `MIGRATION_PLAN.md` (§6 there).

---

## 5. What gets deleted (not carried into this new repo)

- Django entirely: `A2SL/`, `manage.py`, `db.sqlite3`, Django template syntax, Django auth/ORM.
- `nltk` and the tokenize/POS-tag/lemmatize pipeline — replaced by one LLM call (§1).
- `templates/main.js`, `static/build.js`, the `deeplearn`/`deeplearn-knn-image-classifier` train-your-own-gesture classifier — replaced by the zero-shot vision-LLM check.
- The embedded OpenTok video-call iframe — not a working feature as shipped, dropped.
- `A2SL/abc.cpp` — unrelated scratch file.
- `templates/base2.html`, `templates/ppp.html`, `templates/animate.html` — confirmed dead.
- `templates/node_modules/`, duplicate `static/`/`assets/` trees, `.DS_Store` files — 2017-era npm tooling for the classifier being replaced anyway.

## 6. What gets reused as-is

- The 151 `.mp4` sign videos (provenance unverified, reuse risk accepted — §0.1).
- The vocabulary (words/letters/digits) and the letter-spelling-fallback *logic* (reimplemented in JS).
- The tense-insertion heuristic's *intent* (past → "Before" prefix, future → "Will," present-continuous → "Now") — folded into the LLM prompt's instructions rather than hand-coded POS-tag counting, same user-facing behavior.
- The Web Speech API mic-input approach (browser-native, ported to a React handler).
- The general page/navigation shape (Home / About / Contact), now alongside the new chat surface.

---

## 7. Known tradeoffs (repo-wide, in addition to §4.2)

- **Word-level camera recognition is out of scope**, not quietly deferred — real capability reduction from the (non-functional) README claim, but honest, and arguably still ahead of the legacy app's actual state (a from-scratch trainable classifier wasn't a real word recognizer either).
- **Losing the legacy app's train-your-own-gesture flexibility** in exchange for a fixed, reliable vocabulary — deliberate tradeoff, not an oversight.
- **Sign-video provenance is unresolved** (§0.1) — accepted risk, flagged prominently rather than hidden.
- **Free-tier Groq rate limits** apply across both translate and check-letter chains, sharper here than in a single-user tool because chat concurrency multiplies calls (§4.2).

---

## 8. Open items — resolved vs. still open

1. ~~Fingerspelling-only recognition scope~~ — shipped as-is for v1. Widening to static-handshape words is a real idea, tracked in `ROADMAP.md`, not decided against.
2. ~~Group chat vs. 1:1 only for v1~~ — **resolved: 1:1 only**, via the deterministic `dm_<idA>_<idB>` room-derivation trick (see §1's User discovery row) rather than a `conversations.participants` array. Group chat would need an actual participants list and is tracked in `ROADMAP.md` if wanted later.
3. **Sign-video asset provenance** (§0.1) — still open, risk knowingly carried forward. Revisit if/when this needs to survive real scrutiny (public launch, funding, enterprise deal).
4. **Vocabulary expansion strategy** — still open, see `ROADMAP.md`.

See `ROADMAP.md` for the full current backlog, including gaps found only after real testing (no session persistence across a page refresh, no server-side check that a `dm_` room's two IDs match who's actually connecting).

---

## 9. What was actually verified, and two real bugs it caught

Every piece below was exercised against the real service, not just reviewed — the same standard YogaPedia held itself to (§9.10 of that plan: "live-tested," not assumed).

- **Vocabulary** — the 151-item list in `backend/vocabulary.js` was diffed programmatically against the real filenames in `frontend/public/signs/`: exact match, 0 missing, 0 extra.
- **Translate chain** — live-tested against real Groq calls (past/future/present-continuous sentences, out-of-vocabulary fallback to fingerspelling). **Caught a real bug**: the first prompt version silently dropped the subject pronoun ("I went to college" → gloss with no "I"/"ME" at all) because the LLM treated it as grammatically implied. Fixed by explicitly instructing the prompt to always keep personal pronouns as their own token; re-verified correct afterward.
- **Check-letter chain** — live-tested against real Groq calls; confirmed it calls the API and returns correctly-shaped JSON. Could not verify true-positive letter recognition (no real fingerspelling photo was available in this environment) — worth trying against an actual webcam.
- **Chat plumbing** — proven with two real concurrent Socket.io clients joining the same room and exchanging a message end-to-end, including after a server restart.
- **MongoDB persistence** — live-tested against the real Atlas cluster, including a full server restart to confirm messages actually survive (not just that the insert call succeeded). **Caught a real bug**: `insertOne()` mutates its argument in place, so the Mongo-generated `_id` was leaking into the message object broadcast to clients — present in Mongo mode, absent in in-memory mode, an inconsistent shape depending on config. Fixed by inserting a shallow copy instead.
- **Clerk auth** — live-tested against the real Clerk app on both the Socket.io connection gate and the `/api/users/search` REST gate: confirmed both correctly reject a missing token and a garbage/invalid token. The positive path (a real signed-in user connecting successfully) could not be scripted — Clerk sign-in needs a human in a real browser — so it's verified to correctly *reject* bad auth, not yet observed to correctly *admit* good auth.
- **User search** — live-tested `clerkClient.users.getUserList()` against the real Clerk app; confirmed the actual response shape (`{ data, totalCount }`) matches what the code expects, and confirmed the `query` parameter is accepted without error.
- **Room-ID length** — a `dm_<idA>_<idB>` room built from two realistic Clerk user IDs comes out to ~78 characters; confirmed the `ROOM_NAME_PATTERN` regex (bumped from 40 to 100 chars) accepts it.
- **Security housekeeping** — installing `@clerk/clerk-react` surfaced the same real advisory (`GHSA-w24r-5266-9c3c`, an authorization-bypass issue) YogaPedia hit installing the same library; patched via non-breaking `npm audit fix` before writing any code against it.

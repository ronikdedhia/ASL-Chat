# Sign-Language-Converter → JS Rewrite: Migration Plan

> **Verdict: yes, this can be migrated to a JS + LLM stack, same playbook as the YogaPedia rewrite.** Framework choice: **LangChain.js** (`@langchain/core` + `@langchain/groq`) on a Node/Express backend, React + Vite frontend. This document is the plan for a **new, separate repo** — nothing in *this* repo is changed by writing it.

Rewrite goal, same as YogaPedia: kill the Python version-pinning surface (Django + NLTK + whatever the README's ML claims would have required), and replace ad-hoc/unverified recognition with a hosted, swappable vision-LLM. Optimize for "least moving parts," not raw framerate or offline capability.

---

## 0. Audit: what this app actually does vs. what the README claims

Before planning the migration, the actual code was read end-to-end (`A2SL/views.py`, `A2SL/urls.py`, `templates/*.html`, `static/build.js`, `templates/main.js`, `templates/package.json`) rather than trusting the README. Findings that change the plan materially:

| README claim | Reality found in code |
|---|---|
| "ASL Recognition — YOLOv5 and ResNet-50, 92% accuracy" | **No such code exists anywhere in the repo.** No `.h5`/`.pt`/`.onnx` model file, no `cv2`/`torch`/`tensorflow` import, no `requirements.txt` even listing them. This is aspirational README text, not implemented functionality. |
| (not mentioned) | The **real** recognition feature lives at `/index/` → `templates/index.html`, powered by `templates/main.js` / `static/build.js` — a **2017-era `deeplearn.js` + kNN image classifier** (`templates/package.json`: `deeplearn-knn-image-classifier@^0.3.0`, predecessor to TensorFlow.js). The user must **train their own gestures live in the browser** each session ("Train about 30 samples of your Start Gesture...") — there is no pretrained model, no fixed vocabulary, no server round-trip at all for this feature. |
| (not mentioned) | `index.html` also embeds a **hardcoded OpenTok video-call iframe** (`tokbox.com/embed/...&room=DEFAULT_ROOM`) — a demo embed ID and a shared default room, not a real per-session video call feature. |
| "Text-to-Sign Generation — NLTK preprocessing" | **This part is real and matches the README.** `A2SL/views.py`: `word_tokenize` → `nltk.pos_tag` → tense detection (past/present/future/continuous via POS tag counts) → stopword removal → `WordNetLemmatizer` → maps each surviving word to `assets/<word>.mp4` via `finders.find()`, falling back to spelling the word letter-by-letter if no matching video exists. Gated behind `@login_required`. |
| "200+ pre-rendered sign videos" | **151** `.mp4` files in `assets/` — words (`Age`, `Busy`, `College`...), letters `A`–`Z`, digits `0`–`9`. Close enough, not exactly 200+. |

**Practical consequence:** there is effectively no Python ML to port. The two things worth rewriting are (1) the NLTK text pipeline, which is genuinely useful and works, and (2) the trainable kNN gesture demo, which is a novelty, not a working recognizer — the natural move (per the YogaPedia precedent of swapping a custom/self-trained model for a hosted vision-LLM) is to replace it with a **real zero-shot gesture classifier**, not port `deeplearn.js` as-is.

**Also found, not carried forward regardless of migration:**
- `A2SL/abc.cpp` — a competitive-programming double-hashing snippet, no relation to this app at all. Leftover scratch file.
- `templates/base2.html`, `templates/ppp.html`, `templates/animate.html` — grepped across all templates, nothing `{% extends %}` or includes any of them. Dead.
- `templates/node_modules/` (68M, 10,583 files) committed straight into git, `static/` and `assets/` holding near-duplicate file sets, `db.sqlite3`, no `.gitignore` anywhere in the repo. (Full breakdown already given earlier in this session — root cause of the ~196M repo size.)

---

## 1. Decisions (proposed, mirrors YogaPedia where the same tradeoff applies)

| Question | Decision |
|---|---|
| Framework | **LangChain.js** on Node/Express — same reasoning as YogaPedia: avoids reintroducing pip/venv/version-pinning by keeping the whole backend in one language. |
| Text→Sign pipeline (NLTK) | Replace `word_tokenize`/`pos_tag`/`WordNetLemmatizer`/tense-heuristics with **one Groq LLM call** (`llama-3.3-70b-versatile` or similar text model) that takes the sentence + the fixed 151-item vocabulary list and returns structured JSON: `{ tense, glossWords: string[] }`, constrained to only pick from the given vocabulary (same "don't hallucinate outside the candidate list" pattern used in YogaPedia's recommender). Falls back to letter-spelling in **plain code**, not the LLM, for any word the model didn't map to the vocabulary — deterministic, same as the original. |
| Gesture recognition (`deeplearn.js`/kNN train-your-own) | Replace with a **hosted vision-LLM, zero-shot**, same pattern as YogaPedia's pose-check: webcam snapshot every ~2.5s → Groq vision model (`meta-llama/llama-4-scout-17b-16e-instruct`) → classify against a **fixed candidate list**, not free-form training. No more "train 30 samples before you can use it." |
| Recognition vocabulary scope | **Fingerspelling only at first (A–Z, 0–9)** — a snapshot-cadence, zero-shot vision-LLM can plausibly recognize a static handshape (a letter) but **cannot** reliably recognize a dynamic, motion-based word sign from a single frame every 2.5s. Recommending this scope cut explicitly, mirroring YogaPedia's "restrict to what actually works reliably" call (§9.5 of that plan) rather than promising all 151 words are camera-recognizable. |
| Video-call feature (OpenTok iframe) | **Dropped.** Hardcoded demo embed ID / shared default room, unrelated to the core text↔sign value proposition, not a real feature as shipped. Same treatment as YogaPedia dropping the unlicensed `static/GIF/` assets — remove rather than carry forward something that was never really working. |
| Auth | **Optional Clerk**, same library as YogaPedia if personalization/history is wanted later; but note this app's current auth usage is thin — it only gates the `/animation/` page, no per-user data is stored. A simpler open-mode-only build (no login at all) is a legitimate lighter-weight alternative — **this is a real open decision, flagging for you rather than assuming**, see §7. |
| Sign-video assets (151 `.mp4`s) | **Reused as-is** — but **license/attribution status is unconfirmed** (no `LICENSE`/`ATTRIBUTIONS` file found near `assets/*.mp4`, unlike the Wikimedia photos in YogaPedia which were explicitly vetted). Needs a check before shipping in a new repo — see open items. |
| Persistence | **None needed initially.** Unlike YogaPedia (which added weekly schedules/session logs), this app has no natural per-user state beyond auth itself — text→sign and gesture-check are both one-shot, stateless operations. Skip MongoDB entirely unless/until a real feature needs it (e.g. saving phrase history). |

---

## 2. Target architecture

```
┌───────────────────────────────────────────────────────────────┐
│  Browser (React + Vite) — frontend/                            │
│                                                                  │
│  Text → Sign:                                                   │
│   sentence input (+ optional Web Speech API mic, same as         │
│   original webkitSpeechRecognition in animation.html)            │
│   → POST /api/translate → ordered .mp4 clip sequence             │
│   → auto-playing <video> queue (same UX as original play())      │
│                                                                  │
│  Sign → Text (fingerspelling):                                   │
│   consent modal → getUserMedia() → snapshot every 2.5s            │
│   → POST /api/check-letter → recognized letter + confidence       │
└───────────────────────────┬──────────────────────────────────────┘
                            │ HTTPS
┌───────────────────────────▼──────────────────────────────────────┐
│  Express proxy — backend/                                        │
│  — holds GROQ_API_KEY server-side only                            │
│  — GET  /api/vocabulary    → the 151 known sign labels             │
│  — POST /api/translate     → LangChain.js text chain: sentence     │
│                              + vocabulary → tense + gloss word list │
│  — POST /api/check-letter  → LangChain.js vision chain: frame       │
│                              → recognized letter (A-Z, 0-9)         │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                ┌───────────┼──────────────┐
         ┌──────▼──────┐           ┌───────▼─────┐
         │  Groq API   │           │  Groq API   │
         │ text model  │           │vision model │
         │ (translate) │           │(check-letter)│
         └─────────────┘           └─────────────┘

Static assets served directly (no ML at runtime):
- backend/vocabulary.js   — 151 known words/letters/digits, ground-truthed
                            from the actual assets/*.mp4 filenames, not
                            assumed from the README's "200+" claim
- public/signs/*.mp4      — the 151 pre-rendered sign videos, reused as-is
                            (pending license check, see open items)
```

No Python at runtime. No committed `node_modules`. No client-trained classifier. No hardcoded third-party video-call embed.

---

## 3. Components

### 3.1 Frontend — React + Vite
- `TranslatePage.jsx` — text input + mic button (Web Speech API `SpeechRecognition`, replaces `webkitSpeechRecognition` 1:1, same browser API) → calls `/api/translate` → renders the gloss word list + auto-plays the matching `.mp4` sequence, highlighting the active word (same interaction as the original `play()`/`videoPlay()` logic in `animation.html`, ported to React state instead of raw DOM manipulation).
- `FingerspellCheck.jsx` — consent modal → webcam capture → snapshot loop → recognized-letter result card. Structurally the same component shape as YogaPedia's `PoseCheck.jsx`.
- `HomePage.jsx` / `AboutPage.jsx` / `ContactPage.jsx` — direct ports of `home.html`/`about.html`/`contact.html`, no logic in these, just markup.

### 3.2 Backend — Express proxy
- `GET /api/vocabulary` — the 151 labels, single source of truth (mirrors YogaPedia's `GET /api/asanas` pattern — frontend fetches instead of duplicating the list).
- `POST /api/translate` — body `{ sentence }` → `chains/translate.js` (LangChain.js + Groq text model) → `{ tense, words: string[] }`, constrained to the vocabulary; words not in the vocabulary are spelled out letter-by-letter in **plain JS**, not by the LLM (deterministic fallback, same as the original Django view).
- `POST /api/check-letter` — body `{ image: base64 }` → `chains/checkLetter.js` (LangChain.js + Groq vision model) → `{ letter, confidence }`, candidate list restricted to A-Z/0-9. Apply the same `normalizePoseName()`-style exact/case-insensitive/substring-match safety net YogaPedia needed (§9.6 of that plan) — vision-LLMs don't always echo the candidate string verbatim, worth guarding here too rather than assuming it won't happen.

### 3.3 Data
- `backend/vocabulary.js` — the 151 real labels, derived directly from `assets/*.mp4` filenames (ground-truthed the same way YogaPedia checked `labels.npy` instead of trusting the README's "26 asanas" claim).
- `public/signs/*.mp4` — the existing 151 videos, copied over as-is. Provenance is untraceable (see §7 item 1) — reused with that risk knowingly accepted, not because it was cleared.

---

## 4. What gets deleted (not carried into the new repo)

- Django entirely: `A2SL/`, `manage.py`, `db.sqlite3`, `templates/*.html` (Django template syntax), Django auth/ORM.
- `nltk` and the whole tokenize/POS-tag/lemmatize pipeline — replaced by one LLM call (§1).
- `templates/main.js`, `static/build.js`, `templates/package.json`'s `deeplearn`/`deeplearn-knn-image-classifier` deps — the train-your-own-gesture kNN classifier, replaced by the zero-shot vision-LLM check.
- The embedded OpenTok video-call iframe (hardcoded demo room/embed ID) — not a working feature as shipped, dropped rather than ported.
- `A2SL/abc.cpp` — unrelated scratch file, no connection to the app.
- `templates/base2.html`, `templates/ppp.html`, `templates/animate.html` — confirmed dead (nothing references them).
- `templates/node_modules/`, duplicate `static/`/`assets/` trees, `.DS_Store` files — this was 2017-era npm tooling (`browserify`/`budo`/`babelify`) for the kNN classifier being replaced anyway; none of it is needed in a Vite project.

## 5. What gets reused as-is

- The 151 `.mp4` sign videos (provenance unverified, reuse risk accepted — §7 item 1).
- The vocabulary itself (words/letters/digits) and the letter-spelling-fallback *logic* (reimplemented in JS, same behavior).
- The tense-insertion heuristic's *intent* ("Before" prefix for past, "Will" for future, "Now" for present-continuous) — foldable into the LLM prompt's instructions rather than hand-coded POS-tag counting, but the same user-facing behavior.
- The Web Speech API mic-input approach (browser-native, no rewrite needed, just a React event handler instead of inline `onclick`).
- Overall page structure/navigation (Home / About / Contact / Translate).

---

## 6. Known tradeoffs (explicit, per the YogaPedia plan's own standard of not hiding these)

- **Word-level camera recognition is out of scope**, not merely deferred quietly — a single snapshot every 2.5s cannot capture a dynamic/motion sign the way it can capture a static fingerspelled letter. This is a real capability **regression** from the (non-functional) README claim, but an **honest one**, and arguably still ahead of the old repo's actual state (a from-scratch trainable classifier isn't a real word recognizer either).
- **Losing the train-your-own-gesture flexibility.** The old `deeplearn.js` classifier could learn *any* gesture a user showed it (novelty value); a fixed-vocabulary vision-LLM cannot do that. Trading personalization for reliability, deliberately.
- **Translation correctness depends on the LLM's tense/grammar judgment**, not a verified linguistic algorithm — same category of tradeoff YogaPedia accepted for its plan-drafting (§7 of that plan): not clinically/linguistically validated, good enough for a demo-quality translator.
- **Free-tier Groq rate limits apply** (~30 req/min per model), same constraint as YogaPedia — fine for single-user use, would need a paid tier for concurrent multi-user traffic.

---

## 7. Open items — needs your input before/while building

1. ~~`.mp4` license status is unknown.~~ **Resolved: reusing as-is, risk accepted.** Investigated further — GitHub code search found this exact 151-file list (same order, same odd entries like `Glitter.mp4`/`Does Not.mp4`) duplicated verbatim across at least 7 unrelated student repos, with no attribution anywhere in the chain. Origin is untraceable, not just undocumented. **Decision: reuse the existing 151 clips as-is anyway** — carrying the same unresolved provenance risk forward into the new repo, accepted knowingly rather than by omission. Also checked WLASL (~2,000-word open ASL corpus) as a replacement/expansion source: **ruled out** — licensed under C-UDA (academic/research use only, no commercial use), and even that license only covers WLASL's own index — the underlying videos are scraped from ~20 separate third-party sites (YouTube channels, ASLU, ASL-LEX, SigningSavvy, etc.), each retaining its own copyright WLASL never cleared. Not a viable swap-in.
2. **Auth: Clerk vs. no login at all.** Originally an open question when this was just a translator tool (login gated one page, stored no per-user data). **Superseded if the chat-app direction (see §8) is pursued** — a chat feature needs real identity/contacts/message history, making Clerk +Mongo effectively required rather than optional. Still open if chat is *not* built.
3. **Fingerspelling-only scope for camera check** — confirm this cut is acceptable, since it's a real reduction from what the README (inaccurately) advertised.

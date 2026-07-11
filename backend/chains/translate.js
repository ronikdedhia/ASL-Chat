const { HumanMessage } = require('@langchain/core/messages');
const { textModel } = require('../llm');
const { VOCABULARY, FINGERSPELL_CANDIDATES } = require('../vocabulary');

// Case-insensitive lookup map, built once — vocabulary.js is the exact-casing source of
// truth (e.g. "ME" not "Me", "Do Not" not "do not").
const VOCAB_BY_LOWER = new Map(VOCABULARY.map((w) => [w.toLowerCase(), w]));
const FINGERSPELL_SET = new Set(FINGERSPELL_CANDIDATES);

function buildPrompt(sentence) {
  return `You are converting an English sentence into American Sign Language gloss order — the sequence of concepts a signer would actually sign, not a word-for-word translation.

Rules:
- Detect the overall tense of the sentence: "past", "present", "future", "present_continuous", or "neutral" if tense doesn't clearly apply.
- Drop English filler/function words that ASL grammar doesn't sign directly (articles like "a"/"the", most forms of "to be", auxiliary "do/does/did" used only as a question/negation helper, etc.) — but KEEP "Do Not" and "Does Not" as single combined tokens if the sentence expresses negation, since those exact two-word signs exist.
- ALWAYS keep personal pronouns (I, you, he, she, it, we, they) as their own explicit token, even when the verb conjugation makes the subject implied in English grammar — never drop a pronoun as "understood from context."
- Keep the remaining content words in the order they would be signed, lemmatized to their base/dictionary form (e.g. "running" -> "Run", "studies" -> "Study").
- If the sentence is past tense, the gloss does not need an explicit past-tense marker word — the app adds a "Before" marker automatically afterward. Same for future ("Will") and present-continuous ("Now") — do not add those words yourself, just report the tense correctly.
- Every word you output MUST be a single word or, for a fixed two-word sign, one of exactly "Do Not", "Does Not", or "Thank You" — never output any other multi-word phrase as one token.
- Do not invent synonyms for concepts — output the word as the user would recognize it (e.g. keep "Computer" as "Computer", don't substitute "Machine").

Sentence: "${sentence}"

Respond with ONLY a JSON object, no other text, matching exactly this shape:
{
  "tense": "past" | "present" | "future" | "present_continuous" | "neutral",
  "words": ["<ordered gloss tokens as plain strings>"]
}`;
}

// Deterministic, not LLM-judged — same "no exact-version dependency" spirit as the rest of
// this migration, but this particular substitution (first-person "I" signs as "Me") and the
// tense-marker insertion are simple enough to be exact rules rather than model guesses.
function applyGrammarRules(words, tense) {
  const withPronounFix = words.map((w) => (w.toLowerCase() === 'i' ? 'ME' : w));

  if (tense === 'past') return ['Before', ...withPronounFix];
  if (tense === 'future' && !withPronounFix.some((w) => w.toLowerCase() === 'will')) {
    return ['Will', ...withPronounFix];
  }
  if (tense === 'present_continuous') return ['Now', ...withPronounFix];
  return withPronounFix;
}

// Splits a word not in the vocabulary into its fingerspellable letters/digits, dropping any
// character with no corresponding sign (e.g. punctuation) — same fallback behavior as the
// legacy Django view's per-character loop, just reimplemented in JS.
function fingerspell(word) {
  return word
    .toUpperCase()
    .split('')
    .filter((ch) => FINGERSPELL_SET.has(ch));
}

// Resolves each gloss word to either a direct sign-video label or a fingerspelled sequence —
// this is the deterministic vocabulary lookup + letter-fallback step, done in plain code,
// never left to the LLM (mirrors the original Django `finders.find(word + ".mp4")` check).
function resolveToSegments(words) {
  return words.map((word) => {
    const exact = VOCAB_BY_LOWER.get(word.toLowerCase());
    if (exact) return { kind: 'sign', word, label: exact };
    return { kind: 'fingerspell', word, letters: fingerspell(word) };
  });
}

function flattenPlaySequence(segments) {
  const sequence = [];
  for (const seg of segments) {
    if (seg.kind === 'sign') {
      sequence.push({ kind: 'sign', label: seg.label, word: seg.word });
    } else {
      for (const letter of seg.letters) {
        sequence.push({ kind: 'letter', label: letter, word: seg.word });
      }
    }
  }
  return sequence;
}

async function translateToSign(sentence) {
  const message = new HumanMessage({ content: buildPrompt(sentence) });
  const result = await textModel.invoke([message], { response_format: { type: 'json_object' } });
  const parsed = JSON.parse(result.content);

  const tense = typeof parsed.tense === 'string' ? parsed.tense : 'neutral';
  const rawWords = Array.isArray(parsed.words) ? parsed.words.filter((w) => typeof w === 'string' && w.trim()) : [];

  const glossWords = applyGrammarRules(rawWords, tense);
  const segments = resolveToSegments(glossWords);
  const playSequence = flattenPlaySequence(segments);

  return { tense, glossWords, segments, playSequence };
}

module.exports = { translateToSign, resolveToSegments, fingerspell };

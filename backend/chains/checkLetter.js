const { HumanMessage } = require('@langchain/core/messages');
const { visionModel } = require('../llm');

// Same reasoning as YogaPedia's checkPose.js: NOT using ChatGroq's withStructuredOutput()
// here — verified empirically in that project that it routes through Groq's server-side
// tool-call schema validation, which hard-fails (400) on minor type mismatches with no
// partial result. response_format: json_object + manual JSON.parse is the proven-reliable
// pattern instead.
function buildPrompt(candidates) {
  return `You are reading a single snapshot of a person fingerspelling one letter or digit in American Sign Language, captured from a front-facing mirror-style webcam view (describe what you see exactly as a mirror would show it — do not flip left/right).

Known candidates this app supports: ${candidates.join(', ')}.

Look at the handshape in the image and respond with ONLY a JSON object, no other text, matching exactly this shape:
{
  "letter": "<one of the known candidates above, exactly as written, or \\"Unrecognized\\" if no clear static handshape matching one of them is visible>",
  "confidence": <integer 0-100>
}

If no hand or no clear static handshape is visible in frame, set "letter" to "Unrecognized" and "confidence" to 0. Only pick a candidate you are reasonably confident about — a static handshape that doesn't match ASL fingerspelling should also be "Unrecognized".`;
}

// The model doesn't always echo the candidate string verbatim even when told to (e.g. it
// might say "the letter A" or lowercase "a") — normalize back to the exact known string,
// same normalizePoseName() safety net YogaPedia needed for its vision chain, so downstream
// code (message compose buffer) never silently drifts to an unknown label.
function normalizeLetter(raw, candidates) {
  if (!raw || raw === 'Unrecognized') return 'Unrecognized';
  const exact = candidates.find((c) => c === raw);
  if (exact) return exact;

  const cleaned = String(raw).trim().replace(/^(the\s+)?(letter|digit|number)\s+/i, '').replace(/["'.]/g, '');
  const upper = cleaned.toUpperCase();
  const caseInsensitive = candidates.find((c) => c.toUpperCase() === upper);
  if (caseInsensitive) return caseInsensitive;

  return 'Unrecognized'; // couldn't confidently map it back — safer than a drifted label
}

async function checkLetter(imageDataUrl, candidates) {
  const message = new HumanMessage({
    content: [
      { type: 'text', text: buildPrompt(candidates) },
      { type: 'image_url', image_url: { url: imageDataUrl } },
    ],
  });

  const result = await visionModel.invoke([message], { response_format: { type: 'json_object' } });
  const parsed = JSON.parse(result.content);
  parsed.letter = normalizeLetter(parsed.letter, candidates);
  return parsed;
}

module.exports = { checkLetter, normalizeLetter };

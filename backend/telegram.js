const hasTelegramConfig = Boolean(process.env.TELEGRAM_ACCESS_TOKEN && process.env.TELEGRAM_CHANNEL_ID);
if (!hasTelegramConfig) {
  console.warn('TELEGRAM_ACCESS_TOKEN/TELEGRAM_CHANNEL_ID not set — daily ASL lesson broadcasts are disabled.');
}

// Text-only for now — actually attaching the sign-video clip would need either a multipart
// file upload of the local .mp4 (frontend/public/signs/, a different process/directory than
// this backend) or a publicly reachable URL (which localhost isn't). Not built; the message
// links back to the app instead. Revisit once the app has a real public URL to point at.
async function sendTelegramMessage(text, chatId) {
  if (!hasTelegramConfig) throw new Error('Telegram is not configured.');
  const targetChatId = chatId || process.env.TELEGRAM_CHANNEL_ID;
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_ACCESS_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: targetChatId, text, parse_mode: 'HTML' }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram sendMessage failed (${res.status}): ${body}`);
  }
  return res.json();
}

function formatLessonMessage(lesson) {
  const wordList = lesson.words.join(', ');
  return (
    `📖 <b>ASL Lesson: ${lesson.title}</b>\n\n` +
    `${lesson.description}\n\n` +
    `Today's signs: <b>${wordList}</b>\n\n` +
    `Open ASL-Chat to watch each one as a video.`
  );
}

module.exports = { hasTelegramConfig, sendTelegramMessage, formatLessonMessage };

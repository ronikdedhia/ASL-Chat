const { hasTelegramConfig, sendTelegramMessage, formatLessonMessage } = require('./telegram');
const { getTodaysLesson } = require('./lessons');

// Same "check every 5 minutes against a configured HH:MM" pattern YogaPedia-v2 uses for its
// weekly summary email — no cron dependency, just a plain interval. In-memory "already sent
// today" tracking is intentionally not persisted: missing one send across a server restart
// is low-stakes for a daily lesson digest, not worth a database write for.
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
let lastSentDate = null;

function startLessonScheduler() {
  if (!hasTelegramConfig || !process.env.TELEGRAM_DAILY_LESSON_TIME) return;

  setInterval(async () => {
    const now = new Date();
    const currentHHMM = now.toTimeString().slice(0, 5);
    const today = now.toISOString().slice(0, 10);
    if (currentHHMM !== process.env.TELEGRAM_DAILY_LESSON_TIME || lastSentDate === today) return;

    try {
      const lesson = getTodaysLesson();
      await sendTelegramMessage(formatLessonMessage(lesson));
      lastSentDate = today;
      console.log(`Sent daily ASL lesson to Telegram: ${lesson.title}`);
    } catch (err) {
      console.error('Failed to send daily ASL lesson to Telegram:', err);
    }
  }, CHECK_INTERVAL_MS);

  console.log(`Daily ASL lesson scheduler active — sends at ${process.env.TELEGRAM_DAILY_LESSON_TIME} daily.`);
}

module.exports = { startLessonScheduler };

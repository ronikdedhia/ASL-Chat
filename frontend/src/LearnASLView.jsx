import { useEffect, useState } from 'react';
import { getLessons, sendLessonToTelegram } from './api';

const PROGRESS_KEY = 'aslchat.completedLessons';

function getCompletedLessons() {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || [];
  } catch {
    return [];
  }
}

function markLessonComplete(lessonId) {
  const completed = new Set(getCompletedLessons());
  completed.add(lessonId);
  localStorage.setItem(PROGRESS_KEY, JSON.stringify([...completed]));
}

export default function LearnASLView({ onClose, getAuthToken }) {
  const [lessons, setLessons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeLesson, setActiveLesson] = useState(null);
  const [wordIndex, setWordIndex] = useState(0);
  const [completed, setCompleted] = useState(() => getCompletedLessons());
  const [telegramStatus, setTelegramStatus] = useState(null);

  useEffect(() => {
    getLessons()
      .then(setLessons)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key !== 'Escape') return;
      if (activeLesson) setActiveLesson(null);
      else onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [activeLesson, onClose]);

  function handleOpenLesson(lesson) {
    setActiveLesson(lesson);
    setWordIndex(0);
  }

  function handleNext() {
    if (wordIndex + 1 < activeLesson.words.length) {
      setWordIndex((i) => i + 1);
    } else {
      markLessonComplete(activeLesson.id);
      setCompleted(getCompletedLessons());
      setActiveLesson(null);
    }
  }

  function handlePrevious() {
    setWordIndex((i) => Math.max(0, i - 1));
  }

  async function handleShareToTelegram(lesson) {
    setTelegramStatus('sending');
    try {
      const token = await getAuthToken();
      await sendLessonToTelegram(lesson.id, token);
      setTelegramStatus('sent');
    } catch (err) {
      setTelegramStatus(err.message || 'failed');
    } finally {
      setTimeout(() => setTelegramStatus(null), 2500);
    }
  }

  return (
    <div className="vocab-overlay" role="dialog" aria-label="Learn ASL">
      <div className="vocab-panel">
        {!activeLesson ? (
          <>
            <div className="vocab-header">
              <h2>Learn ASL</h2>
              <button type="button" className="vocab-close-btn" onClick={onClose}>✕</button>
            </div>
            <p className="join-subtitle">A short, beginner-friendly curriculum — each lesson steps through its signs one at a time.</p>

            {loading && <p className="find-user-status">Loading…</p>}
            {error && <p className="join-error">{error}</p>}

            <div className="lesson-list">
              {lessons.map((lesson) => (
                <button key={lesson.id} type="button" className="lesson-card" onClick={() => handleOpenLesson(lesson)}>
                  <div className="lesson-card-title">
                    {completed.includes(lesson.id) && <span className="lesson-complete-check">✓</span>}
                    {lesson.title}
                  </div>
                  <p className="lesson-card-description">{lesson.description}</p>
                  <p className="lesson-card-count">{lesson.words.length} signs</p>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="vocab-header">
              <h2>{activeLesson.title}</h2>
              <button type="button" className="vocab-close-btn" onClick={() => setActiveLesson(null)}>✕</button>
            </div>
            <p className="join-subtitle">
              Sign {wordIndex + 1} of {activeLesson.words.length}
            </p>
            <video
              key={activeLesson.words[wordIndex]}
              className="sign-video lesson-video"
              src={`/signs/${encodeURIComponent(activeLesson.words[wordIndex])}.mp4`}
              autoPlay
              loop
              muted
              playsInline
            />
            <p className="sign-caption">{activeLesson.words[wordIndex]}</p>
            <div className="lesson-nav">
              <button type="button" className="lesson-nav-btn secondary" onClick={handlePrevious} disabled={wordIndex === 0}>
                ← Previous
              </button>
              <button type="button" className="lesson-nav-btn" onClick={handleNext}>
                {wordIndex + 1 < activeLesson.words.length ? 'Next →' : 'Finish ✓'}
              </button>
            </div>

            {getAuthToken && (
              <div className="lesson-telegram">
                <button type="button" className="chat-header-link-btn" onClick={() => handleShareToTelegram(activeLesson)} disabled={telegramStatus === 'sending'}>
                  {telegramStatus === 'sending' ? 'Sending…' : telegramStatus === 'sent' ? 'Sent to Telegram ✓' : '📤 Share this lesson to Telegram'}
                </button>
                {telegramStatus && telegramStatus !== 'sending' && telegramStatus !== 'sent' && (
                  <p className="join-error">{telegramStatus}</p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// A beginner ASL curriculum built entirely from words already ground-truthed in
// vocabulary.js — every word listed here has a real sign video, so a lesson never has to
// silently fall back to fingerspelling mid-lesson the way a free-form sentence might.
const LESSONS = [
  {
    id: 'alphabet-a-m',
    title: 'The Alphabet: A–M',
    description: 'The first half of ASL fingerspelling — the foundation for spelling any word without a dedicated sign.',
    words: 'ABCDEFGHIJKLM'.split(''),
  },
  {
    id: 'alphabet-n-z',
    title: 'The Alphabet: N–Z',
    description: 'The second half of the fingerspelling alphabet.',
    words: 'NOPQRSTUVWXYZ'.split(''),
  },
  {
    id: 'numbers',
    title: 'Numbers 0–9',
    description: 'The ten digit signs — used constantly in real conversation for ages, times, and counts.',
    words: '0123456789'.split(''),
  },
  {
    id: 'greetings',
    title: 'Greetings & Introductions',
    description: 'The handful of signs that cover almost every conversation opener.',
    words: ['Hello', 'Bye', 'Name', 'ME', 'You', 'My', 'Thank You', 'Welcome', 'How'],
  },
  {
    id: 'everyday',
    title: 'Everyday Words',
    description: 'Common signs for daily life — home, work, and routine activities.',
    words: ['Home', 'Work', 'Help', 'Time', 'Now', 'Go', 'Come', 'Eat', 'Walk', 'Good', 'Happy'],
  },
];

function getLessonById(id) {
  return LESSONS.find((l) => l.id === id) || null;
}

// Deterministic, no stored state needed — same "day-of-year modulo count" rotation
// YogaPedia-v2 uses for its schedule day-picker, applied here to pick one lesson per day.
function getTodaysLesson() {
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  return LESSONS[dayOfYear % LESSONS.length];
}

module.exports = { LESSONS, getLessonById, getTodaysLesson };

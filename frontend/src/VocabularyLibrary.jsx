import { useEffect, useMemo, useState } from 'react';
import { getVocabulary } from './api';

// The backend's /api/vocabulary is a flat, sorted list — every entry here has a real sign
// video (that's the whole definition of this list, ground-truthed from frontend/public/signs
// filenames, see backend/vocabulary.js). Anything typed that ISN'T on this list gets spelled
// out letter-by-letter automatically — this page exists so that's not a surprise discovered
// only by tapping "View as sign" on a sent message.
function categorize(items) {
  const letters = [];
  const digits = [];
  const words = [];
  for (const item of items) {
    if (item.length === 1 && /[A-Z]/.test(item)) letters.push(item);
    else if (item.length === 1 && /[0-9]/.test(item)) digits.push(item);
    else words.push(item);
  }
  return { letters, digits, words };
}

export default function VocabularyLibrary({ onClose }) {
  const [vocabulary, setVocabulary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [previewLabel, setPreviewLabel] = useState(null);

  useEffect(() => {
    getVocabulary()
      .then(setVocabulary)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key !== 'Escape') return;
      // First Escape closes the video preview if one's open; a second closes the whole panel
      // — matches how a nested modal should behave rather than skipping straight past it.
      if (previewLabel) setPreviewLabel(null);
      else onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [previewLabel, onClose]);

  const { letters, digits, words } = useMemo(() => categorize(vocabulary), [vocabulary]);

  const filteredWords = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return words;
    return words.filter((w) => w.toLowerCase().includes(q));
  }, [words, query]);

  return (
    <div className="vocab-overlay" role="dialog" aria-label="Vocabulary library">
      <div className="vocab-panel">
        <div className="vocab-header">
          <h2>Vocabulary Library</h2>
          <button type="button" className="vocab-close-btn" onClick={onClose}>✕</button>
        </div>
        <p className="join-subtitle">
          These {vocabulary.length} words, letters, and digits have a real sign video. Anything else you type is automatically
          fingerspelled out, letter by letter.
        </p>

        {loading && <p className="find-user-status">Loading…</p>}
        {error && <p className="join-error">{error}</p>}

        {!loading && !error && (
          <>
            <section className="vocab-section">
              <h3 className="recent-conversations-title">Letters ({letters.length})</h3>
              <div className="vocab-chip-grid">
                {letters.map((l) => (
                  <button key={l} type="button" className="vocab-chip" onClick={() => setPreviewLabel(l)}>{l}</button>
                ))}
              </div>
            </section>

            <section className="vocab-section">
              <h3 className="recent-conversations-title">Digits ({digits.length})</h3>
              <div className="vocab-chip-grid">
                {digits.map((d) => (
                  <button key={d} type="button" className="vocab-chip" onClick={() => setPreviewLabel(d)}>{d}</button>
                ))}
              </div>
            </section>

            <section className="vocab-section">
              <h3 className="recent-conversations-title">Words ({words.length})</h3>
              <input
                className="vocab-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter words…"
              />
              <div className="vocab-chip-grid">
                {filteredWords.map((w) => (
                  <button key={w} type="button" className="vocab-chip" onClick={() => setPreviewLabel(w)}>{w}</button>
                ))}
              </div>
            </section>
          </>
        )}

        {previewLabel && (
          <div className="vocab-preview" onClick={() => setPreviewLabel(null)}>
            <video
              key={previewLabel}
              className="sign-video"
              src={`/signs/${encodeURIComponent(previewLabel)}.mp4`}
              autoPlay
              loop
              muted
              playsInline
              onClick={(e) => e.stopPropagation()}
            />
            <p className="sign-caption">{previewLabel} — tap anywhere to close</p>
          </div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { translate } from './api';

export default function MessageBubble({ message, isOwn }) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [playSequence, setPlaySequence] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const videoRef = useRef(null);

  async function handleToggleSign() {
    if (expanded) {
      setExpanded(false);
      setCurrentIndex(-1);
      return;
    }
    setExpanded(true);
    if (playSequence) {
      setCurrentIndex(0);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await translate(message.text);
      if (result.playSequence.length === 0) {
        setError('Nothing in this message could be translated to sign.');
      } else {
        setPlaySequence(result.playSequence);
        setCurrentIndex(0);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (currentIndex < 0 || !playSequence || !videoRef.current) return;
    const el = videoRef.current;
    el.src = `/signs/${encodeURIComponent(playSequence[currentIndex].label)}.mp4`;
    el.play().catch(() => {});
  }, [currentIndex, playSequence]);

  function handleEnded() {
    if (!playSequence) return;
    setCurrentIndex((i) => (i + 1 < playSequence.length ? i + 1 : -1));
  }

  const activeSegment = playSequence && currentIndex >= 0 ? playSequence[currentIndex] : null;

  return (
    <div className={`message-bubble ${isOwn ? 'own' : 'other'}`}>
      <div className="message-meta">
        <span className="message-sender">{message.senderName}</span>
        {message.composedVia === 'sign' && <span className="composed-via-badge" title="Composed by signing">signed</span>}
        {message.composedVia === 'mic' && <span className="composed-via-badge" title="Composed by voice">voice</span>}
      </div>
      <p className="message-text">{message.text}</p>
      <button className="view-as-sign-btn" onClick={handleToggleSign} disabled={loading}>
        {loading ? 'Translating…' : expanded ? 'Hide sign video' : 'View as sign ▸'}
      </button>

      {expanded && (
        <div className="sign-player">
          {error && <p className="sign-error">{error}</p>}
          {playSequence && (
            <>
              <video ref={videoRef} className="sign-video" muted autoPlay playsInline onEnded={handleEnded} />
              <p className="sign-caption">
                {activeSegment ? (
                  <>
                    <strong>{activeSegment.word}</strong> — {activeSegment.kind === 'letter' ? `fingerspelled "${activeSegment.label}"` : 'signed'}
                  </>
                ) : (
                  'Done'
                )}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

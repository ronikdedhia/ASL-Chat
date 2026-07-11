import { useEffect, useRef, useState } from 'react';
import { translate, textToSpeech } from './api';

export default function MessageBubble({ message, isOwn, ttsEnabled }) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [playSequence, setPlaySequence] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [playbackRate, setPlaybackRate] = useState(1);
  const videoRef = useRef(null);

  const [audioUrl, setAudioUrl] = useState(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState(null);
  const audioRef = useRef(null);

  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(message.text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const formattedTime = message.createdAt
    ? new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '';

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
    el.playbackRate = playbackRate; // re-applied per segment — a fresh src can reset this in some browsers
    el.play().catch(() => {});
  }, [currentIndex, playSequence, playbackRate]);

  function handleEnded() {
    if (!playSequence) return;
    setCurrentIndex((i) => (i + 1 < playSequence.length ? i + 1 : -1));
  }

  function handleSpeedChange(rate) {
    setPlaybackRate(rate);
    if (videoRef.current) videoRef.current.playbackRate = rate; // applies immediately to whatever's already playing
  }

  // ElevenLabs TTS, used only for reading messages aloud — never for mic/dictation input,
  // which stays on the browser's built-in Web Speech API. Fetched once per message and
  // cached (same pattern as playSequence above) so replaying doesn't re-hit the API.
  async function handleHearMessage() {
    if (audioUrl) {
      audioRef.current?.play();
      return;
    }
    setAudioLoading(true);
    setAudioError(null);
    try {
      const blob = await textToSpeech(message.text);
      setAudioUrl(URL.createObjectURL(blob));
    } catch (err) {
      setAudioError(err.message);
    } finally {
      setAudioLoading(false);
    }
  }

  useEffect(() => {
    if (audioUrl && audioRef.current) audioRef.current.play().catch(() => {});
  }, [audioUrl]);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const activeSegment = playSequence && currentIndex >= 0 ? playSequence[currentIndex] : null;

  return (
    <div className={`message-bubble ${isOwn ? 'own' : 'other'}`}>
      <div className="message-meta">
        <span className="message-sender">{message.senderName}</span>
        {message.composedVia === 'sign' && <span className="composed-via-badge" title="Composed by signing">signed</span>}
        {message.composedVia === 'mic' && <span className="composed-via-badge" title="Composed by voice">voice</span>}
        {formattedTime && <span className="message-time">{formattedTime}</span>}
        {isOwn && <span className="message-sent-check" title="Sent">✓</span>}
      </div>
      <p className="message-text">{message.text}</p>
      <div className="message-actions">
        <button className="view-as-sign-btn" onClick={handleToggleSign} disabled={loading}>
          {loading ? 'Translating…' : expanded ? 'Hide sign video' : 'View as sign ▸'}
        </button>
        {ttsEnabled && (
          <button className="view-as-sign-btn" onClick={handleHearMessage} disabled={audioLoading}>
            {audioLoading ? 'Loading audio…' : 'Hear this message ▸'}
          </button>
        )}
        <button className="view-as-sign-btn" onClick={handleCopy}>
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      {audioError && <p className="sign-error">{audioError}</p>}
      {audioUrl && <audio ref={audioRef} src={audioUrl} style={{ display: 'none' }} />}

      {expanded && (
        <div className="sign-player">
          {error && <p className="sign-error">{error}</p>}
          {playSequence && (
            <>
              <video ref={videoRef} className="sign-video" muted autoPlay playsInline onEnded={handleEnded} />
              <div className="playback-speed-controls">
                {[0.5, 1, 1.5].map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    className={`playback-speed-btn ${playbackRate === rate ? 'active' : ''}`}
                    onClick={() => handleSpeedChange(rate)}
                  >
                    {rate}×
                  </button>
                ))}
              </div>
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

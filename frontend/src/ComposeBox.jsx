import { useEffect, useRef, useState } from 'react';
import SignCompose from './SignCompose.jsx';
import { socket } from './socket.js';

const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
const TYPING_STOP_DELAY_MS = 2000;

// Real, common ASL conversational-repair phrases — sent as one-tap quick replies rather
// than requiring them to be typed/signed out each time. Not all their words have a real
// sign video (e.g. "Slow"/"Understand" aren't in the 151-word vocabulary) — that's fine,
// the translate pipeline already fingerspells whatever's missing automatically.
const QUICK_PHRASES = ['Again', 'Slow down', "I don't understand"];

export default function ComposeBox({ onSend, sending }) {
  const [text, setText] = useState('');
  const [composedVia, setComposedVia] = useState('typed');
  const [showSignCompose, setShowSignCompose] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);
  const typingStopTimerRef = useRef(null);
  const textInputRef = useRef(null);

  function handleCloseSignCompose() {
    setShowSignCompose(false);
    // Signing only fills the text box, same as mic dictation — it never sends by itself.
    // Focusing the input here (instead of leaving focus on the just-closed "Close" button)
    // makes it visually obvious the recognized text is sitting there waiting for Send.
    textInputRef.current?.focus();
  }

  // Tells the other person "signing…" (a distinct state from "typing…") for exactly as long
  // as the camera panel is open — fires once per open/close rather than needing a manual
  // per-keystroke trigger the way text typing does.
  useEffect(() => {
    socket.emit('typing', { isTyping: showSignCompose, kind: 'signing' });
  }, [showSignCompose]);

  function handleQuickPhrase(phrase) {
    onSend({ text: phrase, composedVia: 'typed' });
  }

  function notifyTyping() {
    socket.emit('typing', { isTyping: true });
    clearTimeout(typingStopTimerRef.current);
    typingStopTimerRef.current = setTimeout(() => socket.emit('typing', { isTyping: false }), TYPING_STOP_DELAY_MS);
  }

  function handleTextChange(e) {
    setText(e.target.value);
    setComposedVia('typed');
    notifyTyping();
  }

  function handleMic() {
    if (!SpeechRecognitionCtor) {
      alert('Speech recognition is not supported in this browser.');
      return;
    }
    // Toggle — clicking the mic button again (or the Stop button in the recording banner)
    // while already listening ends the recording explicitly, instead of only being able to
    // stop it by waiting for the browser's own silence-detection to end it automatically.
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = 'en-US';
    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setText(transcript);
      setComposedVia('mic');
    };
    recognitionRef.current = recognition;
    recognition.start();
  }

  function handleSignInsert(str) {
    setText((t) => t + str);
    setComposedVia('sign');
  }

  function handleSignBackspace() {
    setText((t) => t.slice(0, -1));
  }

  function handleSend(e) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    clearTimeout(typingStopTimerRef.current);
    socket.emit('typing', { isTyping: false });
    onSend({ text: trimmed, composedVia });
    setText('');
    setComposedVia('typed');
  }

  return (
    <div className="compose-box">
      {showSignCompose && (
        <SignCompose
          onInsertText={handleSignInsert}
          onBackspace={handleSignBackspace}
          onClose={handleCloseSignCompose}
        />
      )}
      {listening && (
        <div className="recording-banner" role="status">
          <span className="recording-dot" aria-hidden="true" />
          Recording — speak your message
          <button type="button" className="recording-stop-btn" onClick={handleMic}>Stop</button>
        </div>
      )}
      <div className="quick-phrases">
        {QUICK_PHRASES.map((phrase) => (
          <button key={phrase} type="button" className="quick-phrase-btn" onClick={() => handleQuickPhrase(phrase)}>
            {phrase}
          </button>
        ))}
      </div>
      <form onSubmit={handleSend} className="compose-form">
        <button
          type="button"
          className={`compose-icon-btn ${showSignCompose ? 'active' : ''}`}
          onClick={() => setShowSignCompose((v) => !v)}
          title="Compose by signing"
        >
          Sign
        </button>
        <button
          type="button"
          className={`compose-icon-btn ${listening ? 'active' : ''}`}
          onClick={handleMic}
          title="Compose by voice"
        >
          {listening ? 'Listening…' : 'Mic'}
        </button>
        <input
          ref={textInputRef}
          value={text}
          onChange={handleTextChange}
          placeholder="Type a message, or use Sign / Mic…"
          maxLength={1000}
        />
        {text.length > 800 && <span className="char-counter">{text.length}/1000</span>}
        <button type="submit" disabled={sending || !text.trim()}>Send</button>
      </form>
    </div>
  );
}

import { useRef, useState } from 'react';
import SignCompose from './SignCompose.jsx';
import { socket } from './socket.js';

const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
const TYPING_STOP_DELAY_MS = 2000;

export default function ComposeBox({ onSend, sending }) {
  const [text, setText] = useState('');
  const [composedVia, setComposedVia] = useState('typed');
  const [showSignCompose, setShowSignCompose] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);
  const typingStopTimerRef = useRef(null);

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
          onClose={() => setShowSignCompose(false)}
        />
      )}
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
          value={text}
          onChange={handleTextChange}
          placeholder="Type a message, or use Sign / Mic…"
          maxLength={1000}
        />
        <button type="submit" disabled={sending || !text.trim()}>Send</button>
      </form>
    </div>
  );
}

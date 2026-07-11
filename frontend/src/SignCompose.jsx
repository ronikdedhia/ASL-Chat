import { useEffect, useRef, useState } from 'react';
import { checkLetter } from './api';

const SNAPSHOT_INTERVAL_MS = 2500;
const CONFIDENCE_THRESHOLD = 65;
const STABLE_READS_REQUIRED = 2; // same letter this many snapshots in a row before it's confirmed

export default function SignCompose({ onInsertText, onBackspace, onClose }) {
  const [consented, setConsented] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [status, setStatus] = useState('Show a letter or digit handshape to the camera.');
  const [busy, setBusy] = useState(false);
  const [spelled, setSpelled] = useState('');

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const candidateRef = useRef({ letter: null, count: 0 });
  const busyRef = useRef(false);

  useEffect(() => {
    if (!consented) return undefined;

    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user' } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch((err) => setCameraError(err.message || 'Could not access camera.'));

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [consented]);

  useEffect(() => {
    if (!consented || cameraError) return undefined;

    const interval = setInterval(async () => {
      if (busyRef.current || !videoRef.current || !canvasRef.current) return;
      const video = videoRef.current;
      if (video.readyState < 2) return; // not enough data yet

      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      // Mirror the capture to match the mirrored <video> the user sees themselves in
      // (CSS scaleX(-1)) — otherwise a handshape that looks like an "R" to the user on
      // screen would be captured as its un-mirrored, backwards version.
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7);

      busyRef.current = true;
      setBusy(true);
      try {
        const { letter, confidence } = await checkLetter(dataUrl);
        if (letter === 'Unrecognized' || confidence < CONFIDENCE_THRESHOLD) {
          candidateRef.current = { letter: null, count: 0 };
          setStatus(letter === 'Unrecognized' ? 'No clear handshape recognized — try holding it steady.' : `Saw "${letter}" but not confidently enough (${confidence}%).`);
          return;
        }

        if (candidateRef.current.letter === letter) {
          candidateRef.current.count += 1;
        } else {
          candidateRef.current = { letter, count: 1 };
        }

        if (candidateRef.current.count >= STABLE_READS_REQUIRED) {
          setSpelled((s) => s + letter);
          onInsertText(letter);
          setStatus(`Confirmed "${letter}".`);
          candidateRef.current = { letter: null, count: 0 };
        } else {
          setStatus(`Seeing "${letter}" (${confidence}%) — hold steady to confirm…`);
        }
      } catch (err) {
        setStatus(`Recognition failed: ${err.message}`);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    }, SNAPSHOT_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [consented, cameraError, onInsertText]);

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  function handleSpace() {
    setSpelled((s) => s + ' ');
    onInsertText(' ');
  }

  function handleBackspace() {
    setSpelled((s) => s.slice(0, -1));
    onBackspace();
  }

  if (!consented) {
    return (
      <div className="sign-compose-modal">
        <h3>Enable camera for fingerspelling?</h3>
        <p>
          Each snapshot (about every 2.5 seconds while this panel is open) is sent to Groq's cloud API to recognize the letter or digit you're
          signing. Frames are not stored by this app. Per Groq's published data-usage policy, they are not used to train any model and are not
          retained by default (Groq may keep a transient abuse/troubleshooting log for up to 30 days).
        </p>
        <div className="sign-compose-actions">
          <button onClick={() => setConsented(true)}>Turn on camera</button>
          <button className="secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="sign-compose-modal">
      {cameraError ? (
        <p className="sign-error">{cameraError}</p>
      ) : (
        <>
          <video ref={videoRef} className="sign-compose-video" muted autoPlay playsInline />
          <canvas ref={canvasRef} style={{ display: 'none' }} />
          <p className="sign-compose-status">{busy ? 'Reading…' : status}</p>
          <p className="sign-compose-preview">Spelling: <strong>{spelled || '(nothing yet)'}</strong></p>
          <div className="sign-compose-actions">
            <button onClick={handleSpace}>Space</button>
            <button onClick={handleBackspace}>Backspace</button>
            <button className="secondary" onClick={onClose}>Close — review &amp; Send below</button>
          </div>
        </>
      )}
    </div>
  );
}

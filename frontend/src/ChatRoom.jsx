import { useEffect, useRef, useState } from 'react';
import MessageBubble from './MessageBubble.jsx';
import ComposeBox from './ComposeBox.jsx';
import VocabularyLibrary from './VocabularyLibrary.jsx';
import LearnASLView from './LearnASLView.jsx';
import { getTtsStatus } from './api';

const TITLE_FLASH_INTERVAL_MS = 1000;
const NEAR_BOTTOM_THRESHOLD_PX = 80;

function formatDayLabel(dateStr) {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const isSameDay = (a, b) => a.toDateString() === b.toDateString();
  if (isSameDay(date, today)) return 'Today';
  if (isSameDay(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString([], { month: 'long', day: 'numeric', year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
}

function formatMessagesAsText(messages, roomLabel, room) {
  const lines = [`Chat with ${roomLabel || room} — exported ${new Date().toLocaleString()}`, ''];
  for (const m of messages) {
    if (m.system) continue;
    const time = m.createdAt ? new Date(m.createdAt).toLocaleString() : '';
    lines.push(`[${time}] ${m.senderName}: ${m.text}`);
  }
  return lines.join('\n');
}

function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ChatRoom({ displayName, room, roomLabel, messages, onSend, onLeave, typingUsers, sending, getAuthToken }) {
  const listRef = useRef(null);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [showVocabulary, setShowVocabulary] = useState(false);
  const [showLearn, setShowLearn] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
  );
  // Captured once, not re-read on every render — a render that happens mid-flash could
  // otherwise capture the flashed title as "original" instead of the real one.
  const originalTitleRef = useRef(document.title);

  // Tracked via a ref, not state — this only needs to be read at the moment a new message
  // arrives (inside the messages-length effect below), not trigger its own re-renders on
  // every scroll event the way state would.
  const isNearBottomRef = useRef(true);
  const [hasNewMessagesBelow, setHasNewMessagesBelow] = useState(false);

  function handleScroll() {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_THRESHOLD_PX;
    isNearBottomRef.current = nearBottom;
    if (nearBottom) setHasNewMessagesBelow(false);
  }

  function scrollToBottom(behavior = 'smooth') {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior });
    setHasNewMessagesBelow(false);
  }

  // Only auto-scrolls if the user was already at (or near) the bottom — otherwise someone
  // reading older history doesn't get yanked down every time a new message arrives. When not
  // at the bottom, a "↓ New messages" pill appears instead.
  useEffect(() => {
    if (messages.length === 0) return;
    if (isNearBottomRef.current) scrollToBottom();
    else setHasNewMessagesBelow(true);
  }, [messages.length]);

  // Fetched once here (not per-bubble) so N messages don't each independently hit this
  // endpoint — every MessageBubble just reads the same resolved value as a prop.
  useEffect(() => {
    getTtsStatus()
      .then((s) => setTtsEnabled(s.enabled))
      .catch(() => setTtsEnabled(false));
  }, []);

  // Visual "new message" alert — a sound-based notification is useless to a Deaf user, so
  // this flashes the tab title and (if permitted) fires a real desktop Notification whenever
  // a message arrives from someone else while the tab isn't the active/visible one. Skips
  // system presence messages and our own messages, and stops the instant the tab regains
  // focus rather than waiting for the next message to clear it.
  useEffect(() => {
    if (messages.length === 0) return undefined;
    const last = messages[messages.length - 1];
    if (last.system || last.senderName === displayName) return undefined;
    if (document.visibilityState === 'visible') return undefined;

    let showOriginal = false;
    const intervalId = setInterval(() => {
      document.title = showOriginal ? originalTitleRef.current : `💬 New message — ${originalTitleRef.current}`;
      showOriginal = !showOriginal;
    }, TITLE_FLASH_INTERVAL_MS);

    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(last.senderName, { body: last.text, tag: 'aslchat-message' });
    }

    function handleVisibilityChange() {
      if (document.visibilityState !== 'visible') return;
      clearInterval(intervalId);
      document.title = originalTitleRef.current;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(intervalId);
      document.title = originalTitleRef.current;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [messages, displayName]);

  function handleEnableNotifications() {
    if (typeof Notification === 'undefined') return;
    Notification.requestPermission().then(setNotificationPermission);
  }

  function handleLeaveClick() {
    if (window.confirm('Leave this chat?')) onLeave();
  }

  function handleExport() {
    const text = formatMessagesAsText(messages, roomLabel, room);
    downloadTextFile(`${(roomLabel || room).replace(/[^a-z0-9]/gi, '_')}-chat.txt`, text);
  }

  const othersActivity = [...typingUsers].filter(([name]) => name !== displayName);

  let lastDayLabel = null;

  return (
    <div className="chat-room">
      {showVocabulary && <VocabularyLibrary onClose={() => setShowVocabulary(false)} />}
      {showLearn && <LearnASLView onClose={() => setShowLearn(false)} getAuthToken={getAuthToken} />}
      <header className="chat-header">
        <button type="button" className="chat-leave-btn" onClick={handleLeaveClick}>← Leave</button>
        <span className="chat-room-name">{roomLabel ? `Chatting with ${roomLabel}` : `Room: ${room}`}</span>
        <div className="chat-header-actions">
          {notificationPermission === 'default' && (
            <button type="button" className="chat-header-link-btn" onClick={handleEnableNotifications} title="Get alerted to new messages when this tab isn't active">
              🔔 Enable notifications
            </button>
          )}
          <button type="button" className="chat-header-link-btn" onClick={handleExport} title="Download this conversation as a text file">
            ⬇ Export
          </button>
          <button type="button" className="chat-header-link-btn" onClick={() => setShowVocabulary(true)}>
            📖 Vocabulary
          </button>
          <button type="button" className="chat-header-link-btn" onClick={() => setShowLearn(true)}>
            🎓 Learn ASL
          </button>
          <span className="chat-display-name">You: {displayName}</span>
        </div>
      </header>

      <div className="message-list" ref={listRef} onScroll={handleScroll}>
        {messages.length === 0 && <p className="empty-state">No messages yet — say hello, by typing, mic, or signing.</p>}
        {messages.map((m) => {
          const dayLabel = m.createdAt ? formatDayLabel(m.createdAt) : null;
          const showDivider = dayLabel && dayLabel !== lastDayLabel;
          if (dayLabel) lastDayLabel = dayLabel;
          return (
            <div key={m.id}>
              {showDivider && <p className="day-divider">{dayLabel}</p>}
              {m.system ? (
                <p className="system-message">{m.text}</p>
              ) : (
                <MessageBubble message={m} isOwn={m.senderName === displayName} ttsEnabled={ttsEnabled} />
              )}
            </div>
          );
        })}
      </div>

      {hasNewMessagesBelow && (
        <button type="button" className="jump-to-bottom-btn" onClick={() => scrollToBottom()}>
          ↓ New messages
        </button>
      )}

      <div className="typing-indicator">
        {othersActivity.length > 0
          ? othersActivity.map(([name, kind]) => (kind === 'signing' ? `${name} is signing…` : `${name} typing…`)).join(', ')
          : ' '}
      </div>

      <ComposeBox onSend={onSend} sending={sending} />
    </div>
  );
}

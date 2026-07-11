import { useEffect, useRef } from 'react';
import MessageBubble from './MessageBubble.jsx';
import ComposeBox from './ComposeBox.jsx';

export default function ChatRoom({ displayName, room, roomLabel, messages, onSend, onLeave, typingUsers, sending }) {
  const listRef = useRef(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

  const othersTyping = [...typingUsers].filter((name) => name !== displayName);

  return (
    <div className="chat-room">
      <header className="chat-header">
        <button type="button" className="chat-leave-btn" onClick={onLeave}>← Leave</button>
        <span className="chat-room-name">{roomLabel ? `Chatting with ${roomLabel}` : `Room: ${room}`}</span>
        <span className="chat-display-name">You: {displayName}</span>
      </header>

      <div className="message-list" ref={listRef}>
        {messages.length === 0 && <p className="empty-state">No messages yet — say hello, by typing, mic, or signing.</p>}
        {messages.map((m) =>
          m.system ? (
            <p key={m.id} className="system-message">{m.text}</p>
          ) : (
            <MessageBubble key={m.id} message={m} isOwn={m.senderName === displayName} />
          ),
        )}
      </div>

      <div className="typing-indicator">{othersTyping.length > 0 ? `${othersTyping.join(', ')} typing…` : ' '}</div>

      <ComposeBox onSend={onSend} sending={sending} />
    </div>
  );
}

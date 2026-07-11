import { useEffect, useState } from 'react';
import { socket } from './socket.js';
import JoinScreen from './JoinScreen.jsx';
import ChatRoom from './ChatRoom.jsx';

export default function App({ fixedDisplayName, getAuthToken, myUserId } = {}) {
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState(null);
  const [displayName, setDisplayName] = useState('');
  const [room, setRoom] = useState('');
  const [roomLabel, setRoomLabel] = useState(null);
  const [messages, setMessages] = useState([]);
  const [typingUsers, setTypingUsers] = useState(new Set());

  useEffect(() => {
    function handleReceive(message) {
      setMessages((prev) => [...prev, message]);
    }
    function handleTyping({ displayName: name, isTyping }) {
      setTypingUsers((prev) => {
        const next = new Set(prev);
        if (isTyping) next.add(name);
        else next.delete(name);
        return next;
      });
    }
    function handlePresence({ displayName: name, event }) {
      setMessages((prev) => [
        ...prev,
        { id: `presence-${Date.now()}-${Math.random()}`, senderName: 'system', text: `${name} ${event} the room.`, composedVia: 'system', system: true },
      ]);
    }

    socket.on('message:receive', handleReceive);
    socket.on('typing', handleTyping);
    socket.on('presence', handlePresence);
    return () => {
      socket.off('message:receive', handleReceive);
      socket.off('typing', handleTyping);
      socket.off('presence', handlePresence);
    };
  }, []);

  async function handleJoin({ displayName: name, room: roomCode, roomLabel: label }) {
    setJoining(true);
    setJoinError(null);

    // When Clerk is configured, the socket connection itself is verified server-side (see
    // backend/index.js's io.use() middleware) — a fresh token has to be attached before
    // connect(), Socket.io sends whatever's in socket.auth as the handshake payload.
    if (getAuthToken) {
      try {
        const token = await getAuthToken();
        socket.auth = { token };
      } catch (err) {
        setJoining(false);
        setJoinError('Could not verify your session — try refreshing the page.');
        return;
      }
    }

    socket.connect();
    socket.emit('join', { room: roomCode, displayName: name }, (response) => {
      setJoining(false);
      if (response?.error) {
        setJoinError(response.error);
        socket.disconnect();
        return;
      }
      setDisplayName(name);
      setRoom(roomCode);
      setRoomLabel(label || null);
      setMessages(response.history || []);
      setJoined(true);
    });
  }

  function handleSend({ text, composedVia }) {
    socket.emit('message:send', { text, composedVia }, (response) => {
      if (response?.error) alert(response.error);
    });
  }

  // Fully disconnects rather than just resetting local state — a clean disconnect fires
  // the server's 'presence: left' event for whoever's still in the room, and the next
  // handleJoin call reconnects with a freshly-fetched token rather than reusing a
  // possibly-stale one.
  function handleLeave() {
    socket.disconnect();
    setJoined(false);
    setRoom('');
    setRoomLabel(null);
    setMessages([]);
    setTypingUsers(new Set());
  }

  if (!joined) {
    return (
      <JoinScreen
        onJoin={handleJoin}
        error={joinError}
        joining={joining}
        fixedDisplayName={fixedDisplayName}
        myUserId={myUserId}
        getAuthToken={getAuthToken}
      />
    );
  }

  return (
    <ChatRoom
      displayName={displayName}
      room={room}
      roomLabel={roomLabel}
      messages={messages}
      onSend={handleSend}
      onLeave={handleLeave}
      typingUsers={typingUsers}
    />
  );
}

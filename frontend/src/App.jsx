import { useCallback, useEffect, useState } from 'react';
import { socket } from './socket.js';
import JoinScreen from './JoinScreen.jsx';
import ChatRoom from './ChatRoom.jsx';
import { getStoredSession, setStoredSession, clearStoredSession } from './session.js';

export default function App({ fixedDisplayName, getAuthToken, myUserId } = {}) {
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState(null);
  // True until the initial auto-rejoin attempt (or the decision that there's nothing to
  // rejoin) resolves — avoids flashing the join/search screen for a moment on every reload.
  const [reconnecting, setReconnecting] = useState(true);
  const [displayName, setDisplayName] = useState('');
  const [room, setRoom] = useState('');
  const [roomLabel, setRoomLabel] = useState(null);
  const [messages, setMessages] = useState([]);
  // Map, not Set — value is the activity kind ('typing' | 'signing') so the indicator can
  // show "X is signing…" distinctly from "X typing…", not fold both into one generic label.
  const [typingUsers, setTypingUsers] = useState(new Map());

  useEffect(() => {
    function handleReceive(message) {
      setMessages((prev) => [...prev, message]);
    }
    function handleTyping({ displayName: name, isTyping, kind }) {
      setTypingUsers((prev) => {
        const next = new Map(prev);
        if (isTyping) next.set(name, kind === 'signing' ? 'signing' : 'typing');
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

  const handleJoin = useCallback(
    async ({ displayName: name, room: roomCode, roomLabel: label, otherUserId, otherName }) => {
      setJoining(true);
      setJoinError(null);

      // When Clerk is configured, the socket connection itself is verified server-side (see
      // backend/index.js's io.use() middleware) — a fresh token has to be attached before
      // connect(). skipCache: true is required here — Clerk's getToken() otherwise returns
      // an internally cached token that can already be expired (or expire in the few seconds
      // it takes to reach the server), causing a real "JWT is expired" rejection observed
      // live even though the token looked fine client-side moments earlier.
      if (getAuthToken) {
        try {
          const token = await getAuthToken({ skipCache: true });
          socket.auth = { token };
        } catch (err) {
          setJoining(false);
          setReconnecting(false);
          setJoinError('Could not verify your session — try refreshing the page.');
          return;
        }
      }

      // If the connection itself fails (expired/invalid token, server unreachable), Socket.io
      // never calls the 'join' ack below — without this listener, joining/reconnecting would
      // hang forever with no feedback. once() since this only concerns this one connection
      // attempt, not every future disconnect.
      function handleConnectError(err) {
        setJoining(false);
        setReconnecting(false);
        setJoinError('Connection failed — your session may have expired. Please try again.');
        console.error('Socket connection failed:', err.message);
      }
      socket.once('connect_error', handleConnectError);

      socket.connect();
      socket.emit('join', { room: roomCode, displayName: name, otherUserId, otherName }, (response) => {
        socket.off('connect_error', handleConnectError);
        setJoining(false);
        setReconnecting(false);
        if (response?.error) {
          setJoinError(response.error);
          clearStoredSession();
          socket.disconnect();
          return;
        }
        setDisplayName(name);
        setRoom(roomCode);
        setRoomLabel(label || null);
        setMessages(response.history || []);
        setJoined(true);
        setStoredSession({ room: roomCode, roomLabel: label || null, displayName: name });
      });
    },
    [getAuthToken],
  );

  // Auto-rejoin the last room on page load, if one was stored. Only carries room/displayName
  // forward — otherUserId/otherName (the recent-conversations bookkeeping fields) are
  // intentionally omitted here since that upsert already happened the first time this room
  // was joined; redoing it on every refresh would just be redundant writes.
  useEffect(() => {
    const stored = getStoredSession();
    const name = fixedDisplayName || stored?.displayName;
    if (stored?.room && name) {
      handleJoin({ displayName: name, room: stored.room, roomLabel: stored.roomLabel });
    } else {
      setReconnecting(false);
    }
    // Deliberately run once on mount — fixedDisplayName is already resolved by the time App
    // mounts (AuthedGate only renders it inside <SignedIn>), and handleJoin is stable across
    // that single render via its useCallback dependency on getAuthToken.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    clearStoredSession();
    setJoined(false);
    setRoom('');
    setRoomLabel(null);
    setMessages([]);
    setTypingUsers(new Map());
  }

  if (reconnecting) {
    return (
      <div className="join-screen">
        <div className="join-card">
          <p className="join-subtitle">Reconnecting to your last chat…</p>
        </div>
      </div>
    );
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
      getAuthToken={getAuthToken}
    />
  );
}

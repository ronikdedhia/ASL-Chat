import { useCallback, useEffect, useRef, useState } from 'react';
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

  // Mirrors `joined`/the last-successful join params, but as refs — read inside the
  // 'connect' listener below, which is registered once and would otherwise only ever see
  // the stale values from its first render. Set together right after a real join succeeds;
  // cleared together on Leave.
  const joinedRef = useRef(false);
  const joinParamsRef = useRef(null);

  // Socket.io calls this fresh before EVERY connection attempt — the initial one AND every
  // automatic reconnect after a dropped connection (network blip, Render's free tier cycling
  // the instance, etc). Setting socket.auth to a plain object once (the previous approach)
  // only fixed the *first* connection — a reconnect would resend that same now-stale ~60s
  // Clerk token and get silently rejected. A function here means each reconnect attempt gets
  // its own fresh token, not a stale one from whenever the page first loaded.
  useEffect(() => {
    socket.auth = (cb) => {
      if (!getAuthToken) return cb({});
      getAuthToken({ skipCache: true })
        .then((token) => cb({ token }))
        .catch(() => cb({})); // let the server reject cleanly rather than hanging with no callback
    };
  }, [getAuthToken]);

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
    // Socket.io's automatic reconnection re-establishes the transport but has no idea which
    // room this connection was in — the server's per-socket `currentRoom` starts fresh at
    // null on every new connection. Without this, the app looks fine after a silent
    // auto-reconnect but every Send fails with "Join a room first." Only fires the rejoin
    // when we'd already actually joined before (joinedRef) — on the very first connection,
    // handleJoin's own explicit emit('join', ...) handles it, so this stays a no-op then.
    function handleConnect() {
      if (!joinedRef.current || !joinParamsRef.current) return;
      socket.emit('join', joinParamsRef.current, (response) => {
        if (response?.error) {
          console.error('Silent rejoin after reconnect failed:', response.error);
          handleLeave();
          setJoinError('Your connection was interrupted and could not be restored — please rejoin.');
        } else {
          setMessages(response.history || []); // resync in case anything arrived while disconnected
        }
      });
    }

    socket.on('message:receive', handleReceive);
    socket.on('typing', handleTyping);
    socket.on('presence', handlePresence);
    socket.on('connect', handleConnect);
    return () => {
      socket.off('message:receive', handleReceive);
      socket.off('typing', handleTyping);
      socket.off('presence', handlePresence);
      socket.off('connect', handleConnect);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleJoin = useCallback(
    async ({ displayName: name, room: roomCode, roomLabel: label, otherUserId, otherName }) => {
      setJoining(true);
      setJoinError(null);

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
      const joinPayload = { room: roomCode, displayName: name, otherUserId, otherName };
      socket.emit('join', joinPayload, (response) => {
        socket.off('connect_error', handleConnectError);
        setJoining(false);
        setReconnecting(false);
        if (response?.error) {
          setJoinError(response.error);
          clearStoredSession();
          socket.disconnect();
          return;
        }
        joinedRef.current = true;
        joinParamsRef.current = joinPayload;
        setDisplayName(name);
        setRoom(roomCode);
        setRoomLabel(label || null);
        setMessages(response.history || []);
        setJoined(true);
        setStoredSession({ room: roomCode, roomLabel: label || null, displayName: name });
      });
    },
    [],
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
    // mounts (AuthedGate only renders it inside <SignedIn>), and handleJoin itself has no
    // reactive dependencies (socket.auth, set separately above, supplies the token).
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
    joinedRef.current = false;
    joinParamsRef.current = null;
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

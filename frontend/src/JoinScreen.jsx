import { useState } from 'react';
import FindUserPanel from './FindUserPanel.jsx';

export default function JoinScreen({ onJoin, error, joining, fixedDisplayName, myUserId, getAuthToken }) {
  const [displayName, setDisplayName] = useState('');
  const [room, setRoom] = useState('lobby');
  const [showManualRoom, setShowManualRoom] = useState(!myUserId); // open mode always shows it, Clerk mode defaults to search

  function handleSubmit(e) {
    e.preventDefault();
    const name = fixedDisplayName || displayName.trim();
    if (!name || !room.trim()) return;
    onJoin({ displayName: name, room: room.trim() });
  }

  function handleSelectUser({ room: directRoom, roomLabel }) {
    onJoin({ displayName: fixedDisplayName, room: directRoom, roomLabel });
  }

  return (
    <div className="join-screen">
      <div className="join-card">
        <h1>ASL-Chat</h1>
        <p className="join-subtitle">Sign or type — either becomes a message the other person can read or watch as sign video.</p>

        {fixedDisplayName && <p className="join-signed-in-as">Signed in as <strong>{fixedDisplayName}</strong></p>}

        {myUserId && getAuthToken && !showManualRoom && (
          <>
            <FindUserPanel myUserId={myUserId} getAuthToken={getAuthToken} onSelectUser={handleSelectUser} />
            <button type="button" className="join-toggle-link" onClick={() => setShowManualRoom(true)}>
              Or enter a room code manually
            </button>
          </>
        )}

        {showManualRoom && (
          <form onSubmit={handleSubmit}>
            {!fixedDisplayName && (
              <label>
                Your name
                <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. Ronik" maxLength={40} required />
              </label>
            )}
            <label>
              Room code
              <input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="e.g. lobby" maxLength={100} required />
            </label>
            <p className="join-hint">Both people enter the same room code to land in the same chat.</p>
            {error && <p className="join-error">{error}</p>}
            <button type="submit" disabled={joining}>{joining ? 'Joining…' : 'Join chat'}</button>
            {myUserId && (
              <button type="button" className="join-toggle-link" onClick={() => setShowManualRoom(false)}>
                Back to search
              </button>
            )}
          </form>
        )}

        {error && !showManualRoom && <p className="join-error">{error}</p>}
      </div>
    </div>
  );
}

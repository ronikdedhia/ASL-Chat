import { useEffect, useState } from 'react';
import { getConversations, deleteConversation } from './api';

export default function RecentConversations({ getAuthToken, onSelectConversation }) {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getAuthToken();
        const data = await getConversations(token);
        if (!cancelled) setConversations(data);
      } catch {
        // Non-critical — this is a convenience shortcut, not required to use the app.
        // Fail silently rather than blocking the join screen over it.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getAuthToken]);

  async function handleRemove(_e, room) {
    const previous = conversations;
    setConversations((prev) => prev.filter((c) => c.room !== room)); // optimistic — this is a convenience list, not critical data
    try {
      const token = await getAuthToken();
      await deleteConversation(room, token);
    } catch {
      setConversations(previous); // roll back if the delete didn't actually happen
    }
  }

  if (loading || conversations.length === 0) return null;

  return (
    <div className="recent-conversations">
      <h3 className="recent-conversations-title">Recent</h3>
      <ul className="find-user-results">
        {conversations.map((c) => (
          <li key={c.room} className="recent-conversation-item">
            <button
              type="button"
              className="recent-conversation-row"
              onClick={() => onSelectConversation({ room: c.room, roomLabel: c.otherName, otherUserId: c.otherUserId, otherName: c.otherName })}
            >
              <span>{c.otherName}</span>
            </button>
            <button type="button" className="recent-conversation-remove" onClick={(e) => handleRemove(e, c.room)} title="Remove from recent">
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

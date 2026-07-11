import { useEffect, useRef, useState } from 'react';
import { searchUsers } from './api';

const SEARCH_DEBOUNCE_MS = 350;

// Derives a stable, deterministic room for two people — no invite/code-sharing step needed,
// clicking a search result is enough. Sorted so it comes out identical regardless of who
// searches for whom. Known gap, stated plainly: the server accepts any "dm_..." room from
// any authenticated connection, it doesn't check that the two IDs in the name match who's
// actually connecting — fine for this MVP's threat model (you'd have to already know the
// other person's exact Clerk user ID to guess it), not a real access-control boundary.
function directRoomId(userIdA, userIdB) {
  return `dm_${[userIdA, userIdB].sort().join('_')}`;
}

export default function FindUserPanel({ myUserId, getAuthToken, onSelectUser }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setResults([]);
      setError(null);
      return undefined;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const token = await getAuthToken();
        const data = await searchUsers(query.trim(), token);
        setResults(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(debounceRef.current);
  }, [query, getAuthToken]);

  function handlePick(result) {
    onSelectUser({ room: directRoomId(myUserId, result.userId), roomLabel: result.name });
  }

  return (
    <div className="find-user-panel">
      <label>
        Find someone to chat with
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or username…"
          maxLength={60}
        />
      </label>
      {loading && <p className="find-user-status">Searching…</p>}
      {error && <p className="join-error">{error}</p>}
      {!loading && !error && query.trim().length >= 2 && results.length === 0 && (
        <p className="find-user-status">No one found — they need to have signed in to this app at least once.</p>
      )}
      {results.length > 0 && (
        <ul className="find-user-results">
          {results.map((r) => (
            <li key={r.userId}>
              <button type="button" onClick={() => handlePick(r)}>
                {r.imageUrl && <img src={r.imageUrl} alt="" className="find-user-avatar" />}
                <span>{r.name}{r.username ? ` (@${r.username})` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

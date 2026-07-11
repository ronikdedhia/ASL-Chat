const KEY = 'aslchat.session';

export function getStoredSession() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setStoredSession(session) {
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // localStorage can throw in private-browsing/storage-full edge cases — session
    // persistence is a convenience, not required for the chat itself to work.
  }
}

export function clearStoredSession() {
  localStorage.removeItem(KEY);
}

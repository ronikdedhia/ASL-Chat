const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8788';

async function request(path, options) {
  const res = await fetch(`${API_URL}${path}`, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const getVocabulary = () => request('/api/vocabulary');
export const getConfigStatus = () => request('/api/config-status');

export const translate = (sentence) =>
  request('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sentence }),
  });

export const checkLetter = (imageDataUrl) =>
  request('/api/check-letter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: imageDataUrl }),
  });

export const searchUsers = (query, token) =>
  request(`/api/users/search?q=${encodeURIComponent(query)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

export const API_BASE = API_URL;

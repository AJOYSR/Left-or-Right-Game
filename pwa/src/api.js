import { API_URL, PUBLISHABLE_KEY } from './config.js?v=11';

const TOKEN_KEY = 'lor.playerToken';

export const store = {
  get(k, d) { try { const v = localStorage.getItem('lor.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { if (v == null) localStorage.removeItem('lor.' + k); else localStorage.setItem('lor.' + k, JSON.stringify(v)); } catch {} },
};

export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
export const setToken = t => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {} };

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
  get offline() { return this.status === 0; }
}

// One call to the game server. Throws ApiError; status 0 means the network is down.
export async function api(action, body = {}, { timeout = 12000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const token = getToken();
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: PUBLISHABLE_KEY, ...(token ? { 'x-player-token': token } : {}) },
      body: JSON.stringify({ action, ...body }),
      signal: ctrl.signal,
    });
  } catch {
    throw new ApiError(0, ctrl.signal.aborted ? 'The server took too long to answer.' : 'You’re offline.');
  } finally {
    clearTimeout(timer);
  }
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new ApiError(res.status, data.error || 'Something went wrong. Try again.');
  return data;
}

// Finished games wait in a durable outbox until the server has them (see queue.js).
import { createOutbox } from './queue.js?v=11';
export const outbox = createOutbox({
  storage: store,
  send: item => api('finish', { gameId: item.gameId, events: item.events, ended: item.ended }, { timeout: 15000 }),
});
// Games queued by older versions of the app.
try {
  const old = store.get('pending', null);
  if (Array.isArray(old) && old.length) { for (const p of old) if (!outbox.get(p.gameId)) outbox.add(p); store.set('pending', null); }
} catch {}

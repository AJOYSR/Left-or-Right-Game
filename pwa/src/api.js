import { API_URL, PUBLISHABLE_KEY } from './config.js';

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
    throw new ApiError(0, 'You’re offline.');
  } finally {
    clearTimeout(timer);
  }
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new ApiError(res.status, data.error || 'Something went wrong. Try again.');
  return data;
}

// Finished games that couldn't be sent (no signal at the end of a game) wait here and are retried.
export const pending = {
  list: () => store.get('pending', []),
  add(item) { store.set('pending', [...pending.list().filter(p => p.gameId !== item.gameId), item]); },
  remove(gameId) { store.set('pending', pending.list().filter(p => p.gameId !== gameId)); },
  async flush() {
    const sent = [];
    for (const p of pending.list()) {
      try { const r = await api('finish', { gameId: p.gameId, events: p.events, ended: p.ended }); pending.remove(p.gameId); sent.push({ ...p, result: r }); }
      catch (e) { if (e.offline) break; pending.remove(p.gameId); }   // a rejected or duplicate game won't succeed later
    }
    return sent;
  },
};

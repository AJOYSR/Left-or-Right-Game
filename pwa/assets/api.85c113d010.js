import { API_URL, PUBLISHABLE_KEY } from './config.6c2d557f76.js';

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
export async function api(action, body = {}, { timeout = 12000, token = getToken() } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
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
  // `code` is only present on errors from the game server itself (not a proxy or gateway)
  if (!res.ok) throw Object.assign(new ApiError(res.status, data.error || 'Something went wrong. Try again.'), { code: data.code || null });
  return data;
}

// Finished games wait in a durable outbox until the server has them (see queue.js).
import { createOutbox } from './queue.91786d6ba2.js';
// One outbox per player profile (by player id), so restoring another player's code never
// deletes this one's unsent games; restoring this code again picks them back up.
export const outboxKey = () => { const me = store.get('me', null); return me && me.id ? 'outbox.' + me.id : 'outbox'; };
export const outbox = createOutbox({
  storage: store,
  key: outboxKey,
  context: () => ({ token: getToken() }),
  send: (item, ctx) => api('finish', { gameId: item.gameId, events: item.events, ended: item.ended }, { timeout: 15000, token: ctx.token }),
});
// Games queued by older versions of the app (one shared outbox, or the older `pending` list)
// belong to the player signed in now.
try {
  if (outboxKey() !== 'outbox') {
    const shared = store.get('outbox', null);
    if (Array.isArray(shared) && shared.length) { const mine = outbox.list(); store.set(outboxKey(), [...mine, ...shared.filter(x => !mine.some(m => m.gameId === x.gameId))]); store.set('outbox', null); }
  }
  const old = store.get('pending', null);
  if (Array.isArray(old) && old.length) { for (const p of old) if (!outbox.get(p.gameId)) outbox.add(p); store.set('pending', null); }
} catch {}

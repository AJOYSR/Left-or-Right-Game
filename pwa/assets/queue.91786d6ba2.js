// The outbox for finished games.
// A finished game is written to the device *before* it is sent, and it stays there until the
// server gives a final answer. A dropped connection, a server error (5xx), a timeout or a busy
// server (429) never loses a score: the game waits and is sent again, with growing gaps.
// Only a definite "no" from the server (the game failed verification) ends a game's journey,
// and even then it's kept so the player can see what happened.
//
// States: pending (waiting to send) → posted (server accepted it) | failed (needs attention).

export const RETRY_BASE_MS = 5000, RETRY_MAX_MS = 5 * 60 * 1000;
// Only a definite answer from the game server ends a game's journey: a 4xx that carries the
// server's own error code (it confirmed the game is rejected, missing or not yours). Anything else
// (offline, timeouts, 408, 429, 5xx, or an error from a proxy or gateway with no code) is retried.
export const isRetryable = e => {
  if (!e || !(e.status > 0) || e.status === 408 || e.status === 429 || e.status >= 500) return true;
  return !e.code;
};
export const backoff = tries => Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, tries - 1));

// `key` may be a function: each player profile on the device has its own outbox, so switching
// player codes never touches another profile's unsent games (switching back recovers them).
// `context` is read once at the start of a flush (for example the player token), so a profile
// switch in the middle of a flush can't send one player's games as another.
export function createOutbox({ storage, send, now = () => Date.now(), key = 'outbox', context = () => ({}) }) {
  const keyOf = () => (typeof key === 'function' ? key() : key);
  const listAt = k => { const l = storage.get(k, []); return Array.isArray(l) ? l : []; };
  const list = () => listAt(keyOf());
  const save = l => storage.set(keyOf(), l);
  const putAt = (k, item) => storage.set(k, [...listAt(k).filter(x => x.gameId !== item.gameId), item]);
  const put = item => putAt(keyOf(), item);
  let flushing = null;

  async function flushOnce({ force }) {
    const out = [];
    const k = keyOf(), ctx = context();
    for (const item of listAt(k)) {
      if (item.state !== 'pending') continue;
      if (!force && item.nextAt > now()) continue;
      const put = it => putAt(k, it);
      try {
        const result = await send(item, ctx);
        put({ ...item, state: 'posted', result, postedAt: now() });
        out.push({ gameId: item.gameId, state: 'posted', result, item });
      } catch (e) {
        if (isRetryable(e)) {
          const tries = (item.tries || 0) + 1;
          put({ ...item, tries, nextAt: now() + backoff(tries), lastStatus: e?.status ?? 0 });
          out.push({ gameId: item.gameId, state: 'pending', error: e, item });
          if (!(e?.status > 0)) break;   // offline: no point trying the rest now
        } else {
          put({ ...item, state: 'failed', status: e.status, error: String(e.message || 'Rejected') });
          out.push({ gameId: item.gameId, state: 'failed', error: e, item });
        }
      }
    }
    return out;
  }

  return {
    list,
    get: gameId => list().find(x => x.gameId === gameId) || null,
    pending: () => list().filter(x => x.state === 'pending'),
    failed: () => list().filter(x => x.state === 'failed'),
    // Save first. Nothing is sent here.
    add(entry) { put({ ...entry, state: 'pending', tries: 0, nextAt: 0, savedAt: now() }); },
    remove(gameId) { save(list().filter(x => x.gameId !== gameId)); },
    // Posted entries are only receipts; keep a week of them.
    prune(maxAgeMs = 7 * 864e5) { save(list().filter(x => x.state !== 'posted' || now() - (x.postedAt || 0) < maxAgeMs)); },
    // One flush at a time; a second caller gets the same promise.
    flush({ force = false } = {}) {
      if (!flushing) flushing = flushOnce({ force }).finally(() => { flushing = null; });
      return flushing;
    },
  };
}

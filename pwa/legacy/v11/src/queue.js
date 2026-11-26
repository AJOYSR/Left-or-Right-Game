// The outbox for finished games.
// A finished game is written to the device *before* it is sent, and it stays there until the
// server gives a final answer. A dropped connection, a server error (5xx), a timeout or a busy
// server (429) never loses a score: the game waits and is sent again, with growing gaps.
// Only a definite "no" from the server (the game failed verification) ends a game's journey,
// and even then it's kept so the player can see what happened.
//
// States: pending (waiting to send) → posted (server accepted it) | failed (needs attention).

export const RETRY_BASE_MS = 5000, RETRY_MAX_MS = 5 * 60 * 1000;
export const isRetryable = e => !e || !(e.status > 0) || e.status === 408 || e.status === 429 || e.status >= 500;
export const backoff = tries => Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, tries - 1));

export function createOutbox({ storage, send, now = () => Date.now(), key = 'outbox' }) {
  const list = () => { const l = storage.get(key, []); return Array.isArray(l) ? l : []; };
  const save = l => storage.set(key, l);
  const put = item => save([...list().filter(x => x.gameId !== item.gameId), item]);
  let flushing = null;

  async function flushOnce({ force }) {
    const out = [];
    for (const item of list()) {
      if (item.state !== 'pending') continue;
      if (!force && item.nextAt > now()) continue;
      try {
        const result = await send(item);
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

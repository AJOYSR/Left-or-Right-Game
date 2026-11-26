import test from 'node:test';
import assert from 'node:assert/strict';
import { createOutbox, isRetryable, backoff } from '../src/queue.js';

const memStore = () => { const m = new Map(); return { get: (k, d) => (m.has(k) ? JSON.parse(m.get(k)) : d), set: (k, v) => m.set(k, JSON.stringify(v)) }; };
// errors the game server confirms carry a code; gateway/proxy errors don't
const err = (status, code = status >= 400 && status < 500 && status !== 408 && status !== 429 ? 'api' : null) => Object.assign(new Error('e' + status), { status, code });

test('which errors are retried', () => {
  for (const s of [0, 408, 429, 500, 502, 503, 504]) assert.ok(isRetryable(err(s)), String(s));
  for (const s of [400, 401, 403, 404, 409, 422]) assert.ok(!isRetryable(err(s)), String(s));
  // the same statuses without the server's code (a gateway or proxy said it) are retried
  for (const s of [401, 404, 403]) assert.ok(isRetryable(err(s, null)), 'gateway ' + s);
  assert.ok(backoff(1) < backoff(3) && backoff(30) === 5 * 60 * 1000);
});

test('a 503 keeps the game and it posts later', async () => {
  let t = 0, fail = true;
  const box = createOutbox({ storage: memStore(), now: () => t, send: async () => { if (fail) throw err(503); return { score: 10 }; } });
  box.add({ gameId: 'g1', events: [] });
  let r = await box.flush();
  assert.equal(r[0].state, 'pending');
  assert.equal(box.get('g1').state, 'pending');
  assert.equal((await box.flush()).length, 0, 'waits for the backoff');
  fail = false; t += 60000;
  r = await box.flush();
  assert.equal(r[0].state, 'posted');
  assert.equal(box.get('g1').result.score, 10);
});

test('offline stops the flush but keeps every game', async () => {
  const box = createOutbox({ storage: memStore(), send: async () => { throw err(0); } });
  box.add({ gameId: 'a' }); box.add({ gameId: 'b' });
  const r = await box.flush({ force: true });
  assert.equal(r.length, 1);
  assert.equal(box.pending().length, 2);
});

test('a lost response is safe: sending again gets the stored result', async () => {
  // the server saved the game but the answer never arrived; the retry finds it already finished
  let calls = 0;
  const box = createOutbox({ storage: memStore(), send: async () => { calls++; if (calls === 1) throw err(0); return { score: 5, already: true }; } });
  box.add({ gameId: 'g' });
  await box.flush({ force: true });
  await box.flush({ force: true });
  assert.equal(box.get('g').state, 'posted');
});

test('a verification failure is kept as needing attention, not retried', async () => {
  let calls = 0;
  const box = createOutbox({ storage: memStore(), send: async () => { calls++; throw err(422); } });
  box.add({ gameId: 'x' });
  await box.flush({ force: true }); await box.flush({ force: true });
  assert.equal(calls, 1);
  assert.equal(box.failed().length, 1);
});

test('the outbox survives a reload (same storage)', async () => {
  const s = memStore();
  createOutbox({ storage: s, send: async () => ({}) }).add({ gameId: 'keep' });
  const again = createOutbox({ storage: s, send: async () => ({ ok: 1 }) });
  assert.equal(again.pending().length, 1);
  await again.flush();
  assert.equal(again.get('keep').state, 'posted');
});

test('two flushes at once send a game only once', async () => {
  let calls = 0;
  const box = createOutbox({ storage: memStore(), send: async () => { calls++; await new Promise(r => setTimeout(r, 10)); return {}; } });
  box.add({ gameId: 'once' });
  await Promise.all([box.flush(), box.flush()]);
  assert.equal(calls, 1);
});

test('switching profiles keeps each profile\'s unsent games; switching back recovers them', async () => {
  const s = memStore();
  let who = 'A';
  const sent = [];
  const box = createOutbox({ storage: s, key: () => 'outbox.' + who, context: () => ({ token: who }), send: async (item, ctx) => { sent.push(ctx.token + ':' + item.gameId); return {}; } });
  box.add({ gameId: 'a1' });
  who = 'B';
  assert.equal(box.pending().length, 0, 'B does not see A\'s games');
  box.add({ gameId: 'b1' });
  await box.flush({ force: true });
  assert.deepEqual(sent, ['B:b1']);
  who = 'A';
  assert.equal(box.pending().length, 1, 'A\'s game is still there');
  await box.flush({ force: true });
  assert.deepEqual(sent, ['B:b1', 'A:a1']);
});

test('a profile switch during a flush cannot send games with the other token', async () => {
  const s = memStore();
  let who = 'A';
  const sent = [];
  const box = createOutbox({ storage: s, key: () => 'outbox.' + who, context: () => ({ token: who }),
    send: async (item, ctx) => { who = 'B'; await new Promise(r => setTimeout(r, 5)); sent.push(ctx.token + ':' + item.gameId); return {}; } });
  box.add({ gameId: 'a1' }); box.add({ gameId: 'a2' });
  await box.flush({ force: true });
  assert.deepEqual(sent, ['A:a1', 'A:a2']);
  who = 'A';
  assert.equal(box.list().filter(x => x.state === 'posted').length, 2, 'results written to A\'s outbox');
  who = 'B';
  assert.equal(box.list().length, 0);
});

test('a gateway 404 is retried, a confirmed 404 needs attention', async () => {
  let mode = 'gateway';
  const box = createOutbox({ storage: memStore(), send: async () => { throw mode === 'gateway' ? err(404, null) : err(404, 'missing'); } });
  box.add({ gameId: 'g' });
  await box.flush({ force: true });
  assert.equal(box.get('g').state, 'pending');
  mode = 'server';
  await box.flush({ force: true });
  assert.equal(box.get('g').state, 'failed');
});

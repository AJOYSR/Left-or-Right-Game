// Shared by the link-preview functions. Everything shown comes from the game server's verified data.
export const SITE = 'https://left-or-right-peach.vercel.app';
const API = 'https://tnpsckkmlmmozpzkwsly.supabase.co/functions/v1/api';
const KEY = 'sb_publishable_BE4vMVSHTYs9jOMToZHcCA_VODrszGp';   // public key, safe to ship
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[a-z0-9]{6}-(15|20|30|50)(-h)?$/;
const DAY_ONE = Date.UTC(2026, 10, 26);

async function call(action, body) {
  const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', apikey: KEY, origin: SITE }, body: JSON.stringify({ action, ...body }) });
  if (!r.ok) return null;
  return r.json();
}

// What a share link is about: a verified game (/s/<id>), a challenge (/c/<code>), or the game itself.
export async function lookup(url) {
  const g = url.searchParams.get('g'), c = url.searchParams.get('c');
  if (g && UUID.test(g)) {
    const s = await call('share', { gameId: g });
    if (s) return { kind: 'game', id: g, ...s };
  }
  if (c && CODE.test(c)) {
    const info = await call('challengeInfo', { code: c });
    if (info) {
      const by = info.createdBy, theirs = by && (info.board || []).find(r => r.playerId === by.playerId);
      return { kind: 'challenge', code: c, rounds: info.rounds, hard: info.hard, nickname: by?.nickname || null, score: theirs?.score ?? null, players: (info.board || []).length };
    }
    return { kind: 'challenge', code: c, rounds: +c.split('-')[1], hard: c.endsWith('-h'), nickname: null, score: null, players: 0 };
  }
  return { kind: 'site' };
}

export const dailyNumber = day => Math.round((Date.parse(day + 'T00:00:00Z') - DAY_ONE) / 864e5) + 1;
export const fmt = n => Number(n || 0).toLocaleString('en-US');

export function texts(info) {
  if (info.kind === 'game') {
    const avg = info.avgMs ? ` · ${(info.avgMs / 1000).toFixed(2)}s average` : '';
    const where = info.mode === 'daily' ? `Daily #${dailyNumber(info.day)}` : `${info.rounds} rounds${info.hard ? ' on Hard' : ''}`;
    return {
      title: `${info.nickname} scored ${fmt(info.score)} on Left or Right`,
      description: `${where}: ${info.correct}/${info.rounds} correct${avg}. Odd or even, low or high, three seconds. Can you beat it?`,
    };
  }
  if (info.kind === 'challenge') {
    const who = info.nickname || 'A friend';
    return {
      title: info.score != null ? `${who} scored ${fmt(info.score)}. Can you beat it?` : `${who} challenged you on Left or Right`,
      description: `Same ${info.rounds} questions${info.hard ? ' on Hard' : ''}, one try. Odd or even, low or high, three seconds.`,
    };
  }
  return { title: 'Left or Right', description: 'Odd or even. Low or high. Three seconds. Daily challenge, friend challenges and leaderboards.' };
}

export const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

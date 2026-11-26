// Left or Right: game rules, shared by the app, the server and the tests.
// Pure functions only: no DOM, no network, no clock.

export const ROUND_OPTIONS = [15, 20, 30, 50];
export const BASE_LIMIT = 3000;      // ms per answer
export const HARD_END_LIMIT = 1500;  // Hard mode shrinks the timer to this by the last round
export const MAX_PAUSES = 3;         // per game
export const MIN_MS = 150;           // faster than any real read-and-decide: a guess
export const LATE_GRACE_MS = 250;    // network/timer jitter allowed past the limit
export const MAX_PER_ROUND = 250;    // 100 + 100 speed + 50 streak
export const DAILY_ROUNDS = 20;
export const DAY_ONE = '2026-11-26'; // Daily #1
export const NUMBERS = [1, 2, 3, 4, 6, 7, 8, 9];

export const TYPES = {
  parity: { left: 'ODD', right: 'EVEN', answer: n => (n % 2 === 0 ? 'right' : 'left') },
  size:   { left: 'LOW', right: 'HIGH', answer: n => (n > 5 ? 'right' : 'left') },
};

export const opposite = d => (d === 'left' ? 'right' : 'left');
export const valueSide = q => TYPES[q.type].answer(q.n);                       // the category the number is in
export const sideFor = q => (q.flip ? opposite(valueSide(q)) : valueSide(q));   // where to swipe this round
export const valueLabel = q => (valueSide(q) === 'left' ? TYPES[q.type].left : TYPES[q.type].right);
// 100 for a correct answer, up to +100 for speed, +10 per streak step (max +50).
export const pointsFor = (ms, streak, limit) =>
  100 + Math.round(100 * Math.max(0, 1 - ms / limit)) + Math.min(streak - 1, 5) * 10;

// ---------- seeded randomness: the same seed always gives the same questions ----------
export function seedHash(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}
export function rngFrom(str) {
  let a = seedHash(str);
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SEED_CHARS = 'abcdefghijkmnpqrstuvwxyz23456789';
export const newSeed = (rand = Math.random) =>
  Array.from({ length: 6 }, () => SEED_CHARS[(rand() * SEED_CHARS.length) | 0]).join('');
export const challengeCode = (seed, rounds, hard) => `${seed}-${rounds}${hard ? '-h' : ''}`;
export const CODE_RE = /^([a-z0-9]{6})-(15|20|30|50)(-h)?$/;
export function parseCode(code) {
  const m = CODE_RE.exec(code || '');
  return m ? { code, seed: m[1], rounds: +m[2], hard: !!m[3] } : null;
}

export function makeQuestion(rng, i, total, hard, prev) {
  let q;
  do q = { type: rng() < 0.5 ? 'parity' : 'size', n: NUMBERS[(rng() * NUMBERS.length) | 0] };
  while (prev && prev.type === q.type && prev.n === q.n);
  q.flip = false; q.form = 'digit'; q.limit = BASE_LIMIT;
  if (hard) {
    q.flip = i >= 3 && rng() < 0.25;
    const f = rng();
    q.form = i < 2 ? 'digit' : f < 0.2 ? 'word' : f < 0.35 ? 'dots' : 'digit';
    q.limit = Math.round(BASE_LIMIT - (BASE_LIMIT - HARD_END_LIMIT) * (total > 1 ? i / (total - 1) : 0));
  }
  return q;
}
export function buildQuestions(seed, total, hard) {
  const rng = rngFrom(`${seed}:${hard ? 'h' : 'n'}:${total}`);
  const list = [];
  for (let i = 0; i < total; i++) list.push(makeQuestion(rng, i, total, hard, list[i - 1]));
  return list;
}

const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

// ---------- a game run ----------
// Every question shown and what happened to it is an event:
//   { o: 'a', d: 'left' | 'right' | null, ms, s: 'main' | 'spare' }  answered (d null = ran out of time)
//   { o: 's', s }                                                     skipped by a pause mid-question
// The server replays these events against the seed to compute the score itself.
export class Run {
  constructor({ seed, rounds, hard }) {
    this.seed = seed; this.rounds = rounds; this.hard = !!hard;
    this.qs = buildQuestions(seed, rounds, this.hard);
    this.spare = rngFrom(seed + ':spare');   // replacements for questions a pause interrupted
    this.events = [];
    this.round = 0; this.replace = false; this.prev = null; this.current = null;
    this.score = 0; this.correct = 0; this.streak = 0; this.bestStreak = 0; this.skips = 0;
    this.times = []; this.log = [];
    this.split = { parity: [0, 0], size: [0, 0] };
  }

  get done() { return this.round >= this.rounds; }

  next() {
    if (this.done) return null;
    const src = this.replace ? 'spare' : 'main';
    const base = this.replace ? makeQuestion(this.spare, this.round, this.rounds, this.hard, this.prev) : this.qs[this.round];
    const q = { ...base, src, sw: this.prev ? this.prev.type !== base.type : null };
    this.replace = false;
    this.prev = q; this.current = q;
    return q;
  }

  answer(dir, ms) {
    const q = this.current;
    if (!q) throw new Error('no question on screen');
    this.current = null;
    ms = Math.max(0, Math.round(ms));
    this.round++;
    this.events.push({ o: 'a', d: dir, ms, s: q.src });
    const right = sideFor(q);
    const early = !!dir && ms < MIN_MS;
    const late = ms > q.limit + LATE_GRACE_MS;
    const ok = dir === right && !early && !late;
    this.split[q.type][1]++;
    this.log.push({ sw: q.sw, ms: dir ? ms : q.limit, ok, lim: q.limit });
    let pts = 0;
    if (ok) {
      this.correct++; this.streak++; this.bestStreak = Math.max(this.bestStreak, this.streak);
      this.split[q.type][0]++; this.times.push(ms);
      pts = pointsFor(ms, this.streak, q.limit);
      this.score += pts;
    } else {
      this.streak = 0;
    }
    return { ok, early, pts, right, label: valueLabel(q), q };
  }

  // A pause while a question is showing: the question is thrown away and replaced, the streak ends.
  skip() {
    const q = this.current;
    if (!q) throw new Error('no question on screen');
    if (this.skips >= MAX_PAUSES) throw new Error('no pauses left');
    this.current = null;
    this.skips++;
    this.streak = 0;
    this.replace = true;
    this.events.push({ o: 's', s: q.src });
  }

  summary() {
    const sw = this.log.filter(l => l.ok && l.sw === true).map(l => l.ms);
    const rep = this.log.filter(l => l.ok && l.sw === false).map(l => l.ms);
    const avg = mean(this.times);
    return {
      score: this.score, correct: this.correct, rounds: this.rounds, played: this.round,
      avgMs: avg == null ? null : Math.round(avg), bestStreak: this.bestStreak, skips: this.skips,
      split: this.split, swMs: sw.length ? Math.round(mean(sw)) : null, repMs: rep.length ? Math.round(mean(rep)) : null,
    };
  }

  // Rebuild a run from its events (resume on the device; scoring on the server).
  // Throws if the events could not have come from a real game with this seed.
  static replay(cfg, events, { allowUnfinished = false } = {}) {
    const run = new Run(cfg);
    if (!Array.isArray(events) || events.length > cfg.rounds + MAX_PAUSES) throw new Error('bad events');
    for (const e of events) {
      if (run.done) throw new Error('events after the last round');
      const q = run.next();
      if (!e || e.s !== q.src) throw new Error('question order does not match');
      if (e.o === 's') run.skip();
      else if (e.o === 'a') {
        if (!(e.d === 'left' || e.d === 'right' || e.d === null)) throw new Error('bad answer');
        if (!Number.isFinite(e.ms) || e.ms < 0 || e.ms > 600000) throw new Error('bad time');
        run.answer(e.d, e.ms);
      } else throw new Error('bad event');
    }
    if (!allowUnfinished && !run.done) throw new Error('game not finished');
    return run;
  }
}

// The least wall-clock time a run can have taken: every answer's time, plus the short pause
// the app always shows between questions. Used by the server to reject replayed or scripted runs.
export function minimumDurationMs(events) {
  return events.reduce((t, e) => t + (e.o === 'a' ? (e.d === null ? 0 : e.ms) + 450 : 0), 0);
}

// Human answers are slower than ~220 ms on average for a read-and-decide task, and they vary.
// A run whose typical answer is faster, or whose timing barely varies, is a script.
export const HUMAN_MEDIAN_MS = 220;
export const HUMAN_SPREAD_MS = 30;
export function timingCheck(events) {
  const ms = events.filter(e => e.o === 'a' && e.d !== null).map(e => e.ms).sort((a, b) => a - b);
  if (ms.length < 8) return { ok: true };
  const median = ms[Math.floor(ms.length / 2)];
  const avg = ms.reduce((a, b) => a + b, 0) / ms.length;
  const spread = Math.sqrt(ms.reduce((a, b) => a + (b - avg) ** 2, 0) / ms.length);
  if (median < HUMAN_MEDIAN_MS) return { ok: false, reason: `median ${median} ms` };
  if (spread < HUMAN_SPREAD_MS) return { ok: false, reason: `spread ${Math.round(spread)} ms` };
  return { ok: true };
}

// Nicknames: letters (any language), numbers, spaces and . _ - ' only; no invisible or
// direction-changing characters that could make one name look like another.
const RESERVED = ['admin', 'administrator', 'moderator', 'mod', 'system', 'support', 'staff', 'official', 'null', 'undefined', 'anonymous', 'player'];
export function cleanNickname(raw) {
  const s = String(raw ?? '').normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f­​-‏‪-‮⁠-⁯﻿]/g, '')
    .replace(/\s+/g, ' ').trim();
  if (s.length < 2 || s.length > 20) return { ok: false, error: 'Use 2 to 20 characters.' };
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._'-]*$/u.test(s)) return { ok: false, error: 'Use letters, numbers, spaces and . _ - \' only.' };
  if (RESERVED.includes(s.toLowerCase())) return { ok: false, error: 'That nickname is reserved. Pick another.' };
  if (isOffensive(s)) return { ok: false, error: 'Please pick a different nickname.' };
  return { ok: true, value: s };
}

// A small list of words nobody needs in a nickname. Long words are matched anywhere (so spacing,
// symbols and l33t spelling don't get round it); short ones only as whole words, so names like
// "Cassidy" or "Scunthorpe" aren't caught by accident.
const BLOCK_ANYWHERE = ['fuck', 'shit', 'bitch', 'cunt', 'nigger', 'nigga', 'faggot', 'retard', 'whore', 'slut',
  'rapist', 'pussy', 'penis', 'vagina', 'dildo', 'porn', 'nazi', 'hitler', 'bastard', 'motherf', 'asshole', 'wanker', 'twat',
  'chink', 'spastic', 'tranny', 'kike', 'paki', 'coon'];
const BLOCK_WORD = ['ass', 'cum', 'fag', 'sex', 'kkk', 'rape', 'dick', 'cock', 'tit', 'tits', 'piss', 'wtf', 'stfu', 'gay'];
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'l' };
export function isOffensive(name) {
  const lower = String(name).toLowerCase();
  const collapse = t => t.replace(/(.)\1+/g, '$1');   // "fuuuck" and "fuck" look the same after this
  const squashed = collapse([...lower].map(ch => LEET[ch] ?? ch).join('').replace(/[^a-z]/g, '')
    .replace(/scunthorpe|penistone|cockburn|shitake|matsushita|hancock|assassin|grape|therapist/g, ''));   // real words that contain blocked ones
  if (BLOCK_ANYWHERE.some(w => squashed.includes(collapse(w)))) return true;
  const words = [...lower].map(ch => LEET[ch] ?? ch).join('').split(/[^a-z]+/).filter(Boolean);
  return words.some(w => BLOCK_WORD.includes(w));
}

// ---------- streaks, with freezes ----------
// Every 7 Dailies in a row earn a streak freeze (you can hold 2). A freeze covers one missed day
// automatically, so one busy day doesn't wipe out a long streak.
export const FREEZE_EVERY = 7, MAX_FREEZES = 2;
export function streakInfo(playedDays, today) {
  const days = [...new Set(playedDays)].filter(d => d <= today).sort();
  let streak = 0, freezes = 0, earned = 0, prev = null, usedOn = [];
  for (const d of days) {
    if (prev) {
      let gap = Math.round((Date.parse(d) - Date.parse(prev)) / 864e5) - 1;   // missed days in between
      const covered = gap > 0 && gap <= freezes;
      if (gap > 0 && !covered) { streak = 0; earned = 0; freezes = 0; usedOn = []; }
      else if (covered) { freezes -= gap; for (let i = 1; i <= gap; i++) usedOn.push(addDays(prev, i)); }
    }
    streak++; earned++;
    if (earned % FREEZE_EVERY === 0 && freezes < MAX_FREEZES) freezes++;
    prev = d;
  }
  // a streak is still alive today if the last Daily was today or yesterday (or the gap fits the freezes left)
  if (prev && prev < today) {
    const missed = Math.round((Date.parse(today) - Date.parse(prev)) / 864e5) - 1;
    if (missed > freezes) return { streak: 0, freezes: 0, usedOn: [], alive: false };
  }
  return { streak, freezes, usedOn, alive: streak > 0 };
}

// ---------- levels & badges ----------
export function levelInfo(totalScore) {
  let xp = Math.floor(totalScore / 10), level = 1, need = 300;
  while (xp >= need) { xp -= need; level++; need = Math.round(need * 1.15); }
  const title = level >= 20 ? 'Lightning' : level >= 15 ? 'Swift' : level >= 10 ? 'Sharp' : level >= 5 ? 'Quick' : 'Rookie';
  return { level, title, into: xp, need, progress: xp / need };
}

export const BADGES = [
  { id: 'first', name: 'First game', desc: 'Finish a game', test: s => s.games >= 1 },
  { id: 'ten', name: 'Regular', desc: 'Finish 10 games', test: s => s.games >= 10 },
  { id: 'fifty', name: 'Dedicated', desc: 'Finish 50 games', test: s => s.games >= 50 },
  { id: 'perfect', name: 'Perfect round', desc: 'Get every answer right', test: s => s.perfect >= 1 },
  { id: 'hardperfect', name: 'Hard and flawless', desc: 'A perfect game on Hard', test: s => s.hardPerfect >= 1 },
  { id: 'speed', name: 'Quick thinker', desc: 'Average under 0.5 s in a full game', test: s => s.fastest !== null && s.fastest < 500 },
  { id: 'marathon', name: 'Marathon', desc: 'Finish a 50-round game', test: s => s.marathon >= 1 },
  { id: 'streak3', name: 'On a roll', desc: 'A 3-day Daily streak', test: s => s.bestStreak >= 3 },
  { id: 'streak7', name: 'Week strong', desc: 'A 7-day Daily streak', test: s => s.bestStreak >= 7 },
  { id: 'streak30', name: 'Unstoppable', desc: 'A 30-day Daily streak', test: s => s.bestStreak >= 30 },
  { id: 'challenger', name: 'Challenger', desc: 'Play a friend’s challenge', test: s => s.challenges >= 1 },
];
export function badgeState(games, today) {
  const full = games.filter(g => g.correct != null);
  const dailyDays = full.filter(g => g.mode === 'daily' && g.day).map(g => g.day).sort();
  let best = 0;
  for (let i = 0; i < dailyDays.length; i++) best = Math.max(best, streakInfo(dailyDays.slice(0, i + 1), dailyDays[i]).streak);
  const s = {
    games: full.length,
    perfect: full.filter(g => g.correct === g.rounds).length,
    hardPerfect: full.filter(g => g.hard && g.correct === g.rounds).length,
    fastest: full.filter(g => g.avgMs && g.correct >= Math.min(15, g.rounds)).reduce((m, g) => (m === null || g.avgMs < m ? g.avgMs : m), null),
    marathon: full.filter(g => g.rounds === 50 && g.correct != null).length,
    challenges: full.filter(g => g.mode === 'challenge').length,
    bestStreak: best,
  };
  return BADGES.map(b => ({ id: b.id, name: b.name, desc: b.desc, earned: !!b.test(s) }));
}

// ---------- dates ----------
const pad2 = n => String(n).padStart(2, '0');
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const keyToDate = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
export const dayNumber = k => Math.round((keyToDate(k) - keyToDate(DAY_ONE)) / 864e5) + 1;
export const addDays = (k, n) => { const d = keyToDate(k); d.setDate(d.getDate() + n); return dayKey(d); };

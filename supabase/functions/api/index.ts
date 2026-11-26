// Left or Right game API. All reads and writes go through here; the tables are closed to browsers.
// The server picks seeds, times games and re-scores every finished game from its events,
// so a score posted by editing the app's code, or by a script, is rejected.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';
import {
  Run, ROUND_OPTIONS, DAILY_ROUNDS, MAX_PER_ROUND, MIN_MS, RULES_VERSION, newSeed, challengeCode, parseCode,
  minimumDurationMs, timingCheck, cleanNickname, streakInfo, dayNumber, addDays,
} from './core.js';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

// ---------- limits ----------
const MAX_BODY_BYTES = 16 * 1024;
const LIMITS = {
  registerPerIpHour: 5, registerPerIpDay: 20,   // new players from one network
  startsPer10Min: 40,                           // a real game takes 30 s or more
  renameEveryMs: 10 * 60 * 1000,
  classicMaxAgeMs: 48 * 60 * 60 * 1000,         // a Classic game played offline can be posted for 2 days
  reportsPerDay: 10,
  errorsPerIpHour: 30,                          // error reports from one network
};
const ALLOWED_ORIGINS = [
  'https://left-or-right-peach.vercel.app',
  'https://left-or-right-ajoysrs-projects.vercel.app',
  'http://localhost:5173', 'http://127.0.0.1:5173',
];
const PREVIEW_ORIGIN = /^https:\/\/left-or-right-[a-z0-9]+-ajoysrs-projects\.vercel\.app$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function cors(req: Request) {
  const origin = req.headers.get('origin') || '';
  const allow = ALLOWED_ORIGINS.includes(origin) || PREVIEW_ORIGIN.test(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-player-token, x-admin-key',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };
}
class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
const fail = (status: number, msg: string): never => { throw new HttpError(status, msg); };

// ---------- helpers ----------
const cryptoRand = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
async function hmac(secret: string, msg: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg)));
}
let secrets: Record<string, string> | null = null;
async function secret(key: string) {
  if (!secrets) {
    const { data, error } = await db.from('app_secrets').select('key, value');
    if (error || !data) fail(500, 'Server not ready. Try again.');
    secrets = Object.fromEntries(data!.map(r => [r.key, r.value]));
  }
  return secrets![key];
}
// Daily questions come from a server secret, so nobody can work out tomorrow's set in advance.
// (Days up to 2026-11-26 had already started with date-based questions; they keep them so everyone
// on the same day still gets the same set.)
const dailySeed = async (day: string) => day <= '2026-11-26' ? 'daily-' + day
  : 'd' + (await hmac(await secret('daily_secret'), 'daily:' + day)).slice(0, 12);
const ipHash = async (req: Request) => {
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('cf-connecting-ip') || 'unknown';
  return sha256((await secret('ip_salt')) + ip);
};
const utcDay = (offset = 0) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
const weekStartIso = () => {
  const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString();
};
const since = (ms: number) => new Date(Date.now() - ms).toISOString();
const isUnique = (e: any) => e && (e.code === '23505' || /duplicate key/i.test(e.message || ''));

const nick = (raw: unknown) => { const r = cleanNickname(raw); if (!r.ok) fail(400, r.error!); return r.value!; };
const rounds = (v: unknown) => { const n = Number(v); if (!ROUND_OPTIONS.includes(n)) fail(400, 'Unknown game length.'); return n; };
const gameId = (v: unknown) => { if (typeof v !== 'string' || !UUID.test(v)) fail(400, 'Game not found.'); return v as string; };

async function player(req: Request) {
  const token = req.headers.get('x-player-token') || '';
  if (!/^[0-9a-f]{64}$/.test(token)) fail(401, 'Not signed in.');
  const { data } = await db.from('players').select('id, nickname, renamed_at, is_guest, banned').eq('token_hash', await sha256(token)).maybeSingle();
  if (!data) fail(401, 'Not signed in.');
  if (data!.banned) fail(403, 'This player was removed for breaking the rules.');
  return data!;
}

// The admin page sends its key in a header; compare in constant time.
async function admin(req: Request) {
  const given = req.headers.get('x-admin-key') || '', real = await secret('admin_key');
  let diff = given.length ^ real.length;
  for (let i = 0; i < Math.max(given.length, real.length); i++) diff |= (given.charCodeAt(i) || 0) ^ (real.charCodeAt(i) || 0);
  if (diff !== 0 || !real) { await new Promise(r => setTimeout(r, 400)); fail(403, 'Wrong admin key.'); }
}

// Keys for signing reminder notifications, made once and kept server-side.
async function vapid() {
  if (!(await secret('vapid_public'))) {
    const k = webpush.generateVAPIDKeys();
    await db.from('app_secrets').upsert([{ key: 'vapid_public', value: k.publicKey }, { key: 'vapid_private', value: k.privateKey }], { onConflict: 'key', ignoreDuplicates: true });
    secrets = null;   // re-read, in case another request made them first
  }
  return { pub: await secret('vapid_public'), priv: await secret('vapid_private') };
}

// Leaderboards are read far more often than they change: keep each one for a few seconds.
const boardCache = new Map<string, { t: number; rows: any[] }>();
const BOARD_TTL_MS = 15000;
const rowOut = (r: any) => ({ playerId: r.player_id, nickname: r.nickname, score: r.score, correct: r.correct, avgMs: r.avg_ms });
async function board(kind: 'classic' | 'week' | 'daily' | 'challenge', p: any, fresh = false) {
  const key = kind === 'daily' ? 'd:' + p.day : kind === 'challenge' ? 'c:' + p.code : `${kind}:${p.rounds}:${!!p.hard}`;
  const hit = boardCache.get(key);
  if (!fresh && hit && Date.now() - hit.t < BOARD_TTL_MS) return hit.rows;
  const { data, error } = kind === 'daily' ? await db.rpc('board_daily', { p_day: p.day })
    : kind === 'challenge' ? await db.rpc('board_challenge', { p_code: p.code })
    : await db.rpc('board_classic', { p_rounds: p.rounds, p_hard: !!p.hard, p_since: kind === 'week' ? weekStartIso() : null });
  if (error) fail(500, 'Could not load the leaderboard.');
  const rows = (data || []).map(rowOut);
  if (boardCache.size > 500) boardCache.clear();
  boardCache.set(key, { t: Date.now(), rows });
  return rows;
}
const forgetBoards = () => boardCache.clear();

// Where this run placed, out of how many, and (for Classic, best score per player) where the
// player's best run sits.
async function placement(game: any) {
  const { data } = await db.rpc('run_placement', { p_game: game.id });
  const p = (data || [])[0] || null;
  let bestRank = null;
  if (game.mode === 'classic') {
    const list = await board('classic', { rounds: game.rounds, hard: game.hard }, true);
    const idx = list.findIndex((r: any) => r.playerId === game.player_id);
    bestRank = idx >= 0 ? idx + 1 : null;
  }
  return { place: p?.place ?? null, of: p?.total ?? null, bestRank };
}
const resultOf = (g: any) => ({
  score: g.score, correct: g.correct, rounds: g.rounds, avgMs: g.avg_ms, bestStreak: g.best_streak, skips: g.pauses,
  swMs: g.sw_ms, repMs: g.rep_ms, split: { parity: [g.par_right, g.par_total], size: [g.size_right, g.size_total] },
});

// Product counts (no user ids): what the app reports, plus a few the server knows for certain.
const EVENT_NAMES = new Set(['visit', 'practice_start', 'practice_done', 'practice_skip', 'play_start', 'game_finish',
  'finish_saved_local', 'finish_retry', 'finish_failed', 'daily_open', 'challenge_open', 'challenge_start',
  'share_open', 'share_done', 'install', 'reminder_on', 'name_saved', 'review_open', 'report', 'restart_fail',
  'landing_score', 'untimed_start']);
const bump = (names: string[]) => db.rpc('bump_events', { p_names: names }).then(() => {}, () => {});

// The Daily runs on UTC days. Allow the previous day for a few minutes after midnight, for a
// player who opened it just before.
const openDailyDays = () => {
  const ms = Date.now() % 864e5;
  return ms < 10 * 60000 ? [utcDay(0), utcDay(-1)] : [utcDay(0)];
};
// Which question rules a run uses. The app says which it knows; an out-of-date app is told to reload.
const dailyVersion = (day: string) => (day <= '2026-11-26' ? 1 : 2);
const needVersion = (v: number, b: any) => { if (v > 1 && Number(b.v) < v) fail(426, 'A new version of the game is ready. Reload the page to play.'); };

// Push services we deliver to. Anything else is refused, so the server can't be used to call other sites.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/,
  /\.notify\.windows\.com$/, /^web\.push\.apple\.com$/, /^android\.googleapis\.com$/];
const pushHostOk = (endpoint: string) => { try { const u = new URL(endpoint); return u.protocol === 'https:' && PUSH_HOSTS.some(r => r.test(u.hostname)); } catch { return false; } };
const validTz = (tz: unknown) => { if (typeof tz !== 'string' || !tz || tz.length > 64) return null; try { new Intl.DateTimeFormat('en', { timeZone: tz }); return tz; } catch { return null; } };
function localNow(tz: string | null, offsetMin: number) {
  if (tz) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date()).map(x => [x.type, x.value]));
    return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24 };
  }
  const local = new Date(Date.now() + offsetMin * 60000);
  return { day: local.toISOString().slice(0, 10), hour: local.getUTCHours() };
}
function bestDailyStreak(days: string[]) {
  const sorted = [...new Set(days)].sort();
  let best = 0;
  for (let i = 0; i < sorted.length; i++) best = Math.max(best, streakInfo(sorted.slice(0, i + 1), sorted[i]).streak);
  return best;
}

async function startsRecently(playerId: string) {
  const { count } = await db.from('games').select('id', { count: 'exact', head: true }).eq('player_id', playerId).gte('started_at', since(10 * 60 * 1000));
  if ((count || 0) >= LIMITS.startsPer10Min) fail(429, 'Too many games started. Take a short break and try again.');
}

// ---------- actions ----------
const actions: Record<string, (req: Request, body: any) => Promise<unknown>> = {
  async register(req, b) {
    // Guests play first and pick a name later; they get a placeholder like "Guest 4821".
    const guest = b.guest === true;
    let nickname = guest ? '' : nick(b.nickname);
    const ip = await ipHash(req);
    const [{ count: hour }, { count: day }] = await Promise.all([
      db.from('players').select('id', { count: 'exact', head: true }).eq('ip_hash', ip).gte('created_at', since(36e5)),
      db.from('players').select('id', { count: 'exact', head: true }).eq('ip_hash', ip).gte('created_at', since(864e5)),
    ]);
    if ((hour || 0) >= LIMITS.registerPerIpHour || (day || 0) >= LIMITS.registerPerIpDay) fail(429, 'Too many new players from this network. Try again later.');
    const token = hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
    for (let attempt = 0; attempt < 5; attempt++) {
      if (guest) nickname = 'Guest ' + String(1000 + Math.floor(cryptoRand() * 9000));
      const { data, error } = await db.from('players').insert({ nickname, token_hash: await sha256(token), ip_hash: ip, is_guest: guest }).select('id, nickname, is_guest').single();
      if (!error) return { token, player: { id: data!.id, nickname: data!.nickname, guest: data!.is_guest } };
      if (!isUnique(error)) fail(500, 'Could not create your player.');
      if (!guest) fail(409, 'That nickname is taken. Try another.');
    }
    return fail(500, 'Could not create your player.');
  },

  async me(req) { const p = await player(req); return { player: { id: p.id, nickname: p.nickname, guest: p.is_guest } }; },

  async rename(req, b) {
    const me = await player(req);
    const nickname = nick(b.nickname);
    if (me.renamed_at && Date.now() - new Date(me.renamed_at).getTime() < LIMITS.renameEveryMs) fail(429, 'You can change your nickname again in a few minutes.');
    const { error } = await db.from('players').update({ nickname, renamed_at: new Date().toISOString(), is_guest: false }).eq('id', me.id);
    if (isUnique(error)) fail(409, 'That nickname is taken. Try another.');
    if (error) fail(500, 'Could not change your nickname.');
    return { player: { id: me.id, nickname, guest: false } };
  },

  // Deletes the player and everything tied to them (games, reminders); error reports keep no link.
  async deleteMe(req) {
    const me = await player(req);
    const { error } = await db.from('players').delete().eq('id', me.id);
    if (error) fail(500, 'Could not delete your player. Try again.');
    return { ok: true };
  },

  async start(req, b) {
    const me = await player(req);
    const mode = b.mode;
    if (mode === 'classic') {
      await startsRecently(me.id);
      const v = Number(b.v) >= RULES_VERSION ? RULES_VERSION : 1;
      const row = { player_id: me.id, mode, seed: newSeed(cryptoRand), rounds: rounds(b.rounds), hard: b.hard === true, rules_version: v };
      const { data, error } = await db.from('games').insert(row).select('id, seed, rounds, hard').single();
      if (error) fail(500, 'Could not start the game.');
      bump(['srv_start_classic']);
      return { gameId: data!.id, seed: data!.seed, rounds: data!.rounds, hard: data!.hard, mode, v };
    }
    if (mode === 'daily') {
      // one Daily a day for everyone, on UTC days; the app asks for today's unless it was opened just before midnight
      const open = openDailyDays();
      const day = DAY.test(String(b.day || '')) && open.includes(String(b.day)) ? String(b.day) : open[0];
      const existing = async () => (await db.from('games').select('id, seed, status, rules_version').eq('player_id', me.id).eq('mode', 'daily').eq('day', day).maybeSingle()).data;
      let g = await existing();
      if (!g) {
        const v = dailyVersion(day);
        needVersion(v, b);
        const { error } = await db.from('games').insert({ player_id: me.id, mode, seed: await dailySeed(day), rounds: DAILY_ROUNDS, hard: false, day, rules_version: v });
        if (error && !isUnique(error)) fail(500, 'Could not start the Daily.');   // a double tap simply finds the first one
        g = await existing();
        if (!g) fail(500, 'Could not start the Daily.');
        bump(['srv_start_daily']);
        return { gameId: g!.id, seed: g!.seed, rounds: DAILY_ROUNDS, hard: false, mode, day, v: g!.rules_version };
      }
      if (g.status !== 'open') fail(409, 'You’ve already played today’s challenge.');
      needVersion(g.rules_version, b);
      return { gameId: g.id, seed: g.seed, rounds: DAILY_ROUNDS, hard: false, mode, day, v: g.rules_version, resumed: true };
    }
    if (mode === 'challenge') {
      const c = parseCode(b.code);
      if (!c) fail(400, 'That challenge link isn’t valid.');
      const existing = async () => (await db.from('games').select('id, status, rules_version').eq('player_id', me.id).eq('mode', 'challenge').eq('code', c!.code).maybeSingle()).data;
      let g = await existing();
      if (g && g.status !== 'open') fail(409, 'You’ve already played this challenge.');
      if (g) { needVersion(g.rules_version, b); return { gameId: g.id, seed: c!.seed, rounds: c!.rounds, hard: c!.hard, mode, code: c!.code, v: g.rules_version, resumed: true }; }
      await startsRecently(me.id);
      // a challenge link works even if its creator never posted it (shared from an offline game);
      // its rules version is whatever the first player to open it used
      const fresh = Number(b.v) >= RULES_VERSION ? RULES_VERSION : 1;
      await db.from('challenges').upsert({ code: c!.code, seed: c!.seed, rounds: c!.rounds, hard: c!.hard, created_by: me.id, rules_version: fresh }, { onConflict: 'code', ignoreDuplicates: true });
      const { data: ch } = await db.from('challenges').select('rules_version').eq('code', c!.code).maybeSingle();
      const v = ch?.rules_version ?? fresh;
      needVersion(v, b);
      const { error } = await db.from('games').insert({ player_id: me.id, mode, seed: c!.seed, rounds: c!.rounds, hard: c!.hard, code: c!.code, rules_version: v });
      if (error && !isUnique(error)) fail(500, 'Could not start the challenge.');
      g = await existing();
      if (!g) fail(500, 'Could not start the challenge.');
      bump(['srv_start_challenge']);
      return { gameId: g!.id, seed: c!.seed, rounds: c!.rounds, hard: c!.hard, mode, code: c!.code, v };
    }
    return fail(400, 'Unknown mode.');
  },

  async finish(req, b) {
    const me = await player(req);
    const id = gameId(b.gameId);
    const { data: game } = await db.from('games').select('*').eq('id', id).eq('player_id', me.id).maybeSingle();
    if (!game) fail(404, 'Game not found.');
    // Sending the same game again (the answer to the first try was lost) gets the saved result back.
    if (game!.status === 'finished') return { ...resultOf(game), ...(await placement(game)), already: true };
    if (game!.status === 'rejected') fail(422, 'This game couldn’t be verified, so it wasn’t posted.');
    const events = b.events;
    const reject = async (reason: string) => {
      await db.from('games').update({ status: 'rejected', reject_reason: reason.slice(0, 200), finished_at: new Date().toISOString() }).eq('id', id).eq('status', 'open');
      bump(['srv_reject']);
      return fail(422, 'This game couldn’t be verified, so it wasn’t posted.');
    };
    let run: any;
    try {
      // Daily and challenges are one try: ending early still counts with the rounds played.
      run = Run.replay({ seed: game!.seed, rounds: game!.rounds, hard: game!.hard, version: game!.rules_version }, events, { allowUnfinished: game!.mode !== 'classic' && b.ended === true });
    } catch (e) { return reject('replay: ' + (e as Error).message); }
    const elapsed = Date.now() - new Date(game!.started_at).getTime();
    if (elapsed + 2000 < minimumDurationMs(events)) return reject('faster than the clock');
    if (game!.mode === 'classic' && elapsed > LIMITS.classicMaxAgeMs) return reject('submitted too late');
    const timing = timingCheck(events);
    if (!timing.ok) return reject('timing: ' + timing.reason);
    const s = run.summary();
    if (s.score > game!.rounds * MAX_PER_ROUND || (s.avgMs != null && s.avgMs < MIN_MS)) return reject('impossible score');
    const update = {
      status: 'finished', finished_at: new Date().toISOString(), score: s.score, correct: s.correct, avg_ms: s.avgMs,
      best_streak: s.bestStreak, pauses: s.skips, sw_ms: s.swMs, rep_ms: s.repMs,
      par_right: s.split.parity[0], par_total: s.split.parity[1], size_right: s.split.size[0], size_total: s.split.size[1],
    };
    // only the first submit of a game counts, even if two arrive at once
    const { data: done, error } = await db.from('games').update(update).eq('id', id).eq('status', 'open').select('*');
    if (error) fail(500, 'Could not save the game. Try again.');
    if (!done || !done.length) {
      // a second copy of this submit won the race: return what it saved
      const { data: again } = await db.from('games').select('*').eq('id', id).maybeSingle();
      if (again?.status === 'finished') return { ...resultOf(again), ...(await placement(again)), already: true };
      fail(409, 'This game was already submitted.');
    }
    forgetBoards();
    bump(['srv_finish']);
    return { ...s, ...(await placement(done[0])) };
  },

  async challengeCreate(req, b) {
    const me = await player(req);
    const { data: game } = await db.from('games').select('*').eq('id', gameId(b.gameId)).eq('player_id', me.id).maybeSingle();
    if (!game || game.mode !== 'classic' || game.status !== 'finished') fail(400, 'Finish a Classic game first.');
    const code = challengeCode(game!.seed, game!.rounds, game!.hard);
    await db.from('challenges').upsert({ code, seed: game!.seed, rounds: game!.rounds, hard: game!.hard, created_by: me.id, rules_version: game!.rules_version }, { onConflict: 'code', ignoreDuplicates: true });
    // the creator's own run counts as their one try on this challenge
    const { data: mine } = await db.from('games').select('id').eq('player_id', me.id).eq('mode', 'challenge').eq('code', code).maybeSingle();
    if (!mine) {
      const { id: _id, mode: _m, day: _d, code: _c, ...rest } = game!;
      const { error } = await db.from('games').insert({ ...rest, mode: 'challenge', code });
      if (error && !isUnique(error)) fail(500, 'Could not create the challenge.');
    }
    return { code };
  },

  async challengeInfo(_req, b) {
    const c = parseCode(b.code);
    if (!c) fail(400, 'That challenge link isn’t valid.');
    const { data } = await db.from('challenges').select('created_by, rules_version, players(nickname)').eq('code', c!.code).maybeSingle();
    return {
      ...c, v: data?.rules_version ?? null, createdBy: data ? { playerId: data.created_by, nickname: (data as any).players?.nickname || null } : null,
      board: await board('challenge', { code: c!.code }),
    };
  },

  // Public facts about one verified game, for link previews (the same fields leaderboards show).
  async share(_req, b) {
    const id = gameId(b.gameId);
    const { data: g } = await db.from('games')
      .select('id, mode, rounds, hard, day, code, score, correct, avg_ms, best_streak, player_id, players(nickname, banned)')
      .eq('id', id).eq('status', 'finished').maybeSingle();
    if (!g || (g as any).players?.banned) fail(404, 'Game not found.');
    const pl = await placement(g);
    return {
      mode: g!.mode, rounds: g!.rounds, hard: g!.hard, day: g!.day, code: g!.code, score: g!.score, correct: g!.correct,
      avgMs: g!.avg_ms, bestStreak: g!.best_streak, nickname: (g as any).players?.nickname || 'A player',
      rank: pl.place, of: pl.of,
    };
  },

  async boards(_req, b) {
    const r = rounds(b.rounds);
    const day = typeof b.day === 'string' && DAY.test(b.day) ? b.day : utcDay(0);
    const [all, week, daily] = await Promise.all([
      board('classic', { rounds: r, hard: b.hard === true }),
      board('week', { rounds: r, hard: b.hard === true }),
      day ? board('daily', { day }) : Promise.resolve([]),
    ]);
    return { all, week, daily };
  },

  // ---------- product counts and reports ----------
  async events(req, b) {
    const names = Array.isArray(b.names) ? b.names.filter((n: unknown) => typeof n === 'string' && EVENT_NAMES.has(n)).slice(0, 20) : [];
    if (names.length) await bump(names);
    return { ok: true };
  },

  async report(req, b) {
    const me = await player(req);
    const target = gameId(b.playerId);
    if (target === me.id) fail(400, 'You can’t report yourself.');
    const reason = ['name', 'score', 'other'].includes(b.reason) ? b.reason : fail(400, 'Pick a reason.');
    const { count } = await db.from('reports').select('id', { count: 'exact', head: true }).eq('reporter_id', me.id).gte('created_at', since(864e5));
    if ((count || 0) >= LIMITS.reportsPerDay) fail(429, 'You’ve sent a lot of reports today. Thanks, we’ll look at them.');
    const note = typeof b.note === 'string' ? b.note.trim().slice(0, 200) || null : null;
    const { error } = await db.from('reports').insert({ reporter_id: me.id, target_id: target, reason, note });
    if (error && !isUnique(error)) fail(error.code === '23503' ? 404 : 500, 'Could not send the report.');
    bump(['report']);
    return { ok: true };
  },

  // ---------- error reports from browsers ----------
  async logError(req, b) {
    const ip = await ipHash(req);
    const { count } = await db.from('client_errors').select('id', { count: 'exact', head: true }).eq('ip_hash', ip).gte('at', since(36e5));
    if ((count || 0) >= LIMITS.errorsPerIpHour) return { ok: true };   // quietly drop floods
    let playerId = null;
    try { playerId = (await player(req)).id; } catch {}
    const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : null);
    const message = str(b.message, 500);
    if (!message) fail(400, 'Bad request.');
    await db.from('client_errors').insert({ player_id: playerId, message, stack: str(b.stack, 2000), url: str(b.url, 300), ua: str(req.headers.get('user-agent'), 300), ip_hash: ip });
    return { ok: true };
  },

  // ---------- daily reminder notifications ----------
  async pushKey() { return { key: (await vapid()).pub }; },

  async pushSubscribe(req, b) {
    const me = await player(req);
    const sub = b.subscription || {};
    const endpoint = String(sub.endpoint || ''), p256dh = String(sub.keys?.p256dh || ''), auth = String(sub.keys?.auth || '');
    if (!pushHostOk(endpoint) || endpoint.length > 1000 || !p256dh || p256dh.length > 200 || !auth || auth.length > 100) fail(400, 'Bad subscription.');
    const tz = Math.max(-840, Math.min(840, Math.round(Number(b.tzOffsetMin) || 0)));
    const tzName = validTz(b.tz);
    const hour = Number.isInteger(b.hour) && b.hour >= 0 && b.hour <= 23 ? b.hour : 18;
    const { count } = await db.from('push_subscriptions').select('id', { count: 'exact', head: true }).eq('player_id', me.id);
    if ((count || 0) >= 5) await db.from('push_subscriptions').delete().eq('player_id', me.id);   // keep the newest devices only
    const { error } = await db.from('push_subscriptions').upsert({ player_id: me.id, endpoint, p256dh, auth, tz_offset_min: tz, tz: tzName, remind_hour: hour, fail_count: 0 }, { onConflict: 'endpoint' });
    if (error) fail(500, 'Could not turn on reminders.');
    return { ok: true, hour };
  },

  async pushUnsubscribe(req, b) {
    const me = await player(req);
    await db.from('push_subscriptions').delete().eq('player_id', me.id).eq('endpoint', String(b.endpoint || ''));
    return { ok: true };
  },

  // Called every hour by the database scheduler. Reminds players whose local reminder hour it is
  // and who haven't played today's Daily yet.
  async sendReminders(req) {
    if (req.headers.get('x-cron-key') !== (await secret('cron_key'))) fail(403, 'Forbidden.');
    const keys = await vapid();
    webpush.setVapidDetails('https://left-or-right-peach.vercel.app', keys.pub, keys.priv);
    const { data: subs } = await db.from('push_subscriptions').select('*').limit(5000);
    let sent = 0, removed = 0, skipped = 0, failed = 0;
    const today = utcDay(0);   // the Daily is on UTC days
    const send = (sub: any, payload: string) => webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 6 * 3600 });
    for (const s of subs || []) {
      const local = localNow(s.tz, s.tz_offset_min);
      // send in the reminder hour, or up to 3 hours later if an earlier try failed
      if (local.hour < s.remind_hour || local.hour > s.remind_hour + 3 || s.last_sent_day === local.day) { skipped++; continue; }
      if (!pushHostOk(s.endpoint)) { await db.from('push_subscriptions').delete().eq('id', s.id); removed++; continue; }
      const { data: played } = await db.from('games').select('day').eq('player_id', s.player_id).eq('mode', 'daily').eq('status', 'finished').gte('day', addDays(today, -90));
      const days = (played || []).map(g => g.day);
      if (days.includes(today)) { await db.from('push_subscriptions').update({ last_sent_day: local.day }).eq('id', s.id); skipped++; continue; }
      const st = streakInfo(days, today);
      const body = st.alive && st.streak > 0 ? `Keep your ${st.streak}-day streak going. Same 20 questions for everyone.` : 'Same 20 questions for everyone. One try.';
      const payload = JSON.stringify({ title: `Daily #${dayNumber(today)} is ready`, body, url: '/?view=daily' });
      let ok = false;
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        try { await send(s, payload); ok = true; }
        catch (e) {
          const code = (e as any)?.statusCode;
          if (code === 404 || code === 410) { await db.from('push_subscriptions').delete().eq('id', s.id); removed++; break; }
          const transient = !code || code === 429 || code >= 500;
          if (!transient || attempt === 2) { console.error('push failed', code); break; }
          await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        }
      }
      if (ok) { sent++; await db.from('push_subscriptions').update({ last_sent_day: local.day, fail_count: 0 }).eq('id', s.id); }
      else {
        failed++;
        // try again next hour; after repeated failures, stop
        const fails = (s.fail_count || 0) + 1;
        if (fails >= 6) { await db.from('push_subscriptions').delete().eq('id', s.id); removed++; }
        else await db.from('push_subscriptions').update({ fail_count: fails }).eq('id', s.id);
      }
    }
    return { sent, removed, skipped, failed };
  },

  // ---------- admin page ----------
  async adminSummary(req) {
    await admin(req);
    const head = (q: any) => q.then((r: any) => r.count || 0);
    const [players, guests, banned, gamesToday, errors24h, reminders] = await Promise.all([
      head(db.from('players').select('id', { count: 'exact', head: true })),
      head(db.from('players').select('id', { count: 'exact', head: true }).eq('is_guest', true)),
      head(db.from('players').select('id', { count: 'exact', head: true }).eq('banned', true)),
      head(db.from('games').select('id', { count: 'exact', head: true }).eq('status', 'finished').gte('finished_at', since(864e5))),
      head(db.from('client_errors').select('id', { count: 'exact', head: true }).gte('at', since(864e5))),
      head(db.from('push_subscriptions').select('id', { count: 'exact', head: true })),
    ]);
    return { players, guests, banned, gamesToday, errors24h, reminders };
  },
  async adminPlayers(req, b) {
    await admin(req);
    let q = db.from('players').select('id, nickname, is_guest, banned, created_at, games(count)').order('created_at', { ascending: false }).limit(100);
    if (typeof b.q === 'string' && b.q.trim()) q = q.ilike('nickname', `%${b.q.trim().replace(/[%_\\]/g, m => '\\' + m).slice(0, 30)}%`);
    const { data, error } = await q;
    if (error) fail(500, 'Could not load players.');
    return { players: (data || []).map((p: any) => ({ id: p.id, nickname: p.nickname, guest: p.is_guest, banned: p.banned, createdAt: p.created_at, games: p.games?.[0]?.count ?? 0 })) };
  },
  async adminSetBanned(req, b) {
    await admin(req);
    const { error } = await db.from('players').update({ banned: b.banned === true }).eq('id', gameId(b.playerId));
    if (error) fail(500, 'Could not update the player.');
    return { ok: true };
  },
  async adminRename(req, b) {
    await admin(req);
    const { error } = await db.from('players').update({ nickname: nick(b.nickname) }).eq('id', gameId(b.playerId));
    if (isUnique(error)) fail(409, 'That nickname is taken.');
    if (error) fail(500, 'Could not rename the player.');
    return { ok: true };
  },
  async adminReports(req) {
    await admin(req);
    const { data } = await db.from('reports').select('id, reason, note, created_at, target_id, target:players!reports_target_id_fkey(nickname, banned), reporter:players!reports_reporter_id_fkey(nickname)')
      .eq('status', 'open').order('created_at', { ascending: false }).limit(100);
    return { reports: (data || []).map((r: any) => ({ id: r.id, reason: r.reason, note: r.note, at: r.created_at, targetId: r.target_id, target: r.target?.nickname, targetBanned: r.target?.banned, reporter: r.reporter?.nickname || null })) };
  },
  async adminResolveReport(req, b) {
    await admin(req);
    await db.from('reports').update({ status: 'done' }).eq('id', gameId(b.reportId));
    return { ok: true };
  },
  async adminFunnel(req) {
    await admin(req);
    const { data } = await db.from('events_daily').select('day, name, n').gte('day', utcDay(-13)).order('day');
    return { events: data || [] };
  },
  async adminErrors(req) {
    await admin(req);
    const { data } = await db.from('client_errors').select('at, message, stack, url, ua, player_id').order('at', { ascending: false }).limit(100);
    return { errors: data || [] };
  },

  async myStats(req) {
    const me = await player(req);
    const { data } = await db.from('games')
      .select('id, mode, rounds, hard, day, score, correct, avg_ms, sw_ms, rep_ms, par_right, par_total, size_right, size_total, finished_at')
      .eq('player_id', me.id).eq('status', 'finished').order('finished_at', { ascending: false }).limit(150);
    const games = (data || []).reverse().map(g => ({
      id: g.id, at: new Date(g.finished_at).getTime(), mode: g.mode, rounds: g.rounds, hard: g.hard, day: g.day,
      score: g.score, correct: g.correct, avgMs: g.avg_ms, swMs: g.sw_ms, repMs: g.rep_ms,
      par: [g.par_right, g.par_total], siz: [g.size_right, g.size_total],
    }));
    // Totals over every game ever, so levels and badges don't slip when old games drop off the list above.
    const [{ data: lt }, { data: dd }] = await Promise.all([
      db.rpc('player_lifetime', { p_player: me.id }),
      db.from('games').select('day').eq('player_id', me.id).eq('mode', 'daily').eq('status', 'finished').limit(5000),
    ]);
    const l = (lt || [])[0];
    const lifetime = l ? {
      games: l.games, totalScore: Number(l.total_score), perfect: l.perfect, hardPerfect: l.hard_perfect, fastest: l.fastest_ms,
      marathon: l.marathon, challenges: l.challenges, bestStreak: bestDailyStreak((dd || []).map((g: any) => g.day)),
    } : null;
    return { games, lifetime, today: utcDay(0) };
  },
};

Deno.serve(async req => {
  const headers = { ...cors(req), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  try {
    if (Number(req.headers.get('content-length') || 0) > MAX_BODY_BYTES) return json({ error: 'Request too large.' }, 413);
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return json({ error: 'Request too large.' }, 413);
    let body: any;
    try { body = JSON.parse(text); } catch { return json({ error: 'Bad request.' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Bad request.' }, 400);
    const fn = Object.hasOwn(actions, body.action) ? actions[body.action] : null;
    if (!fn) return json({ error: 'Unknown action.' }, 400);
    return json(await fn(req, body));
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'Something went wrong. Try again.' }, 500);
  }
});

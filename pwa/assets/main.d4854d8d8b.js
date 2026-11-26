import {
  Run, ROUND_OPTIONS, BASE_LIMIT, MAX_PAUSES, MIN_MS, MAX_PER_ROUND, DAILY_ROUNDS, TYPES, RULES_VERSION, LATE_GRACE_MS,
  sideFor, valueLabel, makeQuestion, newSeed, parseCode, keyToDate, dayNumber, addDays, cleanNickname,
  streakInfo, levelInfo, statsFromGames, badgesFromStats, utcDayKey, msToNextUtcDay,
} from './core.373fb97d34.js';
import { api, ApiError, store, getToken, setToken, outbox } from './api.85c113d010.js';

const WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const DOTS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 6: [0, 2, 3, 5, 6, 8], 7: [0, 2, 3, 4, 5, 6, 8], 8: [0, 1, 2, 3, 5, 6, 7, 8], 9: [0, 1, 2, 3, 4, 5, 6, 7, 8] };
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const byScore = (a, b) => (b.score || 0) - (a.score || 0) || (a.avgMs ?? 1e9) - (b.avgMs ?? 1e9);
const plausible = total => r => (r.score || 0) <= total * MAX_PER_ROUND && (r.avgMs == null || r.avgMs >= MIN_MS);
let todayKey = utcDayKey();   // the Daily is on UTC days, the same moment for everyone

// ================= product counts =================
// Event names only (no ids, no device details), added up per day on the server. See /privacy.
let trackQ = [];
function track(name) { trackQ.push(name); if (trackQ.length >= 15) flushTrack(); }
function flushTrack() {
  if (!trackQ.length || !navigator.onLine) return;
  const names = trackQ; trackQ = [];
  api('events', { names }).catch(() => {});
}
setInterval(flushTrack, 20000);
addEventListener('visibilitychange', () => { if (document.hidden) flushTrack(); });

// ================= error reporting =================
// Problems on players' devices are sent to the server (at most 5 per visit), so they can be fixed.
let reported = 0;
function report(message, stack) {
  if (reported >= 5 || !message) return;
  reported++;
  api('logError', { message: String(message).slice(0, 500), stack: String(stack || '').slice(0, 2000), url: location.pathname }).catch(() => {});
}
addEventListener('error', e => report(e.message, e.error && e.error.stack));
addEventListener('unhandledrejection', e => report(e.reason && (e.reason.message || String(e.reason)), e.reason && e.reason.stack));

// ================= screens & helpers =================
const $ = id => document.getElementById(id);
const screens = ['home', 'game', 'results', 'stats'];
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const bump = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
const show = name => {
  screens.forEach(s => { $(s).hidden = s !== name; });
  document.querySelector('.app').classList.toggle('page', name !== 'game');
  if (name !== 'game') window.scrollTo(0, 0);
  const el = $(name);
  const blocks = [...el.querySelectorAll(':scope > .bar, :scope > .hud, :scope > .scroll > *, :scope > .dock, :scope > .pads')];
  blocks.forEach((b, i) => { b.classList.add('stagger'); b.style.setProperty('--i', i); });
  bump(el, 'enter');
  // Focus follows the screen: otherwise it stays on a button in the screen that was just hidden.
  // The game screen is played with keys/pads anywhere, so it takes focus on its stage.
  const target = name === 'game' ? $('stage') : el.querySelector('h1') || el.querySelector('.bar .brand') || el.querySelector('h2');
  if (target && document.activeElement !== target) {
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }
  for (const id of ['board', 'board2', 'cBoard']) {
    const ol = $(id); bump(ol, 'rows-in');
    clearTimeout(ol._t); ol._t = setTimeout(() => ol.classList.remove('rows-in'), 1200);
  }
};
// Move focus into dialogs only for keyboard users; after a tap it just draws a ring nobody asked for.
let usingKeyboard = false;
addEventListener('keydown', () => { usingKeyboard = true; }, true);
addEventListener('pointerdown', () => { usingKeyboard = false; }, true);
const focusKbd = el => { if (usingKeyboard && el) el.focus(); };
const toast = (msg, ms = 2600) => {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  // during a game the bottom of the screen is the answer pads, so messages show under the HUD
  t.classList.toggle('top', !$('game').hidden);
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, ms);
};
// Screen-reader announcements (questions, answers, results).
const say = msg => { const el = $('sr'); el.textContent = ''; setTimeout(() => { el.textContent = msg; }, 30); };

// ---------- dialogs: everything behind an open dialog is inert, and focus stays inside ----------
const dialogStack = [];
function setInertBehind(dialogEl, on) {
  // dialogs inside the game screen (pause) lock the rest of the game; sheets lock the whole app
  const inGame = $('game').contains(dialogEl);
  const targets = inGame
    ? [$('hud'), document.querySelector('.pads'), ...[...$('stage').children].filter(c => c !== dialogEl)]
    : [document.querySelector('.app'), ...document.querySelectorAll('body > .scrim')].filter(x => x !== dialogEl && !x.contains(dialogEl));
  targets.forEach(t => { if (t) t.inert = on; });
}
function openDialog(el, focusEl) {
  if (!dialogStack.includes(el)) dialogStack.push(el);
  el.hidden = false;
  setInertBehind(el, true);
  const f = focusEl || el.querySelector('button:not([hidden]):not(:disabled), input, a[href]');
  setTimeout(() => f?.focus({ preventScroll: true }), 30);
}
function closeDialog(el, returnTo) {
  el.hidden = true;
  setInertBehind(el, false);
  const i = dialogStack.indexOf(el); if (i >= 0) dialogStack.splice(i, 1);
  // re-lock for any dialog still open underneath
  dialogStack.forEach(d => setInertBehind(d, true));
  returnTo?.focus?.({ preventScroll: true });
}

// ================= device settings =================
let soundOn = store.get('sound', true);
let rounds = ROUND_OPTIONS.includes(store.get('rounds', 20)) ? store.get('rounds', 20) : 20;
let hard = !!store.get('hard', false);
let boardR = rounds, boardH = hard;   // which classic board the home leaderboard shows (follows Quick play)
let badgesExpanded = false;
let updateWaiting = false;   // a new version took over and should load at the next safe moment
const modeKey = (r, h) => (h ? 'h' : 'n') + r;
const localBest = (r = rounds, h = hard) => store.get('best.' + modeKey(r, h), 0);
let localPlays = store.get('plays', 0);

// ================= theme =================
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const effectiveTheme = () => document.documentElement.dataset.theme || (darkQuery.matches ? 'dark' : 'light');
function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t;
  const dark = effectiveTheme() === 'dark';
  $('themeBtn').setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  $('themeLabel').textContent = dark ? 'Light mode' : 'Dark mode';
  $('themeIcon').innerHTML = dark
    ? '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'
    : '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>';
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => { m.content = dark ? '#0d0f15' : '#eef0f5'; m.removeAttribute('media'); });
}
$('themeBtn').addEventListener('click', () => {
  const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
  store.set('theme', next);
  if (document.startViewTransition && !reduceMotion.matches) {
    const r = $('themeBtn').getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    try {
      const vt = document.startViewTransition(() => applyTheme(next));
      vt.ready.then(() => document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 520, easing: 'cubic-bezier(.2,.8,.2,1)', pseudoElement: '::view-transition-new(root)' },
      )).catch(() => {});
      return;
    } catch {}
  }
  const root = document.documentElement;
  root.classList.add('theming'); applyTheme(next);
  setTimeout(() => root.classList.remove('theming'), 400);
});
try { darkQuery.addEventListener('change', () => applyTheme()); } catch {}
applyTheme(store.get('theme', null));

// ================= text size =================
const SIZES = [1, 1.12, 1.25], SIZE_NAMES = ['normal', 'large', 'extra large'];
let sizeIdx = Math.min(SIZES.length - 1, Math.max(0, store.get('size', 0)));
// Space left after text zoom decides the compact layouts (media queries can't see the zoom).
function fitClasses() {
  const z = SIZES[sizeIdx], h = innerHeight / z, w = innerWidth / z;
  document.documentElement.classList.toggle('short', h < 640);
  document.documentElement.classList.toggle('narrow', w < 340);
}
addEventListener('resize', fitClasses);
function applySize() {
  document.documentElement.style.setProperty('--zoom', SIZES[sizeIdx]);
  fitClasses();
  $('sizeBtn').setAttribute('aria-label', `Text size: ${SIZE_NAMES[sizeIdx]}`);
  $('sizeLabel').textContent = `Text size: ${SIZE_NAMES[sizeIdx]}`;
  $('sizeBtn').classList.toggle('on', sizeIdx > 0);
}
$('sizeBtn').addEventListener('click', () => { sizeIdx = (sizeIdx + 1) % SIZES.length; store.set('size', sizeIdx); applySize(); });

// ---------- settings menu ----------
function setMenu(open) {
  $('settingsMenu').hidden = !open;
  $('settingsBtn').setAttribute('aria-expanded', String(open));
  if (open) focusKbd($('settingsMenu').querySelector('.menu-item'));
}
$('settingsBtn').addEventListener('click', e => { e.stopPropagation(); setMenu($('settingsMenu').hidden); });
document.addEventListener('click', e => { if (!$('settingsMenu').hidden && !e.target.closest('.menu-wrap')) setMenu(false); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('settingsMenu').hidden) { setMenu(false); $('settingsBtn').focus(); } });
// role="menu" promises arrow keys: Up/Down move (wrapping), Home/End jump, Tab closes the menu
$('settingsMenu').addEventListener('keydown', e => {
  const items = [...$('settingsMenu').querySelectorAll('.menu-item:not([hidden])')];
  const i = items.indexOf(document.activeElement);
  const go = n => { e.preventDefault(); items[(n + items.length) % items.length].focus(); };
  if (e.key === 'ArrowDown') go(i + 1);
  else if (e.key === 'ArrowUp') go(i < 0 ? items.length - 1 : i - 1);
  else if (e.key === 'Home') go(0);
  else if (e.key === 'End') go(items.length - 1);
  else if (e.key === 'Tab') setMenu(false);
});
$('settingsBtn').addEventListener('keydown', e => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault(); setMenu(true);
  const items = $('settingsMenu').querySelectorAll('.menu-item');
  items[e.key === 'ArrowDown' ? 0 : items.length - 1].focus();
});
$('howMenuBtn').addEventListener('click', () => { setMenu(false); startTutorial(hard ? HARD_TUTORIAL : TUTORIAL); });
applySize();

// ================= sound & haptics =================
let audio = null;
function beep(freq, dur = 0.08, type = 'sine', vol = 0.06) {
  if (!soundOn) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), gn = audio.createGain();
    o.type = type; o.frequency.value = freq;
    gn.gain.setValueAtTime(vol, audio.currentTime);
    gn.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
    o.connect(gn).connect(audio.destination);
    o.start(); o.stop(audio.currentTime + dur);
  } catch {}
}
const buzz = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };
function renderSound() {
  $('soundBtn').setAttribute('aria-label', soundOn ? 'Sound on' : 'Sound off');
  $('soundLabel').textContent = soundOn ? 'Sound: on' : 'Sound: off';
  $('soundIcon').innerHTML = soundOn
    ? '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>'
    : '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/>';
}
$('soundBtn').addEventListener('click', () => { soundOn = !soundOn; store.set('sound', soundOn); renderSound(); beep(660); });
renderSound();

// ================= player =================
let me = store.get('me', null);          // { id, nickname } cached for offline
let online = navigator.onLine;
let afterNick = null;

function askNickname(then, { rename = false } = {}) {
  afterNick = then;
  $('nickTitle').textContent = rename ? 'Change nickname' : 'Pick a nickname';
  $('nickSave').textContent = rename ? 'Save' : 'Start playing';
  $('nickOffline').hidden = rename;
  $('nickInput').value = rename && me ? me.nickname : '';
  $('nickError').hidden = true;
  openDialog($('nickScrim'), $('nickInput'));
  $('nickForm').dataset.rename = rename ? '1' : '';
}
$('nickForm').addEventListener('submit', async e => {
  e.preventDefault();
  const check = cleanNickname($('nickInput').value);   // same rules the server applies
  if (!check.ok) { $('nickError').textContent = check.error; $('nickError').hidden = false; return; }
  const nickname = check.value;
  $('nickSave').disabled = true;
  try {
    if ($('nickForm').dataset.rename) {
      const r = await api('rename', { nickname }); me = r.player;
    } else {
      const r = await api('register', { nickname }); setToken(r.token); me = r.player;
    }
    store.set('me', me);
    closeDialog($('nickScrim'));
    track('name_saved');
    renderAll(); refreshRemote();
    const next = afterNick; afterNick = null; next && next();
  } catch (err) {
    $('nickError').textContent = err.offline ? 'You’re offline. Connect to save a nickname, or play without one.' : err.message;
    $('nickError').hidden = false;
  } finally { $('nickSave').disabled = false; }
});
$('nickClose').addEventListener('click', () => { closeDialog($('nickScrim')); afterNick = null; });
$('nickOffline').addEventListener('click', () => { closeDialog($('nickScrim')); const next = afterNick; afterNick = null; next && next({ offline: true }); });

// Play first: new players get a guest account without being asked anything, and pick a
// nickname after their first game. Calls fn() once there is a player (or with {offline:true}).
// The server confirmed this device's player code is no longer valid (not a gateway hiccup).
const authGone = e => e && e.status === 401 && e.code === 'auth';
let registering = null;
function ensurePlayer({ quiet = false } = {}) {
  if (getToken()) return Promise.resolve(true);
  if (!online) return Promise.resolve(false);
  if (!registering) {
    registering = api('register', { guest: true })
      .then(r => { setToken(r.token); me = r.player; store.set('me', me); return true; })
      .catch(e => { if (!quiet) toast(e.status === 429 ? e.message : 'Couldn’t reach the server, so this game stays on this device.'); return false; })
      .finally(() => { registering = null; });
  }
  return registering;
}

// ================= game state =================
const RING_LEN = 2 * Math.PI * 46;
$('ring').style.strokeDasharray = RING_LEN;
let g = null;
let roundTimer = 0, raf = 0, nextTimer = 0, countTimer = 0;

// ---------- practice ----------
// The whole game in two turns: the same number goes right under one rule and left under the other.
const TUTORIAL = [
  { type: 'parity', n: 2, coach: '<b>Odd or Even?</b> 2 is even, and even goes <b>right</b>. Tap EVEN, swipe right or press →.' },
  { type: 'size', n: 2, coach: 'Same 2, <b>new rule</b>: Low or High? 2 is low, so this time it goes <b>left</b>. Always read the rule first.' },
  { timed: true, coach: 'Now with the <b>3-second timer</b>. Rule first, then the number.' },
  { timed: true, coach: 'Odd and low go left. Even and high go right. Last one!' },
];
const HARD_TUTORIAL = [
  { type: 'parity', n: 4, flip: true, coach: '<b>Sides swapped.</b> 4 is even, but this round EVEN sits on the <b>left</b>. Follow the labels, not habit.' },
  { type: 'size', n: 7, form: 'word', coach: 'Numbers can be <b>words</b>. Seven is high, and HIGH is on the right.' },
  { type: 'parity', n: 3, form: 'dots', coach: 'Or <b>dots</b>. Count them: 3 is odd.' },
  { type: 'size', n: 2, flip: true, form: 'word', coach: 'All together: two is low, and the sides are swapped. The timer also shrinks to 1.5 s by the last round.' },
];
const needsTutorial = () => !store.get('tutorialDone', false) && !gameHistory.length;

function resetStage(tutorial) {
  document.querySelector('.app').classList.remove('is-paused');
  renderPauseBtn();
  $('hud').classList.toggle('tut', tutorial);
  $('skipBtn').hidden = !tutorial;
  $('hRoundK').textContent = tutorial ? 'Practice' : g.mode === 'daily' ? `Daily #${dayNumber(g.day)}` : g.mode === 'challenge' ? 'Challenge' : 'Round';
  $('hOf').textContent = '/' + (tutorial ? g.steps.length : g.rounds);
  $('hRound').textContent = 1; $('hScore').textContent = 0; $('hStreak').textContent = 0;
  $('coach').hidden = true; $('swapTag').hidden = true;
  $('tutSteps').replaceChildren(...(tutorial ? g.steps.map(() => document.createElement('i')) : []));
  $('swipeHint').hidden = tutorial;
  $('verdict').textContent = ''; $('num').textContent = '';
  $('ring').style.strokeDashoffset = 0; $('ring').classList.remove('late');
  $('restartBtn').hidden = !tutorial && g.mode !== 'classic';
  setPads(null);
}

// `intent` is what the player was trying to do when practice started (a Daily, a friend's
// challenge, or Classic). Skip and the Ready button both continue to exactly that.
function startTutorial(steps = TUTORIAL, intent = null) {
  clearAll();
  g = { tutorial: true, step: 0, steps, hardIntro: steps === HARD_TUTORIAL, pauses: 0, q: null, open: false, intent: intent || { mode: 'classic' } };
  show('game'); resetStage(true); nextRound();
  track('practice_start');
  ensurePlayer({ quiet: true });   // make the guest player while they practise, so the real game starts at once
}
const intentLabel = it => it.mode === 'daily' ? 'Start today’s Daily'
  : it.mode === 'challenge' ? 'Start the challenge'
  : `Play ${rounds} rounds${hard ? ' · Hard' : ''}`;
// What comes after practice: the Hard intro if the game needs it, otherwise the game itself.
function afterPractice(intent) {
  const needsHard = intent.mode === 'challenge' ? !!parseCode(intent.code)?.hard : intent.mode === 'classic' && hard;
  if (needsHard && !store.get('hardIntroDone', false)) return startTutorial(HARD_TUTORIAL, intent);
  return startGame(intent);
}
function finishTutorial() {
  store.set(g.hardIntro ? 'hardIntroDone' : 'tutorialDone', true);
  track('practice_done');
  $('coach').hidden = true;
  $('readyText').textContent = g.hardIntro
    ? 'Hard mode: watch for swapped sides, words and dots. The timer shrinks as you go.'
    : 'Each answer now has 3 seconds, and the question can switch at any time.';
  $('readyPlayBtn').textContent = intentLabel(g.intent);
  $('readyOverlay').hidden = false;
  setTimeout(() => $('readyPlayBtn').focus({ preventScroll: true }), 30);
}

// ---------- starting a game ----------
// opts: { mode: 'classic' | 'daily' | 'challenge' | 'practice', code }
// Returns true if a game started, false if it couldn't (the current screen is left as it was).
let starting = false;
const START_BTNS = ['playBtn', 'dailyBtn', 'cAccept', 'readyPlayBtn', 'againBtn', 'skipBtn', 'landingPlay'];
function setStarting(on) {
  starting = on;
  for (const id of START_BTNS) { const b = $(id); if (!b) continue; b.disabled = on; b.setAttribute('aria-busy', String(on)); }
  document.body.classList.toggle('starting', on);
}
async function startGame(opts = {}) {
  if (starting) return false;
  const mode = opts.mode || 'classic';
  if (mode === 'practice') return startPractice();
  setStarting(true);
  let info = null;
  try {
    if (mode !== 'classic' || online) await ensurePlayer({ quiet: mode === 'classic' });
    if (mode !== 'classic' && !getToken()) { toast(online ? 'Couldn’t reach the server. Try again in a moment.' : 'You’re offline. The Daily and challenges need a connection.'); return false; }
    if (getToken() && online) {
      const base = { v: RULES_VERSION };
      info = await api('start', mode === 'classic' ? { ...base, mode, rounds, hard } : mode === 'daily' ? { ...base, mode, day: todayKey } : { ...base, mode, code: opts.code });
    }
  } catch (e) {
    if (authGone(e)) { setToken(null); me = null; store.set('me', null); setStarting(false); return startGame(opts); }
    if (e.status === 426) { toast(e.message, 6000); setTimeout(() => location.reload(), 2500); return false; }
    if (mode !== 'classic' || !e.offline) {
      toast(e.offline ? 'You’re offline. This needs a connection.' : e.message, 4000);
      if (e.status === 409) refreshRemote();
      return false;
    }
  } finally { setStarting(false); }
  if (mode !== 'classic' && !info) { toast('You’re offline. This needs a connection.'); return false; }

  clearAll();
  const cfg = info ? { seed: info.seed, rounds: info.rounds, hard: info.hard, version: info.v || 1 } : { seed: newSeed(), rounds, hard, version: RULES_VERSION };
  g = {
    mode, gameId: info?.gameId || null, day: info?.day || null, code: info?.code || null, ...cfg,
    run: new Run(cfg), q: null, open: false, started: 0, paused: false, pauses: 0, timed: true,
  };
  show('game'); resetStage(false);
  const saved = g.gameId ? store.get('progress.' + g.gameId, null) : null;
  const note = saved ? resumeFrom(saved) || '' : !g.gameId ? 'Offline game: your score stays on this device.' : '';
  track(mode === 'challenge' ? 'challenge_start' : 'play_start');
  countdown(3, nextRound, note);
  return true;
}

// Untimed practice: a normal question set with no clock, never posted. For learning the rules,
// or for anyone who wants to play without time pressure.
function startPractice() {
  clearAll();
  const cfg = { seed: newSeed(), rounds: 20, hard: false, version: RULES_VERSION };
  const run = new Run(cfg);
  run.qs.forEach(q => { q.limit = 600000; });
  g = { mode: 'practice', gameId: null, ...cfg, run, q: null, open: false, started: 0, paused: false, pauses: 0, timed: false, untimed: true };
  show('game'); resetStage(false);
  track('untimed_start');
  nextRound();
  return true;
}

// Practice comes first for new players, whatever they tapped (Play, a Daily or a friend's challenge),
// and it starts at once: the guest player is made in the background meanwhile.
function play(intent = { mode: 'classic' }) {
  if (needsTutorial()) return startTutorial(TUTORIAL, intent);
  return afterPractice(intent);
}

// ---------- resume (closing the app mid-game shouldn't wipe a Daily or challenge) ----------
function saveProgress() {
  if (!g || g.tutorial || !g.gameId) return;
  store.set('progress.' + g.gameId, { events: g.run.events, pauses: g.pauses, open: g.open, mode: g.mode, day: g.day, code: g.code });
}
const clearProgress = () => { if (g && g.gameId) store.set('progress.' + g.gameId, null); };
// Same rule as leaving mid-game: a question that was on screen is replaced (uses a pause)
// or, with no pauses left, counts as missed. A question is never shown twice.
function resumeFrom(sv) {
  try { g.run = Run.replay({ seed: g.seed, rounds: g.rounds, hard: g.hard, version: g.version }, sv.events, { allowUnfinished: true }); }
  catch { store.set('progress.' + g.gameId, null); return; }
  g.pauses = sv.pauses || 0;
  let note = `Picked up at round ${Math.min(g.run.round + 1, g.rounds)}.`;
  if (sv.open && !g.run.done) {
    const q = g.run.next();
    if (g.run.version >= 2) { g.pauses++; g.run.skip(); note = 'Picked up where you left off. The question that was on screen counted as missed.'; }
    else if (g.pauses < MAX_PAUSES && g.run.skips < MAX_PAUSES) { g.pauses++; g.run.skip(); note = 'Picked up where you left off. The open question is replaced, which used a pause.'; }
    else { g.run.answer(null, q.limit); note = 'Picked up where you left off. The open question counted as missed (no pauses left).'; }
  }
  $('hRound').textContent = Math.max(1, g.run.round); $('hScore').textContent = g.run.score; $('hStreak').textContent = g.run.streak;
  renderPauseBtn(); saveProgress();
  return note;
}

// Words, not digits: the questions are digits (and, in Hard, number words), so a "3, 2, 1" in the
// same spot as the question reads as a question. `note` is shown under it (offline game, resumed run)
// instead of a toast that would sit over the pads as play starts.
const COUNT_WORDS = ['Go', 'Set', 'Ready'];
function countdown(n, done, note = '') {
  const ov = $('countOverlay'); ov.hidden = false;
  $('countNote').textContent = note; $('countNote').hidden = !note;
  const step = k => {
    if (k === 0) { ov.hidden = true; done(); return; }
    $('count').textContent = COUNT_WORDS[k - 1] || COUNT_WORDS[2]; bump($('count'), 'pop');
    beep(k === 1 ? 740 : 520, 0.07);
    countTimer = setTimeout(() => step(k - 1), 650);
  };
  step(n);
}

function setPads(q) {
  const t = q ? TYPES[q.type] : TYPES.parity;
  const L = q && q.flip ? t.right : t.left, R = q && q.flip ? t.left : t.right;
  $('padLText').textContent = L; $('padRText').textContent = R;
  $('pL').textContent = L; $('pR').textContent = R;
  $('padL').className = 'pad l'; $('padR').className = 'pad r';

  const swapped = !!(q && q.flip);
  $('swapTag').hidden = !swapped;
}

function renderNumber(q) {
  const num = $('num');
  num.className = 'number'; num.replaceChildren();
  if (q.form === 'word') { num.textContent = WORDS[q.n]; num.classList.add('word'); num.setAttribute('aria-label', String(q.n)); }
  else if (q.form === 'dots') {
    const grid = document.createElement('div'); grid.className = 'dots';
    for (let i = 0; i < 9; i++) { const d = document.createElement('i'); if (DOTS[q.n].includes(i)) d.className = 'on'; grid.append(d); }
    num.append(grid); num.setAttribute('aria-label', String(q.n));
  } else { num.textContent = q.n; num.removeAttribute('aria-label'); }
  // no entrance animation: the number is readable the instant the clock starts
}

function nextRound() {
  if (g.tutorial) {
    if (g.step >= g.steps.length) return finishTutorial();
    const s = g.steps[g.step];
    g.q = s.n ? { type: s.type, n: s.n, flip: !!s.flip, form: s.form || 'digit', limit: BASE_LIMIT }
      : makeQuestion(Math.random, 0, 1, false, g.q);
    g.timed = !!s.timed;
    $('coach').innerHTML = s.coach;   // fixed copy above, never user input
    $('coach').hidden = false;
    $('hRound').textContent = g.step + 1;
    [...$('tutSteps').children].forEach((el, i) => { el.className = i < g.step ? 'done' : i === g.step ? 'now' : ''; });
  } else {
    if (g.run.done) return finish(false);
    g.q = g.run.next();
    $('hRound').textContent = g.run.round + 1;
  }
  setPads(g.q);
  if (g.tutorial && !g.timed) $(sideFor(g.q) === 'left' ? 'padL' : 'padR').classList.add('glow');
  renderNumber(g.q);
  $('verdict').textContent = ''; $('verdict').className = 'verdict';
  if (!g.tutorial && g.run.round > 3) $('swipeHint').hidden = true;
  const t = TYPES[g.q.type];
  say(`${t.left} or ${t.right}? ${g.q.form === 'dots' ? g.q.n + ' dots' : g.q.n}${g.q.flip ? '. Sides swapped' : ''}`);
  // The clock starts on the frame the number is drawn, and the same deadline drives the ring,
  // the timeout and the scoring.
  const myG = g;
  raf = requestAnimationFrame(() => {
    if (g !== myG || g.paused) return;
    g.started = performance.now();
    g.open = true; held = null;
    if (g.timed) {
      roundTimer = setTimeout(onDeadline, g.q.limit);
      tick(); saveProgress();
    } else { $('ring').style.strokeDashoffset = 0; $('ring').classList.remove('late'); }
  });
}
// At the deadline a finger already on a pad still counts if it lifts within the grace period
// (the answer's time is when it touched down).
function onDeadline() {
  if (!g || !g.open) return;
  if (held) { roundTimer = setTimeout(() => { if (g && g.open) { clearHold(); answer(null); } }, LATE_GRACE_MS); return; }
  answer(null);
}

function tick() {
  if (!g || !g.open) return;
  const left = Math.max(0, 1 - (performance.now() - g.started) / g.q.limit);
  $('ring').style.strokeDashoffset = RING_LEN * (1 - left);
  $('ring').classList.toggle('late', left < 0.3);
  raf = requestAnimationFrame(tick);
}

// `at` is when the input began (key down, finger down on a pad, or the start of a swipe), so
// taps, swipes and keys are timed the same way.
function answer(dir, at = performance.now()) {
  if (!g || !g.open) return;
  const raw = Math.max(0, at - g.started);
  // Early-input rule: anything in the first 150 ms is a guess and counts as wrong (it says so).
  g.open = false;
  clearTimeout(roundTimer); cancelAnimationFrame(raf);
  const ms = dir === null && !g.tutorial ? g.q.limit : raw;
  const q = g.q, v = $('verdict');

  if (g.tutorial) {
    const right = sideFor(q), ok = dir === right, guided = !g.timed, label = valueLabel(q);
    if (ok) { v.textContent = guided ? 'Correct' : `Correct · ${(ms / 1000).toFixed(2)}s`; v.className = 'verdict good'; bump(v, 'show'); bump($('num'), 'good'); beep(880, 0.09, 'triangle'); buzz(15); }
    else {
      v.textContent = dir === null ? `Too slow. ${q.n} is ${label}` : `Not quite. ${q.n} is ${label}` + (guided ? ', try again' : '');
      v.className = 'verdict bad'; bump(v, 'show'); bump($('num'), 'bad'); beep(180, 0.18, 'sawtooth', 0.05); buzz([40, 40, 40]);
    }
    $(right === 'left' ? 'padL' : 'padR').classList.add('hit');
    if (dir && !ok) $(dir === 'left' ? 'padL' : 'padR').classList.add('miss');
    if (ok || !guided) g.step++;
    nextTimer = setTimeout(nextRound, ok ? 700 : 1500);
    return;
  }

  const r = g.run.answer(dir, ms);
  say(r.ok ? 'Correct' : r.early ? 'Too early' : dir === null ? `Too slow, ${q.n} is ${r.label}` : `Wrong, ${q.n} is ${r.label}`);
  if (r.ok) {
    v.textContent = g.untimed ? 'Correct' : `+${r.pts} · ${(ms / 1000).toFixed(2)}s`;
    v.className = 'verdict good'; bump(v, 'show'); bump($('num'), 'good');
    beep(880 + Math.min(g.run.streak, 8) * 40, 0.09, 'triangle'); buzz(15);
  } else {
    v.textContent = r.early ? 'Too early (under 0.15 s). Read the number first'
      : dir === null ? `Too slow. ${q.n} is ${r.label}`
      : q.flip ? `${q.n} is ${r.label}, and the sides were swapped` : `${q.n} is ${r.label}`;
    v.className = 'verdict bad'; bump(v, 'show'); bump($('num'), 'bad');
    beep(180, 0.18, 'sawtooth', 0.05); buzz([40, 40, 40]);
  }
  $(r.right === 'left' ? 'padL' : 'padR').classList.add('hit');
  if (dir && !r.ok) $(dir === 'left' ? 'padL' : 'padR').classList.add('miss');
  $(r.right === 'left' ? 'padR' : 'padL').classList.add('dim');
  $('hScore').textContent = g.run.score; $('hStreak').textContent = g.run.streak;
  if (r.ok) { bump($('hScore'), 'tick'); bump($('hStreak'), 'tick'); }
  saveProgress();
  nextTimer = setTimeout(nextRound, r.ok ? 550 : 1100);
}

function clearAll() {
  clearTimeout(roundTimer); clearTimeout(nextTimer); clearTimeout(countTimer); cancelAnimationFrame(raf);
  $('countOverlay').hidden = true; $('pauseOverlay').hidden = true; $('readyOverlay').hidden = true;
}

// ================= pause =================
// While paused the number is hidden. Pausing between questions is free and unlimited. Pausing
// while a question is showing counts that question as missed, so a Daily or challenge has the
// same questions for everyone. (Games started on rules v1 keep their old limit of 3 pauses.)
const v1Limits = () => g && !g.tutorial && g.run && g.run.version < 2;
function renderPauseBtn() {
  const left = g && v1Limits() ? MAX_PAUSES - g.pauses : Infinity;
  $('pauseBtn').disabled = left <= 0;
  $('pauseBtn').setAttribute('aria-label', left === Infinity ? 'Pause game' : left > 0 ? `Pause game, ${left} left` : 'No pauses left');
}

function pauseGame(reason) {
  if (!g || g.paused || $('game').hidden || !$('readyOverlay').hidden) return;
  if (g.tutorial && !g.timed) return;
  if (reason === 'button' && v1Limits() && g.pauses >= MAX_PAUSES) { toast('No pauses left in this game'); return; }
  const mid = g.open;
  clearAll(); clearHold();
  g.open = false; g.paused = true;
  $('num').textContent = ''; $('num').className = 'number'; $('verdict').textContent = '';
  let msg = 'Take your time. The game is waiting.';
  if (g.tutorial) msg = 'Practice is paused.';
  else if (g.untimed) msg = 'Practice is paused. Nothing here is timed or posted.';
  else if (!v1Limits()) {
    g.pauses++;
    if (mid) {
      g.run.skip();
      msg = 'That question counted as missed. Tip: pausing between questions is free.';
    }
    if (reason === 'away') msg = 'You left the game, so it paused. ' + msg;
  } else if (g.pauses >= MAX_PAUSES) {
    if (mid) g.run.answer(null, g.q.limit);
    msg = mid ? 'You left with no pauses left, so that question counted as missed.' : 'You left with no pauses left.';
  } else {
    g.pauses++;
    if (mid) {
      const hadStreak = g.run.streak;
      g.run.skip();
      msg = hadStreak > 0 ? `You’ll get a new number when you resume. Pausing during a question ended your ${hadStreak}-answer streak.` : 'You’ll get a new number when you resume.';
    }
    if (reason === 'away') msg = 'You left the game, so it paused. ' + msg;
  }
  if (!g.tutorial && (g.mode === 'daily' || g.mode === 'challenge')) msg += ' This is your one try, so quitting ends it with the score you have.';
  if (!g.tutorial) {
    $('hStreak').textContent = g.run.streak; $('hScore').textContent = g.run.score;
    $('hRound').textContent = Math.min(g.run.round + 1, g.rounds);   // same round the pause card shows
    saveProgress();
  }
  $('pauseMsg').textContent = msg;
  $('pRound').textContent = g.tutorial ? `${g.step + 1}/${g.steps.length}` : `${Math.min(g.run.round + 1, g.rounds)}/${g.rounds}`;
  $('pScore').textContent = (g.tutorial ? 0 : g.run.score).toLocaleString();
  $('pLeftK').textContent = v1Limits() ? 'Pauses left' : 'Pauses used';
  $('pLeft').textContent = g.tutorial ? '–' : v1Limits() ? Math.max(0, MAX_PAUSES - g.pauses) : g.pauses;
  $('pauseMain').hidden = false; $('pauseConfirm').hidden = true;
  document.querySelector('.app').classList.add('is-paused');
  renderPauseBtn();
  openDialog($('pauseOverlay'), $('resumeBtn'));
  // a run that ends on a missed question finishes when they resume
}
function resumeGame() {
  if (!g || !g.paused) return;
  closeDialog($('pauseOverlay'));
  document.querySelector('.app').classList.remove('is-paused');
  g.paused = false;
  if (!g.tutorial && g.run.done) return finish(false);
  if (g.untimed) return nextRound();
  countdown(3, nextRound);
}
let confirmAction = null;
function askConfirm(text, yesLabel, action) {
  confirmAction = action;
  $('confirmText').textContent = text; $('confirmYes').textContent = yesLabel;
  $('pauseMain').hidden = true; $('pauseConfirm').hidden = false;
  focusKbd($('confirmNo'));
}
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame('away'); });
$('pauseBtn').addEventListener('click', () => pauseGame('button'));
$('resumeBtn').addEventListener('click', resumeGame);
$('restartBtn').addEventListener('click', () => askConfirm('Restart from round 1? This score won’t be saved.', 'Restart',
  () => (g && g.untimed ? startPractice() : startGame({ mode: 'classic' }))));
$('quitBtn').addEventListener('click', () => {
  if (g && !g.tutorial && (g.mode === 'daily' || g.mode === 'challenge')) askConfirm('End your one try now? Your score so far will count.', 'End it', () => { clearAll(); finish(true); });
  else askConfirm('Quit this game? This score won’t be saved.', 'Quit', () => { clearAll(); g = null; goHome(); });
});
$('confirmNo').addEventListener('click', () => { $('pauseConfirm').hidden = true; $('pauseMain').hidden = false; focusKbd($('resumeBtn')); });
$('confirmYes').addEventListener('click', async () => {
  const a = confirmAction; confirmAction = null;
  const was = g;
  document.querySelector('.app').classList.remove('is-paused');
  closeDialog($('pauseOverlay'));
  if (g) g.paused = false;
  const ok = a ? await a() : true;
  // A restart that couldn't start (no connection, server busy) leaves the paused game as it was.
  if (ok === false && g === was && g) {
    g.paused = true;
    document.querySelector('.app').classList.add('is-paused');
    $('pauseMain').hidden = false; $('pauseConfirm').hidden = true;
    openDialog($('pauseOverlay'), $('resumeBtn'));
    track('restart_fail');
  }
});

// ================= input =================
// Keys answer on key down. Pads answer when the finger lifts on the same pad (slide off to
// cancel), timed from when it touched down. Swipes are timed from the start of the swipe.
const evTime = e => (e && e.timeStamp > 0 && Math.abs(performance.now() - e.timeStamp) < 5000 ? e.timeStamp : performance.now());
let held = null;   // { dir, at, pointerId }
function clearHold() {
  if (!held) return;
  $(held.dir === 'left' ? 'padL' : 'padR').classList.remove('press');
  held = null;
}
document.addEventListener('keydown', e => {
  if (e.repeat || dialogStack.some(d => d.classList.contains('scrim'))) return;
  if (!$('game').hidden) {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') { e.preventDefault(); press('left', evTime(e)); }
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { e.preventDefault(); press('right', evTime(e)); }
    if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
      e.preventDefault();
      if (g && g.paused) { if (!$('pauseConfirm').hidden) $('confirmNo').click(); else resumeGame(); }
      else pauseGame('button');
    }
  } else if (!$('stats').hidden && e.key === 'Escape') goHome();
});
function press(dir, at) {
  const pad = $(dir === 'left' ? 'padL' : 'padR');
  pad.classList.add('press'); setTimeout(() => pad.classList.remove('press'), 90);
  answer(dir, at);
}
for (const [id, dir] of [['padL', 'left'], ['padR', 'right']]) {
  const pad = $(id);
  pad.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (!g || !g.open || held) return;
    held = { dir, at: evTime(e), pointerId: e.pointerId };
    pad.classList.add('press');
    try { pad.setPointerCapture(e.pointerId); } catch {}
  });
  pad.addEventListener('pointerup', e => {
    if (!held || held.dir !== dir || held.pointerId !== e.pointerId) return;
    const r = pad.getBoundingClientRect();
    const inside = e.clientX >= r.left - 12 && e.clientX <= r.right + 12 && e.clientY >= r.top - 12 && e.clientY <= r.bottom + 12;
    const at = held.at; clearHold();
    if (inside) answer(dir, at);
  });
  pad.addEventListener('pointercancel', clearHold);
  pad.addEventListener('lostpointercapture', () => { if (held && held.dir === dir) setTimeout(() => { if (held && held.dir === dir) clearHold(); }, 0); });
  // keyboard / switch access: Enter or Space on a focused pad
  pad.addEventListener('click', e => { if (e.detail === 0) press(dir, performance.now()); });
}
let sx = 0, sy = 0, st = 0, tracking = false;
$('stage').addEventListener('pointerdown', e => { sx = e.clientX; sy = e.clientY; st = evTime(e); tracking = true; });
$('stage').addEventListener('pointerup', e => {
  if (!tracking) return; tracking = false;
  const dx = e.clientX - sx, dy = e.clientY - sy;
  if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.2) answer(dx < 0 ? 'left' : 'right', g && st >= g.started ? st : evTime(e));
});
$('stage').addEventListener('pointercancel', () => { tracking = false; });

// ================= results =================
let lastRun = null;

async function finish(ended) {
  if (g.untimed) return finishPractice();
  const before = { level: levelInfo(lifetime().totalScore).level, badges: earnedBadges() };
  const s = g.run.summary();
  const run = {
    mode: g.mode, gameId: g.gameId, rounds: g.rounds, hard: g.hard, seed: g.seed, code: g.code, day: g.day, version: g.version,
    ...s, pauses: g.pauses, log: g.run.log, date: new Date(), place: null, of: null, bestRank: null, posted: false,
  };
  lastRun = run;
  const events = g.run.events;
  localPlays++; store.set('plays', localPlays);

  if (run.mode === 'classic') {
    const prevBest = Math.max(localBest(run.rounds, run.hard), myBest(run.rounds, run.hard));
    // a first game has nothing to beat, so it isn't called a personal best
    run.isBest = prevBest > 0 && run.score > prevBest; run.prevBest = prevBest; run.firstOfKind = prevBest === 0;
    if (run.score > localBest(run.rounds, run.hard)) store.set('best.' + modeKey(run.rounds, run.hard), run.score);
  }
  if (run.mode === 'daily') { const h = store.get('daily.history', {}); h[run.day] = run.score; store.set('daily.history', h); }
  if (run.mode === 'challenge') store.set('chal.' + run.code, run.score);
  run.perfect = run.correct === run.rounds;
  // Every finished game is written to this device first, so stats, bests and streaks never wait on the network.
  addLocalHistory(run);
  if (run.gameId) outbox.add({ gameId: run.gameId, events, ended: !!ended, mode: run.mode, day: run.day, code: run.code, score: run.score });
  clearProgress();
  track('game_finish');

  renderResults(run);
  show('results');
  say(`Finished. Score ${run.score}. ${run.correct} of ${run.rounds} correct.`);
  beep(run.isBest ? 1040 : 620, 0.2, 'triangle');

  if (run.gameId) {
    setSave(run, 'sending');
    await flushOutbox({ force: true });
    // your account lives on this device: after a few games, remind once to keep a backup code
    if (run.posted && !store.get('backupNudged', false) && gameHistory.filter(x => !x.local).length >= 2) {
      store.set('backupNudged', true);
      setTimeout(() => toast('Tip: copy your player code (Stats → Play on another device) so you never lose your scores.'), 2200);
    }
    await refreshRemote();
    renderResults(run, { skipCount: true });
  } else {
    setSave(run, 'local');
  }
  celebrate(before, run);
}

// Where this game's score is: on the device, on its way, posted, or needing attention.
function setSave(run, state, detail) {
  run.saveState = state;
  const el = $('rSave');
  const text = {
    local: run.mode === 'practice' ? 'Practice: not posted' : 'Offline game: saved on this device only',
    sending: 'Saved on this device · posting…',
    waiting: 'Saved on this device · will post when the server is reachable',
    posted: 'Posted to the leaderboard',
    failed: `Not posted: ${detail || 'this game couldn’t be verified'}`,
  }[state];
  el.textContent = text; el.dataset.state = state;
  if (run === lastRun && state === 'posted') say('Score posted');
}

// Send everything waiting in the outbox, and update whatever is on screen.
let retryTimer = 0;
async function flushOutbox({ force = false } = {}) {
  if (!getToken()) return [];
  const res = await outbox.flush({ force });
  let posted = 0;
  for (const r of res) {
    const run = lastRun && lastRun.gameId === r.gameId ? lastRun : null;
    if (r.state === 'posted') {
      posted++;
      markPosted(r.gameId);
      if (run) {
        Object.assign(run, { posted: true, place: r.result.place ?? null, of: r.result.of ?? null, bestRank: r.result.bestRank ?? null });
        setSave(run, 'posted');
        if (!$('results').hidden) renderResults(run, { skipCount: true });
      }
    } else if (r.state === 'pending') {
      if (run) setSave(run, 'waiting');
      track('finish_retry');
    } else {
      if (run) setSave(run, 'failed', r.error?.status === 422 ? null : r.error?.message);
      track('finish_failed');
    }
  }
  if (posted && !(posted === 1 && res.length === 1 && lastRun && res[0].gameId === lastRun.gameId)) toast(`Posted ${posted} saved game${posted > 1 ? 's' : ''}`);
  // try again later for anything still waiting
  clearTimeout(retryTimer);
  const next = outbox.pending().map(x => x.nextAt).sort((x, y) => x - y)[0];
  if (next) retryTimer = setTimeout(() => { flushOutbox().then(renderAll); }, Math.max(3000, next - Date.now()));
  renderNet();
  return res;
}
function markPosted(gameId) {
  let changed = false;
  gameHistory = gameHistory.map(x => (x.id === gameId && x.local ? (changed = true, { ...x, local: false, posted: true }) : x));
  if (changed) store.set('history', gameHistory);
}

function finishPractice() {
  const s = g.run.summary();
  lastRun = { mode: 'practice', gameId: null, rounds: g.rounds, hard: false, ...s, pauses: g.pauses, log: g.run.log, date: new Date() };
  renderResults(lastRun);
  show('results');
  setSave(lastRun, 'local');
  say(`Practice finished. ${s.correct} of ${s.rounds} correct.`);
}

// After a game: show a level or badge reached on the results card itself (a toast here would
// cover the leaderboard and the buttons under it).
function celebrate(before, run) {
  const awards = [];
  const L = levelInfo(lifetime().totalScore);
  if (L.level > before.level) awards.push({ kind: 'level', text: `Level ${L.level} · ${L.title}` });
  for (const b of badgesFromStats(lifetime())) if (b.earned && !before.badges.has(b.id)) awards.push({ kind: 'badge', text: `Badge: ${b.name}` });
  if (!awards.length) return;
  run.awards = awards;
  if (lastRun === run) renderAwards(awards, true);
  awards.forEach((_, i) => setTimeout(() => beep(990 + i * 120, 0.12, 'triangle'), 300 + i * 220));
  say(awards.map(a => a.kind === 'level' ? `Level up: ${a.text}` : `${a.text} earned`).join('. '));
}
function renderAwards(awards = [], animate = false) {
  const box = $('rAwards');
  box.hidden = !awards.length;
  box.replaceChildren(...awards.map((a, i) => {
    const d = document.createElement('span'); d.className = 'award ' + a.kind + (animate ? ' in' : '');
    d.style.setProperty('--i', i);
    const ic = document.createElement('i'); ic.setAttribute('aria-hidden', 'true'); ic.textContent = a.kind === 'level' ? '▲' : '★';
    d.append(ic, a.kind === 'level' ? `Level up: ${a.text}` : a.text);
    return d;
  }));
}

function renderResults(run, { skipCount = false } = {}) {
  let badgeText = null, badgeGood = true;
  if (run.mode === 'classic') {
    badgeText = run.perfect ? 'Perfect round' : run.isBest ? `New best, up ${(run.score - run.prevBest).toLocaleString()}` : run.firstOfKind ? null : `Your best: ${run.prevBest.toLocaleString()}`;
    badgeGood = run.isBest || run.perfect;
  } else if (run.mode === 'daily') {
    const streak = dayStreak(dailyHistory());
    run.dayStreak = streak;
    badgeText = streak > 1 ? `${streak}-day streak` : 'Streak started. Come back tomorrow';
  }
  const practice = run.mode === 'practice';
  document.body.classList.toggle('practice-result', practice);
  $('rXp').hidden = !run.score || practice;
  $('rXp').textContent = `+${Math.floor(run.score / 10).toLocaleString()} XP`;
  renderAwards(run.awards);
  // guests: offer to put a name on this score
  $('saveName').hidden = !(me && me.guest && run.gameId);
  if (me && me.guest) $('guestName').textContent = me.nickname;
  $('rLabel').textContent = practice ? 'Untimed practice' : run.mode === 'daily' ? `Daily #${dayNumber(run.day)}` : run.mode === 'challenge' ? 'Challenge score' : `Score · ${run.rounds} rounds${run.hard ? ' · Hard' : ''}`;
  if (!skipCount) countUp($('rScore'), practice ? run.correct : run.score);
  $('rCorrect').textContent = `${run.correct}/${run.rounds}`;
  $('rAvg').textContent = run.avgMs ? (run.avgMs / 1000).toFixed(2) + 's' : '–';
  $('rStreak').textContent = run.bestStreak;
  // "This run" placing (out of everyone on that board), not the player's all-time best
  $('rRank').textContent = run.place ? `#${run.place}` : '–';
  $('rRank').parentElement.hidden = !run.place;
  $('rRankK').textContent = run.place && run.of ? `of ${run.of}` : 'Place';
  $('rTitle').textContent = practice ? 'Practice' : run.mode === 'daily' ? `Daily #${dayNumber(run.day)}` : run.mode === 'challenge' ? 'Challenge' : 'Results';
  const tk = takeaway(run);
  $('rTakeawayK').textContent = tk.k; $('rTakeawayText').textContent = tk.t;
  const misses = (run.log || []).filter(l => !l.ok).length;
  $('reviewBtn').replaceChildren(misses ? 'Review mistakes' : 'Review answers');
  if (misses) { const n = document.createElement('span'); n.className = 'count-pill'; n.textContent = misses; $('reviewBtn').append(' ', n); }
  $('reviewBtn').setAttribute('aria-label', misses ? `Review ${misses} mistake${misses > 1 ? 's' : ''}` : 'Review every answer');
  $('rBestRank').hidden = !(run.mode === 'classic' && run.bestRank && run.bestRank !== run.place);
  $('rBestRank').textContent = `Your best run is #${run.bestRank} on this board`;
  if (!skipCount && run.saveState) setSave(run, run.saveState);
  const badge = $('rBadge');
  badge.hidden = !badgeText;
  if (badgeText) { badge.className = badgeGood ? 'badge' : 'badge plain'; badge.textContent = badgeText; }
  if (run.mode === 'challenge') renderChallengeVerdict(run);
  $('rSplit').textContent = run.pauses ? `${run.pauses} pause${run.pauses > 1 ? 's' : ''} used` : '';
  $('rSplit').hidden = !run.pauses;
  if (!skipCount) renderStrip(run.log);
  const bars = $('rSplitBars'); bars.replaceChildren();
  for (const [k, v, alt] of [['Odd or Even', run.split.parity, false], ['Low or High', run.split.size, true]]) bars.append(meter(k, v[1] ? v[0] / v[1] : 0, `${v[0]}/${v[1]}`, alt));
  $('challengeBtn').hidden = run.mode !== 'classic' || !run.gameId || !run.posted;
  $('shareBtn').hidden = practice;
  $('againBtn').textContent = practice ? 'Practise again' : run.mode === 'classic' ? 'Play again' : 'Quick play';
  renderResultsBoard();
}

function renderChallengeVerdict(run) {
  const c = challengeData[run.code];
  if (!c || !c.createdBy || c.createdBy.playerId === me?.id) return;
  const theirs = (c.board || []).find(x => x.playerId === c.createdBy.playerId);
  if (!theirs) return;
  const name = c.createdBy.nickname || 'Your friend';
  const badge = $('rBadge'); badge.hidden = false;
  if (run.score > theirs.score) { badge.className = 'badge'; badge.textContent = `You beat ${name} by ${(run.score - theirs.score).toLocaleString()}`; }
  else if (run.score === theirs.score) { badge.className = 'badge plain'; badge.textContent = `Tied with ${name}`; }
  else { badge.className = 'badge plain'; badge.textContent = `${name} still leads by ${(theirs.score - run.score).toLocaleString()}`; }
}

function meter(label, frac, valueText, alt) {
  const row = document.createElement('div'); row.className = 'meter';
  const lab = document.createElement('span'); lab.textContent = label;
  const tr = document.createElement('div'); tr.className = 'track';
  const fill = document.createElement('div'); fill.className = 'fill' + (alt ? ' alt' : ''); fill.style.width = `${Math.round(frac * 100)}%`;
  tr.append(fill);
  const val = document.createElement('b'); val.textContent = valueText;
  row.append(lab, tr, val);
  return row;
}

function renderStrip(log) {
  const strip = $('rStrip');
  strip.replaceChildren(...log.map((l, i) => {
    const b = document.createElement('i');
    const speed = Math.max(0, 1 - l.ms / Math.min(l.lim || BASE_LIMIT, BASE_LIMIT));
    b.style.height = l.ok ? `${30 + speed * 70}%` : '22%';
    if (!l.ok) b.className = 'no';
    b.style.setProperty('--i', i);
    return b;
  }));
  strip.setAttribute('aria-label', `${log.filter(l => l.ok).length} of ${log.length} answers right. Show every answer below.`);
  renderReview(log);
}
// Every answer, in order: the question, the number, what you pressed and what was right.
// Mistakes first: that's what people open the review for. "All answers" shows every round in order.
let reviewLog = [], reviewMode = 'miss';
function renderReview(log) {
  if (log) { reviewLog = log; reviewExpanded = false; }
  const misses = reviewLog.filter(l => !l.ok).length;
  if (!misses) reviewMode = 'all';
  else if (log) reviewMode = 'miss';
  $('rvMiss').textContent = misses ? `Mistakes (${misses})` : 'No mistakes';
  $('rvMiss').disabled = !misses;
  $('rvAll').textContent = `All ${reviewLog.length}`;
  $('rvMiss').setAttribute('aria-pressed', String(reviewMode === 'miss'));
  $('rvAll').setAttribute('aria-pressed', String(reviewMode === 'all'));
  const box = $('rReview');
  const side = (l, d) => { const t = TYPES[l.type]; if (!t || !d) return '–'; const flipped = l.flip ? (d === 'left' ? 'right' : 'left') : d; return flipped === 'left' ? t.left : t.right; };
  const rows = reviewLog.map((l, i) => [l, i]).filter(([l]) => reviewMode === 'all' || !l.ok);
  // Long lists show the first few with a "Show all" button, rather than a box that scrolls inside the page.
  const shown = reviewExpanded || rows.length <= REVIEW_FOLD + 2 ? rows : rows.slice(0, REVIEW_FOLD);
  const el = (cls, text) => { const x = document.createElement('span'); x.className = cls; if (text != null) x.textContent = text; return x; };
  box.replaceChildren(...shown.map(([l, i]) => {
    const li = document.createElement('li');
    li.className = l.ok ? 'ok' : 'no';
    const t = TYPES[l.type];
    const q = el('rv-q', t ? `${i + 1}. ${t.left[0] + t.left.slice(1).toLowerCase()} or ${t.right.toLowerCase()}? ${l.n}${l.form && l.form !== 'digit' ? ` (${l.form})` : ''}${l.flip ? ' · swapped' : ''}` : `${i + 1}.`);
    const time = l.paused ? 'paused' : l.d == null ? 'no answer' : l.early ? 'too early' : `${(l.ms / 1000).toFixed(2)}s`;
    if (l.ok) {
      // right: the question, how fast, and the answer with a tick
      const m = el('rv-m'); m.append(el('rv-tick', '✓'), side(l, l.right));
      m.setAttribute('aria-label', `right: ${side(l, l.right)}`);
      li.append(q, el('rv-a', time), m);
      return li;
    }
    // wrong: the right answer sits where a right row's answer does (with a tick, in green); what they
    // did goes on its own line, struck through, so the two can't be read the wrong way round
    const m = el('rv-m'); m.append(el('rv-tick', '✓'), side(l, l.right));
    m.setAttribute('aria-label', `answer: ${side(l, l.right)}`);
    const you = el('rv-you');
    you.append('You: ');
    if (l.d != null && !l.paused) { const pick = el('rv-pick', side(l, l.d)); pick.setAttribute('aria-label', `${side(l, l.d)}, wrong`); you.append(pick, ` · ${time}`); }
    else you.append(time);
    const why = l.paused ? '' : l.early ? 'Answered before reading it.' : l.d == null ? 'Ran out of time.'
      : l.flip ? 'The sides were swapped this round.' : l.sw ? 'The rule had just changed.' : '';
    if (why) you.append(el('rv-why', why));
    li.append(q, m, you);
    return li;
  }));
  const more = $('rvMore');
  more.hidden = shown.length === rows.length;
  more.textContent = `Show all ${rows.length}`;
}
const REVIEW_FOLD = 6;
let reviewExpanded = false;
$('rvMore').addEventListener('click', () => { reviewExpanded = true; renderReview(null); });
$('rvMiss').addEventListener('click', () => { reviewMode = 'miss'; reviewExpanded = false; renderReview(null); });
$('rvAll').addEventListener('click', () => { reviewMode = 'all'; reviewExpanded = false; renderReview(null); });
const openReview = () => {
  const d = $('rReviewBox'); if (d.open) { d.open = false; return; }
  d.open = true; track('review_open');
  d.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' });
  focusKbd([$('rvMiss'), $('rvAll')].find(b => !b.disabled && b.getAttribute('aria-pressed') === 'true') || $('rvAll'));
};
$('rStrip').addEventListener('click', openReview);
$('reviewBtn').addEventListener('click', openReview);

// One concrete thing to work on, from this run's answers.
function takeaway(run) {
  const L = run.log || [];
  const miss = L.filter(l => !l.ok);
  const rate = a => (a.length ? a.filter(l => l.ok).length / a.length : 1);
  const swCost = run.swMs != null && run.repMs != null && (run.swN ?? 3) >= 3 ? run.swMs - run.repMs : null;
  if (!L.length) return { k: 'Next time', t: 'Answer a few questions to get feedback here.' };
  if (!miss.length) {
    if (swCost != null && swCost >= 150) return { k: 'Clean run', t: `Every answer right. You were ${swCost} ms slower right after the rule changed: that gap is the thing to shrink next.` };
    return { k: 'Clean run', t: run.hard ? 'Every answer right on Hard. That’s the top of the game.' : 'Every answer right. Try Hard next: the clock shrinks and the sides can swap.' };
  }
  const early = miss.filter(l => l.early).length;
  const slow = miss.filter(l => l.d == null && !l.paused).length;
  const flip = miss.filter(l => l.flip).length;
  const sw = L.filter(l => l.sw === true), rp = L.filter(l => l.sw === false);
  const par = L.filter(l => l.type === 'parity'), siz = L.filter(l => l.type === 'size');
  const k = 'What to work on';
  // Each pattern that applies is a candidate, weighted by how many misses it explains; the biggest
  // one wins (ties go to the earlier, more actionable one). Before, the first match won, so 3 misses
  // on swapped sides could hide 10 missed Low/High questions.
  const cands = [];
  if (early >= 2) cands.push({ n: early, t: `${early} answers came in under 0.15 s and counted as guesses. Wait for the number, then move.` });
  if (slow >= 3) cands.push({ n: slow, t: `${slow} questions ran out of time. Read the rule first; once you know it, the number is quick.` });
  if (flip >= 2) cands.push({ n: flip, t: `${flip} misses were on swapped sides. When the sides swap, follow the words on the pads, not habit.` });
  if (sw.length >= 3 && rp.length >= 3 && rate(rp) - rate(sw) >= 0.2) {
    const m = sw.filter(l => !l.ok).length;
    const mr = rp.filter(l => !l.ok).length;
    cands.push({ n: m, t: `You missed ${m} of ${sw.length} questions right after the rule changed, against ${mr} of ${rp.length} when it stayed the same. Check the rule before the number.` });
  }
  if (par.length && siz.length && Math.abs(rate(par) - rate(siz)) >= 0.15) {
    const [weak, wl, strong, sl] = rate(par) < rate(siz) ? ['Odd/Even', par, 'Low/High', siz] : ['Low/High', siz, 'Odd/Even', par];
    const right = wl.filter(l => l.ok).length;
    const tip = right === 0 ? ` Check the rule above the number: ${weak === 'Low/High' ? '1–4 is low, 6–9 is high' : '1, 3, 7, 9 are odd'}.` : '';
    cands.push({ n: wl.length - right, t: `You missed more ${weak} questions: ${right}/${wl.length} right, against ${sl.filter(l => l.ok).length}/${sl.length} for ${strong}.${tip}` });
  }
  if (cands.length) return { k, t: cands.reduce((best, c) => (c.n > best.n ? c : best)).t };
  if (swCost != null && swCost >= 150) return { k, t: `You were ${swCost} ms slower right after the rule changed. That gap shrinks with practice.` };
  return { k, t: `${miss.length} miss${miss.length > 1 ? 'es' : ''}, spread across question types. Review them to spot a pattern.` };
}

function countUp(el, to) {
  if (reduceMotion.matches || to <= 0) { el.textContent = to.toLocaleString(); return; }
  const start = performance.now(), dur = 900;
  const step = now => {
    const t = Math.min(1, (now - start) / dur), e = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(to * e).toLocaleString();
    if (t < 1) requestAnimationFrame(step);
  };
  el.textContent = '0'; requestAnimationFrame(step);
}

function goHome() {
  // a new version arrived while they were playing: load it now, between games
  if (updateWaiting) { location.reload(); return; }
  show('home'); renderAll(); refreshRemote();
}

// ================= home controls =================
$('playBtn').addEventListener('click', () => play({ mode: 'classic' }));
$('howBtn').addEventListener('click', () => startTutorial(hard ? HARD_TUTORIAL : TUTORIAL));
$('untimedBtn').addEventListener('click', () => startPractice());
$('untimedNearBtn').addEventListener('click', () => startPractice());
// Skip and Ready continue to whatever the player came for (their Daily, a friend's challenge, or Classic).
$('skipBtn').addEventListener('click', () => {
  if (!g || !g.tutorial) return;
  store.set(g.hardIntro ? 'hardIntroDone' : 'tutorialDone', true);
  track('practice_skip');
  const it = g.intent;
  if (!g.hardIntro && it) { const needsHard = it.mode === 'challenge' ? !!parseCode(it.code)?.hard : it.mode === 'classic' && hard; if (needsHard) store.set('hardIntroDone', true); }
  startGame(it || { mode: 'classic' });
});
$('practiceAgainBtn').addEventListener('click', () => startTutorial(g && g.hardIntro ? HARD_TUTORIAL : TUTORIAL, g?.intent));
$('readyPlayBtn').addEventListener('click', () => { const it = g?.intent || { mode: 'classic' }; return g?.hardIntro ? startGame(it) : afterPractice(it); });
$('againBtn').addEventListener('click', () => (lastRun?.mode === 'practice' ? startPractice() : startGame({ mode: 'classic' })));
$('homeBtn').addEventListener('click', goHome);
$('statsBtn').addEventListener('click', () => { show('stats'); renderStats(); });
$('statsBack').addEventListener('click', goHome);
$('stPlay').addEventListener('click', () => play({ mode: 'classic' }));

function renderSetup() {
  for (const b of $('roundsSeg').querySelectorAll('button')) b.setAttribute('aria-pressed', String(+b.dataset.r === rounds));
  for (const b of $('levelSeg').querySelectorAll('button')) b.setAttribute('aria-pressed', String(!!+b.dataset.h === hard));
  $('optsSummary').textContent = `${rounds} rounds · ${hard ? 'Hard' : 'Normal'}`;
  $('youBestK').textContent = `Best (${rounds}${hard ? ', Hard' : ''})`;
  $('levelInfo').hidden = !hard;
}
$('roundsSeg').addEventListener('click', e => { const b = e.target.closest('button[data-r]'); if (!b) return; rounds = +b.dataset.r; store.set('rounds', rounds); boardR = rounds; boardH = hard; renderSetup(); refreshBoards(); });
$('levelSeg').addEventListener('click', e => { const b = e.target.closest('button[data-h]'); if (!b) return; hard = !!+b.dataset.h; store.set('hard', hard); boardR = rounds; boardH = hard; renderSetup(); refreshBoards(); });
renderSetup();

// ================= remote data (cached for offline) =================
let boards = store.get('cache.boards', {});     // modeKey -> { all, week }, plus daily[day]
let gameHistory = store.get('history', []);         // finished games (server + offline)
const challengeData = {};                       // code -> { createdBy, board, rounds, hard }
let boardView = 'classic', period = 'all';
let dataState = 'loading';

const myBest = (r, h) => Math.max(0, ...gameHistory.filter(x => x.mode === 'classic' && x.rounds === r && !!x.hard === !!h).map(x => x.score));
// Local receipts: every finished game goes here at once (id = its server game id, or null for
// offline games). When the server's list includes it, the server copy replaces it.
function addLocalHistory(run) {
  gameHistory = [...gameHistory.filter(x => !(run.gameId && x.id === run.gameId)), { id: run.gameId || null, at: Date.now(), mode: run.mode, rounds: run.rounds, hard: run.hard, day: run.day, score: run.score, correct: run.correct,
    avgMs: run.avgMs, swMs: run.swMs, repMs: run.repMs, swN: run.swN, repN: run.repN, par: run.split.parity, siz: run.split.size, bestStreak: run.bestStreak, local: true }].slice(-300);
  store.set('history', gameHistory);
}
// Lifetime totals: the server's count of every posted game, plus games only this device has
// seen yet. Never lower than what the local list alone shows.
let serverLifetime = store.get('lifetime', null);
function lifetime() {
  const local = statsFromGames(statGames());
  if (!serverLifetime) return local;
  const extra = statsFromGames(statGames().filter(x => x.local && !x.posted));
  const sum = { ...serverLifetime };
  for (const k of ['games', 'totalScore', 'perfect', 'hardPerfect', 'marathon', 'challenges']) sum[k] = (serverLifetime[k] || 0) + (extra[k] || 0);
  sum.fastest = [serverLifetime.fastest, extra.fastest].filter(v => v != null).reduce((m, v) => Math.min(m, v), Infinity);
  if (sum.fastest === Infinity) sum.fastest = null;
  sum.bestStreak = Math.max(serverLifetime.bestStreak || 0, local.bestStreak || 0);
  for (const k of ['games', 'totalScore', 'perfect', 'hardPerfect', 'marathon', 'challenges']) sum[k] = Math.max(sum[k], local[k] || 0);
  return sum;
}

function dailyHistory() {
  const h = { ...store.get('daily.history', {}) };
  for (const x of gameHistory) if (x.mode === 'daily' && x.day) h[x.day] = Math.max(h[x.day] ?? 0, x.score);
  return h;
}
// Streaks forgive one missed day per freeze (earned every 7 Dailies in a row).
const streakNow = (hist = dailyHistory()) => streakInfo(Object.keys(hist).filter(k => hist[k] != null), todayKey);
function dayStreak(hist) { return streakNow(hist).streak; }

// Each answer is filed under the board it was asked for, so a slow answer for 30 rounds can't
// land under the 20-round heading after the player switched.
let boardsSeq = 0;
async function refreshBoards() {
  renderAll();
  if (!online) return;
  const r0 = rounds, h0 = hard, day0 = todayKey, seq = ++boardsSeq;
  try {
    const r = await api('boards', { rounds: r0, hard: h0, day: day0 });
    boards[modeKey(r0, h0)] = { all: r.all, week: r.week };
    boards['daily:' + day0] = r.daily;
    store.set('cache.boards', boards);
    if (seq === boardsSeq) dataState = 'ready';
  } catch (e) { if (seq === boardsSeq) dataState = e.offline ? 'offline' : 'error'; }
  renderAll();
  if (boardR !== r0 || boardH !== h0) fetchBoard(boardR, boardH);
}

// One classic board on its own (the home leaderboard's length picker), when it isn't the Quick play one.
async function fetchBoard(r, h) {
  if (!online) return;
  try {
    const res = await api('boards', { rounds: r, hard: h, day: todayKey });
    boards[modeKey(r, h)] = { all: res.all, week: res.week };
    store.set('cache.boards', boards);
  } catch {}
  renderHomeBoard();
}

async function refreshRemote() {
  if (!online) { dataState = 'offline'; renderAll(); return; }
  await flushOutbox();
  const jobs = [refreshBoards()];
  if (getToken()) jobs.push(api('myStats').then(r => {
    const serverIds = new Set(r.games.map(x => x.id));
    // keep local receipts the server doesn't list yet (offline games, games still waiting to post)
    const local = gameHistory.filter(x => x.local && !(x.id && serverIds.has(x.id)) && !(x.posted && x.at < (r.games[0]?.at ?? 0)));
    gameHistory = [...r.games, ...local].sort((a, b) => a.at - b.at);
    store.set('history', gameHistory);
    if (r.lifetime) { serverLifetime = r.lifetime; store.set('lifetime', serverLifetime); }
  }).catch(e => { if (authGone(e)) { setToken(null); me = null; store.set('me', null); } }));
  if (pendingChallenge) jobs.push(loadChallenge(pendingChallenge.code));
  if (lastRun?.mode === 'challenge') jobs.push(loadChallenge(lastRun.code));
  await Promise.all(jobs);
  renderAll();
}

function boardData(view, r = rounds, h = hard) {
  if (view === 'daily') {
    const list = (boards['daily:' + todayKey] || []).filter(plausible(DAILY_ROUNDS)).sort(byScore);
    return { list, total: DAILY_ROUNDS, sub: `Daily #${dayNumber(todayKey)}`, empty: 'No one has played today’s challenge yet. Be the first.' };
  }
  if (view === 'challenge') {
    const code = lastRun?.mode === 'challenge' ? lastRun.code : pendingChallenge?.code;
    const c = challengeData[code] || {};
    const total = c.rounds || 20;
    return { list: (c.board || []).filter(plausible(total)).sort(byScore), total, sub: `${total} rounds${c.hard ? ' · Hard' : ''}`, empty: 'No results yet.' };
  }
  const b = boards[modeKey(r, h)] || {};
  return { list: (period === 'week' ? b.week : b.all || []) || [], total: r, sub: `${r} rounds${h ? ' · Hard' : ''}`,
           empty: period === 'week' ? 'No scores this week yet. Play a round to take first place.' : 'No scores yet. Play a round to take first place.' };
}

function renderList(olId, emptyId, data, max = 10) {
  const ol = $(olId), empty = emptyId ? $(emptyId) : null;
  const { list } = data;
  let shown = list.slice(0, max);
  const meIdx = me ? list.findIndex(x => x.playerId === me.id) : -1;
  if (meIdx >= max) shown = [...shown.slice(0, max - 1), list[meIdx]];
  ol.replaceChildren(...shown.map((r, i) => {
    const rank = list.indexOf(r) + 1;
    const li = document.createElement('li');
    if (rank <= 3) li.classList.add('top');
    const mine = me && r.playerId === me.id;
    if (mine) li.classList.add('me');
    const rk = document.createElement('span'); rk.className = 'rank'; rk.textContent = rank; rk.dataset.rank = rank;
    const av = document.createElement('span'); av.className = 'avatar'; av.textContent = (r.nickname || '?').slice(0, 1).toUpperCase();
    av.style.setProperty('--h', [...(r.playerId || 'x')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7));
    const who = document.createElement('div'); who.className = 'who';
    const nm = document.createElement('div'); nm.className = 'name'; nm.textContent = (r.nickname || 'Player') + (mine ? ' (you)' : '');
    const meta = document.createElement('div'); meta.className = 'meta';
    meta.textContent = `${r.correct ?? '–'}/${data.total} · ${r.avgMs ? (r.avgMs / 1000).toFixed(2) + 's avg' : '–'}`;
    who.append(nm, meta);
    const pts = document.createElement('span'); pts.className = 'pts'; pts.textContent = (r.score || 0).toLocaleString();
    li.style.setProperty('--i', i);
    li.append(rk, av, who, pts);
    if (!mine && r.playerId && getToken()) {
      const more = document.createElement('button'); more.type = 'button'; more.className = 'row-more';
      more.setAttribute('aria-label', `Report ${r.nickname || 'this player'}`); more.title = 'Report';
      more.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4h11l-1.5 4L16 12H5"/></svg>';
      more.addEventListener('click', e => { e.stopPropagation(); openReport(r); });
      li.append(more);
    }
    return li;
  }));
  if (!empty) return;
  empty.hidden = list.length > 0;
  const noPlayer = !getToken() && online && dataState !== 'loading';
  empty.textContent = dataState === 'loading' && !list.length ? 'Loading scores…'
    : noPlayer && !list.length ? 'No scores yet. Pick a nickname and take first place.'
    : !online && !list.length ? 'You’re offline. Leaderboards load when you’re back.'
    : data.empty;
  // the empty state names an action, so offer it right there
  if (noPlayer && !list.length) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'ghost small empty-cta'; b.textContent = 'Pick a nickname';
    b.addEventListener('click', () => askNickname(null));
    empty.append(document.createElement('br'), b);
  }
}

function renderAll() {
  renderHomeBoard(); renderYou(); renderDaily(); renderChallengeCard(); renderNet();
  if (!$('results').hidden) renderResultsBoard();
  if (!$('stats').hidden) renderStats();
}
function renderNet() {
  const n = outbox.pending().length, bad = outbox.failed();
  let note = '';
  if (!online) note = 'You’re offline. Classic games still work and are saved on this device.' + (n ? ` ${n} finished game${n > 1 ? 's' : ''} will post when you’re back.` : '');
  else if (n) note = `${n} finished game${n > 1 ? 's are' : ' is'} saved on this device and waiting to post. We’ll keep trying.`;
  $('netNote').textContent = note; $('netNote').hidden = !note;
  const att = $('attnNote');
  att.hidden = !bad.length;
  if (bad.length) $('attnText').textContent = `${bad.length} game${bad.length > 1 ? 's' : ''} couldn’t be posted: ${bad[0].error || 'it couldn’t be verified'}.`;
}
$('attnDismiss').addEventListener('click', () => { outbox.failed().forEach(x => outbox.remove(x.gameId)); renderNet(); });
function renderHomeBoard() {
  const classic = boardView === 'classic';
  const data = classic ? boardData('classic', boardR, boardH) : boardData(boardView);
  $('boardSub').textContent = data.sub;
  $('boardSub').hidden = classic;   // the length picker says it
  $('boardTools').hidden = !classic;
  $('boardMode').value = `${boardR}:${boardH ? 1 : 0}`;
  $('viewClassic').setAttribute('aria-pressed', String(boardView === 'classic'));
  $('viewDaily').setAttribute('aria-pressed', String(boardView === 'daily'));
  renderList('board', 'boardEmpty', data);
}
$('viewClassic').addEventListener('click', () => { boardView = 'classic'; renderHomeBoard(); });
$('boardMode').addEventListener('change', e => {
  const [r, h] = e.target.value.split(':');
  boardR = +r; boardH = h === '1';
  renderHomeBoard();
  fetchBoard(boardR, boardH);
});
$('stBadgesMore').addEventListener('click', () => { badgesExpanded = true; renderStats(); });
$('viewDaily').addEventListener('click', () => { boardView = 'daily'; renderHomeBoard(); });
for (const [id, p] of [['tabAll', 'all'], ['tabWeek', 'week']]) {
  $(id).addEventListener('click', () => {
    period = p;
    $('tabAll').setAttribute('aria-pressed', String(p === 'all'));
    $('tabWeek').setAttribute('aria-pressed', String(p === 'week'));
    renderHomeBoard();
  });
}
function renderResultsBoard() {
  if (!lastRun) return;
  $('rBoardPanel').hidden = lastRun.mode === 'practice';
  if (lastRun.mode === 'practice') return;
  const view = lastRun.mode;
  const data = boardData(view, lastRun.rounds, lastRun.hard);
  $('rBoardTitle').textContent = view === 'challenge' ? 'Challenge results' : view === 'daily' ? 'Today’s leaderboard' : 'Leaderboard';
  $('boardSub2').textContent = data.sub;
  renderList('board2', 'boardEmpty2', data, 5);
  if (!lastRun.gameId) { $('boardEmpty2').hidden = false; $('boardEmpty2').textContent = lastRun.mode === 'practice' ? 'Practice games aren’t on the leaderboard.' : 'This was an offline game, so it isn’t on the leaderboard.'; }
}
const earnedBadges = () => new Set(badgesFromStats(lifetime()).filter(b => b.earned).map(b => b.id));

function renderYou() {
  const lt = lifetime();
  const L = levelInfo(lt.totalScore);
  $('levelName').textContent = `Level ${L.level} · ${L.title}`;
  $('levelXp').textContent = `${L.into.toLocaleString()} / ${L.need.toLocaleString()} XP`;
  $('levelFill').style.width = `${Math.round(L.progress * 100)}%`;
  $('youNameBtn').hidden = !(me && me.guest);
  const { list } = boardData('classic');
  const idx = me ? list.findIndex(x => x.playerId === me.id) : -1;
  const best = Math.max(localBest(), myBest(rounds, hard));
  $('youBest').textContent = best ? best.toLocaleString() : '–';
  $('youRank').textContent = idx >= 0 ? `#${idx + 1}` : '–';
  const plays = Math.max(lt.games, statGames().length) || localPlays;
  $('youPlays').textContent = plays;
  // only show numbers that exist: a new player sees their level and nothing else
  $('youBest').parentElement.hidden = !best;
  $('youRank').parentElement.hidden = idx < 0;
  $('youPlays').parentElement.parentElement.hidden = !plays;
  // returning players get a short greeting instead of the full intro and rules
  const returning = statGames().length > 0;
  document.body.classList.toggle('returning', returning);
  $('heroTitle').textContent = returning ? (me && !me.guest ? `Welcome back, ${me.nickname}.` : 'Welcome back.') : 'Odd or even. Low or high. Three seconds.';
  $('youStatus').textContent = me ? me.nickname : '';
}

// ---------- daily ----------
// A new Daily opens at midnight UTC for everyone.
function untilMidnight() {
  const mins = Math.max(1, Math.round(msToNextUtcDay() / 60000));
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
}
const nextDailyLocalTime = () => new Date(Date.now() + msToNextUtcDay()).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
function dailyProgress() {
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith('lor.progress.')) continue;
    const v = store.get(k.slice(4), null);
    if (v && v.mode === 'daily' && v.day === todayKey) return v;
  }
  return null;
}
function renderDaily() {
  const k = utcDayKey();
  if (k !== todayKey) { todayKey = k; refreshBoards(); }
  $('dailyTitle').textContent = `Daily #${dayNumber(todayKey)}`;
  $('dailyDate').textContent = keyToDate(todayKey).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const hist = dailyHistory();
  const st = streakNow(hist), streak = st.streak;
  $('dayStreak').hidden = streak < 1;
  $('dayStreak').classList.toggle('hot', streak >= 3);
  $('dayStreakN').textContent = streak;
  $('dayFreeze').hidden = !st.freezes;
  $('dayFreezeN').textContent = st.freezes;
  const monday = addDays(todayKey, -((keyToDate(todayKey).getDay() + 6) % 7));
  $('dailyWeek').replaceChildren(...Array.from({ length: 7 }, (_, i) => addDays(monday, i)).map(k2 => {
    const d = document.createElement('div');
    const played = hist[k2] != null, frozen = st.usedOn.includes(k2);
    const before = dayNumber(k2) < 1;
    d.className = [played ? 'done' : '', frozen ? 'frozen' : '', k2 === todayKey ? 'today' : '', k2 > todayKey || before ? 'future' : ''].join(' ').trim();
    const dot = document.createElement('i');
    if (played) dot.innerHTML = '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>';
    else if (frozen) { dot.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3v18M5 7.5l14 9M19 7.5l-14 9"/></svg>'; d.title = 'Covered by a streak freeze'; }
    const lab = document.createElement('span'); lab.textContent = keyToDate(k2).toLocaleDateString(undefined, { weekday: 'narrow' });
    if (!frozen) d.title = keyToDate(k2).toLocaleDateString(undefined, { weekday: 'long' }) + (played ? `: ${hist[k2].toLocaleString()}` : before ? ': before the first Daily' : '');
    d.append(dot, lab);
    return d;
  }));
  const mine = hist[todayKey];
  // returning players who haven't played today: the Daily is the main thing on the page
  const dailyFirst = mine == null && document.body.classList.contains('returning');
  document.body.classList.toggle('daily-open', dailyFirst);
  // move the card in the page itself, not just visually, so Tab and screen readers meet it first too
  const card = $('dailyCard'), block = $('playBlock');
  if (dailyFirst ? card.nextElementSibling !== block : block.nextElementSibling !== card) {
    if (dailyFirst) block.before(card); else block.after(card);
  }
  $('dailyPlay').hidden = mine != null;
  $('dailyDone').hidden = mine == null;
  const prog = dailyProgress();
  $('dailyBtn').textContent = prog ? `Resume today’s challenge · round ${Math.min(Replay(prog) + 1, DAILY_ROUNDS)}/${DAILY_ROUNDS}` : 'Play today’s challenge';
  if (mine != null) {
    $('dailyScore').textContent = mine.toLocaleString();
    const { list } = boardData('daily');
    const idx = me ? list.findIndex(x => x.playerId === me.id) : -1;
    $('dailyRank').textContent = idx >= 0 ? `#${idx + 1} of ${list.length}` : '–';
    $('dailyRankK').textContent = 'This run, today';
    $('dailyNext').textContent = untilMidnight();
    $('dailyNextK').textContent = `New one at ${nextDailyLocalTime()}`;
  }
  $('dailyResets').textContent = `A new Daily opens every day at ${nextDailyLocalTime()} your time.`;
  $('dailyRemindBtn').hidden = mine == null || !remindersPossible() || store.get('reminders', false);
}
const Replay = prog => (prog.events || []).filter(e => e.o === 'a').length;
setInterval(() => { if (!$('home').hidden) renderDaily(); }, 30000);
$('dailyBtn').addEventListener('click', () => {
  if (dailyHistory()[todayKey] != null) { renderDaily(); return; }
  if (!online) { toast('You’re offline. The Daily needs a connection.'); return; }
  track('daily_open');
  // first-timers get the short warm-up first, then go straight into the Daily
  play({ mode: 'daily' });
});
$('dailyShareBtn').addEventListener('click', () => {
  const hist = dailyHistory();
  const fromHist = gameHistory.slice().reverse().find(x => x.mode === 'daily' && x.day === todayKey);
  const run = (lastRun && lastRun.mode === 'daily' && lastRun.day === todayKey) ? lastRun : {
    mode: 'daily', gameId: fromHist?.id || null, posted: !!fromHist && (!fromHist.local || !!fromHist.posted), rounds: DAILY_ROUNDS, hard: false, day: todayKey, score: hist[todayKey] || 0,
    correct: fromHist?.correct ?? 0, avgMs: fromHist?.avgMs ?? null, bestStreak: 0, date: new Date(), dayStreak: dayStreak(hist),
  };
  run.dayStreak = dayStreak(hist);
  openShare('score', run);
});

// ---------- challenges ----------
function parseHashChallenge() { return location.hash.startsWith('#c-') ? parseCode(location.hash.slice(3)) : null; }
let pendingChallenge = parseHashChallenge();
let challengeDismissed = false;
window.addEventListener('hashchange', () => { pendingChallenge = parseHashChallenge(); challengeDismissed = false; if (pendingChallenge) loadChallenge(pendingChallenge.code).then(renderAll); renderAll(); });

async function loadChallenge(code) {
  if (!online) return;
  try { challengeData[code] = await api('challengeInfo', { code }); } catch {}
}
function renderChallengeCard() {
  const pc = pendingChallenge;
  const card = $('challengeCard');
  card.hidden = !pc || challengeDismissed;
  if (card.hidden) return;
  const c = challengeData[pc.code] || {};
  const board = c.board || [];
  const mine = me && board.find(x => x.playerId === me.id);
  const played = mine || store.get('chal.' + pc.code, null) != null;
  const by = c.createdBy;
  const theirs = by && board.find(x => x.playerId === by.playerId);
  const level = pc.hard ? ' on Hard' : '';
  if (played) { $('cTitle').textContent = by && me && by.playerId === me.id ? 'Your challenge' : 'You played this challenge'; $('cSub').textContent = `${pc.rounds} questions${level}. Results update as friends play.`; }
  else if (theirs && (!me || by.playerId !== me.id)) { $('cTitle').textContent = `${by.nickname || 'Your friend'} scored ${theirs.score.toLocaleString()}. Beat it.`; $('cSub').textContent = `You get exactly the same ${pc.rounds} questions${level}. One try.`; }
  else { $('cTitle').textContent = `Same ${pc.rounds} questions${level}. Beat your friend.`; $('cSub').textContent = 'You get exactly the questions they played. One try.'; }
  const prog = Object.keys(localStorage).some(k => k.startsWith('lor.progress.') && store.get(k.slice(4), {})?.code === pc.code);
  $('cAccept').hidden = !!played;
  $('cAccept').textContent = prog ? 'Resume challenge' : 'Accept challenge';
  $('cDismiss').textContent = played ? 'Close' : 'Not now';
  $('cBtns').style.gridTemplateColumns = played ? '1fr' : '';
  const data = { list: board.filter(plausible(pc.rounds)).sort(byScore), total: pc.rounds };
  $('cBoard').hidden = !data.list.length;
  renderList('cBoard', null, data, 5);
}
$('cAccept').addEventListener('click', () => {
  const pc = pendingChallenge; if (!pc) return;
  if (!online) { toast('You’re offline. Challenges need a connection.'); return; }
  // practice (and the Hard intro) first if needed; Skip or Ready then start this exact challenge
  play({ mode: 'challenge', code: pc.code });
});
$('cDismiss').addEventListener('click', () => { challengeDismissed = true; window.history.replaceState(null, '', location.pathname); renderChallengeCard(); });
$('challengeBtn').addEventListener('click', async () => {
  if (!lastRun || lastRun.mode !== 'classic' || !lastRun.gameId) return;
  try {
    const { code } = await api('challengeCreate', { gameId: lastRun.gameId });
    lastRun.code = code;
    openShare('challenge', lastRun);
  } catch (e) { toast(e.offline ? 'You’re offline. Try again when you’re connected.' : e.message); }
});

// ---------- stats ----------
const SVGNS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs, text) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; return e; };
// a challenge you created duplicates the Classic game it came from; count it once
const statGames = () => gameHistory.filter((x, i, a) => !(x.mode === 'challenge' && a.some(y => y !== x && y.mode === 'classic' && y.score === x.score && Math.abs(y.at - x.at) < 2000)));

function renderStats() {
  $('pName').textContent = me ? me.nickname + (me.guest ? ' (guest)' : '') : 'Not set';
  $('renameBtn').textContent = me && !me.guest ? 'Change' : 'Pick one';
  const lt = lifetime();
  const lv = levelInfo(lt.totalScore);
  $('stLevelSub').textContent = `${lv.level} · ${lv.title}`;
  $('stLevelFill').style.width = `${Math.round(lv.progress * 100)}%`;
  $('stLevelNext').textContent = `${(lv.need - lv.into).toLocaleString()} XP to level ${lv.level + 1}. Every 10 points you score is 1\u00a0XP.`;
  const bs = badgesFromStats(lt);
  $('stBadgeCount').textContent = `${bs.filter(b => b.earned).length} of ${bs.length}`;
  const earned = bs.filter(b => b.earned), locked = bs.filter(b => !b.earned);
  // earned badges, then the next two or three to aim for; the rest wait behind a button
  const nextUp = (earned.length + 2) % 2 ? 3 : 2;   // fill the two-column grid's last row
  const shownB = badgesExpanded ? [...earned, ...locked] : [...earned, ...locked.slice(0, nextUp)];
  $('stBadgesMore').hidden = shownB.length === bs.length;
  $('stBadgesMore').textContent = `Show ${bs.length - shownB.length} more to earn`;
  $('stBadges').replaceChildren(...shownB.map(b => {
    const d = document.createElement('div'); d.className = 'badge-item' + (b.earned ? '' : ' locked');
    const m = document.createElement('div'); m.className = 'medal'; m.textContent = b.earned ? '★' : '';
    m.setAttribute('aria-label', b.earned ? 'Earned' : 'Not earned yet');
    const n = document.createElement('b'); n.textContent = b.name;
    const t = document.createElement('span'); t.textContent = b.desc;
    d.append(m, n, t); return d;
  }));
  $('copyStep').hidden = !getToken();   // nothing to copy until there's a player
  const games = statGames();
  const has = games.length > 0;
  $('stEmpty').hidden = has;
  for (const id of ['stTiles', 'stTrendPanel', 'stSwitchPanel', 'stSplitPanel', 'stLevelPanel']) $(id).hidden = !has;
  if (!has) $('stBaselinePanel').hidden = true;
  if (!has) return;
  const totalQ = games.reduce((a, x) => a + x.rounds, 0), totalC = games.reduce((a, x) => a + x.correct, 0);
  const avgAll = mean(games.filter(x => x.avgMs).map(x => x.avgMs));
  const tiles = [[Math.max(lt.games, games.length), 'Games played'], [`${Math.round((totalC / Math.max(1, totalQ)) * 100)}%`, 'Accuracy'],
    [avgAll ? (avgAll / 1000).toFixed(2) + 's' : '–', 'Avg (correct answers)'], [dayStreak(dailyHistory()), 'Daily streak']];
  $('stTiles').replaceChildren(...tiles.map(([v, k]) => { const d = document.createElement('div'); const b = document.createElement('b'); b.textContent = v; const s = document.createElement('span'); s.textContent = k; d.append(b, s); return d; }));

  // With only a game or two, a trend chart is a dot. Show the starting point instead.
  const fewGames = games.length < 3;
  $('stBaselinePanel').hidden = !fewGames; $('stTrendPanel').hidden = fewGames;
  $('stTiles').hidden = fewGames; $('stSwitchPanel').hidden = fewGames;   // too little data to mean anything yet
  if (fewGames) {
    const g0 = games.slice(-games.length);
    const ppr = Math.round(mean(g0.map(x => x.score / x.rounds)));
    const acc = Math.round(100 * g0.reduce((a, x) => a + x.correct, 0) / Math.max(1, g0.reduce((a, x) => a + x.rounds, 0)));
    const avg = mean(g0.filter(x => x.avgMs).map(x => x.avgMs));
    const cells = [[ppr, 'points per round'], [`${acc}%`, 'accuracy'], [avg ? (avg / 1000).toFixed(2) + 's' : '–', 'avg (correct)']];
    $('stBaseline').replaceChildren(...cells.map(([v, k]) => { const d = document.createElement('div'); const b = document.createElement('b'); b.textContent = v; const sp = document.createElement('span'); sp.textContent = k; d.append(b, sp); return d; }));
    const left = 3 - games.length;
    $('stBaselineNote').textContent = `${games.length === 1 ? 'Your first run. ' : ''}Play ${left} more game${left > 1 ? 's' : ''} to see a trend.`;
  }
  // Normal and Hard don't belong on one line: Hard has a shorter clock and words/dots. Chart Normal
  // games, or Hard ones if that's nearly all the player has played.
  const normal = games.filter(x => !x.hard), hardG = games.filter(x => x.hard);
  const pool = normal.length >= 2 || normal.length >= hardG.length ? normal : hardG;
  const shownG = pool.slice(-30);
  $('stTrendSub').textContent = `points per round, last ${shownG.length} ${pool === hardG ? 'Hard' : 'Normal'} game${shownG.length > 1 ? 's' : ''}${hardG.length && normal.length ? (pool === normal ? ' · Hard not included' : ' · Normal not included') : ''}`;
  const pts = shownG.map(x => x.score / x.rounds);
  const W = 320, H = 130, L = 26, R = 30, T = 10, B = 18;
  const maxY = Math.max(50, Math.ceil(Math.max(...pts) / 50) * 50);
  const xAt = i => L + (pts.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (pts.length - 1));
  const yAt = v => T + (H - T - B) * (1 - v / maxY);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Points per round over your last ${pts.length} games, latest ${Math.round(pts[pts.length - 1])}` });
  for (let v = 0; v <= maxY; v += maxY / 2) {
    svg.append(svgEl('line', { class: 'grid', x1: L, x2: W - R, y1: yAt(v), y2: yAt(v) }));
    svg.append(svgEl('text', { class: 'axis', x: L - 6, y: yAt(v) + 3, 'text-anchor': 'end' }, Math.round(v)));
  }
  const line = pts.map((v, i) => `${i ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ');
  if (pts.length > 1) svg.append(svgEl('path', { class: 'area', d: `${line} L${xAt(pts.length - 1)},${yAt(0)} L${xAt(0)},${yAt(0)} Z` }));
  svg.append(svgEl('path', { class: 'line', d: line }));
  const lx = xAt(pts.length - 1), ly = yAt(pts[pts.length - 1]);
  svg.append(svgEl('circle', { class: 'end', cx: lx, cy: ly, r: 4.5 }));
  svg.append(svgEl('text', { class: 'endlabel', x: lx + 7, y: ly + 3.5 }, Math.round(pts[pts.length - 1])));
  svg.append(svgEl('text', { class: 'axis', x: L, y: H - 4 }, pts.length > 1 ? 'oldest' : 'this game'));
  svg.append(svgEl('text', { class: 'axis', x: W - R, y: H - 4, 'text-anchor': 'end' }, 'latest'));
  $('stTrend').replaceChildren(svg);

  const withBoth = games.filter(x => x.swMs != null && x.repMs != null);
  const box = $('stSwitch'); box.replaceChildren();
  if (!withBoth.length) {
    const p = document.createElement('p'); p.className = 'switch-note'; p.textContent = 'Play a few more answers and your switch cost will show here.'; box.append(p);
  } else {
    const recent = withBoth.slice(-10);
    const sw = mean(recent.map(x => x.swMs)), rep = mean(recent.map(x => x.repMs)), cost = Math.round(sw - rep);
    const counted = recent.filter(x => x.swN != null);
    const nSw = counted.reduce((a, x) => a + x.swN, 0), nRep = counted.reduce((a, x) => a + x.repN, 0);
    const big = document.createElement('div'); big.className = 'switch-big'; big.textContent = `${cost > 0 ? '+' : ''}${cost} ms`;
    const note = document.createElement('p'); note.className = 'switch-note';
    note.textContent = (cost > 0 ? 'slower right after the question changes' : 'no slowdown after a switch')
      + ` · last ${recent.length} game${recent.length > 1 ? 's' : ''}, correct answers only`;
    box.append(big, note);
    const sample = document.createElement('p'); sample.className = 'switch-note muted';
    sample.textContent = counted.length === recent.length
      ? `Based on ${nSw} answers after a switch and ${nRep} after a repeat.${nSw + nRep < 60 ? ' A small sample: it will settle as you play more.' : ''}`
      : recent.length < 5 ? 'A small sample: it will settle as you play more.' : '';
    if (sample.textContent) box.append(sample);
    if (withBoth.length >= 12) {
      const first = withBoth.slice(0, 10), was = Math.round(mean(first.map(x => x.swMs)) - mean(first.map(x => x.repMs)));
      const t = document.createElement('p'); t.className = 'switch-note' + (cost < was ? ' good' : '');
      t.textContent = cost < was ? `Down from ${was} ms in your first 10 games.` : `It was ${was} ms in your first 10 games.`;
      box.append(t);
    }
    const maxMs = Math.max(sw, rep);
    box.append(meter('Same question', rep / maxMs, (rep / 1000).toFixed(2) + 's', false), meter('After a switch', sw / maxMs, (sw / 1000).toFixed(2) + 's', true));
  }
  const sum = (key, i) => games.reduce((a, x) => a + ((x[key] || [0, 0])[i] || 0), 0);
  $('stSplit').replaceChildren(...[['Odd or Even', 'par', false], ['Low or High', 'siz', true]].map(([k, key, alt]) => {
    const right = sum(key, 0), total = sum(key, 1);
    return meter(k, total ? right / total : 0, total ? `${Math.round((right / total) * 100)}%` : '–', alt);
  }));
}
$('saveName').addEventListener('submit', async e => {
  e.preventDefault();
  const check = cleanNickname($('saveNameInput').value);
  const err = $('saveNameError');
  if (!check.ok) { err.textContent = check.error; err.hidden = false; return; }
  $('saveNameBtn').disabled = true;
  try {
    const r = await api('rename', { nickname: check.value });
    me = r.player; store.set('me', me);
    $('saveName').hidden = true; err.hidden = true;
    toast(`Saved. You’re on the leaderboard as ${me.nickname}`);
    track('name_saved');
    await refreshRemote();
  } catch (ex) { err.textContent = ex.offline ? 'You’re offline. Try again when you’re connected.' : ex.message; err.hidden = false; }
  finally { $('saveNameBtn').disabled = false; }
});
$('youNameBtn').addEventListener('click', () => askNickname(null, { rename: true }));
// Switching to another player: forget everything that belonged to the previous one on this
// device (history, bests, streak, queued games, cached boards). Settings stay.
// Unsent games stay, in each profile's own outbox: switching back to that code posts them.
const KEEP_KEYS = ['theme', 'sound', 'size', 'tutorialDone', 'hardIntroDone', 'rounds', 'hard', 'playerToken'];
function wipePlayerData() {
  try { Object.keys(localStorage).filter(k => k.startsWith('lor.') && !KEEP_KEYS.includes(k.slice(4)) && !k.startsWith('lor.outbox.')).forEach(k => localStorage.removeItem(k)); } catch {}
  gameHistory = []; serverLifetime = null; boards = {}; localPlays = 0; lastRun = null;
}
$('deleteMeBtn').addEventListener('click', async () => {
  const b = $('deleteMeBtn');
  if (!getToken()) { toast('There’s no player on this device.'); return; }
  if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Tap again to delete for good'; setTimeout(() => { b.dataset.armed = ''; b.textContent = 'Delete my player'; }, 5000); return; }
  b.disabled = true;
  try {
    await api('deleteMe');
    // other profiles' unsent games on this device are kept; only this player's go
    const mineBox = 'lor.outbox.' + (me?.id || '');
    try { Object.keys(localStorage).filter(k => k.startsWith('lor.') && (!k.startsWith('lor.outbox.') || k === mineBox)).forEach(k => localStorage.removeItem(k)); } catch {}
    const reg = await navigator.serviceWorker?.ready.catch(() => null);
    (await reg?.pushManager?.getSubscription())?.unsubscribe();
    location.href = '/';
  } catch (e) { toast(e.offline ? 'You’re offline. Try again when you’re connected.' : e.message); b.disabled = false; }
});
$('renameBtn').addEventListener('click', () => (getToken() ? askNickname(null, { rename: true }) : askNickname(null)));
$('copyCodeBtn').addEventListener('click', async () => {
  const t = getToken(); if (!t) return;
  store.set('backupNudged', true);
  try { await navigator.clipboard.writeText(t); toast('Player code copied. Keep it private: it signs you in.'); }
  catch { $('codeInput').value = t; $('codeInput').select(); toast('Select and copy the code shown'); }
});
$('useCodeBtn').addEventListener('click', async () => {
  const code = $('codeInput').value.trim();
  if (!/^[0-9a-f]{64}$/.test(code)) { toast('That doesn’t look like a player code.'); return; }
  const old = getToken(), oldMe = me;
  setToken(code);
  try {
    const r = await api('me');
    if (!oldMe || oldMe.id !== r.player.id) wipePlayerData();
    me = r.player; store.set('me', me); $('codeInput').value = '';
    const waiting = outbox.pending().length;
    toast(`Signed in as ${me.nickname}` + (waiting ? `. Posting ${waiting} saved game${waiting > 1 ? 's' : ''}…` : ''));
    if (waiting) await flushOutbox({ force: true });   // this profile's saved games go now, not after the retry wait
    await refreshRemote();
  }
  catch (e) { setToken(old); toast(e.status === 401 ? 'That code didn’t match a player.' : e.message); }
});

// ================= share =================
const SITE = location.origin;
let cardBlob = null, cardUrl = null, shareKind = 'score', shareRun = null, shareOpener = null;
// Each verified game and each challenge gets its own link, whose preview shows that exact score card.
const shareLink = () => (shareKind === 'challenge' ? `${SITE}/c/${shareRun.code}`
  : shareRun.gameId && shareRun.posted ? `${SITE}/s/${shareRun.gameId}` : SITE);
function shareText(run) {
  const sc = run.score.toLocaleString();
  if (shareKind === 'challenge') return `I scored ${sc} on these exact ${run.rounds} questions${run.hard ? ' on Hard' : ''} in Left or Right. Same questions, one try. Can you beat me?`;
  if (run.mode === 'daily') return `Left or Right Daily #${dayNumber(run.day)}: ${sc} (${run.correct}/${run.rounds})${run.dayStreak > 1 ? ` · ${run.dayStreak}-day streak` : ''}. Same questions for everyone today.`;
  const avg = run.avgMs ? `, ${(run.avgMs / 1000).toFixed(2)}s average` : '';
  return `I scored ${sc} on Left or Right (${run.rounds} rounds${run.hard ? ', Hard' : ''}): ${run.correct}/${run.rounds} correct${avg}. Can you beat it?`;
}

async function drawCard(run) {
  const W = 1080, H = 1350;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const D = '"Bricolage Grotesque", "Avenir Next", system-ui, sans-serif', Bf = 'Inter, -apple-system, system-ui, sans-serif';
  try { await Promise.all([`800 100px ${D}`, `700 40px ${D}`, `500 30px ${Bf}`].map(f => document.fonts.load(f))); } catch {}
  const C = { bg: '#0d0f15', tile: '#171a23', ink: '#eef0f6', muted: '#9298ab', left: '#7d8bff', right: '#ff7aa6', good: '#43c98a', warn: '#f2ae4e' };
  x.fillStyle = C.bg; x.fillRect(0, 0, W, H);
  const glow = (cx, col) => { const gr = x.createRadialGradient(cx, 260, 0, cx, 260, 620); gr.addColorStop(0, col + '40'); gr.addColorStop(1, col + '00'); x.fillStyle = gr; x.fillRect(0, 0, W, H); };
  glow(120, C.left); glow(W - 120, C.right);
  const rr = (px, py, w, h, r, col) => { x.fillStyle = col; x.beginPath(); x.roundRect(px, py, w, h, r); x.fill(); };
  rr(80, 86, 26, 48, 7, C.left); rr(112, 86, 26, 48, 7, C.right);
  x.fillStyle = C.ink; x.font = `800 44px ${D}`; x.textBaseline = 'middle'; x.fillText('Left or Right', 162, 112);
  x.textAlign = 'right'; x.fillStyle = C.muted; x.font = `500 30px ${Bf}`;
  x.fillText((run.date || new Date()).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }), W - 80, 112);
  const head = shareKind === 'challenge' ? 'BEAT MY SCORE' : run.mode === 'daily' ? `DAILY #${dayNumber(run.day)}` : run.hard ? 'MY SCORE · HARD' : 'MY SCORE';
  x.textAlign = 'center'; x.textBaseline = 'alphabetic';
  x.fillStyle = C.muted; x.font = `600 34px ${Bf}`; x.fillText(head, W / 2, 330);
  let size = 260; x.font = `800 ${size}px ${D}`;
  const s = run.score.toLocaleString();
  while (x.measureText(s).width > W - 160 && size > 120) { size -= 10; x.font = `800 ${size}px ${D}`; }
  x.fillStyle = C.ink; x.fillText(s, W / 2, 330 + size * 0.95);
  const badge = run.mode === 'daily' && run.dayStreak > 1 ? `${run.dayStreak}-day streak` : run.isBest ? 'New personal best' : run.perfect ? 'Perfect round' : null;
  if (badge) {
    x.font = `700 34px ${Bf}`;
    const bw = x.measureText(badge).width + 64, col = run.mode === 'daily' ? C.warn : C.good;
    rr((W - bw) / 2, 640, bw, 64, 32, col + '2e');
    x.fillStyle = col; x.textBaseline = 'middle'; x.fillText(badge, W / 2, 673); x.textBaseline = 'alphabetic';
  }
  const stats = [[`${run.correct}/${run.rounds}`, 'Correct'], [run.avgMs ? (run.avgMs / 1000).toFixed(2) + 's' : '–', 'Avg answer'],
    [String(run.bestStreak ?? 0), 'Best streak'], run.rank ? [`#${run.rank}`, run.mode === 'daily' ? 'Today' : 'Leaderboard'] : [`${Math.round((run.correct / run.rounds) * 100)}%`, 'Accuracy']];
  const tw = (W - 160 - 24) / 2, th = 170;
  stats.forEach(([v, k], i) => {
    const tx = 80 + (i % 2) * (tw + 24), ty = 760 + Math.floor(i / 2) * (th + 24);
    rr(tx, ty, tw, th, 28, C.tile);
    x.textAlign = 'left'; x.fillStyle = C.ink; x.font = `700 72px ${D}`; x.fillText(v, tx + 36, ty + 92);
    x.fillStyle = C.muted; x.font = `500 30px ${Bf}`; x.fillText(k, tx + 36, ty + 140);
  });
  x.textAlign = 'center'; x.fillStyle = C.ink; x.font = `700 44px ${D}`;
  x.fillText(shareKind === 'challenge' ? 'Same questions. Your turn.' : 'Can you beat it?', W / 2, 1222);
  x.fillStyle = C.muted; x.font = `500 28px ${Bf}`;
  x.fillText(run.mode === 'daily' ? 'Same 20 questions for everyone today' : `${run.rounds} rounds${run.hard ? ' · Hard' : ''} · ${run.hard ? '3 to 1.5' : '3'} seconds per answer`, W / 2, 1272);
  return new Promise(res => c.toBlob(res, 'image/png'));
}

function setSocialLinks(run) {
  const link = shareLink();
  const t = encodeURIComponent(shareText(run)), u = encodeURIComponent(link), tu = encodeURIComponent(shareText(run) + ' ' + link);
  $('sX').href = `https://x.com/intent/post?text=${t}&url=${u}`;
  $('sWa').href = `https://wa.me/?text=${tu}`;
  $('sFb').href = `https://www.facebook.com/sharer/sharer.php?u=${u}&quote=${t}`;
  $('sLi').href = `https://www.linkedin.com/sharing/share-offsite/?url=${u}`;
  $('sTg').href = `https://t.me/share/url?url=${u}&text=${t}`;
}
const fileFor = blob => new File([blob], `left-or-right-${shareRun.score}.png`, { type: 'image/png' });
const canNativeShare = () => { try { return !!cardBlob && !!navigator.canShare && navigator.canShare({ files: [fileFor(cardBlob)] }); } catch { return false; } };

async function openShare(kind, run) {
  if (!run) return;
  shareKind = kind; shareRun = run; shareOpener = document.activeElement;
  $('shareTitle').textContent = kind === 'challenge' ? 'Challenge a friend' : 'Share your score';
  $('shareNote').textContent = kind === 'challenge'
    ? 'Your friend gets the exact same questions and one try. Their result shows up on your challenge.'
    : shareRun.gameId && shareRun.posted
      ? 'The link shows this score card as its preview on LinkedIn, X, WhatsApp and more. Or save the image to post it yourself.'
      : shareRun.gameId
        ? 'This score isn’t posted yet, so the link goes to the game itself. Save the image to post your score now, or share again once it’s posted.'
        : 'This game wasn’t posted, so the link goes to the game itself. Save the image to post your score.';
  $('copyTextLabel').textContent = kind === 'challenge' ? 'Copy invite' : 'Copy text';
  openDialog($('shareScrim'), $('shareClose'));
  track('share_open');
  setSocialLinks(run);
  $('cardImg').removeAttribute('src');
  cardBlob = await drawCard(run);
  if (cardUrl) URL.revokeObjectURL(cardUrl);
  cardUrl = URL.createObjectURL(cardBlob);
  $('cardImg').src = cardUrl;
  $('saveImgLabel').textContent = canNativeShare() ? 'Share image' : 'Save image';
  $('saveImgIcon').innerHTML = canNativeShare()
    ? '<path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>'
    : '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>';
  $('copyImgBtn').hidden = !(window.ClipboardItem && navigator.clipboard && navigator.clipboard.write);
}
function closeShare() { closeDialog($('shareScrim'), shareOpener); }
$('shareBtn').addEventListener('click', () => openShare('score', lastRun));
$('shareClose').addEventListener('click', closeShare);
$('shareScrim').addEventListener('click', e => { if (e.target === $('shareScrim')) closeShare(); });
for (const id of ['nickScrim', 'iosScrim', 'reportScrim']) $(id).addEventListener('click', e => { if (e.target === $(id)) closeDialog($(id)); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('shareScrim').hidden) closeShare();
  for (const id of ['nickScrim', 'iosScrim', 'reportScrim']) if (!$(id).hidden) closeDialog($(id));
});
// keep Tab inside the open sheet
document.addEventListener('keydown', e => {
  if (e.key !== 'Tab' || !dialogStack.length) return;
  const d = dialogStack[dialogStack.length - 1];
  const f = [...d.querySelectorAll('button, a[href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')].filter(x => !x.disabled && !x.hidden && x.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  else if (!d.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
});

// ================= report a player =================
let reportTarget = null;
function openReport(row) {
  reportTarget = row;
  $('reportWho').textContent = row.nickname || 'this player';
  $('reportForm').reset(); $('reportError').hidden = true;
  openDialog($('reportScrim'));
}
$('reportClose').addEventListener('click', () => closeDialog($('reportScrim')));
$('reportForm').addEventListener('submit', async e => {
  e.preventDefault();
  const reason = new FormData($('reportForm')).get('reason');
  if (!reason) { $('reportError').textContent = 'Pick a reason.'; $('reportError').hidden = false; return; }
  $('reportSend').disabled = true;
  try {
    await api('report', { playerId: reportTarget.playerId, reason, note: $('reportNote').value });
    closeDialog($('reportScrim'));
    toast('Thanks. We’ll take a look.');
  } catch (ex) { $('reportError').textContent = ex.offline ? 'You’re offline. Try again when you’re connected.' : ex.message; $('reportError').hidden = false; }
  finally { $('reportSend').disabled = false; }
});
$('saveImgBtn').addEventListener('click', async () => {
  if (!cardBlob) return;
  if (canNativeShare()) {
    try { await navigator.share({ files: [fileFor(cardBlob)], text: shareText(shareRun) + ' ' + shareLink() }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = cardUrl; a.download = `left-or-right-${shareRun.score}.png`;
  document.body.append(a); a.click(); a.remove();
  toast('Image saved');
});
$('copyImgBtn').addEventListener('click', async () => {
  try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': cardBlob })]); toast('Image copied. Paste it into your post'); }
  catch { $('copyImgBtn').hidden = true; toast('Copying images isn’t supported here. Save it instead'); }
});
$('copyTextBtn').addEventListener('click', async () => {
  const text = shareText(shareRun) + ' ' + shareLink();
  if (shareKind === 'challenge' && navigator.share && !canNativeShare()) {
    try { await navigator.share({ text: shareText(shareRun), url: shareLink() }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(text); toast(shareKind === 'challenge' ? 'Invite copied. Send it to a friend' : 'Text copied'); }
  catch { toast('Couldn’t copy. Select the text in your post instead'); }
});

// ================= daily reminders (web push) =================
const remindersPossible = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
function b64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
function renderReminder() { $('remindLabel').textContent = `Daily reminder: ${store.get('reminders', false) ? 'on (6 pm)' : 'off'}`; }
async function enableReminders() {
  if (!remindersPossible()) {
    toast(isIOS() && !isStandalone() ? 'On iPhone, add the game to your Home Screen first, then turn on reminders.' : 'This browser can’t show reminders.');
    return;
  }
  if (!(await ensurePlayer())) return;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { toast('Notifications are blocked. You can allow them in your browser’s site settings.'); return; }
  try {
    const reg = await navigator.serviceWorker.ready;
    const { key } = await api('pushKey');
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
    let tz = null; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch {}
    await api('pushSubscribe', { subscription: sub.toJSON(), tz, tzOffsetMin: -new Date().getTimezoneOffset(), hour: 18 });
    store.set('reminders', true);
    track('reminder_on');
    toast('Done. We’ll remind you at 6 pm on days you haven’t played the Daily.');
  } catch (e) { toast(e.offline ? 'You’re offline. Try again when you’re connected.' : 'Couldn’t turn on reminders. Try again later.'); report('push: ' + (e.message || e)); }
  renderReminder(); renderDaily();
}
async function disableReminders() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) { await api('pushUnsubscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
  } catch {}
  store.set('reminders', false); renderReminder(); renderDaily();
  toast('Reminders off.');
}
$('remindBtn').addEventListener('click', () => { setMenu(false); store.get('reminders', false) ? disableReminders() : enableReminders(); });
$('dailyRemindBtn').addEventListener('click', enableReminders);
renderReminder();

// ================= install (PWA) =================
let installPrompt = null;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; $('installBtn').hidden = isStandalone(); });
window.addEventListener('appinstalled', () => { installPrompt = null; $('installBtn').hidden = true; track('install'); toast('Installed. Find Left or Right on your home screen.'); });
if (isIOS() && !isStandalone()) $('installBtn').hidden = false;
$('installBtn').addEventListener('click', async () => {
  if (installPrompt) { installPrompt.prompt(); const { outcome } = await installPrompt.userChoice.catch(() => ({})); if (outcome === 'accepted') $('installBtn').hidden = true; installPrompt = null; return; }
  if (isIOS()) openDialog($('iosScrim'));
});
$('iosClose').addEventListener('click', () => closeDialog($('iosScrim')));

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  // Updates: look for a new version whenever the app comes back to the front (and every 30 minutes).
  // When one takes over, reload straight away if nothing is in progress; mid-game, wait until they
  // go back home. Without this an open tab or installed app keeps showing the old version.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('/sw.js').then(reg => {
    const check = () => reg.update().catch(() => {});
    addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    setInterval(check, 30 * 60 * 1000);
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || updateWaiting) return;   // first install: nothing old on screen
    const busy = !$('game').hidden || !$('shareScrim').hidden || !$('nickScrim').hidden || !$('reportScrim').hidden;
    if (busy) { updateWaiting = true; return; }
    updateWaiting = true; location.reload();
  });
}

// ================= connectivity & boot =================
window.addEventListener('online', () => { online = true; refreshRemote(); });
// try the outbox again whenever the app comes back to the front
addEventListener('visibilitychange', () => { if (!document.hidden && online && outbox.pending().length) flushOutbox({ force: true }).then(renderAll); });
window.addEventListener('offline', () => { online = false; dataState = 'offline'; renderAll(); });

// ---------- a shared score link (/s/<id> lands here as /?s=<id>) ----------
async function showLanding(id) {
  try {
    const d = await api('share', { gameId: id });
    const what = d.mode === 'daily' ? `Daily #${dayNumber(d.day)}` : d.mode === 'challenge' ? 'a challenge' : `${d.rounds} rounds${d.hard ? ' on Hard' : ''}`;
    $('landingTitle').textContent = `${d.nickname} scored ${Number(d.score).toLocaleString()} on ${what}.`;
    $('landingSub').textContent = `${d.correct}/${d.rounds} correct${d.avgMs ? ` · ${(d.avgMs / 1000).toFixed(2)}s average` : ''}${d.rank && d.of ? ` · #${d.rank} of ${d.of}` : ''}. Checked by the game server.`;
    const todays = d.mode === 'daily' && d.day === todayKey && dailyHistory()[todayKey] == null;
    landingIntent = todays ? { mode: 'daily' } : { mode: 'classic' };
    if (!todays && ROUND_OPTIONS.includes(d.rounds) && d.mode === 'classic') { rounds = d.rounds; hard = !!d.hard; renderSetup(); }
    $('landingPlay').textContent = todays ? 'Play today’s Daily' : `Play ${rounds} rounds${hard ? ' · Hard' : ''}`;
    $('landingCard').hidden = false;
    track('landing_score');
  } catch { /* an unknown or removed game: just show the normal home screen */ }
}
let landingIntent = { mode: 'classic' };
$('landingPlay').addEventListener('click', () => { $('landingCard').hidden = true; play(landingIntent); });
$('landingClose').addEventListener('click', () => { $('landingCard').hidden = true; });

async function boot() {
  goHome();
  track('visit');
  if (pendingChallenge) track('challenge_open');
  const qs = new URLSearchParams(location.search);
  // from a reminder: show the Daily card, never start it without a tap
  if (qs.get('view') === 'daily' || qs.get('go') === 'daily') setTimeout(() => { $('dailyCard').scrollIntoView({ block: 'center' }); $('dailyCard').classList.add('flash'); focusKbd($('dailyBtn')); }, 300);
  const sid = qs.get('s');
  if (sid && /^[0-9a-f-]{36}$/i.test(sid)) showLanding(sid);
  if (qs.toString()) history.replaceState(null, '', location.pathname + location.hash);
  if (getToken() && online) {
    try { const r = await api('me'); me = r.player; store.set('me', me); renderAll(); }
    catch (e) { if (authGone(e)) { setToken(null); me = null; store.set('me', null); } }
  }
  if (online && outbox.pending().length) flushOutbox({ force: true }).then(renderAll);
}
boot();

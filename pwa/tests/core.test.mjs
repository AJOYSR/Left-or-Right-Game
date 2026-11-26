import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Run, buildQuestions, sideFor, valueLabel, pointsFor, minimumDurationMs, parseCode, challengeCode,
  dayNumber, addDays, MAX_PAUSES, BASE_LIMIT, HARD_END_LIMIT, NUMBERS, timingCheck, cleanNickname,
  isOffensive, streakInfo, levelInfo, badgeState,
} from '../src/core.js';

const play = (run, pick) => { while (!run.done) { const q = run.next(); const r = pick(q, run); if (r === 'skip') run.skip(); else run.answer(r.d, r.ms); } return run; };
const perfect = q => ({ d: sideFor(q), ms: 600 });

test('the same seed always gives the same questions', () => {
  assert.deepEqual(buildQuestions('abc234', 20, false), buildQuestions('abc234', 20, false));
  assert.deepEqual(buildQuestions('abc234', 20, true), buildQuestions('abc234', 20, true));
  assert.notDeepEqual(buildQuestions('abc234', 20, false), buildQuestions('xyz789', 20, false));
});

test('questions never use 5 and never repeat back to back', () => {
  for (const seed of ['a', 'b', 'c', 'daily-2026-11-26']) {
    const qs = buildQuestions(seed, 50, true);
    qs.forEach((q, i) => {
      assert.ok(NUMBERS.includes(q.n));
      if (i) assert.ok(!(q.type === qs[i - 1].type && q.n === qs[i - 1].n));
    });
  }
});

test('Hard mode: timer shrinks from 3 s to 1.5 s, first rounds are plain digits, never swapped early', () => {
  const qs = buildQuestions('hardseed', 20, true);
  assert.equal(qs[0].limit, BASE_LIMIT);
  assert.equal(qs[19].limit, HARD_END_LIMIT);
  assert.ok(qs.slice(0, 2).every(q => q.form === 'digit'));
  assert.ok(qs.slice(0, 3).every(q => !q.flip));
  assert.ok(buildQuestions('normal', 20, false).every(q => !q.flip && q.form === 'digit' && q.limit === BASE_LIMIT));
});

test('answer sides match the rules, including swapped rounds', () => {
  assert.equal(sideFor({ type: 'parity', n: 6 }), 'right');
  assert.equal(sideFor({ type: 'parity', n: 3 }), 'left');
  assert.equal(sideFor({ type: 'size', n: 6 }), 'right');
  assert.equal(sideFor({ type: 'size', n: 4 }), 'left');
  assert.equal(sideFor({ type: 'parity', n: 4, flip: true }), 'left');
  assert.equal(valueLabel({ type: 'parity', n: 4, flip: true }), 'EVEN');
});

test('scoring: speed and streak bonuses, capped streak', () => {
  assert.equal(pointsFor(0, 1, 3000), 200);
  assert.equal(pointsFor(3000, 1, 3000), 100);
  assert.equal(pointsFor(1500, 2, 3000), 160);
  assert.equal(pointsFor(0, 50, 3000), 250);   // max per round
});

test('a perfect run replays to the same score on the server', () => {
  const run = play(new Run({ seed: 'abc234', rounds: 15, hard: false }), perfect);
  const again = Run.replay({ seed: 'abc234', rounds: 15, hard: false }, run.events);
  assert.equal(again.score, run.score);
  assert.equal(again.correct, 15);
});

test('pausing mid-question replaces the question, ends the streak and is capped', () => {
  const run = new Run({ seed: 'pz', rounds: 15, hard: false });
  const first = run.next(); run.answer(sideFor(first), 500);
  const shown = run.next(); run.skip();
  assert.equal(run.streak, 0);
  const repl = run.next();
  assert.equal(repl.src, 'spare');
  run.answer(sideFor(repl), 500);
  play(run, perfect);
  const again = Run.replay({ seed: 'pz', rounds: 15, hard: false }, run.events);
  assert.equal(again.score, run.score);
  assert.equal(again.skips, 1);
  assert.ok(shown);

  const r2 = new Run({ seed: 'pz', rounds: 15, hard: false });
  for (let i = 0; i < MAX_PAUSES; i++) { r2.next(); r2.skip(); }
  r2.next();
  assert.throws(() => r2.skip(), /no pauses left/);
});

test('cheats are caught by replay', () => {
  const cfg = { seed: 'cheat1', rounds: 15, hard: false };
  const honest = play(new Run(cfg), perfect).events;

  // answering instantly = guessing: counted wrong
  const guessed = Run.replay(cfg, honest.map(e => ({ ...e, ms: 40 })));
  assert.equal(guessed.correct, 0);

  // answers slower than the limit don't count
  assert.equal(Run.replay(cfg, honest.map(e => ({ ...e, ms: 9000 }))).correct, 0);

  // claiming a replacement question that wasn't earned
  assert.throws(() => Run.replay(cfg, [{ ...honest[0], s: 'spare' }, ...honest.slice(1)]), /order/);

  // unfinished classic game
  assert.throws(() => Run.replay(cfg, honest.slice(0, 10)), /not finished/);
  // but an ended Daily or challenge may be short
  assert.equal(Run.replay(cfg, honest.slice(0, 10), { allowUnfinished: true }).summary().played, 10);

  // extra events
  assert.throws(() => Run.replay(cfg, [...honest, honest[0]]), /after the last round|bad events/);
  // junk
  assert.throws(() => Run.replay(cfg, [{ o: 'x', s: 'main' }]), /bad event/);
});

test('wall-clock check: a 15-round game needs real time', () => {
  const events = play(new Run({ seed: 't', rounds: 15, hard: false }), perfect).events;
  assert.ok(minimumDurationMs(events) >= 15 * 600);
});

test('bot timing is caught, human timing passes', () => {
  const ev = ms => ms.map(m => ({ o: 'a', d: 'left', ms: m, s: 'main' }));
  const human = [520, 610, 480, 700, 455, 830, 590, 640, 510, 760, 430, 680];
  assert.equal(timingCheck(ev(human)).ok, true);
  assert.equal(timingCheck(ev(human.map(() => 180))).ok, false);                 // superhuman
  assert.equal(timingCheck(ev(human.map((_, i) => 400 + (i % 2) * 10))).ok, false); // robotic, barely varies
  assert.equal(timingCheck(ev([200, 210])).ok, true);                              // too few answers to judge
});

test('nicknames are cleaned and checked', () => {
  assert.deepEqual(cleanNickname('  Quick   Thumbs '), { ok: true, value: 'Quick Thumbs' });
  assert.equal(cleanNickname('Mi​a').value, 'Mia');          // invisible character removed
  assert.equal(cleanNickname('Ｍｉａ').value, 'Mia');               // full-width letters folded
  assert.equal(cleanNickname('Tāne').ok, true);                   // other languages welcome
  assert.equal(cleanNickname('a').ok, false);
  assert.equal(cleanNickname('<script>').ok, false);
  assert.equal(cleanNickname('Admin').ok, false);
  assert.equal(cleanNickname('x'.repeat(21)).ok, false);
});

test('offensive nicknames are blocked without catching ordinary names', () => {
  for (const bad of ['fuck', 'F.u.c.k', 'sh1t head', 'B1TCH', 'big ass', 'kkk', 'FUUUCK']) assert.equal(isOffensive(bad), true, bad);
  for (const ok of ['Cassidy', 'Scunthorpe', 'Hemi', 'Classic Lass', 'Dickens fan', 'Tāne', 'Essex', 'The Therapist']) assert.equal(isOffensive(ok), false, ok);
  assert.equal(cleanNickname('sh1thead').ok, false);
  assert.equal(cleanNickname('Cassidy').ok, true);
});

test('streak freezes cover a missed day after 7 in a row', () => {
  const run = (start, n) => Array.from({ length: n }, (_, i) => addDays(start, i));
  const week = run('2026-12-01', 7);                       // 1st to 7th: earns one freeze
  assert.deepEqual(streakInfo(week, '2026-12-07'), { streak: 7, freezes: 1, usedOn: [], alive: true });
  const withGap = [...week, '2026-12-09'];                 // missed the 8th
  const s = streakInfo(withGap, '2026-12-09');
  assert.equal(s.streak, 8); assert.equal(s.freezes, 0); assert.deepEqual(s.usedOn, ['2026-12-08']);
  assert.equal(streakInfo([...run('2026-12-01', 3), '2026-12-05'], '2026-12-05').streak, 1);   // no freeze yet: resets
  assert.equal(streakInfo(week, '2026-12-08').alive, true);   // yesterday counts
  assert.equal(streakInfo(week, '2026-12-09').alive, true);   // freeze keeps it alive
  assert.equal(streakInfo(week, '2026-12-10').alive, false);  // two missed days, one freeze
});

test('levels and badges', () => {
  assert.equal(levelInfo(0).level, 1);
  assert.equal(levelInfo(3000).level, 2);
  assert.ok(levelInfo(100000).level > levelInfo(50000).level);
  const games = [{ mode: 'classic', rounds: 15, hard: false, correct: 15, avgMs: 480 }, { mode: 'daily', day: '2026-12-01', rounds: 20, correct: 18, avgMs: 600 }];
  const earned = badgeState(games, '2026-12-01').filter(b => b.earned).map(b => b.id);
  assert.deepEqual(earned.sort(), ['first', 'perfect', 'speed'].sort());
});

test('challenge codes and Daily numbers', () => {
  assert.equal(challengeCode('abc234', 20, true), 'abc234-20-h');
  assert.deepEqual(parseCode('abc234-20-h'), { code: 'abc234-20-h', seed: 'abc234', rounds: 20, hard: true });
  assert.equal(parseCode('abc234-21'), null);
  assert.equal(parseCode('<script>'), null);
  assert.equal(dayNumber('2026-11-26'), 1);
  assert.equal(dayNumber(addDays('2026-11-26', 40)), 41);
});

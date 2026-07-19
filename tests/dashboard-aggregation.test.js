'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { combinedDayLoad, weekLoad, sessionsOnDate, reorderSessionExercises } = require('../core.js');

// Minimal parsed-row factory matching parseWorkoutCSV's shape (load = weight*reps).
function row(date, day, exercise, setNumber, weight, reps, sessionId) {
  return {
    date, workoutDay: day, exercise, setNumber: String(setNumber),
    weight, reps, load: weight * reps,
    exerciseLoad: 0, totalWorkoutLoad: 0, sessionId
  };
}

const DATE = '2026-07-15';
const S1 = DATE + '-090000';   // Back, morning
const S2 = DATE + '-173000';   // Chest, evening
// Back:  800 + 600 + 1080 = 2480 ; Chest: 925 + 925 = 1850 ; day = 4330
const rows = [
  row(DATE, 'Back',  'Pull-up', 1, 100, 8, S1),
  row(DATE, 'Back',  'Pull-up', 2, 100, 6, S1),
  row(DATE, 'Back',  'BB Row',  1, 135, 8, S1),
  row(DATE, 'Chest', 'Bench',   1, 185, 5, S2),
  row(DATE, 'Chest', 'Bench',   2, 185, 5, S2),
];

test('combinedDayLoad sums raw set loads across both sessions', () => {
  assert.equal(combinedDayLoad(rows, DATE), 4330);
});

test('sessionsOnDate yields two ordered sub-groups', () => {
  const sessions = sessionsOnDate(rows, DATE);
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].sessionId, S1);
  assert.equal(sessions[0].workoutDay, 'Back');
  assert.equal(sessions[1].sessionId, S2);
  assert.equal(sessions[1].workoutDay, 'Chest');
});

test('per-session subtotal sums r.load within each session', () => {
  const sessions = sessionsOnDate(rows, DATE);
  const sub = s => s.rows.reduce((a, r) => a + r.load, 0);
  assert.equal(sub(sessions[0]), 2480);
  assert.equal(sub(sessions[1]), 1850);
});

test('de-duplicated multi-type header derives ["Back","Chest"]', () => {
  const sessions = sessionsOnDate(rows, DATE);
  const types = [];
  for (const s of sessions) if (types.indexOf(s.workoutDay) === -1) types.push(s.workoutDay);
  assert.deepEqual(types, ['Back', 'Chest']);
});

test('reorderSessionExercises reorders only the target session', () => {
  const out = reorderSessionExercises(rows, S1, ['BB Row', 'Pull-up']);
  const s1ex = [...new Set(out.filter(r => r.sessionId === S1).map(r => r.exercise))];
  assert.deepEqual(s1ex, ['BB Row', 'Pull-up']);           // S1 reordered
  const s2 = out.filter(r => r.sessionId === S2);
  assert.deepEqual(s2.map(r => r.setNumber), ['1', '2']);  // S2 untouched
  assert.equal(combinedDayLoad(out, DATE), 4330);          // totals invariant to order
});

/* ─── weekLoad (Task 4.2b: fixes calcWeekLoad's multi-session-day undercount) ─── */

// Row factory with a realistic totalWorkoutLoad: duplicated on every row of the
// session (as the real parsed CSV shape does), unlike the zeroed-out `row()` helper
// above — needed so the "legacy buggy dedup" comparison below is meaningful.
function wrow(date, day, exercise, setNumber, weight, reps, sessionId, totalWorkoutLoad) {
  return {
    date, workoutDay: day, exercise, setNumber: String(setNumber),
    weight, reps, load: weight * reps,
    exerciseLoad: 0, totalWorkoutLoad, sessionId
  };
}

const WD1 = '2026-07-15';          // Wed — two sessions this day (the undercount case)
const WD2 = '2026-07-16';          // Thu — one session
const WD_BOUND = '2026-07-18';     // Sat — end-of-range boundary day, one session
const WD_OUT = '2026-07-19';       // Sun — one week later, out of range

const WS1 = WD1 + '-090000';       // Back: 800 + 600 + 1080 = 2480
const WS2 = WD1 + '-173000';       // Chest: 925 + 925 = 1850  (day total 4330)
const WS3 = WD2 + '-080000';       // Legs: 1000
const WS5 = WD_BOUND + '-080000';  // Arms: 300
const WS4 = WD_OUT + '-080000';    // Arms: 500

const weekRows = [
  wrow(WD1, 'Back',  'Pull-up', 1, 100, 8, WS1, 2480),
  wrow(WD1, 'Back',  'Pull-up', 2, 100, 6, WS1, 2480),
  wrow(WD1, 'Back',  'BB Row',  1, 135, 8, WS1, 2480),
  wrow(WD1, 'Chest', 'Bench',   1, 185, 5, WS2, 1850),
  wrow(WD1, 'Chest', 'Bench',   2, 185, 5, WS2, 1850),
  wrow(WD2, 'Legs',  'Squat',   1, 200, 5, WS3, 1000),
  wrow(WD_BOUND, 'Arms', 'Curl', 1, 30, 10, WS5, 300),
  wrow(WD_OUT,   'Arms', 'Curl', 1, 50, 10, WS4, 500),
];

// The old calcWeekLoad algorithm: dedupe by date across the WHOLE array (not
// per-session), keep whichever row is hit first, add its totalWorkoutLoad.
function legacyBuggyWeekLoad(rows, start, end) {
  const seenDates = new Set();
  let total = 0;
  for (const row of rows) {
    if (row.date >= start && row.date <= end && !seenDates.has(row.date)) {
      seenDates.add(row.date);
      total += row.totalWorkoutLoad;
    }
  }
  return total;
}

test('weekLoad sums combinedDayLoad per unique date, not the per-session totalWorkoutLoad field', () => {
  const total = weekLoad(weekRows, '2026-07-12', '2026-07-18');
  // 07-15 (two sessions, 4330) + 07-16 (1000) + 07-18 (300) = 5630
  assert.equal(total, 5630);
  assert.equal(
    total,
    combinedDayLoad(weekRows, WD1) + combinedDayLoad(weekRows, WD2) + combinedDayLoad(weekRows, WD_BOUND)
  );
});

test('weekLoad strictly exceeds the old buggy first-row-wins totalWorkoutLoad dedup for a multi-session week', () => {
  const fixed = weekLoad(weekRows, '2026-07-12', '2026-07-18');
  const buggy = legacyBuggyWeekLoad(weekRows, '2026-07-12', '2026-07-18');
  assert.equal(buggy, 3780); // 2480 (misses WS2's 1850) + 1000 + 300
  assert.equal(fixed, 5630);
  assert.ok(fixed > buggy, `fixed weekLoad (${fixed}) should exceed buggy dedup total (${buggy})`);
});

test('weekLoad is correct for a single-session week (no regression on the non-buggy case)', () => {
  assert.equal(weekLoad(weekRows, WD2, WD2), 1000);
});

test('weekLoad range boundaries are inclusive on both ends', () => {
  assert.equal(weekLoad(weekRows, WD1, WD1), 4330);                 // single-day range, start===end
  assert.equal(weekLoad(weekRows, '2026-07-12', '2026-07-17'), 5330); // excludes boundary day 07-18
  assert.equal(weekLoad(weekRows, '2026-07-12', '2026-07-18'), 5630); // includes boundary day 07-18
});

test('weekLoad excludes dates outside the given range', () => {
  const withinWeek = weekLoad(weekRows, '2026-07-12', '2026-07-18');
  const includingNextWeek = weekLoad(weekRows, '2026-07-12', WD_OUT);
  assert.equal(includingNextWeek, withinWeek + 500); // WD_OUT's 500 only counted when in range
});

test('weekLoad returns 0 for an empty rows array', () => {
  assert.equal(weekLoad([], '2026-07-12', '2026-07-18'), 0);
});

test('weekLoad returns 0 when no row falls inside the range', () => {
  assert.equal(weekLoad(weekRows, '2099-01-01', '2099-01-07'), 0);
});

test('weekLoad does not mutate its input rows', () => {
  const snapshot = JSON.parse(JSON.stringify(weekRows));
  weekLoad(weekRows, '2026-07-12', '2026-07-18');
  assert.deepEqual(weekRows, snapshot);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { combinedDayLoad, sessionsOnDate, reorderSessionExercises } = require('../core.js');

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

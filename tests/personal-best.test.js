'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../core.js');

/* Minimal row factory matching parseWorkoutCSV's output shape. Only the
   fields the lookups read are populated. */
function row(date, sessionId, exercise, setNumber, weight, reps) {
  return {
    date: date,
    workoutDay: 'Push',
    exercise: exercise,
    setNumber: String(setNumber),
    weight: weight,
    reps: reps,
    sessionId: sessionId
  };
}

/* ── lastSessionSets: AC-7, AC-8, AC-9 ───────────────────────────── */

test('lastSessionSets returns the most recent earlier session for that exercise', () => {
  const rows = [
    row('2026-07-10', '2026-07-10-100000', 'BB Bench', 1, 185, 5),
    row('2026-07-10', '2026-07-10-100000', 'BB Bench', 2, 185, 5),
    row('2026-07-20', '2026-07-20-100000', 'BB Bench', 1, 205, 5),
    row('2026-07-20', '2026-07-20-100000', 'BB Bench', 2, 205, 4)
  ];
  const sets = core.lastSessionSets(rows, 'BB Bench', '2026-07-25-080000', '2026-07-25');
  assert.deepEqual(
    sets.map(s => [s.setNumber, s.weight, s.reps]),
    [['1', 205, 5], ['2', 205, 4]]
  );
});

test('lastSessionSets ignores the workout day the exercise was logged under', () => {
  const rows = [
    row('2026-07-20', '2026-07-20-100000', 'BB Bench', 1, 205, 5)
  ];
  rows[0].workoutDay = 'Upper';
  const sets = core.lastSessionSets(rows, 'BB Bench', '2026-07-25-080000', '2026-07-25');
  assert.equal(sets.length, 1);
  assert.equal(sets[0].weight, 205);
});

test('lastSessionSets reads the earlier session when a day is logged twice', () => {
  const rows = [
    row('2026-07-25', '2026-07-25-070000', 'BB Bench', 1, 185, 5),
    row('2026-07-25', '2026-07-25-190000', 'BB Bench', 1, 195, 5)
  ];
  const sets = core.lastSessionSets(rows, 'BB Bench', '2026-07-25-190000', '2026-07-25');
  assert.equal(sets.length, 1);
  assert.equal(sets[0].weight, 185);
});

test('lastSessionSets returns empty when the exercise has no earlier session', () => {
  const rows = [row('2026-07-20', '2026-07-20-100000', 'BB Bench', 1, 205, 5)];
  assert.deepEqual(core.lastSessionSets(rows, 'DB Fly', '2026-07-25-080000', '2026-07-25'), []);
  assert.deepEqual(core.lastSessionSets([], 'BB Bench', '2026-07-25-080000', '2026-07-25'), []);
});

test('lastSessionSets excludes the session being logged', () => {
  const rows = [
    row('2026-07-25', '2026-07-25-080000', 'BB Bench', 1, 225, 5)
  ];
  assert.deepEqual(core.lastSessionSets(rows, 'BB Bench', '2026-07-25-080000', '2026-07-25'), []);
});

test('lastSessionSets keeps superset A/B labels in set-number order', () => {
  const rows = [
    row('2026-07-20', '2026-07-20-100000', 'Superset: Curl / Pushdown', '2A', 40, 10),
    row('2026-07-20', '2026-07-20-100000', 'Superset: Curl / Pushdown', '1A', 35, 12),
    row('2026-07-20', '2026-07-20-100000', 'Superset: Curl / Pushdown', '1B', 50, 12),
    row('2026-07-20', '2026-07-20-100000', 'Superset: Curl / Pushdown', '2B', 55, 10)
  ];
  const sets = core.lastSessionSets(rows, 'Superset: Curl / Pushdown', '2026-07-25-080000', '2026-07-25');
  assert.deepEqual(sets.map(s => s.setNumber), ['1A', '1B', '2A', '2B']);
});

/* ── markPersonalBests: AC-1 through AC-5, AC-9 ──────────────────── */

test('markPersonalBests badges a weight above the pre-session best at that rep count', () => {
  const rows = [row('2026-07-20', '2026-07-20-100000', 'BB Bench', 1, 225, 5)];
  const flags = core.markPersonalBests(
    rows, 'BB Bench', [{ setNumber: '1', weight: 230, reps: 5 }],
    '2026-07-25-080000', '2026-07-25'
  );
  assert.deepEqual(flags, [true]);
});

test('markPersonalBests withholds the badge when the weight only equals the best', () => {
  const rows = [row('2026-07-20', '2026-07-20-100000', 'BB Bench', 1, 225, 5)];
  const flags = core.markPersonalBests(
    rows, 'BB Bench', [{ setNumber: '1', weight: 225, reps: 5 }],
    '2026-07-25-080000', '2026-07-25'
  );
  assert.deepEqual(flags, [false]);
});

test('markPersonalBests badges the first set ever logged at a rep count', () => {
  const rows = [row('2026-07-20', '2026-07-20-100000', 'BB Bench', 1, 225, 5)];
  const flags = core.markPersonalBests(
    rows, 'BB Bench', [{ setNumber: '1', weight: 135, reps: 12 }],
    '2026-07-25-080000', '2026-07-25'
  );
  assert.deepEqual(flags, [true]);
});

test('markPersonalBests compares only against sessions earlier than this one', () => {
  const rows = [
    row('2026-07-20', '2026-07-20-100000', 'BB Bench', 1, 225, 5),
    // A row already committed for the session being logged must not raise the bar.
    row('2026-07-25', '2026-07-25-080000', 'BB Bench', 1, 275, 5)
  ];
  const flags = core.markPersonalBests(
    rows, 'BB Bench', [{ setNumber: '1', weight: 230, reps: 5 }],
    '2026-07-25-080000', '2026-07-25'
  );
  assert.deepEqual(flags, [true]);
});

test('markPersonalBests badges only the earlier of two equal sets in one session', () => {
  const rows = [row('2026-07-20', '2026-07-20-100000', 'BB Bench', 1, 225, 5)];
  const flags = core.markPersonalBests(
    rows, 'BB Bench',
    [{ setNumber: '1', weight: 230, reps: 5 }, { setNumber: '2', weight: 230, reps: 5 }],
    '2026-07-25-080000', '2026-07-25'
  );
  assert.deepEqual(flags, [true, false]);
});

test('markPersonalBests badges a later set that beats an earlier one in the same session', () => {
  const rows = [row('2026-07-20', '2026-07-20-100000', 'BB Bench', 1, 225, 5)];
  const flags = core.markPersonalBests(
    rows, 'BB Bench',
    [{ setNumber: '1', weight: 230, reps: 5 }, { setNumber: '2', weight: 235, reps: 5 }],
    '2026-07-25-080000', '2026-07-25'
  );
  assert.deepEqual(flags, [true, true]);
});

test('markPersonalBests treats each rep count as its own record', () => {
  const rows = [row('2026-07-20', '2026-07-20-100000', 'BB Bench', 1, 225, 5)];
  const flags = core.markPersonalBests(
    rows, 'BB Bench',
    [{ setNumber: '1', weight: 200, reps: 5 }, { setNumber: '2', weight: 200, reps: 8 }],
    '2026-07-25-080000', '2026-07-25'
  );
  assert.deepEqual(flags, [false, true]);
});

test('markPersonalBests withholds the badge from sets missing a weight or reps', () => {
  const flags = core.markPersonalBests(
    [], 'BB Bench',
    [
      { setNumber: '1', weight: NaN, reps: 5 },
      { setNumber: '2', weight: 225, reps: NaN },
      { setNumber: '3', weight: 0, reps: 5 },
      { setNumber: '4', weight: 225, reps: 0 }
    ],
    '2026-07-25-080000', '2026-07-25'
  );
  assert.deepEqual(flags, [false, false, false, false]);
});

test('markPersonalBests scores superset A and B against their own slot', () => {
  const rows = [
    row('2026-07-20', '2026-07-20-100000', 'Superset: Curl / Pushdown', '1A', 35, 12),
    row('2026-07-20', '2026-07-20-100000', 'Superset: Curl / Pushdown', '1B', 60, 12)
  ];
  const flags = core.markPersonalBests(
    rows, 'Superset: Curl / Pushdown',
    [
      { setNumber: '1A', weight: 40, reps: 12 }, // beats the 35 in slot A
      { setNumber: '1B', weight: 55, reps: 12 }  // below the 60 in slot B
    ],
    '2026-07-25-080000', '2026-07-25'
  );
  assert.deepEqual(flags, [true, false]);
});

test('markPersonalBests does not let slot A history set the bar for slot B', () => {
  const rows = [
    row('2026-07-20', '2026-07-20-100000', 'Superset: Curl / Pushdown', '1A', 95, 12)
  ];
  const flags = core.markPersonalBests(
    rows, 'Superset: Curl / Pushdown',
    [{ setNumber: '1B', weight: 50, reps: 12 }],
    '2026-07-25-080000', '2026-07-25'
  );
  assert.deepEqual(flags, [true]); // first ever record in slot B
});

test('markPersonalBests ignores other exercises entirely', () => {
  const rows = [row('2026-07-20', '2026-07-20-100000', 'DB Bench', 1, 300, 5)];
  const flags = core.markPersonalBests(
    rows, 'BB Bench', [{ setNumber: '1', weight: 135, reps: 5 }],
    '2026-07-25-080000', '2026-07-25'
  );
  assert.deepEqual(flags, [true]);
});

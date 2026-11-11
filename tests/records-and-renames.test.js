'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../core.js');
// app.js calls core helpers as browser globals.
Object.assign(globalThis, core);
const app = require('../app.js');

function row(exercise, setNumber, weight, reps, date) {
  return { date: date || '2026-11-05', workoutDay: 'Shoulders', exercise, setNumber, weight, reps, sessionId: 's1' };
}

test('recordExerciseName files superset halves separately', () => {
  assert.equal(core.recordExerciseName('Superset: Curl / Pushdown', '2B'), 'Superset: Curl / Pushdown (B)');
  assert.equal(core.recordExerciseName('Superset: Curl / Pushdown', '1A'), 'Superset: Curl / Pushdown (A)');
  assert.equal(core.recordExerciseName('BB Row', '3'), 'BB Row');
});

test('computeAllTimeRecords keeps a superset B best that a heavier A used to hide', () => {
  const recs = app.computeAllTimeRecords([
    row('Lateral Raise SuperSet', '1A', 22, 7),
    row('Lateral Raise SuperSet', '1B', 17, 7)
  ]);
  const byName = Object.fromEntries(recs.map(r => [r.exercise, r.weight]));
  assert.deepEqual(byName, { 'Lateral Raise SuperSet (A)': 22, 'Lateral Raise SuperSet (B)': 17 });
});

test('computeAllTimeRecords drops a corrected typo because it reads history, not old records', () => {
  // History after the typo 2555 was fixed back to 255: only 255 remains.
  const recs = app.computeAllTimeRecords([row('BB Row', '1', 255, 5)]);
  assert.deepEqual(recs.map(r => r.weight), [255]);
});

test('renameExercisesInRows renames only the matching exercise', () => {
  const out = core.renameExercisesInRows(
    [row('BB Row', '1', 135, 5), row('Squat', '1', 225, 5)],
    [{ oldName: 'BB Row', newName: 'Barbell Row' }]
  );
  assert.deepEqual(out.map(r => r.exercise), ['Barbell Row', 'Squat']);
});

test('renameExercisesInRows does not chain renames in one pass', () => {
  const out = core.renameExercisesInRows(
    [row('A', '1', 1, 1), row('B', '1', 1, 1)],
    [{ oldName: 'A', newName: 'B' }, { oldName: 'B', newName: 'C' }]
  );
  assert.deepEqual(out.map(r => r.exercise), ['B', 'C']);
});

test('addExerciseRename collapses chains and cancels a rename back', () => {
  let r = core.addExerciseRename([], 'BB Row', 'Barbell Row');
  r = core.addExerciseRename(r, 'Barbell Row', 'Pendlay Row');
  assert.deepEqual(r, [{ oldName: 'BB Row', newName: 'Pendlay Row' }]);
  r = core.addExerciseRename(r, 'Pendlay Row', 'BB Row');
  assert.deepEqual(r, []);
  assert.deepEqual(core.addExerciseRename([], 'X', 'X'), []);
});

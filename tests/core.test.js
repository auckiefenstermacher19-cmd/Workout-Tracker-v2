'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../core.js');

test('calcLoad multiplies weight by reps with numeric coercion', () => {
  assert.equal(core.calcLoad(255, 5), 1275);
  assert.equal(core.calcLoad('140', '12'), 1680);
  assert.equal(core.calcLoad(0, 5), 0);
  assert.equal(core.calcLoad(100, 0), 0);
  assert.equal(core.calcLoad('', ''), 0);
});

test('calcExerciseLoad sums load across sets or rows', () => {
  const sets = [{ weight: 45, reps: 8 }, { weight: 45, reps: 8 }, { weight: 45, reps: 8 }];
  assert.equal(core.calcExerciseLoad(sets), 1080);
  assert.equal(core.calcExerciseLoad([]), 0);
});

test('calcWorkoutLoad accepts a flat rows array', () => {
  const rows = [{ weight: 255, reps: 5 }, { weight: 45, reps: 8 }];
  assert.equal(core.calcWorkoutLoad(rows), 1275 + 360);
});

test('calcWorkoutLoad accepts a Map(name -> sets) (live logger form)', () => {
  const m = new Map();
  m.set('BB Squat', [{ weight: 225, reps: 5 }, { weight: 225, reps: 5 }]);
  m.set('Leg Press', [{ weight: 400, reps: 10 }]);
  assert.equal(core.calcWorkoutLoad(m), 2250 + 4000);
});

test('makeSessionId formats YYYY-MM-DD-HHMMSS from local time', () => {
  const d = new Date(2026, 6, 18, 10, 15, 3); // 2026-07-18 10:15:03 local
  assert.equal(core.makeSessionId(d, []), '2026-07-18-101503');
});

test('makeSessionId appends -2/-3 on same-second collision', () => {
  const d = new Date(2026, 6, 18, 10, 15, 3);
  assert.equal(core.makeSessionId(d, ['2026-07-18-101503']), '2026-07-18-101503-2');
  assert.equal(core.makeSessionId(d, ['2026-07-18-101503', '2026-07-18-101503-2']), '2026-07-18-101503-3');
});

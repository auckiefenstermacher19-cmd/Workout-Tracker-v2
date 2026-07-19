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

test('CSV_HEADER includes the Session Id column last', () => {
  assert.equal(core.CSV_HEADER,
    'Date,Workout Day,Exercise,Set Number,Weight,Reps,Load,Exercise Load,Total Workout Load,Session Id');
});

test('splitCSVLine is quote-aware: a quoted field containing a comma round-trips correctly', () => {
  assert.deepEqual(
    core.splitCSVLine('2026-07-18,Legs,"Squat, Paused",1,225'),
    ['2026-07-18', 'Legs', 'Squat, Paused', '1', '225']
  );
});

test('parseWorkoutCSV parses real legacy 9-col rows and synthesizes session id', () => {
  const text =
    'Date,Workout Day,Exercise,Set Number,Weight,Reps,Load,Exercise Load,Total Workout Load\n' +
    '2026-04-22,Back,BB Row,1,255,5,1275,5100,19550\n' +
    '2026-07-17,Chest,Machine Cheat Press,4,150,8,1200,5120,5120\n';
  const rows = core.parseWorkoutCSV(text);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    date: '2026-04-22', workoutDay: 'Back', exercise: 'BB Row', setNumber: '1',
    weight: 255, reps: 5, load: 1275, exerciseLoad: 5100, totalWorkoutLoad: 19550,
    sessionId: '2026-04-22|Back'
  });
  assert.equal(rows[1].sessionId, '2026-07-17|Chest');
});

test('parseWorkoutCSV uses an explicit Session Id when present (10-col)', () => {
  const text = core.CSV_HEADER + '\n' +
    '2026-07-18,Chest,Flat Bench,1,225,5,1125,1125,1125,2026-07-18-101503\n';
  assert.equal(core.parseWorkoutCSV(text)[0].sessionId, '2026-07-18-101503');
});

test('parseWorkoutCSV falls back when the Session Id column is empty', () => {
  const text = core.CSV_HEADER + '\n' +
    '2026-07-18,Chest,Flat Bench,1,225,5,1125,1125,1125,\n';
  assert.equal(core.parseWorkoutCSV(text)[0].sessionId, '2026-07-18|Chest');
});

test('parseWorkoutCSV is quote-aware for fields containing commas', () => {
  const text = core.CSV_HEADER + '\n' +
    '2026-07-18,Legs,"Squat, Paused",1,225,5,1125,1125,1125,2026-07-18-090000\n';
  const rows = core.parseWorkoutCSV(text);
  assert.equal(rows[0].exercise, 'Squat, Paused');
  assert.equal(rows[0].sessionId, '2026-07-18-090000');
});

test('parseWorkoutCSV drops rows with <9 columns or empty set number', () => {
  const text = core.CSV_HEADER + '\n' +
    '2026-07-18,Chest,Flat Bench,,225,5,1125,1125,1125,sid\n' +
    'garbage,row\n';
  assert.equal(core.parseWorkoutCSV(text).length, 0);
});

test('parseWorkoutCSV returns [] for empty input', () => {
  assert.deepEqual(core.parseWorkoutCSV(''), []);
  assert.deepEqual(core.parseWorkoutCSV('   '), []);
});

test('serializeWorkoutCSV emits the v2 header and Session Id as column 10', () => {
  const rows = [{
    date: '2026-07-18', workoutDay: 'Chest', exercise: 'Flat Bench', setNumber: '1',
    weight: 225, reps: 5, load: 1125, exerciseLoad: 1125, totalWorkoutLoad: 1125,
    sessionId: '2026-07-18-101503'
  }];
  assert.equal(core.serializeWorkoutCSV(rows),
    core.CSV_HEADER + '\n' +
    '2026-07-18,Chest,Flat Bench,1,225,5,1125,1125,1125,2026-07-18-101503\n');
});

test('parse -> serialize -> parse round-trips legacy rows stably', () => {
  const legacy =
    'Date,Workout Day,Exercise,Set Number,Weight,Reps,Load,Exercise Load,Total Workout Load\n' +
    '2026-04-22,Back,BB Row,1,255,5,1275,5100,19550\n' +
    '2026-04-22,Back,BB Row,2,255,5,1275,5100,19550\n';
  const once = core.parseWorkoutCSV(legacy);
  const twice = core.parseWorkoutCSV(core.serializeWorkoutCSV(once));
  assert.deepEqual(twice, once);
  assert.equal(once[0].sessionId, '2026-04-22|Back');
});

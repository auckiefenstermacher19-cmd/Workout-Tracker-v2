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

function twoSessionDay() {
  return [
    { date: '2026-05-01', workoutDay: 'Back',  exercise: 'BB Row',     setNumber: '1', weight: 200, reps: 5,  load: 1000, exerciseLoad: 1000, totalWorkoutLoad: 1000, sessionId: '2026-05-01-080000' },
    { date: '2026-05-01', workoutDay: 'Chest', exercise: 'Flat Bench', setNumber: '1', weight: 100, reps: 10, load: 1000, exerciseLoad: 1000, totalWorkoutLoad: 1800, sessionId: '2026-05-01-173000' },
    { date: '2026-05-01', workoutDay: 'Chest', exercise: 'Incline',    setNumber: '1', weight: 80,  reps: 10, load: 800,  exerciseLoad: 800,  totalWorkoutLoad: 1800, sessionId: '2026-05-01-173000' },
    { date: '2026-05-02', workoutDay: 'Legs',  exercise: 'Squat',      setNumber: '1', weight: 300, reps: 5,  load: 1500, exerciseLoad: 1500, totalWorkoutLoad: 1500, sessionId: '2026-05-02-090000' }
  ];
}

test('combinedDayLoad sums per-set load across every session that date', () => {
  const rows = twoSessionDay();
  assert.equal(core.combinedDayLoad(rows, '2026-05-01'), 2800); // 1000 + 1000 + 800, NOT duplicated totalWorkoutLoad
  assert.equal(core.combinedDayLoad(rows, '2026-05-02'), 1500);
  assert.equal(core.combinedDayLoad(rows, '2026-01-01'), 0);
});

test('sessionsOnDate groups by Session Id preserving row order', () => {
  const groups = core.sessionsOnDate(twoSessionDay(), '2026-05-01');
  assert.equal(groups.length, 2);
  assert.equal(groups[0].sessionId, '2026-05-01-080000');
  assert.equal(groups[0].workoutDay, 'Back');
  assert.equal(groups[0].rows.length, 1);
  assert.equal(groups[1].sessionId, '2026-05-01-173000');
  assert.equal(groups[1].workoutDay, 'Chest');
  assert.equal(groups[1].rows.length, 2);
});

test('rebuildSessionRows recomputes loads and stamps the session id in map order', () => {
  const map = new Map();
  map.set('Flat Bench', [{ weight: 100, reps: 10 }, { weight: 100, reps: 8 }]);
  map.set('Incline',    [{ weight: 80, reps: 10 }]);
  const rows = core.rebuildSessionRows('2026-05-01-173000', '2026-05-01', 'Chest', map);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].exercise, 'Flat Bench');
  assert.equal(rows[0].setNumber, '1');
  assert.equal(rows[0].load, 1000);
  assert.equal(rows[0].exerciseLoad, 1000 + 800); // 100x10 + 100x8 = 1800
  assert.equal(rows[0].totalWorkoutLoad, 1800 + 800); // + incline 80x10 = 2600
  assert.equal(rows[2].exercise, 'Incline');
  rows.forEach(function (r) { assert.equal(r.sessionId, '2026-05-01-173000'); });
});

test('rebuildSessionRows preserves superset set labels', () => {
  const map = new Map();
  map.set('Lateral Raise SS', [{ weight: 20, reps: 12, setLabel: '1A' }, { weight: 20, reps: 12, setLabel: '1B' }]);
  const rows = core.rebuildSessionRows('sid', '2026-05-03', 'Shoulders', map);
  assert.equal(rows[0].setNumber, '1A');
  assert.equal(rows[1].setNumber, '1B');
});

test('commitReplaceSession replaces only the target session, never others', () => {
  const all = twoSessionDay();
  const newChest = [
    { date: '2026-05-01', workoutDay: 'Chest', exercise: 'Flat Bench', setNumber: '1', weight: 110, reps: 10, load: 1100, exerciseLoad: 1100, totalWorkoutLoad: 1100, sessionId: '2026-05-01-173000' }
  ];
  const merged = core.commitReplaceSession(all, '2026-05-01-173000', newChest);
  assert.equal(merged.filter(function (r) { return r.sessionId === '2026-05-01-080000'; }).length, 1);
  assert.equal(merged.filter(function (r) { return r.sessionId === '2026-05-02-090000'; }).length, 1);
  const chest = merged.filter(function (r) { return r.sessionId === '2026-05-01-173000'; });
  assert.equal(chest.length, 1);
  assert.equal(chest[0].weight, 110);
});

test('renameDayInRows rewrites only matching workoutDay values (new array, input unmutated)', () => {
  const rows = twoSessionDay();
  const out = core.renameDayInRows(rows, 'Chest', 'Push');
  assert.equal(out.filter(function (r) { return r.workoutDay === 'Push'; }).length, 2);
  assert.equal(out.filter(function (r) { return r.workoutDay === 'Chest'; }).length, 0);
  assert.equal(out.filter(function (r) { return r.workoutDay === 'Back'; }).length, 1);
  assert.notEqual(out, rows);
  assert.equal(rows[1].workoutDay, 'Chest');
});

test('reorderSessionExercises reorders one session; others untouched', () => {
  const rows = twoSessionDay();
  const out = core.reorderSessionExercises(rows, '2026-05-01-173000', ['Incline', 'Flat Bench']);
  const chest = out.filter(function (r) { return r.sessionId === '2026-05-01-173000'; });
  assert.deepEqual(chest.map(function (r) { return r.exercise; }), ['Incline', 'Flat Bench']);
  assert.equal(out[0].sessionId, '2026-05-01-080000');
  assert.equal(out[out.length - 1].sessionId, '2026-05-02-090000');
});

test('reorderSessionExercises keeps unlisted exercises in original relative order at the end', () => {
  const base = { date: 'd', workoutDay: 'X', setNumber: '1', weight: 1, reps: 1, load: 1, exerciseLoad: 1, totalWorkoutLoad: 3, sessionId: 's' };
  const rows = [
    Object.assign({}, base, { exercise: 'A' }),
    Object.assign({}, base, { exercise: 'B' }),
    Object.assign({}, base, { exercise: 'C' })
  ];
  const out = core.reorderSessionExercises(rows, 's', ['C']);
  assert.deepEqual(out.map(function (r) { return r.exercise; }), ['C', 'A', 'B']);
});

/* ─── Exercises v2 model ─── */
const V1_FIXTURE = {
  Legs: [{ name: 'BB Squat', defaultSets: 4 }, { name: 'Leg Press', defaultSets: 3 }],
  Chest: [{ name: 'Flat Bench', defaultSets: 4 }],
  'Cardio Blast': [{ name: 'Row', defaultSets: 2 }] // unknown day -> palette fallback + slug
};

test('slugifyDayId produces lowercase a-z0-9 slugs unique vs takenIds', () => {
  assert.equal(core.slugifyDayId('Legs', []), 'legs');
  assert.equal(core.slugifyDayId('Upper Body!', []), 'upper-body');
  assert.equal(core.slugifyDayId('Legs', ['legs']), 'legs-2');
  assert.equal(core.slugifyDayId('Legs', ['legs', 'legs-2']), 'legs-3');
  assert.equal(core.slugifyDayId('***', []), 'day');
});

test('adaptExercisesModel maps a v1 object to v2 with preset colors and order', () => {
  const model = core.adaptExercisesModel(V1_FIXTURE);
  assert.equal(model.version, 2);
  assert.deepEqual(model.days.map(function (d) { return d.id; }), ['legs', 'chest', 'cardio-blast']);
  assert.deepEqual(model.days.map(function (d) { return d.name; }), ['Legs', 'Chest', 'Cardio Blast']);
  assert.equal(model.days[0].color, '#c084fc'); // Legs preset
  assert.equal(model.days[1].color, '#fb923c'); // Chest preset
  assert.equal(model.days[2].color, '#38bdf8'); // unknown -> fallback palette by index 2
  assert.deepEqual(model.days[0].exercises,
    [{ name: 'BB Squat', defaultSets: 4 }, { name: 'Leg Press', defaultSets: 3 }]);
});

test('adaptExercisesModel is idempotent for an already-v2 object', () => {
  const v2 = core.adaptExercisesModel(V1_FIXTURE);
  assert.deepEqual(core.adaptExercisesModel(v2), v2);
});

test('serializeExercisesModel emits 2-space pretty JSON that re-adapts equal', () => {
  const model = core.adaptExercisesModel(V1_FIXTURE);
  const text = core.serializeExercisesModel(model);
  assert.ok(text.startsWith('{\n  "version": 2,'));
  assert.deepEqual(core.adaptExercisesModel(JSON.parse(text)), model);
});

test('modelToLegacyMap projects a v2 model back to the legacy {day:[...]} shape, preserving order', () => {
  const model = core.adaptExercisesModel(V1_FIXTURE);
  const legacy = core.modelToLegacyMap(model);
  assert.deepEqual(Object.keys(legacy), ['Legs', 'Chest', 'Cardio Blast']);
  assert.deepEqual(legacy.Legs, [{ name: 'BB Squat', defaultSets: 4 }, { name: 'Leg Press', defaultSets: 3 }]);
  assert.deepEqual(legacy.Chest, [{ name: 'Flat Bench', defaultSets: 4 }]);
  assert.deepEqual(legacy['Cardio Blast'], [{ name: 'Row', defaultSets: 2 }]);
});

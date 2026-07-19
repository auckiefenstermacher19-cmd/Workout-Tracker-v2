'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../core.js');

const parsed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'exercises.json'), 'utf8'));

test('committed exercises.json is v2 with 5 ordered days, correct ids and colors', () => {
  assert.equal(parsed.version, 2);
  assert.deepEqual(parsed.days.map(function (d) { return d.name; }), ['Legs', 'Chest', 'Back', 'Shoulders', 'Arms']);
  assert.deepEqual(parsed.days.map(function (d) { return d.id; }), ['legs', 'chest', 'back', 'shoulders', 'arms']);
  assert.deepEqual(parsed.days.map(function (d) { return d.color; }), ['#c084fc', '#fb923c', '#38bdf8', '#facc15', '#f472b6']);
});

test('committed exercises.json preserves original exercise order and counts', () => {
  const byName = {};
  parsed.days.forEach(function (d) { byName[d.name] = d.exercises; });
  assert.deepEqual(byName.Legs.map(function (e) { return e.name; }),
    ['BB Squat', 'Leg Press', 'Bulgarian Split Squat', 'Leg Extension', 'Front Squat']);
  assert.deepEqual(byName.Arms.map(function (e) { return e.name; }),
    ['BB Curl', 'Skull Crushers', 'Incline DB Curl', 'Tricep Pushdown', 'Hammer Curls', 'Overhead Cable Ext']);
  assert.equal(byName.Legs[0].defaultSets, 4);
  assert.equal(byName.Back[3].defaultSets, 2); // Lat Pull Downs
});

test('adaptExercisesModel round-trips the committed v2 file unchanged (idempotent)', () => {
  assert.deepEqual(core.adaptExercisesModel(parsed), parsed);
});

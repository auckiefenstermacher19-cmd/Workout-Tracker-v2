'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../core.js');

function baseModel() {
  return {
    version: 2,
    days: [
      { id: 'legs', name: 'Legs', color: '#c084fc', exercises: [
        { name: 'BB Squat', defaultSets: 4 },
        { name: 'Leg Press', defaultSets: 3 }
      ] },
      { id: 'chest', name: 'Chest', color: '#fb923c', exercises: [] }
    ]
  };
}

test('addExercise appends to the right day with a normalized set count', () => {
  const m = core.addExercise(baseModel(), 'legs', '  Lunge  ', '3');
  assert.equal(m.days[0].exercises.length, 3);
  assert.deepEqual(m.days[0].exercises[2], { name: 'Lunge', defaultSets: 3 });
});

test('addExercise dup guard is case-insensitive and scoped to one day', () => {
  assert.throws(() => core.addExercise(baseModel(), 'legs', 'bb squat', 3), /already exists/);
  const m = core.addExercise(baseModel(), 'chest', 'BB Squat', 3); // same name, other day is OK
  assert.equal(m.days[1].exercises[0].name, 'BB Squat');
});

test('addExercise rejects blank name, non-positive sets, unknown day; does not mutate input', () => {
  const input = baseModel();
  assert.throws(() => core.addExercise(input, 'legs', '  ', 3), /required/);
  assert.throws(() => core.addExercise(input, 'legs', 'X', 0), /positive/);
  assert.throws(() => core.addExercise(input, 'nope', 'X', 3), /Unknown day/);
  assert.equal(input.days[0].exercises.length, 2);
});

test('renameExercise renames in place and blocks duplicates / unknowns', () => {
  const m = core.renameExercise(baseModel(), 'legs', 'Leg Press', 'Hack Squat');
  assert.equal(m.days[0].exercises[1].name, 'Hack Squat');
  assert.throws(() => core.renameExercise(baseModel(), 'legs', 'Leg Press', 'bb squat'), /already exists/);
  assert.throws(() => core.renameExercise(baseModel(), 'legs', 'Ghost', 'X'), /Unknown exercise/);
});

test('removeExercise removes by exact name and preserves order', () => {
  const m = core.removeExercise(baseModel(), 'legs', 'BB Squat');
  assert.deepEqual(m.days[0].exercises.map(e => e.name), ['Leg Press']);
});

test('moveExercise reorders within the day and clamps at ends', () => {
  assert.deepEqual(core.moveExercise(baseModel(), 'legs', 'BB Squat', 1).days[0].exercises.map(e => e.name),
    ['Leg Press', 'BB Squat']);
  assert.deepEqual(core.moveExercise(baseModel(), 'legs', 'BB Squat', -1).days[0].exercises.map(e => e.name),
    ['BB Squat', 'Leg Press']);
});

test('setDefaultSets updates only the set count and validates', () => {
  assert.equal(core.setDefaultSets(baseModel(), 'legs', 'Leg Press', '5').days[0].exercises[1].defaultSets, 5);
  assert.throws(() => core.setDefaultSets(baseModel(), 'legs', 'Leg Press', 0), /positive/);
  assert.throws(() => core.setDefaultSets(baseModel(), 'legs', 'Ghost', 3), /Unknown exercise/);
});

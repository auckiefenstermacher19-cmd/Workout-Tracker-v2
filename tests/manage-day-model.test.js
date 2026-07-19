'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../core.js');

function baseModel() {
  return {
    version: 2,
    days: [
      { id: 'legs',  name: 'Legs',  color: '#c084fc', exercises: [{ name: 'BB Squat', defaultSets: 4 }] },
      { id: 'chest', name: 'Chest', color: '#fb923c', exercises: [] },
      { id: 'back',  name: 'Back',  color: '#38bdf8', exercises: [] }
    ]
  };
}

test('addDay appends a day with a unique slug id, chosen color, empty exercises', () => {
  const m = core.addDay(baseModel(), 'Core', '#4ade80');
  assert.equal(m.days.length, 4);
  assert.deepEqual(
    { name: m.days[3].name, id: m.days[3].id, color: m.days[3].color, exercises: m.days[3].exercises },
    { name: 'Core', id: 'core', color: '#4ade80', exercises: [] }
  );
});

test('addDay does not mutate the input model', () => {
  const input = baseModel();
  core.addDay(input, 'Core', '#4ade80');
  assert.equal(input.days.length, 3);
});

test('addDay assigns a #rrggbb palette color when none is given', () => {
  const m = core.addDay(baseModel(), 'Core');
  assert.match(m.days[3].color, /^#[0-9a-f]{6}$/i);
});

test('addDay trims the name and rejects blank or case-insensitive duplicate names', () => {
  assert.equal(core.addDay(baseModel(), '  Core  ', '#4ade80').days[3].name, 'Core');
  assert.throws(() => core.addDay(baseModel(), '   '), /required/);
  assert.throws(() => core.addDay(baseModel(), 'legs'), /already exists/);
});

test('addDay never reuses an existing id when the slug collides', () => {
  const seeded = baseModel();
  seeded.days.push({ id: 'core', name: 'Existing Core', color: '#ffffff', exercises: [] });
  const m = core.addDay(seeded, 'Core!'); // slugs to "core", which is taken
  assert.notEqual(m.days[m.days.length - 1].id, 'core');
});

test('renameDay changes only the name, keeps id and exercises', () => {
  const m = core.renameDay(baseModel(), 'legs', 'Quads');
  assert.equal(m.days[0].name, 'Quads');
  assert.equal(m.days[0].id, 'legs');
  assert.equal(m.days[0].exercises[0].name, 'BB Squat');
});

test('renameDay allows renaming to its own current name, rejects blank/dup/unknown', () => {
  assert.equal(core.renameDay(baseModel(), 'legs', 'Legs').days[0].name, 'Legs');
  assert.throws(() => core.renameDay(baseModel(), 'legs', '  '), /required/);
  assert.throws(() => core.renameDay(baseModel(), 'legs', 'chest'), /already exists/);
  assert.throws(() => core.renameDay(baseModel(), 'nope', 'X'), /Unknown day/);
});

test('removeDay drops the day, leaves others, throws on unknown, is pure', () => {
  const input = baseModel();
  const m = core.removeDay(input, 'chest');
  assert.deepEqual(m.days.map(d => d.id), ['legs', 'back']);
  assert.throws(() => core.removeDay(input, 'nope'), /Unknown day/);
  assert.equal(input.days.length, 3);
});

test('moveDay reorders up/down and clamps at the ends', () => {
  assert.deepEqual(core.moveDay(baseModel(), 'legs', 1).days.map(d => d.id), ['chest', 'legs', 'back']);
  assert.deepEqual(core.moveDay(baseModel(), 'back', -1).days.map(d => d.id), ['legs', 'back', 'chest']);
  assert.deepEqual(core.moveDay(baseModel(), 'legs', -1).days.map(d => d.id), ['legs', 'chest', 'back']);
  assert.deepEqual(core.moveDay(baseModel(), 'back', 1).days.map(d => d.id), ['legs', 'chest', 'back']);
});

test('setDayColor sets a valid hex and rejects a bad one', () => {
  assert.equal(core.setDayColor(baseModel(), 'legs', '#123abc').days[0].color, '#123abc');
  assert.throws(() => core.setDayColor(baseModel(), 'legs', 'red'), /hex/);
  assert.throws(() => core.setDayColor(baseModel(), 'nope', '#123abc'), /Unknown day/);
});

test('diffDayRenames reports id-matched name changes only', () => {
  const before = baseModel();
  let after = core.renameDay(before, 'legs', 'Quads');
  after = core.renameDay(after, 'back', 'Posterior');
  assert.deepEqual(core.diffDayRenames(before, after),
    [{ oldName: 'Legs', newName: 'Quads' }, { oldName: 'Back', newName: 'Posterior' }]);
});

test('diffDayRenames ignores added/removed days and unchanged names', () => {
  const before = baseModel();
  let after = core.addDay(before, 'Core', '#4ade80');
  after = core.removeDay(after, 'chest');
  assert.deepEqual(core.diffDayRenames(before, after), []);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../core.js');

const parsed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'exercises.json'), 'utf8'));

// exercises.json is live user data: the Manage screen rewrites it through the
// Worker whenever days or exercises change. These tests assert the SHAPE the
// app depends on, never specific names/counts/sets — snapshotting those values
// makes every legitimate Manage edit a CI failure.

test('committed exercises.json is a well-formed v2 model', () => {
  assert.equal(parsed.version, 2);
  assert.ok(Array.isArray(parsed.days) && parsed.days.length > 0, 'days must be a non-empty array');

  const ids = parsed.days.map(function (d) { return d.id; });
  assert.equal(new Set(ids).size, ids.length, 'day ids must be unique');

  parsed.days.forEach(function (d) {
    assert.ok(typeof d.id === 'string' && d.id.length > 0, 'day id must be a non-empty string');
    assert.ok(typeof d.name === 'string' && d.name.length > 0, 'day name must be a non-empty string');
    assert.match(d.color, /^#[0-9a-fA-F]{6}$/, 'day color must be a hex colour');
    assert.ok(Array.isArray(d.exercises), 'day exercises must be an array');
  });
});

test('every committed exercise has a name and a positive integer defaultSets', () => {
  parsed.days.forEach(function (d) {
    const names = d.exercises.map(function (e) { return e.name; });
    assert.equal(new Set(names).size, names.length, 'exercise names must be unique within ' + d.name);

    d.exercises.forEach(function (e) {
      assert.ok(typeof e.name === 'string' && e.name.length > 0, 'exercise name must be a non-empty string');
      assert.ok(Number.isInteger(e.defaultSets) && e.defaultSets > 0,
        e.name + ' defaultSets must be a positive integer');
    });
  });
});

test('adaptExercisesModel round-trips the committed v2 file unchanged (idempotent)', () => {
  assert.deepEqual(core.adaptExercisesModel(parsed), parsed);
});

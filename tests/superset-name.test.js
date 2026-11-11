'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../core.js');

test('makeSupersetName builds the canonical name the logger detects', () => {
  const name = core.makeSupersetName('  DB Curl ', 'Tricep Pushdown');
  assert.equal(name, 'Superset: DB Curl / Tricep Pushdown');
  // The logger switches to A/B mode on this substring check.
  assert.ok(name.toLowerCase().includes('superset'));
});

test('makeSupersetName rejects a missing, repeated or slashed exercise', () => {
  assert.throws(() => core.makeSupersetName('Curl', ''), /both exercises/);
  assert.throws(() => core.makeSupersetName('Curl', 'curl'), /two different/);
  assert.throws(() => core.makeSupersetName('Curl/Hammer', 'Pushdown'), /cannot contain/);
});

test('supersetParts reads both halves back, round-tripping makeSupersetName', () => {
  assert.deepEqual(core.supersetParts(core.makeSupersetName('Curl', 'Pushdown')), { a: 'Curl', b: 'Pushdown' });
  assert.deepEqual(core.supersetParts('superset:Fly/Dip'), { a: 'Fly', b: 'Dip' });
});

test('supersetParts returns null for names it cannot split', () => {
  assert.equal(core.supersetParts('BB Row'), null);
  assert.equal(core.supersetParts('Arms superset'), null);
  assert.equal(core.supersetParts(undefined), null);
});

test('a superset made by name can be added to a day through addExercise', () => {
  const model = { version: 2, days: [{ id: 'arms', name: 'Arms', color: '#f472b6', exercises: [] }] };
  const next = core.addExercise(model, 'arms', core.makeSupersetName('Curl', 'Pushdown'), 3);
  assert.deepEqual(next.days[0].exercises, [{ name: 'Superset: Curl / Pushdown', defaultSets: 3 }]);
});

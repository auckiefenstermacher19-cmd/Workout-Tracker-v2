'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { dedupeOrder, resumeRenderOrder } = require('../core.js');

test('dedupeOrder removes duplicates and falsy, preserves first-seen order', () => {
  assert.deepEqual(dedupeOrder(['A', 'B', 'A', 'C', 'B']), ['A', 'B', 'C']);
  assert.deepEqual(dedupeOrder(['A', '', null, undefined, 'B']), ['A', 'B']);
  assert.deepEqual(dedupeOrder([]), []);
  assert.deepEqual(dedupeOrder('nope'), []);
  assert.deepEqual(dedupeOrder(undefined), []);
});

test('resumeRenderOrder: no draft returns default order', () => {
  assert.deepEqual(
    resumeRenderOrder(['Squat', 'Lunge', 'Leg Press'], null),
    ['Squat', 'Lunge', 'Leg Press']
  );
});

test('resumeRenderOrder: explicit order is authoritative', () => {
  const draft = {
    day: 'Legs',
    order: ['Leg Press', 'Squat', 'Lunge'],
    exercises: { 'Squat': [], 'Lunge': [], 'Leg Press': [] }
  };
  assert.deepEqual(
    resumeRenderOrder(['Squat', 'Lunge', 'Leg Press'], draft),
    ['Leg Press', 'Squat', 'Lunge']
  );
});

test('resumeRenderOrder: rescues added-but-non-default exercise kept in saved order', () => {
  const draft = {
    day: 'Legs',
    order: ['Squat', 'Front Squat', 'Lunge'], // Front Squat is not a default
    exercises: { 'Squat': [], 'Front Squat': [], 'Lunge': [] }
  };
  assert.deepEqual(
    resumeRenderOrder(['Squat', 'Lunge', 'Leg Press'], draft),
    ['Squat', 'Front Squat', 'Lunge']
  );
});

test('resumeRenderOrder: default removed in session does not reappear', () => {
  const draft = {
    day: 'Legs',
    order: ['Squat', 'Lunge'],
    exercises: { 'Squat': [], 'Lunge': [] }
  };
  assert.deepEqual(
    resumeRenderOrder(['Squat', 'Lunge', 'Leg Press'], draft),
    ['Squat', 'Lunge']
  );
});

test('resumeRenderOrder: stale order entry without data dropped, orphan data appended', () => {
  const draft = {
    day: 'Legs',
    order: ['Squat', 'Ghost', 'Lunge'],           // Ghost has no exercises entry
    exercises: { 'Squat': [], 'Lunge': [], 'Leg Press': [] } // Leg Press absent from order
  };
  assert.deepEqual(
    resumeRenderOrder(['Squat', 'Lunge', 'Leg Press'], draft),
    ['Squat', 'Lunge', 'Leg Press']
  );
});

test('resumeRenderOrder: legacy draft without order uses default order then appends extras', () => {
  const draft = {
    day: 'Legs',
    exercises: { 'Lunge': [], 'Squat': [], 'Front Squat': [] } // no order key
  };
  assert.deepEqual(
    resumeRenderOrder(['Squat', 'Lunge', 'Leg Press'], draft),
    ['Squat', 'Lunge', 'Front Squat']
  );
});

test('resumeRenderOrder: empty/corrupt draft falls back to defaults', () => {
  assert.deepEqual(
    resumeRenderOrder(['Squat', 'Lunge'], { day: 'Legs', order: [], exercises: {} }),
    ['Squat', 'Lunge']
  );
  assert.deepEqual(
    resumeRenderOrder(['Squat', 'Lunge'], { day: 'Legs', order: ['X'], exercises: {} }),
    ['Squat', 'Lunge']
  );
});

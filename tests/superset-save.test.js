'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../core.js');

// app.js reads core.js helpers as browser globals; mirror that for Node.
Object.assign(globalThis, core);
const app = require('../app.js');

/* Minimal stand-ins for the few DOM calls these two functions make:
   querySelectorAll, querySelector, dataset and input .value. */
function input(cls, value) {
  return { cls: cls, value: String(value) };
}

function row(round, inputs) {
  return {
    dataset: { round: String(round) },
    querySelector: function (sel) {
      const want = sel.replace('.', '');
      return inputs.find(function (i) { return i.cls === want; }) || null;
    }
  };
}

function block(name, isSuperset, rows) {
  return {
    dataset: isSuperset ? { exercise: name, superset: 'true' } : { exercise: name },
    querySelectorAll: function (sel) { return sel === '.set-row' ? rows : []; }
  };
}

function session(blocks) {
  return {
    querySelectorAll: function (sel) { return sel === '.exercise-block' ? blocks : []; }
  };
}

const SUPERSET = 'Lateral Raise SuperSet';

/* ── AC-10: a superset set must survive the draft, not serialise empty ── */

test('serializeSessionForStorage keeps both sides of a superset row', () => {
  const el = session([
    block(SUPERSET, true, [
      row(1, [
        input('input-weight-a', 30), input('input-reps-a', 15),
        input('input-weight-b', 20), input('input-reps-b', 12)
      ])
    ])
  ]);
  const draft = app.serializeSessionForStorage(el, 'Shoulders');
  assert.deepEqual(draft.exercises[SUPERSET], [
    { weight: '30', reps: '15', weightB: '20', repsB: '12' }
  ]);
});

test('serializeSessionForStorage emits one draft entry per superset row', () => {
  const el = session([
    block(SUPERSET, true, [
      row(1, [
        input('input-weight-a', 30), input('input-reps-a', 15),
        input('input-weight-b', 20), input('input-reps-b', 12)
      ]),
      row(2, [
        input('input-weight-a', 35), input('input-reps-a', 12),
        input('input-weight-b', 25), input('input-reps-b', 10)
      ])
    ])
  ]);
  const draft = app.serializeSessionForStorage(el, 'Shoulders');
  // The resume path sizes the set grid from this length -- two DOM rows must
  // restore as two rows, not four.
  assert.equal(draft.exercises[SUPERSET].length, 2);
});

test('serializeSessionForStorage keeps a half-filled superset row', () => {
  const el = session([
    block(SUPERSET, true, [
      row(1, [
        input('input-weight-a', 30), input('input-reps-a', 15),
        input('input-weight-b', ''), input('input-reps-b', '')
      ])
    ])
  ]);
  const draft = app.serializeSessionForStorage(el, 'Shoulders');
  assert.deepEqual(draft.exercises[SUPERSET], [
    { weight: '30', reps: '15', weightB: '', repsB: '' }
  ]);
});

test('serializeSessionForStorage leaves a normal exercise shape unchanged', () => {
  const el = session([
    block('BB Curl', false, [
      row(1, [input('input-weight', 95), input('input-reps', 7)]),
      row(2, [input('input-weight', ''), input('input-reps', '')])
    ])
  ]);
  const draft = app.serializeSessionForStorage(el, 'Arms');
  assert.deepEqual(draft.exercises['BB Curl'], [
    { weight: '95', reps: '7' },
    { weight: '', reps: '' }
  ]);
  assert.deepEqual(draft.order, ['BB Curl']);
  assert.equal(draft.day, 'Arms');
});

/* ── AC-10: the CSV path labels superset sets 1A / 1B ── */

test('buildExercisesMapFromDOM labels superset sets 1A and 1B', () => {
  const el = session([
    block(SUPERSET, true, [
      row(1, [
        input('input-weight-a', 30), input('input-reps-a', 15),
        input('input-weight-b', 20), input('input-reps-b', 12)
      ])
    ])
  ]);
  const map = app.buildExercisesMapFromDOM(el);
  assert.deepEqual(map.get(SUPERSET), [
    { weight: 30, reps: 15, setLabel: '1A' },
    { weight: 20, reps: 12, setLabel: '1B' }
  ]);
});

/* ── AC-11: a superset card's exercise load counts its superset sets ── */

test('calcExerciseLoad totals the superset sets the DOM map produces', () => {
  const el = session([
    block(SUPERSET, true, [
      row(1, [
        input('input-weight-a', 30), input('input-reps-a', 15),
        input('input-weight-b', 20), input('input-reps-b', 12)
      ])
    ])
  ]);
  const sets = app.buildExercisesMapFromDOM(el).get(SUPERSET);
  assert.equal(core.calcExerciseLoad(sets), 30 * 15 + 20 * 12);
});

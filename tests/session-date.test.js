'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../core.js');

test('sessionDateFromId returns the day the session started', () => {
  assert.equal(core.sessionDateFromId('2026-08-20-083657', '2026-08-26'), '2026-08-20');
  assert.equal(core.sessionDateFromId('2026-08-20-083657-2', '2026-08-26'), '2026-08-20');
});

test('sessionDateFromId falls back for legacy or missing ids', () => {
  assert.equal(core.sessionDateFromId('2026-08-20|Chest', '2026-08-26'), '2026-08-26');
  assert.equal(core.sessionDateFromId('', '2026-08-26'), '2026-08-26');
  assert.equal(core.sessionDateFromId(null, '2026-08-26'), '2026-08-26');
});

test('a session minted by makeSessionId reads back its own date', () => {
  const sid = core.makeSessionId(new Date(2026, 9, 28, 23, 59, 58), []);
  assert.equal(core.sessionDateFromId(sid, 'x'), '2026-10-28');
});

test('an empty rebuild deletes a session that was already saved', () => {
  const rows = [
    { sessionId: 'S1', exercise: 'BB Row' },
    { sessionId: 'S2', exercise: 'Squat' }
  ];
  const next = core.commitReplaceSession(rows, 'S1', core.rebuildSessionRows('S1', '2026-11-11', 'Back', new Map()));
  assert.deepEqual(next.map(r => r.sessionId), ['S2']);
});

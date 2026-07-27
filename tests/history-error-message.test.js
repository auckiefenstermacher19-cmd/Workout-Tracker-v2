'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../core.js');

/* The message shown when history fails to load. Only a genuinely unconfigured
   Worker may send the reader to config.js; every other failure must say what it
   actually is. See INC-11. */

test('historyFailureMessage names config.js when the Worker is not configured', () => {
  const msg = core.historyFailureMessage(new Error('Raw CSV fetch failed'), false);
  assert.match(msg, /config\.js/);
});

test('historyFailureMessage does not blame config.js for a network failure', () => {
  const msg = core.historyFailureMessage(new TypeError('Failed to fetch'), true);
  assert.doesNotMatch(msg, /config\.js/);
  assert.match(msg, /history/i);
});

test('historyFailureMessage does not blame config.js for an unexpected error', () => {
  const msg = core.historyFailureMessage(
    new TypeError("Cannot read properties of null (reading 'value')"), true
  );
  assert.doesNotMatch(msg, /config\.js/);
  assert.match(msg, /history/i);
});

test('historyFailureMessage still answers when the caught value is not an Error', () => {
  assert.doesNotMatch(core.historyFailureMessage(undefined, true), /config\.js/);
  assert.match(core.historyFailureMessage(undefined, false), /config\.js/);
});

test('historyFailureMessage returns a non-empty string in every case', () => {
  for (const configured of [true, false]) {
    const msg = core.historyFailureMessage(new Error('boom'), configured);
    assert.equal(typeof msg, 'string');
    assert.ok(msg.trim().length > 0);
  }
});

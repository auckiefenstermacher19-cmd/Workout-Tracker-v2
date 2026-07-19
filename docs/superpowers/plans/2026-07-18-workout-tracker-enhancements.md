# Workout Tracker v2 Enhancements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make workout days (categories + their exercises) fully editable, let exercises be reordered in the logger / for a past day / as the permanent default, show correct combined per-calendar-day totals with distinct same-day sessions, and fix the clipped mobile back navigation — all on the live GitHub-Pages PWA without a backend or Worker change.

**Architecture:** Extract all pure logic into a new `core.js` (UMD guard: browser attaches to `globalThis`, Node `require()`s it) so it is unit-testable with the Node built-in test runner. `exercises.json` moves to a versioned v2 shape that makes days first-class editable data; `workout_tracker.csv` gains a trailing `Session Id` column (legacy rows synthesize `date|day`) so saves are session-keyed and never overwrite a second same-day session. DOM/CSS changes wire the four static pages to this model. Ship code + data migration atomically on one branch; Pages deploys `main` on merge.

**Tech Stack:** Vanilla ES5-ish JS (no framework/build), HTML, CSS; Cloudflare Worker (unchanged) proxying the GitHub Contents API; Node `--test` + `node:assert/strict` for pure-logic tests (no new dependencies).

## Global Constraints

- **No new dependencies.** Tests use only Node's built-in `node --test` + `node:assert/strict`. Run: `node --test tests/`.
- **All pure logic lives in `core.js`** behind the UMD guard `(function(root){ … const api={…}; if (typeof module!=='undefined'&&module.exports) module.exports=api; else Object.assign(root,api); })(typeof globalThis!=='undefined'?globalThis:this);`. Every HTML page loads scripts in order: `config.js` → `core.js` → `app.js`. Contract functions are DEFINED only in Workstream 1; all other workstreams CONSUME them by exact name and never redefine them.
- **`exercises.json` v2 shape:** `{ "version":2, "days":[ { "id":slug, "name":str, "color":"#rrggbb", "exercises":[ {"name":str,"defaultSets":int} ] } ] }`.
- **`workout_tracker.csv` header (exact):** `Date,Workout Day,Exercise,Set Number,Weight,Reps,Load,Exercise Load,Total Workout Load,Session Id`. `Session Id` is appended LAST (indices 0–8 unchanged). A row with <10 columns or empty Session Id falls back to `sessionId = date + '|' + workoutDay`.
- **Load == Volume == `weight × reps`** (a single metric; there is no second "volume" number).
- **No Cloudflare Worker changes** — it is schema-agnostic base64 text passthrough.
- **Data safety:** the app writes to `main` (which Pages serves live). Do ALL testing locally against fixture copies — never point dev/testing at the live Worker or real CSVs. Keep every reader backward-compatible so a partial state can't misread legacy rows.
- **Reorder UI is up/down buttons** in v1 (no drag-and-drop).
- **Do not modify safe-area/notch handling** — it is already correct (`padding-top: max(var(--space-3), env(safe-area-inset-top))`, `viewport-fit=cover`).
- **Branch:** `feature/workout-qol-editable-days`. Execute workstreams in order 1→2→3→4→5 (foundation first; each is independently testable/shippable).

### Controller amendments (pre-flight — binding; supersede any contrary Foundation preamble note)

- **A — Keep every page functional after WS1 (applies to Tasks 1.4 & 1.6; supersedes Foundation preamble note 4).** Migrating `exercises.json` to v2 must NOT break the v1-shaped readers (`index.html` `EXERCISES[day]`, `records.html` `exercisesByDay`, `exercise-library.html` `libState.exercises`) before WS5 rewrites them — otherwise WS3/WS4 cannot be verified on the branch, violating "independently testable." Add `modelToLegacyMap(model)` to `core.js` returning `{ "<dayName>": [ {name, defaultSets} ] }` in `days` order, unit-tested. In WS1, have the exercise loaders project the v2 model through `modelToLegacyMap(adaptExercisesModel(raw))` so existing `{day:[…]}` consumers keep working unchanged. WS5 removes the projection when it makes days fully dynamic.
- **B — Single CSV splitter (applies to Tasks 1.2 & 1.6; supersedes Foundation preamble note 2's "can stay duplicated").** Export `splitCSVLine` from `core.js` as public API and have `app.js`'s `parseRecordsCSV` use the `core.js` version instead of keeping its own copy, so the quote-aware field splitter is defined exactly once.

> **Task numbering:** IDs are `Task <workstream>.<n>` (e.g. Task 1.3). Where an authored task body refers to another task as "Task N", it means the task in the same workstream identified by its parenthetical descriptor.

---


## Workstream 1 — Foundation (data model: core.js, exercises.json v2, Session Id)

_spec §4, §5.1_

## Section: Foundation

**Section preconditions & stated assumptions (read before executing):**

1. **Environment:** Node `v24.18.0` is installed (supports `node --test` + `node:assert/strict`). There is no `package.json` and no `tests/` dir yet — no npm deps are added; `tests/` is created in Task N (core skeleton). Run tests with `node --test tests/` (or a single file, e.g. `node --test tests/core.test.js`).
2. **`core.js` ↔ `app.js` coexistence (verified):** every HTML page loads `config.js` → `core.js` → `app.js`. `core.js` attaches its API to `globalThis`; `app.js` loads last, so any function `app.js` still declares would *shadow* the `core.js` global of the same name. Therefore the three contract math functions (`calcLoad`, `calcExerciseLoad`, `calcWorkoutLoad`) are **removed** from `app.js` (Task N) so the `core.js` globals win. `core.js`'s own internal calls resolve lexically inside its closure and are immune to any `app.js` global — this is why `splitCSVLine` can stay duplicated in `app.js` (used by `parseRecordsCSV`) without conflict.
3. **`calcWorkoutLoad` signature reconciliation (decision, not silent):** the contract says `calcWorkoutLoad(rowsOfOneSession)`, but the live logger caller `recalcWorkoutLoad()` (`index.html:966`) passes a `Map(name→sets)`. I implement `calcWorkoutLoad` **polymorphically** (accepts a flat rows array *or* a `Map`) so both the contract and the existing live display are satisfied by one function. `calcExerciseLoad` already works on any `{weight,reps}[]` (sets or rows) with no conflict.
4. **`exercises.json` v2 migration is cross-section-coupled (primary risk — surfaced, not hidden):** all current readers assume the v1 `{Day:[…]}` shape — `index.html` (`EXERCISES[day]` at :235/:391/:402/:458), `records.html` (`recState.exercisesByDay` :99), `exercise-library.html` (`libState.exercises` :195), and `app.js` `addExerciseToLibrary` (:146-160). Committing the v2 file **breaks the logger's default-exercise population until the Manage/dynamic-rendering section (spec §5.1) rewrites those consumers.** Per spec §9 the whole branch merges atomically, so the *deployed* app is never half-migrated. **Recommendation:** the v2 file migration is sequenced **last** in Foundation (Task N), and the Manage consumer rewrite must land in the same PR before the logger is manually smoke-tested. I deliberately do **not** add a v2→v1 projection shim (rejected as unnecessary churn given the atomic-merge guarantee and minimalism directive).
5. **Dead code (verified by grep):** `buildCSVRows` (`app.js:462`) has no callers; `appendRowsToCSV` (`app.js:32`) has no callers. They are **not wired** — they are removed in Task N as part of the CSV cleanup.
6. **Session-id durability across resume:** the session id must be stable for a session's life so `commitReplaceSession` overwrites (not duplicates) on resume. The contract's documented draft shape `{day,order,exercises}` has no id field, so the id is persisted in a **sibling** localStorage key `wt_sid_<day>` (mirrors the existing `wt_session_<day>` draft key), minted on start, reused on resume, cleared on complete/discard. This does not alter the documented draft shape.

---

### Task 1.1: Create `core.js` (UMD skeleton) + load math + `makeSessionId`

**Files:**
- Create `core.js` (repo root) — UMD guard + first functions.
- Create `tests/core.test.js` — first tests.

**Interfaces:**
- Produces: `calcLoad(weight,reps)`, `calcExerciseLoad(setsOrRows)`, `calcWorkoutLoad(rowsOrMap)`, `makeSessionId(dateObj, takenIds[])`.
- Consumes: nothing.

- [ ] **Step 1: Write failing tests.** Create `tests/core.test.js`:
```js
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
```
- [ ] **Step 2: Run — expect FAIL.** `node --test tests/core.test.js` → `Cannot find module '../core.js'`.
- [ ] **Step 3: Create `core.js`** with the exact UMD guard and these functions:
```js
(function (root) {
  'use strict';

  /* ─── Load math (single "load == volume" metric = weight × reps) ─── */
  function calcLoad(weight, reps) {
    const w = parseFloat(weight) || 0;
    const r = parseInt(reps, 10) || 0;
    return w * r;
  }

  function calcExerciseLoad(setsOrRows) {
    return (setsOrRows || []).reduce(function (sum, s) {
      return sum + calcLoad(s.weight, s.reps);
    }, 0);
  }

  // Accepts a flat rows array (one session's rows) OR a Map(name -> sets[])
  // so the live logger total (recalcWorkoutLoad) and row-based callers share one impl.
  function calcWorkoutLoad(rowsOrMap) {
    if (rowsOrMap instanceof Map) {
      let total = 0;
      for (const sets of rowsOrMap.values()) total += calcExerciseLoad(sets);
      return total;
    }
    return (rowsOrMap || []).reduce(function (sum, r) {
      return sum + calcLoad(r.weight, r.reps);
    }, 0);
  }

  /* ─── Session id: "YYYY-MM-DD-HHMMSS" from a Date, -2/-3 on collision ─── */
  function makeSessionId(dateObj, takenIds) {
    const taken = takenIds || [];
    const pad = function (n) { return String(n).padStart(2, '0'); };
    const base = dateObj.getFullYear() + '-' + pad(dateObj.getMonth() + 1) + '-' +
      pad(dateObj.getDate()) + '-' + pad(dateObj.getHours()) +
      pad(dateObj.getMinutes()) + pad(dateObj.getSeconds());
    let id = base;
    let n = 2;
    while (taken.indexOf(id) !== -1) { id = base + '-' + n; n++; }
    return id;
  }

  const api = {
    calcLoad: calcLoad,
    calcExerciseLoad: calcExerciseLoad,
    calcWorkoutLoad: calcWorkoutLoad,
    makeSessionId: makeSessionId
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof globalThis !== 'undefined' ? globalThis : this);
```
- [ ] **Step 4: Run — expect PASS.** `node --test tests/core.test.js`.
- [ ] **Step 5: Commit.** `git add core.js tests/core.test.js && git commit -m "feat(core): scaffold core.js UMD + load math + makeSessionId with tests"`

---

### Task 1.2: `core.js` — CSV parse/serialize with `Session Id`

**Files:**
- Modify `core.js` — add `CSV_HEADER`, internal `splitCSVLine`, `parseWorkoutCSV`, `serializeWorkoutCSV`; extend `api`.
- Modify `tests/core.test.js` — append CSV tests.

**Interfaces:**
- Produces: `CSV_HEADER`, `parseWorkoutCSV(text)→row[]`, `serializeWorkoutCSV(rows)→text`.
- Consumes: nothing (internal `splitCSVLine`).

- [ ] **Step 1: Append failing tests** to `tests/core.test.js`:
```js
test('CSV_HEADER includes the Session Id column last', () => {
  assert.equal(core.CSV_HEADER,
    'Date,Workout Day,Exercise,Set Number,Weight,Reps,Load,Exercise Load,Total Workout Load,Session Id');
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
```
- [ ] **Step 2: Run — expect FAIL.** `node --test tests/core.test.js` (new tests throw on `undefined` functions).
- [ ] **Step 3: Implement** in `core.js` — insert **before** the `const api` block:
```js
  /* ─── Workout CSV (10-col; Session Id appended last for BC) ─── */
  const CSV_HEADER =
    'Date,Workout Day,Exercise,Set Number,Weight,Reps,Load,Exercise Load,Total Workout Load,Session Id';

  // Quote-aware single-line splitter (internal; not exported).
  function splitCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === ',' && !inQuotes) { result.push(current); current = ''; }
      else current += ch;
    }
    result.push(current);
    return result;
  }

  function parseWorkoutCSV(text) {
    if (!text || !text.trim()) return [];
    const dataLines = text.trim().split('\n').slice(1); // tolerate old 9-col OR new 10-col header
    return dataLines
      .map(function (line) { return line.trim(); })
      .filter(function (line) { return line.length > 0; })
      .map(function (line) {
        const cols = splitCSVLine(line);
        if (cols.length < 9) return null;
        const date = cols[0].trim();
        const workoutDay = cols[1].trim();
        const rawSid = cols.length >= 10 ? cols[9].trim() : '';
        return {
          date: date,
          workoutDay: workoutDay,
          exercise: cols[2].trim(),
          setNumber: cols[3].trim(), // string: preserves "1A"/"1B" superset labels
          weight: parseFloat(cols[4]),
          reps: parseInt(cols[5], 10),
          load: parseFloat(cols[6]),
          exerciseLoad: parseFloat(cols[7]),
          totalWorkoutLoad: parseFloat(cols[8]),
          sessionId: rawSid !== '' ? rawSid : (date + '|' + workoutDay)
        };
      })
      .filter(function (row) { return row !== null && row.setNumber && row.setNumber.length > 0; });
  }

  function serializeWorkoutCSV(rows) {
    const lines = rows.map(function (r) {
      const sid = (r.sessionId != null && r.sessionId !== '') ? r.sessionId : (r.date + '|' + r.workoutDay);
      return [
        r.date, r.workoutDay, r.exercise, r.setNumber,
        r.weight, r.reps, r.load, r.exerciseLoad, r.totalWorkoutLoad, sid
      ].join(',');
    });
    return [CSV_HEADER].concat(lines).join('\n') + '\n';
  }
```
Add to the `api` object: `CSV_HEADER: CSV_HEADER,`, `parseWorkoutCSV: parseWorkoutCSV,`, `serializeWorkoutCSV: serializeWorkoutCSV,`.
- [ ] **Step 4: Run — expect PASS.** `node --test tests/core.test.js`.
- [ ] **Step 5: Commit.** `git add core.js tests/core.test.js && git commit -m "feat(core): session-id-aware CSV parse/serialize with legacy fallback + round-trip tests"`

---

### Task 1.3: `core.js` — session grouping, rebuild, session-keyed commit, rename, reorder

**Files:**
- Modify `core.js` — add `combinedDayLoad`, `sessionsOnDate`, `rebuildSessionRows`, `commitReplaceSession`, `renameDayInRows`, `reorderSessionExercises`; extend `api`.
- Modify `tests/core.test.js` — append tests.

**Interfaces:**
- Produces: `combinedDayLoad(rows,dateStr)`, `sessionsOnDate(rows,dateStr)`, `rebuildSessionRows(sessionId,date,workoutDay,exercisesMap)`, `commitReplaceSession(allRows,sessionId,newSessionRows)`, `renameDayInRows(rows,oldName,newName)`, `reorderSessionExercises(rows,sessionId,orderedExerciseNames[])`.
- Consumes: `calcLoad`, `calcExerciseLoad`, `calcWorkoutLoad` (internal, this file).

- [ ] **Step 1: Append failing tests** to `tests/core.test.js`:
```js
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
```
- [ ] **Step 2: Run — expect FAIL.** `node --test tests/core.test.js`.
- [ ] **Step 3: Implement** in `core.js` — insert **before** the `const api` block:
```js
  /* ─── Calendar-day aggregation & session grouping ─── */
  function combinedDayLoad(rows, dateStr) {
    return rows.reduce(function (sum, r) {
      return r.date === dateStr ? sum + r.load : sum;
    }, 0);
  }

  function sessionsOnDate(rows, dateStr) {
    const groups = [];
    const byId = new Map();
    for (const r of rows) {
      if (r.date !== dateStr) continue;
      let g = byId.get(r.sessionId);
      if (!g) {
        g = { sessionId: r.sessionId, workoutDay: r.workoutDay, rows: [] };
        byId.set(r.sessionId, g);
        groups.push(g);
      }
      g.rows.push(r);
    }
    return groups;
  }

  /* ─── Build & save one session's rows (replaces old rebuildRowObjects) ─── */
  function rebuildSessionRows(sessionId, date, workoutDay, exercisesMap) {
    const totalWorkoutLoad = calcWorkoutLoad(exercisesMap);
    const rows = [];
    for (const entry of exercisesMap) {
      const exerciseName = entry[0];
      const sets = entry[1];
      const exerciseLoad = calcExerciseLoad(sets);
      sets.forEach(function (set, idx) {
        const setNum = set.setLabel !== undefined ? set.setLabel : String(idx + 1);
        rows.push({
          date: date,
          workoutDay: workoutDay,
          exercise: exerciseName,
          setNumber: setNum,
          weight: set.weight,
          reps: set.reps,
          load: calcLoad(set.weight, set.reps),
          exerciseLoad: exerciseLoad,
          totalWorkoutLoad: totalWorkoutLoad,
          sessionId: sessionId
        });
      });
    }
    return rows;
  }

  // Session-keyed save: drop the target session's rows, append the rebuilt ones.
  function commitReplaceSession(allRows, sessionId, newSessionRows) {
    const kept = allRows.filter(function (r) { return r.sessionId !== sessionId; });
    return kept.concat(newSessionRows);
  }

  /* ─── History rewrite on day rename ─── */
  function renameDayInRows(rows, oldName, newName) {
    return rows.map(function (r) {
      return r.workoutDay === oldName ? Object.assign({}, r, { workoutDay: newName }) : r;
    });
  }

  /* ─── Reorder one session's exercises; unknown names keep relative order at end ─── */
  function reorderSessionExercises(rows, sessionId, orderedExerciseNames) {
    const order = orderedExerciseNames || [];
    const groups = new Map(); // exercise -> its rows, in first-appearance order
    for (const r of rows) {
      if (r.sessionId !== sessionId) continue;
      if (!groups.has(r.exercise)) groups.set(r.exercise, []);
      groups.get(r.exercise).push(r);
    }
    const rank = new Map();
    order.forEach(function (name, i) { if (!rank.has(name)) rank.set(name, i); });
    const known = [];
    const unknown = [];
    for (const name of groups.keys()) {
      if (rank.has(name)) known.push(name); else unknown.push(name);
    }
    known.sort(function (a, b) { return rank.get(a) - rank.get(b); });
    const orderedNames = known.concat(unknown);
    const reordered = [];
    orderedNames.forEach(function (name) {
      groups.get(name).forEach(function (r) { reordered.push(r); });
    });
    const result = [];
    let injected = false;
    for (const r of rows) {
      if (r.sessionId === sessionId) {
        if (!injected) { reordered.forEach(function (sr) { result.push(sr); }); injected = true; }
      } else {
        result.push(r);
      }
    }
    return result;
  }
```
Add to `api`: `combinedDayLoad`, `sessionsOnDate`, `rebuildSessionRows`, `commitReplaceSession`, `renameDayInRows`, `reorderSessionExercises`.
- [ ] **Step 4: Run — expect PASS.** `node --test tests/core.test.js`.
- [ ] **Step 5: Commit.** `git add core.js tests/core.test.js && git commit -m "feat(core): session grouping, rebuildSessionRows, session-keyed commit, rename + reorder with tests"`

---

### Task 1.4: `core.js` — exercises v2 model (`slugifyDayId`, `adaptExercisesModel`, `serializeExercisesModel`)

**Files:**
- Modify `core.js` — add color constants, `slugifyDayId`, `adaptExercisesModel`, `serializeExercisesModel`; extend `api`.
- Modify `tests/core.test.js` — append model tests.

**Interfaces:**
- Produces: `slugifyDayId(name,takenIds[])`, `adaptExercisesModel(raw)→v2 model`, `serializeExercisesModel(model)→pretty JSON`.
- Consumes: nothing.

- [ ] **Step 1: Append failing tests** to `tests/core.test.js`:
```js
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
```
- [ ] **Step 2: Run — expect FAIL.** `node --test tests/core.test.js`.
- [ ] **Step 3: Implement** in `core.js` — insert **before** the `const api` block:
```js
  /* ─── Exercises v2 model ─── */
  const DAY_PRESET_COLORS = {
    Legs: '#c084fc', Chest: '#fb923c', Back: '#38bdf8', Shoulders: '#facc15', Arms: '#f472b6'
  };
  const DAY_FALLBACK_PALETTE = [
    '#c084fc', '#fb923c', '#38bdf8', '#facc15', '#f472b6',
    '#34d399', '#f87171', '#a3e635', '#22d3ee', '#e879f9'
  ];

  function slugifyDayId(name, takenIds) {
    const taken = takenIds || [];
    let base = String(name == null ? '' : name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!base) base = 'day';
    let id = base;
    let n = 2;
    while (taken.indexOf(id) !== -1) { id = base + '-' + n; n++; }
    return id;
  }

  // Accepts a v1 object ({Day:[{name,defaultSets}]}) OR an already-v2 object.
  function adaptExercisesModel(raw) {
    if (raw && (raw.version === 2 || Array.isArray(raw.days))) {
      const days = (raw.days || []).map(function (d, i) {
        return {
          id: d.id || slugifyDayId(d.name || ('day-' + (i + 1)), []),
          name: d.name,
          color: d.color || DAY_FALLBACK_PALETTE[i % DAY_FALLBACK_PALETTE.length],
          exercises: (d.exercises || []).map(function (e) {
            return { name: e.name, defaultSets: e.defaultSets };
          })
        };
      });
      return { version: 2, days: days };
    }
    const names = raw ? Object.keys(raw) : [];
    const takenIds = [];
    const days = names.map(function (name, i) {
      const id = slugifyDayId(name, takenIds);
      takenIds.push(id);
      const color = DAY_PRESET_COLORS[name] || DAY_FALLBACK_PALETTE[i % DAY_FALLBACK_PALETTE.length];
      const exercises = (raw[name] || []).map(function (e) {
        return { name: e.name, defaultSets: e.defaultSets };
      });
      return { id: id, name: name, color: color, exercises: exercises };
    });
    return { version: 2, days: days };
  }

  function serializeExercisesModel(model) {
    return JSON.stringify(model, null, 2) + '\n';
  }
```
Add to `api`: `slugifyDayId`, `adaptExercisesModel`, `serializeExercisesModel`.
- [ ] **Step 4: Run — expect PASS.** `node --test tests/core.test.js` (all suites green — the full `core.js` contract is now implemented).
- [ ] **Step 5: Commit.** `git add core.js tests/core.test.js && git commit -m "feat(core): exercises v1->v2 adapter, slugifyDayId, serializeExercisesModel with tests"`

---

### Task 1.5: Load `core.js` before `app.js` on all four pages

**Files:**
- Modify `index.html` (:125-126), `dashboard.html` (:174-175), `records.html` (:68-69), `exercise-library.html` (:161-162).

**Interfaces:** Consumes: `core.js` globals. Produces: nothing.

Each page currently ends its scripts with (verbatim, per page anchor):
```html
<script src="config.js"></script>
<script src="app.js"></script>
```
- [ ] **Step 1: Insert `core.js` between `config.js` and `app.js` on every page** so `app.js` sees the core globals. New block (identical on all four):
```html
<script src="config.js"></script>
<script src="core.js"></script>
<script src="app.js"></script>
```
Apply at: `index.html:125`, `dashboard.html:174`, `records.html:68`, `exercise-library.html:161` (insert the `core.js` line before the existing `app.js` line at each anchor).
- [ ] **Step 2: Manual verify (no DOM test runner).** Serve the folder locally (`python -m http.server` or any static server), open each page, and in the browser console confirm the globals loaded:
  - `typeof window.parseWorkoutCSV === 'function'` → `true`
  - `window.CSV_HEADER.endsWith(',Session Id')` → `true`
  - `typeof window.adaptExercisesModel === 'function'` → `true`
  Pages must render exactly as before (both `core.js` and `app.js` still define the math globals at this point; `app.js` — loaded last — wins, so behavior is unchanged).
- [ ] **Step 3: Commit.** `git add index.html dashboard.html records.html exercise-library.html && git commit -m "chore: load core.js before app.js on all four pages"`

---

### Task 1.6: Wire `app.js` to `core.js` (delegate CSV, drop moved/dead logic, session-keyed commit, `applyDayColor`)

**Files:**
- Modify `app.js`: `appendRowsToCSV` (32-42, delete), `parseCSV` (192-220, delegate), `serializeCSV` (264-271, delegate), `calcLoad`/`calcExerciseLoad`/`calcWorkoutLoad` (401-417, delete), `buildCSVRows` (462-484, delete), `rebuildRowObjects` (486-514, delete), `createAutosaveEngine` opts + `flush` (776-816) + `completeFlush` (876), `commitTodaysWorkout` (890-911), plus a new `applyDayColor` helper.

**Interfaces:**
- Consumes: `parseWorkoutCSV`, `serializeWorkoutCSV`, `rebuildSessionRows`, `commitReplaceSession` (core globals).
- Produces: `commitTodaysWorkout(date, workoutDay, exercisesMap, sessionId)`, `applyDayColor(el, hex)`.

- [ ] **Step 1: Delegate `parseCSV`.** Replace the whole function body at `app.js:192-220` with:
```js
function parseCSV(rawText) {
  // Delegates to core.js (session-id aware). Thin wrapper so existing callers
  // (dashboard.html, index.html history, rebuildAllRecordsFromHistory) are unchanged.
  return parseWorkoutCSV(rawText);
}
```
- [ ] **Step 2: Delegate `serializeCSV`.** Replace `app.js:264-271` with:
```js
function serializeCSV(rows) {
  return serializeWorkoutCSV(rows);
}
```
- [ ] **Step 3: Remove the three math functions** now owned by `core.js`. Delete `calcLoad`, `calcExerciseLoad`, `calcWorkoutLoad` (`app.js:401-417`) and replace with a one-line marker so callers resolve to the core globals:
```js
/* calcLoad / calcExerciseLoad / calcWorkoutLoad now live in core.js (loaded first). */
```
- [ ] **Step 4: Remove dead code.** Delete `appendRowsToCSV` (`app.js:32-42`) and `buildCSVRows` (`app.js:462-484`) entirely — both are confirmed uncalled (grep: only their declarations exist).
- [ ] **Step 5: Remove `rebuildRowObjects`** (`app.js:486-514`) — replaced by `core.js` `rebuildSessionRows`; its only caller (`commitTodaysWorkout`) is rewired in Step 7.
- [ ] **Step 6: Thread `sessionId` through the autosave engine.** In `createAutosaveEngine` add the opt after line 781 (`const getExercisesMap = opts.getExercisesMap;`):
```js
  const getSessionId = opts.getSessionId || function () { return undefined; };
```
Then change the two `commitTodaysWorkout` calls to pass it:
  - `flush()` at `app.js:816`: `await commitTodaysWorkout(getDate(), getWorkoutDay(), exMap, getSessionId());`
  - `completeFlush()` at `app.js:876`: `await commitTodaysWorkout(getDate(), getWorkoutDay(), exMap, getSessionId());`
- [ ] **Step 7: Rewire `commitTodaysWorkout` to a session-keyed save.** Replace `app.js:890-911` with:
```js
async function commitTodaysWorkout(date, workoutDay, exercisesMap, sessionId) {
  const fileData = await getCSVFile();
  const content = fileData.content;
  const sha = fileData.sha;
  const allRows = parseWorkoutCSV(content);

  // Fall back to the legacy date+day key if no explicit id (keeps this commit
  // functional before the index.html session-id lifecycle task lands).
  const sid = (sessionId != null && sessionId !== '') ? sessionId : (date + '|' + workoutDay);
  const newSessionRows = rebuildSessionRows(sid, date, workoutDay, exercisesMap);
  const merged = commitReplaceSession(allRows, sid, newSessionRows);
  const csvText = serializeWorkoutCSV(merged);

  const result = await putToWorker('/csv', csvText, sha, 'Autosave ' + workoutDay + ' \u2014 ' + date);

  try {
    await updateRecordsFromSession(exercisesMap, date);
  } catch (e) {
    console.warn('Personal records update failed:', e);
  }

  return result;
}
```
- [ ] **Step 8: Add `applyDayColor`** (contract helper, DOM-touching → lives in `app.js`). Insert it next to the other small helpers (e.g. immediately after `getRecordsForExercise`, `app.js:579`):
```js
// Applies a day's configured color to a DOM element via the --day-color custom
// property. Consumed by the dynamic day-rendering (Manage) and mobile-framing
// sections; a no-op until CSS references var(--day-color).
function applyDayColor(el, hex) {
  if (el && hex) el.style.setProperty('--day-color', hex);
}
```
- [ ] **Step 9: Verify.** Automated syntax gate: `node --check app.js` (must exit 0 — catches any edit slip). Pure-logic regression: `node --test tests/` (still green). Manual: reload the served logger, confirm the "Total Workout Load" display still updates as you type (proves `recalcWorkoutLoad → core.js calcWorkoutLoad(Map)` works) and that an autosave writes a row whose 10th CSV column is `<date>|<day>` (session-keyed save via the legacy fallback, since the real id lands next task).
- [ ] **Step 10: Commit.** `git add app.js && git commit -m "refactor(app): delegate CSV/math to core.js, session-keyed commit, drop dead code, add applyDayColor"`

---

### Task 1.7: Session-id lifecycle in the logger (mint / persist / resume / clear)

**Files:**
- Modify `app.js` — add `wt_sid_<day>` storage helpers next to the LS helpers (`app.js:581-614`).
- Modify `index.html` — `startSession` (233-257), `handleCompleteWorkout` (316), `discardSession` (227-231).

**Interfaces:**
- Consumes: `makeSessionId` (core global), `getSessionId` opt (from previous task).
- Produces: `state.sessionId`; `saveSessionId`/`loadSessionId`/`clearSessionId`.

- [ ] **Step 1: Add session-id storage helpers to `app.js`** (immediately after `clearLocalStorage`/`hasLocalStorage`, i.e. after `app.js:614`):
```js
const LS_SID_PREFIX = 'wt_sid_';

function saveSessionId(workoutDay, sessionId) {
  try { localStorage.setItem(LS_SID_PREFIX + workoutDay, sessionId); } catch (e) {}
}
function loadSessionId(workoutDay) {
  try { return localStorage.getItem(LS_SID_PREFIX + workoutDay) || null; } catch (e) { return null; }
}
function clearSessionId(workoutDay) {
  try { localStorage.removeItem(LS_SID_PREFIX + workoutDay); } catch (e) {}
}
```
- [ ] **Step 2: Mint/resume the id in `startSession`.** In `index.html`, the current head of `startSession` (`:233-236`) is:
```js
async function startSession(day, resume) {
  state.currentDay = day;
  state.exercises  = (EXERCISES && EXERCISES[day]) ? EXERCISES[day] : [];
  state.csvLoaded  = false;
```
Insert, right after `state.csvLoaded = false;`:
```js

  // Stable Session Id for this session's life: reuse the persisted id on resume,
  // else mint a fresh one so a new session becomes a new CSV block (no overwrite).
  let sid = resume ? loadSessionId(day) : null;
  if (!sid) {
    sid = makeSessionId(new Date(), []);
    saveSessionId(day, sid);
  }
  state.sessionId = sid;
```
Then add the `getSessionId` opt to the `createAutosaveEngine({…})` call (`index.html:251-257`) — the current object ends:
```js
    getExercisesMap: () => buildExercisesMapFromDOM(document.getElementById('exercise-list'))
  });
```
Change to:
```js
    getExercisesMap: () => buildExercisesMapFromDOM(document.getElementById('exercise-list')),
    getSessionId: () => state.sessionId
  });
```
- [ ] **Step 3: Clear the id on completion.** In `handleCompleteWorkout` (`index.html:315-319`), the success branch currently is:
```js
  if (result.ok) {
    clearLocalStorage(state.currentDay);
    showToast(state.currentDay + ' workout completed', 'success');
```
Add `clearSessionId` beside `clearLocalStorage`:
```js
  if (result.ok) {
    clearLocalStorage(state.currentDay);
    clearSessionId(state.currentDay);
    showToast(state.currentDay + ' workout completed', 'success');
```
- [ ] **Step 4: Clear the id on discard.** `discardSession` (`index.html:227-231`) currently:
```js
function discardSession(day) {
  clearLocalStorage(day);
  renderResumeBanners();
  showToast(day + ' local draft discarded');
}
```
Change to add `clearSessionId(day);`:
```js
function discardSession(day) {
  clearLocalStorage(day);
  clearSessionId(day);
  renderResumeBanners();
  showToast(day + ' local draft discarded');
}
```
- [ ] **Step 5: Verify.** `node --check app.js` (exit 0). Manual, on the served app:
  1. Start a Chest session; console: `localStorage.getItem('wt_sid_Chest')` → an id like `2026-07-18-101503`.
  2. Enter a set; after autosave, the committed CSV's new rows carry that id in column 10 (check via the network PUT body or the raw CSV).
  3. Reload, click **Resume** on the banner; console: `state.sessionId` equals the same id (no duplicate block appended on the next save).
  4. Click **Complete**; console: `localStorage.getItem('wt_sid_Chest')` → `null`.
- [ ] **Step 6: Commit.** `git add app.js index.html && git commit -m "feat(logger): mint, persist, resume and clear a stable Session Id per session"`

---

### Task 1.8: Migrate committed `exercises.json` to v2 + committed-file round-trip test

**Files:**
- Create `tests/exercises-migration.test.js`.
- Modify `exercises.json` (replace v1 → v2).

**Interfaces:** Consumes: `adaptExercisesModel` (core). Produces: the on-disk v2 model.

> **CROSS-SECTION COUPLING (must ship with the Manage section in the same PR).** This task changes the on-disk shape from v1 `{Day:[…]}` to v2 `{version,days:[…]}`. Every current reader assumes v1 and will misread the v2 file until the **Manage / dynamic-rendering section (spec §5.1)** rewrites them: `index.html` `EXERCISES[day]` (:235/:391/:402/:458), `records.html` `recState.exercisesByDay` (:99), `exercise-library.html` `libState.exercises` (:195), and `app.js` `addExerciseToLibrary` (:146-160). Per spec §9 the branch merges atomically, so the *deployed* app is never half-migrated — but do not manually smoke-test the logger's default-exercise list from this commit alone. Sequence this task **last in Foundation**, and land the Manage consumer rewrite before end-to-end logger verification.

- [ ] **Step 1: Write the failing committed-file test.** Create `tests/exercises-migration.test.js`:
```js
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
```
- [ ] **Step 2: Run — expect FAIL.** `node --test tests/exercises-migration.test.js` (file is still v1 → `version` undefined).
- [ ] **Step 3: Replace `exercises.json`** with the exact v2 content below (this is `serializeExercisesModel(adaptExercisesModel(<current v1>))` — generated from the real v1 file, so ids/colors/order are verified):
```json
{
  "version": 2,
  "days": [
    {
      "id": "legs",
      "name": "Legs",
      "color": "#c084fc",
      "exercises": [
        {
          "name": "BB Squat",
          "defaultSets": 4
        },
        {
          "name": "Leg Press",
          "defaultSets": 3
        },
        {
          "name": "Bulgarian Split Squat",
          "defaultSets": 3
        },
        {
          "name": "Leg Extension",
          "defaultSets": 4
        },
        {
          "name": "Front Squat",
          "defaultSets": 4
        }
      ]
    },
    {
      "id": "chest",
      "name": "Chest",
      "color": "#fb923c",
      "exercises": [
        {
          "name": "Flat Bench",
          "defaultSets": 4
        },
        {
          "name": "Incline Bench",
          "defaultSets": 4
        },
        {
          "name": "Peck Flys",
          "defaultSets": 3
        },
        {
          "name": "Tricep Pushdown",
          "defaultSets": 3
        },
        {
          "name": "Machine Cheat Press",
          "defaultSets": 4
        }
      ]
    },
    {
      "id": "back",
      "name": "Back",
      "color": "#38bdf8",
      "exercises": [
        {
          "name": "BB Row",
          "defaultSets": 4
        },
        {
          "name": "Weighted Pull Ups",
          "defaultSets": 4
        },
        {
          "name": "Cable Rows",
          "defaultSets": 3
        },
        {
          "name": "Lat Pull Downs",
          "defaultSets": 2
        },
        {
          "name": "Cable Curls",
          "defaultSets": 3
        }
      ]
    },
    {
      "id": "shoulders",
      "name": "Shoulders",
      "color": "#facc15",
      "exercises": [
        {
          "name": "Shoulder Press",
          "defaultSets": 4
        },
        {
          "name": "Lateral Raise SuperSet",
          "defaultSets": 3
        },
        {
          "name": "Rear Delts",
          "defaultSets": 3
        },
        {
          "name": "BB Shrugs",
          "defaultSets": 4
        },
        {
          "name": "Cable Lat Raises",
          "defaultSets": 3
        }
      ]
    },
    {
      "id": "arms",
      "name": "Arms",
      "color": "#f472b6",
      "exercises": [
        {
          "name": "BB Curl",
          "defaultSets": 4
        },
        {
          "name": "Skull Crushers",
          "defaultSets": 4
        },
        {
          "name": "Incline DB Curl",
          "defaultSets": 3
        },
        {
          "name": "Tricep Pushdown",
          "defaultSets": 4
        },
        {
          "name": "Hammer Curls",
          "defaultSets": 3
        },
        {
          "name": "Overhead Cable Ext",
          "defaultSets": 3
        }
      ]
    }
  ]
}
```
- [ ] **Step 4: Run — expect PASS.** `node --test tests/exercises-migration.test.js`, then full suite `node --test tests/`.
- [ ] **Step 5: Commit.** `git add exercises.json tests/exercises-migration.test.js && git commit -m "feat(data): migrate exercises.json to v2 model + committed-file round-trip test"`

---

**Consumed-by-downstream summary (for the assembler):** every other section depends on these `core.js` globals — Mobile framing uses `applyDayColor`; Logger reorder uses `reorderSessionExercises` + the draft `order` field + session-id persistence; Dashboard uses `combinedDayLoad`, `sessionsOnDate`, `parseWorkoutCSV`; Manage uses `adaptExercisesModel`, `serializeExercisesModel`, `slugifyDayId`, `renameDayInRows`, `reorderSessionExercises`, `replaceExercisesContent`. The Manage section additionally **must** rewrite the v1 `exercises.json` consumers listed in the Task N coupling note within the same PR.


## Workstream 2 — Mobile framing / back button

_spec §5.4_

### Task 2.1: Add shared `.page-header` header pattern and remove dead shell CSS (`styles.css`)

**Files:**
- Modify `styles.css` — replace the dead **App Shell** block (lines **152–178**) with the new shared header block; delete the dead `.home-screen` rule (lines **385–389**) and the dead `.session-screen` / `.session-screen.active` rules (lines **479–487**).

**Interfaces:**
- Produces CSS classes `.page-header`, `.page-header-back`, `.page-header-title`, `.page-header-actions` consumed by `dashboard.html`, `records.html`, `exercise-library.html` (Tasks below). No JS/DOM contract. Reuses existing tokens `--tap-min`, `--space-*`, `--radius-sm`, `--bg-base`, `--border-subtle`, `--text-primary`, and base `.btn` / `.btn-icon` / `.btn-secondary`.
- Consumes nothing from `core.js` (pure presentation).

**Verification note:** `.app-header`, `.app-header-title`, `.app-main`, `.home-screen`, `.session-screen` were confirmed unused via `grep -rn` over `*.html` + `*.js` (0 matches). `.btn-sm` is NOT removed — it is still used by `index.html:220-221,358` and `records.html:149`. Safe-area/notch handling is preserved verbatim (`padding-top: max(var(--space-3), env(safe-area-inset-top))`).

- [ ] **Step 1: Replace the dead App Shell block with the shared header block.** In `styles.css`, the current block at lines **152–178** is:

```css
/* ── App Shell ────────────────────────────────────────────────── */
.app-header {
  position: sticky;
  top: 0;
  z-index: 100;
  background: var(--bg-base);
  border-bottom: 1px solid var(--border-subtle);
  padding: var(--space-3) var(--space-4);
  padding-top: max(var(--space-3), env(safe-area-inset-top));
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: var(--tap-min);
}

.app-header-title {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-primary);
}

.app-main {
  padding: var(--space-5) var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}
```

Replace those 27 lines (152–178) verbatim with:

```css
/* ── Shared sub-page header (dashboard / records / library) ───── */
.page-header {
  position: sticky;
  top: 0;
  z-index: 100;
  background: var(--bg-base);
  border-bottom: 1px solid var(--border-subtle);
  padding: var(--space-3) var(--space-4);
  padding-top: max(var(--space-3), env(safe-area-inset-top));
  display: flex;
  flex-wrap: wrap;                 /* nav drops to its own row on narrow phones */
  align-items: center;
  gap: var(--space-2) var(--space-3);
  min-height: var(--tap-min);
}

/* Left back-arrow — mirrors the logger's #btn-back-home, returns to index.html */
.page-header-back {
  flex-shrink: 0;
}

.page-header-title {
  flex: 1 1 auto;
  min-width: 0;                    /* lets the title shrink instead of clipping the row */
  font-size: 0.9375rem;
  font-weight: 700;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.page-header-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-left: auto;
}

/* Header nav links: visually compact but full 44px tap targets */
.page-header-actions .btn {
  min-height: var(--tap-min);
  padding: var(--space-2) var(--space-3);
  font-size: 0.8125rem;
  border-radius: var(--radius-sm);
}
```

- [ ] **Step 2: Delete the dead `.home-screen` rule.** In `styles.css` (currently lines **385–389**, directly under the `/* ── Home Screen ── */` comment on line 384), remove exactly:

```css
.home-screen {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
}
```

Keep the `/* ── Home Screen ── */` comment and the live `.home-header` rule that follows.

- [ ] **Step 3: Delete the dead `.session-screen` rules.** In `styles.css` (currently lines **479–487**, under `/* ── Session View: Continuous Autosave Layout ── */` on line 478), remove exactly:

```css
.session-screen {
  display: none;
  min-height: 100dvh;
  flex-direction: column;
}

.session-screen.active {
  display: flex;
}
```

Keep the `/* ── Session View … ── */` comment and the live `.session-header` rule that follows (it is used by `index.html`).

- [ ] **Step 4: Local render check.** Serve the repo (`python -m http.server 8000` from repo root, or `npx --yes serve -l 8000 .`) and load `http://localhost:8000/index.html`. Confirm the logger still renders (home day buttons + session header unchanged) — this proves the shell-CSS removals broke nothing. (`.page-header` has no consumer yet; that lands in the next tasks.)

- [ ] **Step 5: Commit.**
```
git add styles.css && git commit -m "feat(mobile): add shared .page-header pattern; remove dead shell CSS"
```

---

### Task 2.2: Convert `dashboard.html` header to `.page-header` and drop dead `.dash-header` CSS

**Files:**
- Modify `dashboard.html` — header markup at lines **110–117**.
- Modify `styles.css` — delete dead `.dash-header` (lines **1063–1075**) and `.dash-header-title` (lines **1077–1081**).

**Interfaces:**
- Consumes `.page-header` / `.page-header-back` / `.page-header-title` / `.page-header-actions` (Task above). No `core.js` interface.

- [ ] **Step 1: Replace the header markup.** In `dashboard.html`, the current block (lines **110–117**, inside `.dash-top`) is:

```html
  <!-- Header -->
  <div class="dash-header">
    <div class="dash-header-title">Dashboard</div>
    <div style="display:flex; gap: var(--space-2);">
      <a href="exercise-library.html" class="btn btn-secondary btn-sm">Library</a>
      <a href="records.html" class="btn btn-secondary btn-sm">Records</a>
      <a href="index.html" class="btn btn-secondary btn-sm">Log Workout</a>
    </div>
  </div>
```

Replace with (drops the redundant "Log Workout" link — the back arrow now performs that return):

```html
  <!-- Header -->
  <div class="page-header">
    <a href="index.html" class="btn btn-icon btn-secondary page-header-back" aria-label="Back to logger">&larr;</a>
    <div class="page-header-title">Dashboard</div>
    <div class="page-header-actions">
      <a href="exercise-library.html" class="btn btn-secondary">Library</a>
      <a href="records.html" class="btn btn-secondary">Records</a>
    </div>
  </div>
```

- [ ] **Step 2: Delete the now-dead `.dash-header` CSS.** In `styles.css`, under the `/* ── Dashboard ── */` comment (line 1062), remove exactly the `.dash-header` rule (lines **1063–1075**) and the `.dash-header-title` rule (lines **1077–1081**):

```css
.dash-header {
  position: sticky;
  top: 0;
  z-index: 100;
  background: var(--bg-base);
  border-bottom: 1px solid var(--border-subtle);
  padding: var(--space-3) var(--space-4);
  padding-top: max(var(--space-3), env(safe-area-inset-top));
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: var(--tap-min);
}

.dash-header-title {
  font-size: 0.9375rem;
  font-weight: 700;
  color: var(--text-primary);
}
```

Keep the `/* ── Dashboard ── */` comment and the live `.date-nav` rule that follows.

- [ ] **Step 3: Local verification.** Reload `http://localhost:8000/dashboard.html` in Chrome DevTools device mode at **320px** width. Confirm: the ← back button is fully visible top-left and returns to `index.html` when tapped; the "Dashboard" title is not clipped; "Library"/"Records" wrap to a second row rather than overflowing off-screen; the date-nav (‹ date ›) sits directly below unchanged. Inspect the ← button → computed height **44px**; inspect a nav `.btn` → computed height **≥44px**.

- [ ] **Step 4: Commit.**
```
git add dashboard.html styles.css && git commit -m "feat(mobile): dashboard shared page-header with back arrow"
```

---

### Task 2.3: Convert `records.html` header to `.page-header` and drop dead `.records-header` CSS

**Files:**
- Modify `records.html` — header markup at lines **52–59**.
- Modify `styles.css` — delete dead `.records-header` (lines **1471–1484**), `.records-header-title` (lines **1486–1490**), `.records-header-actions` (lines **1492–1496**).

**Interfaces:**
- Consumes shared `.page-header*` classes. No `core.js` interface.

- [ ] **Step 1: Replace the header markup.** In `records.html`, the current block (lines **52–59**) is:

```html
<div class="records-header">
  <div class="records-header-title">Records</div>
  <div class="records-header-actions">
    <a href="exercise-library.html" class="btn btn-secondary btn-sm">Library</a>
    <a href="dashboard.html" class="btn btn-secondary btn-sm">Dashboard</a>
    <a href="index.html" class="btn btn-secondary btn-sm">Log Workout</a>
  </div>
</div>
```

Replace with:

```html
<div class="page-header">
  <a href="index.html" class="btn btn-icon btn-secondary page-header-back" aria-label="Back to logger">&larr;</a>
  <div class="page-header-title">Records</div>
  <div class="page-header-actions">
    <a href="exercise-library.html" class="btn btn-secondary">Library</a>
    <a href="dashboard.html" class="btn btn-secondary">Dashboard</a>
  </div>
</div>
```

- [ ] **Step 2: Delete the now-dead `.records-header` CSS.** In `styles.css`, under the `/* ── Records Dashboard ── */` comment (line 1470), remove exactly lines **1471–1496**:

```css
.records-header {
  position: sticky;
  top: 0;
  z-index: 100;
  background: var(--bg-base);
  border-bottom: 1px solid var(--border-subtle);
  padding: var(--space-3) var(--space-4);
  padding-top: max(var(--space-3), env(safe-area-inset-top));
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-height: var(--tap-min);
}

.records-header-title {
  font-size: 0.9375rem;
  font-weight: 700;
  color: var(--text-primary);
}

.records-header-actions {
  display: flex;
  gap: var(--space-2);
  flex-shrink: 0;
}
```

Keep the `/* ── Records Dashboard ── */` comment and the live `.records-body` rule that follows.

- [ ] **Step 3: Local verification.** Reload `http://localhost:8000/records.html` at **320px**. Confirm ← is fully visible/tappable → returns to `index.html`; "Records" title unclipped; "Library"/"Dashboard" wrap rather than overflow; the records list still scrolls below the fixed header. Back button computed height **44px**; nav `.btn` computed height **≥44px**.

- [ ] **Step 4: Commit.**
```
git add records.html styles.css && git commit -m "feat(mobile): records shared page-header with back arrow"
```

---

### Task 2.4: Convert `exercise-library.html` header to `.page-header` and drop its inline `.lib-header` CSS

**Files:**
- Modify `exercise-library.html` — inline `<style>` block: delete `.lib-header` / `.lib-header-title` / `.lib-header-actions` (lines **26–51**); header markup at lines **145–152**.

**Interfaces:**
- Consumes shared `.page-header*` classes. The page's other inline rules (`.lib-body`, `.lib-day-*`, `.lib-exercise-*`, `#library-region`) are unrelated and stay.

- [ ] **Step 1: Delete the inline header CSS.** In `exercise-library.html`, inside `<style>`, remove exactly lines **26–51**:

```css
    .lib-header {
      position: sticky;
      top: 0;
      z-index: 100;
      background: var(--bg-base);
      border-bottom: 1px solid var(--border-subtle);
      padding: var(--space-3) var(--space-4);
      padding-top: max(var(--space-3), env(safe-area-inset-top));
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2);
      min-height: var(--tap-min);
    }

    .lib-header-title {
      font-size: 0.9375rem;
      font-weight: 700;
      color: var(--text-primary);
    }

    .lib-header-actions {
      display: flex;
      gap: var(--space-2);
      flex-shrink: 0;
    }
```

Leave the surrounding `#library-region` (above) and `.lib-body` (below) rules intact.

- [ ] **Step 2: Replace the header markup.** In `exercise-library.html`, the current block (lines **145–152**) is:

```html
<div class="lib-header">
  <div class="lib-header-title">Exercise Library</div>
  <div class="lib-header-actions">
    <a href="records.html" class="btn btn-secondary btn-sm">Records</a>
    <a href="dashboard.html" class="btn btn-secondary btn-sm">Dashboard</a>
    <a href="index.html" class="btn btn-secondary btn-sm">Log Workout</a>
  </div>
</div>
```

Replace with:

```html
<div class="page-header">
  <a href="index.html" class="btn btn-icon btn-secondary page-header-back" aria-label="Back to logger">&larr;</a>
  <div class="page-header-title">Exercise Library</div>
  <div class="page-header-actions">
    <a href="records.html" class="btn btn-secondary">Records</a>
    <a href="dashboard.html" class="btn btn-secondary">Dashboard</a>
  </div>
</div>
```

- [ ] **Step 3: Local verification.** Reload `http://localhost:8000/exercise-library.html` at **320px**. "Exercise Library" is the longest title — confirm it ellipsizes/shrinks (never pushes the row wider than the viewport), ← stays fully visible top-left and returns to `index.html`, and "Records"/"Dashboard" wrap to a second row. Back button computed height **44px**; nav `.btn` computed height **≥44px**.

- [ ] **Step 4: Commit.**
```
git add exercise-library.html && git commit -m "feat(mobile): library shared page-header with back arrow"
```

---

### Task 2.5: Cross-breakpoint framing verification (320 / 360 / 375)

**Files:** none (manual verification only — there is no DOM test runner for CSS).

**Interfaces:** none.

- [ ] **Step 1: Serve locally.** From repo root: `python -m http.server 8000` (or `npx --yes serve -l 8000 .`).

- [ ] **Step 2: Run the matrix.** In Chrome DevTools device toolbar (Responsive), for each width **320px**, **360px**, **375px**, load each of `dashboard.html`, `records.html`, `exercise-library.html` (9 combinations). For every combination confirm:
  - The ← back-arrow button is fully on-screen (not clipped by the right/left edge) and returns to `index.html` when clicked.
  - No element in the header row is cut off horizontally; the page body does not scroll sideways (nav wraps to a second row when it can't fit).
  - The page title is readable (or cleanly ellipsized) and never overlaps the nav buttons.
- [ ] **Step 3: Tap-target spot check.** With DevTools element inspector, confirm the ← button renders at **44×44px** and each nav `.btn` renders at **≥44px** tall on all three pages (raised from the old 36px `.btn-sm`).
- [ ] **Step 4: Notch regression check.** In DevTools device mode pick a notch device (e.g. iPhone 14 Pro) and confirm the header's top padding still clears the status bar (safe-area rule untouched: `padding-top: max(var(--space-3), env(safe-area-inset-top))`).
- [ ] **Step 5: No commit** (verification only). If any check fails, the fix belongs in `.page-header*` (Task 1) — re-run this matrix after.

---

**Files touched by this section (absolute paths):**
- `C:/Users/Auckie/OneDrive/Documents/1 - Coding Projects/.claude/Projects/Internal/Fitness/Workout Tracker v2/Workout-Tracker-live/styles.css`
- `C:/Users/Auckie/OneDrive/Documents/1 - Coding Projects/.claude/Projects/Internal/Fitness/Workout Tracker v2/Workout-Tracker-live/dashboard.html`
- `C:/Users/Auckie/OneDrive/Documents/1 - Coding Projects/.claude/Projects/Internal/Fitness/Workout Tracker v2/Workout-Tracker-live/records.html`
- `C:/Users/Auckie/OneDrive/Documents/1 - Coding Projects/.claude/Projects/Internal/Fitness/Workout Tracker v2/Workout-Tracker-live/exercise-library.html`

**Cross-section notes for the assembler:** This section does not touch any `[data-day="…"]` color selectors in these files (`.day-detail-type`, `.records-day-heading`, `.lib-day-heading`, `.session-day-badge`, `.day-btn`) — those are owned by the Foundation/Manage `applyDayColor` work. It removes only dead shell rules and the three per-page header patterns, and adds no `core.js` interface. `.btn-sm` is intentionally retained (still consumed by resume banners and the records Recalculate button).


## Workstream 3 — Logger reorder + durable resume

_spec §5.2a_

### Task 3.1: Pure resume-order helpers in `core.js` (TDD)

**Files:**
- Modify `core.js` — add two pure functions inside the UMD IIFE (immediately above the `const api = {` line that Foundation creates) and register them in the exported `api` object.
- Create `tests/logger-order.test.js`.

**Interfaces:**
- Produces (new, non-contract pure helpers — allowed per SHARED CONTRACT "Pure ordering helpers (draft order build/merge) go in core.js"):
  - `dedupeOrder(names) -> string[]` — drops falsy/non-string/duplicate entries, preserving first-seen order.
  - `resumeRenderOrder(defaultNames, draft) -> string[]` — the authoritative render order for a resumed session draft.
- Consumes: nothing (pure).
- Draft shape consumed: `{ day, order:[name,...], exercises:{ '<name>':[{weight,reps,setLabel?}] } }` (SHARED CONTRACT localStorage draft shape).

Steps:

- [ ] **Step 1: Write the failing test file.** Create `tests/logger-order.test.js` with the complete literal code below. It requires `../core.js`, so it will FAIL until Step 3 adds the functions.

```js
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
```

- [ ] **Step 2: Run the test — expect FAIL.** From the repo root: `node --test tests/logger-order.test.js`. It must fail with a `require`/undefined-export error (functions not yet defined).

- [ ] **Step 3: Add the implementation to `core.js`.** Insert the two function declarations inside the UMD IIFE, immediately **above** the `const api = {` line (find it with `grep -n "const api = {" core.js`):

```js
/**
 * dedupeOrder(names) -> string[]
 * Normalizes a raw ordered list of exercise names: drops falsy/non-string
 * entries and duplicates, preserving first-seen order. Used to build the
 * durable draft 'order' array from DOM block order.
 */
function dedupeOrder(names) {
  const out = [];
  const seen = new Set();
  if (!Array.isArray(names)) return out;
  for (const n of names) {
    if (!n || typeof n !== 'string') continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/**
 * resumeRenderOrder(defaultNames, draft) -> string[]
 * Order in which exercise cards render when a saved session draft resumes.
 *  - No draft: the day's default order.
 *  - Draft with an explicit 'order' array (authoritative): that order,
 *    filtered to names still present in draft.exercises, then any draft
 *    exercises missing from a stale order appended (rescue).
 *  - Legacy draft without 'order': default order first (for names that
 *    have draft data), then added-but-non-default exercises appended.
 * Falls back to defaults when the computed order is empty (corrupt draft).
 */
function resumeRenderOrder(defaultNames, draft) {
  const defaults = dedupeOrder(defaultNames);
  if (!draft || typeof draft !== 'object') return defaults;

  const draftNames = (draft.exercises && typeof draft.exercises === 'object')
    ? Object.keys(draft.exercises)
    : [];
  const draftSet = new Set(draftNames);

  const savedOrder = Array.isArray(draft.order) ? dedupeOrder(draft.order) : null;
  const out = [];
  const seen = new Set();
  const push = (n) => { if (n && !seen.has(n)) { seen.add(n); out.push(n); } };

  if (savedOrder && savedOrder.length) {
    for (const n of savedOrder) if (draftSet.has(n)) push(n);
    for (const n of draftNames) push(n); // rescue any missing from a stale order
  } else {
    for (const n of defaults) if (draftSet.has(n)) push(n);
    for (const n of draftNames) push(n); // added-but-non-default exercises
  }

  return out.length ? out : defaults;
}
```

- [ ] **Step 4: Register the exports.** In the `const api = { … }` object literal in `core.js`, add `dedupeOrder,` and `resumeRenderOrder,` as members alongside the Foundation-registered functions (so both `module.exports` in Node and the `Object.assign(root, api)` browser attach expose them).

- [ ] **Step 5: Run the test — expect PASS.** `node --test tests/logger-order.test.js` — all 8 tests green.

- [ ] **Step 6: Commit.**
```
git add core.js tests/logger-order.test.js && git commit -m "feat(logger): pure resume-order helpers (dedupeOrder, resumeRenderOrder) + tests"
```

---

### Task 3.2: Persist explicit `order` array in the session draft

**Files:**
- Modify `app.js` — `serializeSessionForStorage` (lines 1003-1027).

**Interfaces:**
- Consumes: `dedupeOrder` (global from `core.js`, loaded before `app.js`).
- Produces: draft object now shaped `{ day, order:[name,...], exercises:{…} }` (SHARED CONTRACT draft shape). `order` mirrors DOM `.exercise-block` order.

Steps:

- [ ] **Step 1: Edit `serializeSessionForStorage`.** Current body (app.js:1003-1027) builds only `exercises`. Replace it to also collect and return `order`. Exact old block:

```js
function serializeSessionForStorage(sessionEntryEl, workoutDay) {
  const exercises = {};
  const blocks = sessionEntryEl.querySelectorAll('.exercise-block');

  for (const block of blocks) {
    const name = block.dataset.exercise;
    if (!name) continue;

    const setRows = block.querySelectorAll('.set-row');
    const sets = [];

    for (const row of setRows) {
      const weightInput = row.querySelector('.input-weight');
      const repsInput   = row.querySelector('.input-reps');
      sets.push({
        weight: weightInput ? weightInput.value : '',
        reps:   repsInput   ? repsInput.value   : ''
      });
    }

    exercises[name] = sets;
  }

  return { day: workoutDay, exercises: exercises };
}
```

New block:

```js
function serializeSessionForStorage(sessionEntryEl, workoutDay) {
  const exercises = {};
  const orderNames = [];
  const blocks = sessionEntryEl.querySelectorAll('.exercise-block');

  for (const block of blocks) {
    const name = block.dataset.exercise;
    if (!name) continue;

    orderNames.push(name);

    const setRows = block.querySelectorAll('.set-row');
    const sets = [];

    for (const row of setRows) {
      const weightInput = row.querySelector('.input-weight');
      const repsInput   = row.querySelector('.input-reps');
      sets.push({
        weight: weightInput ? weightInput.value : '',
        reps:   repsInput   ? repsInput.value   : ''
      });
    }

    exercises[name] = sets;
  }

  return { day: workoutDay, order: dedupeOrder(orderNames), exercises: exercises };
}
```

- [ ] **Step 2: Local manual verification.** Serve the app locally, start a Legs session, type into one set to trigger `handleInputChange`, then in DevTools console run `JSON.parse(localStorage.getItem('wt_session_Legs'))`. Confirm the object now has an `order` array whose entries equal the visible card order top-to-bottom, and that `Object.keys(...exercises)` matches the same names. (Depends on `core.js` being loaded before `app.js`; the Foundation section adds the `<script src="core.js">` tag.)

- [ ] **Step 3: Commit.**
```
git add app.js && git commit -m "feat(logger): persist explicit exercise order array in session draft"
```

---

### Task 3.3: Up/down move buttons in the logger card header

**Files:**
- Modify `index.html` — `buildExerciseCard` header actions (insert at line 681, between `headerActions.className = …` and the swap-dropdown comment at line 682); add `moveExerciseCard` + `refreshMoveButtonStates` after `handleRemoveExerciseCard` (after line 633); add `refreshMoveButtonStates()` calls in `buildExerciseList` (325-337), `addExerciseCardToToday` (590-611) and `handleRemoveExerciseCard` (619-633).
- Modify `styles.css` — add `.exercise-card-move` rules after the `.exercise-card-remove:hover` media block (after line 719).

**Interfaces:**
- Consumes: `handleInputChange()` (index.html:950) — called after every move so the durable draft (Task N+1) captures the new order.
- Produces: reordered `#exercise-list` DOM; disabled state on the first card's up-button and last card's down-button. Movement never crosses the `[data-role="add-exercise-control"]` trailing node (guaranteed by only swapping with siblings that carry the `.exercise-card` class).

Steps:

- [ ] **Step 1: Insert the move buttons in `buildExerciseCard`.** Anchor old block (index.html:679-682):

```js
  const headerActions = document.createElement('div');
  headerActions.className = 'exercise-card-header-actions';

  // Swap dropdown -- lists other exercises assigned to the current day
```

New block (adds the two buttons before the swap dropdown so reorder controls lead the header):

```js
  const headerActions = document.createElement('div');
  headerActions.className = 'exercise-card-header-actions';

  // Reorder controls -- move this exercise up/down within today's session.
  // Movement is session-local; it never touches exercises.json.
  const moveUpBtn = document.createElement('button');
  moveUpBtn.className = 'exercise-card-move exercise-card-move-up';
  moveUpBtn.type = 'button';
  moveUpBtn.setAttribute('aria-label', 'Move exercise up');
  moveUpBtn.textContent = '\u2191'; // up arrow
  moveUpBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    moveExerciseCard(card, 'up');
  });
  headerActions.appendChild(moveUpBtn);

  const moveDownBtn = document.createElement('button');
  moveDownBtn.className = 'exercise-card-move exercise-card-move-down';
  moveDownBtn.type = 'button';
  moveDownBtn.setAttribute('aria-label', 'Move exercise down');
  moveDownBtn.textContent = '\u2193'; // down arrow
  moveDownBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    moveExerciseCard(card, 'down');
  });
  headerActions.appendChild(moveDownBtn);

  // Swap dropdown -- lists other exercises assigned to the current day
```

- [ ] **Step 2: Add `moveExerciseCard` + `refreshMoveButtonStates`.** Anchor on the end of `handleRemoveExerciseCard` (index.html:619-633). Old block:

```js
function handleRemoveExerciseCard(card) {
  const list = document.getElementById('exercise-list');
  const remainingCards = list.querySelectorAll('.exercise-card').length;

  if (remainingCards <= 1) {
    showToast('At least one exercise is required');
    return;
  }

  const name = card.dataset.exercise;
  card.remove();
  refreshAddExerciseControl();
  handleInputChange();
  showToast(name + ' removed from today\u2019s session');
}
```

New block (adds `refreshMoveButtonStates()` inside remove, then defines the two new functions immediately after):

```js
function handleRemoveExerciseCard(card) {
  const list = document.getElementById('exercise-list');
  const remainingCards = list.querySelectorAll('.exercise-card').length;

  if (remainingCards <= 1) {
    showToast('At least one exercise is required');
    return;
  }

  const name = card.dataset.exercise;
  card.remove();
  refreshAddExerciseControl();
  refreshMoveButtonStates();
  handleInputChange();
  showToast(name + ' removed from today\u2019s session');
}

/**
 * moveExerciseCard(card, direction)
 * Reorders a card up/down within today's session by swapping it with its
 * adjacent .exercise-card sibling. Only swaps with a node that carries the
 * .exercise-card class, so a downward move can never cross the trailing
 * [data-role="add-exercise-control"] node. Session-local; persists via the
 * handleInputChange() autosave (draft order + CSV row order both follow DOM).
 */
function moveExerciseCard(card, direction) {
  const list = document.getElementById('exercise-list');
  if (direction === 'up') {
    const prev = card.previousElementSibling;
    if (prev && prev.classList.contains('exercise-card')) {
      list.insertBefore(card, prev);
    }
  } else {
    const next = card.nextElementSibling;
    if (next && next.classList.contains('exercise-card')) {
      list.insertBefore(next, card);
    }
  }
  refreshMoveButtonStates();
  handleInputChange();
}

/**
 * refreshMoveButtonStates()
 * Disables the up-button on the first card and the down-button on the last
 * card; enables the rest. Call after any structural change (build, add,
 * remove, move).
 */
function refreshMoveButtonStates() {
  const list = document.getElementById('exercise-list');
  const cards = list.querySelectorAll('.exercise-card');
  cards.forEach((card, i) => {
    const up = card.querySelector('.exercise-card-move-up');
    const down = card.querySelector('.exercise-card-move-down');
    if (up) up.disabled = (i === 0);
    if (down) down.disabled = (i === cards.length - 1);
  });
}
```

- [ ] **Step 3: Refresh disabled state after initial build.** In `buildExerciseList` (index.html:325-337), anchor old:

```js
  appendAddExerciseControl(list);

  recalcWorkoutLoad();
}
```

New:

```js
  appendAddExerciseControl(list);

  refreshMoveButtonStates();
  recalcWorkoutLoad();
}
```

- [ ] **Step 4: Refresh disabled state after an add.** In `addExerciseCardToToday` (index.html:590-611), anchor old:

```js
  refreshAddExerciseControl();
  handleInputChange();
  showToast(name + ' added to today\u2019s session');
```

New:

```js
  refreshAddExerciseControl();
  refreshMoveButtonStates();
  handleInputChange();
  showToast(name + ' added to today\u2019s session');
```

- [ ] **Step 5: Add the move-button CSS.** In `styles.css`, anchor old (the remove-button hover block, lines 714-719):

```css
@media (hover: hover) {
  .exercise-card-remove:hover {
    color: var(--color-error);
    background: rgba(240, 128, 128, 0.1);
  }
}
```

New (append the move-button rules; sized 32px to match the existing `.exercise-card-remove`/`.exercise-swap-select` header controls):

```css
@media (hover: hover) {
  .exercise-card-remove:hover {
    color: var(--color-error);
    background: rgba(240, 128, 128, 0.1);
  }
}

/* Reorder (up/down) buttons in the card header */
.exercise-card-move {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 0.9375rem;
  line-height: 1;
  cursor: pointer;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
  -webkit-tap-highlight-color: transparent;
}

.exercise-card-move:disabled {
  opacity: 0.3;
  cursor: default;
}

@media (hover: hover) {
  .exercise-card-move:not(:disabled):hover {
    color: var(--text-primary);
    background: var(--bg-panel);
  }
}
```

- [ ] **Step 6: Local manual verification.** Serve locally, start a Legs session with ≥3 default exercises. Confirm: (a) the first card's up-arrow is dimmed/disabled and the last card's down-arrow is dimmed/disabled; (b) clicking down on the top card swaps it below its neighbour and the disabled states update; (c) the bottom card's down-arrow does nothing (never jumps past the "+ Add exercise to today" row); (d) after a move, `JSON.parse(localStorage.getItem('wt_session_Legs')).order` reflects the new order, and `[...buildExercisesMapFromDOM(document.getElementById('exercise-list')).keys()]` (the exact source of CSV row order in `app.js:951`) matches it — proving the autosaved CSV row order follows the reorder with no change needed in `buildExercisesMapFromDOM`.

- [ ] **Step 7: Commit.**
```
git add index.html styles.css && git commit -m "feat(logger): up/down reorder buttons in exercise card header"
```

---

### Task 3.4: Durable resume — render in saved order and rescue added exercises

**Files:**
- Modify `index.html` — `buildExerciseList` (325-337, the `list.innerHTML = ''` + card loop region).

**Interfaces:**
- Consumes: `resumeRenderOrder` (global from `core.js`), `findExerciseDef(name)` (index.html:401, cross-library lookup), `buildExerciseCard(def, savedData)` (index.html:654).
- Produces: on resume, cards render in `savedData.order` and any added-but-non-default exercise (present in the draft, absent from the day defaults) is re-created so it survives reload. Non-resume start (`savedData === null`) is unchanged (default order).

Steps:

- [ ] **Step 1: Rewrite the `buildExerciseList` card loop.** Anchor old block (index.html:326-332):

```js
  const list = document.getElementById('exercise-list');
  list.innerHTML = '';

  for (const ex of exercises) {
    const card = buildExerciseCard(ex, savedData);
    list.appendChild(card);
  }
```

New block:

```js
  const list = document.getElementById('exercise-list');
  list.innerHTML = '';

  const defaultNames = exercises.map(e => e.name);
  const defByName = new Map(exercises.map(e => [e.name, e]));

  // On resume, render in the draft's saved order (authoritative) and rescue
  // added-but-non-default exercises; otherwise use the day's default order.
  const order = savedData ? resumeRenderOrder(defaultNames, savedData) : defaultNames;

  for (const name of order) {
    const def = defByName.get(name) || findExerciseDef(name) || { name: name, defaultSets: 3 };
    const card = buildExerciseCard(def, savedData);
    list.appendChild(card);
  }
```

(The `appendAddExerciseControl(list); refreshMoveButtonStates(); recalcWorkoutLoad();` tail added in Task N+2 remains unchanged below this block.)

- [ ] **Step 2: Local manual verification.** Serve locally. Start a Legs session; add a non-default exercise via "+ Add exercise to today" (e.g. Front Squat); reorder cards with the up/down buttons; type a set value so the draft autosaves. Reload the page and resume Legs. Confirm: (a) cards appear in exactly the reordered sequence, (b) the added Front Squat card is present with its entered values, (c) any default exercise you removed before reload stays gone, (d) with a *legacy* draft (delete the `order` key from `wt_session_Legs` in DevTools, then reload) resume still renders default order plus the extra exercise appended — no crash, no lost exercise.

- [ ] **Step 3: Confirm the pure helper still passes.** `node --test tests/logger-order.test.js` (state unchanged from Task N, but rerun to confirm no regression) — 8 tests green.

- [ ] **Step 4: Commit.**
```
git add index.html && git commit -m "feat(logger): durable resume renders saved order and restores added exercises"
```

---

**Section notes for the assembler:**
- `dedupeOrder` / `resumeRenderOrder` are new pure helpers this section adds to `core.js`; they are NOT contract functions and are consumed only here. The Foundation section owns `core.js` creation and the `<script src="core.js">` tag on `index.html` (this section's `index.html`/`app.js` code assumes `core.js` is loaded before `app.js`).
- No change is required to `buildExercisesMapFromDOM` (`app.js:951`): it already emits `.exercise-block` names in DOM order into an insertion-ordered `Map`, so reordering cards propagates to CSV row order automatically (verified in Task N+2 Step 6). The CSV write path itself is Foundation's `rebuildSessionRows`/`commitReplaceSession`.
- Task dependency order matters: N (helpers) → N+1 (serialize `order`) → N+2 (buttons; introduces `refreshMoveButtonStates`, which N's `buildExerciseList` edit calls) → N+3 (resume render). Building out of order leaves a call to an undefined function.


## Workstream 4 — Dashboard aggregation, sessions, edit-past-day

_spec §5.3, §5.2b_

## Section: Dashboard Aggregation + Sessions + Edit-Past-Day (spec §5.3, §5.2b)

**Boundary assumptions (named per "no silent choices"):**
1. Per the SHARED CONTRACT, the pure aggregation math — `combinedDayLoad`, `sessionsOnDate`, `calcExerciseLoad`, and the **corrected** `calcWeekLoad` (sum each date's raw set loads) — lives in `core.js`, implemented + `node --test`-covered by the **Foundation** section. This section **consumes** them and does **not** redefine or re-test them. This section therefore contains **no** `calcWeekLoad` edit; it depends on Foundation having relocated `calcWeekLoad`/`calcLoad`/`calcExerciseLoad`/`calcWorkoutLoad` **out of** `app.js` into `core.js` with **no shadowing duplicate left in `app.js`** (core.js loads before app.js, so a leftover app.js copy would win). If at integration time `app.js` still defines `calcWeekLoad` summing `row.totalWorkoutLoad`, that is a Foundation defect to fix there, not here.
2. `parseWorkoutCSV`/`serializeWorkoutCSV` (core.js, Foundation) replace `parseCSV`/`serializeCSV`. This section updates **dashboard.html's own** call site (it needs `sessionId`-bearing rows); Foundation owns app.js-internal renames.
3. Day colors come from the v2 model — the dashboard loads it (`getRawExercises` + `adaptExercisesModel`) into a `name→hex` map and applies via `applyDayColor` (Foundation, app.js), replacing the fixed `[data-day="…"]` CSS in dashboard.html.
4. This section owns: `app.js` `renderDayDetail` + dead-code removal, `dashboard.html` controller, `styles.css` detail classes, and `tests/dashboard-aggregation.test.js`.

---

### Task 4.1: Dashboard 2-session aggregation scenario test (pure, node --test)

Locks the exact §5.3 data contract the renderer consumes: one combined day total, two ordered session sub-groups, per-session subtotals, de-duplicated multi-type header, and a session-scoped reorder that leaves other sessions untouched.

**Files:**
- Create `tests/dashboard-aggregation.test.js`

**Interfaces:**
- Consumes (from `core.js`, Foundation): `combinedDayLoad(rows, dateStr)`, `sessionsOnDate(rows, dateStr) -> [{sessionId, workoutDay, rows}]`, `reorderSessionExercises(rows, sessionId, orderedExerciseNames[]) -> rows`
- Produces: no exports (test-only)

**Steps:**

- [ ] **Step 1: Write the failing test.** Create `tests/dashboard-aggregation.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { combinedDayLoad, sessionsOnDate, reorderSessionExercises } = require('../core.js');

// Minimal parsed-row factory matching parseWorkoutCSV's shape (load = weight*reps).
function row(date, day, exercise, setNumber, weight, reps, sessionId) {
  return {
    date, workoutDay: day, exercise, setNumber: String(setNumber),
    weight, reps, load: weight * reps,
    exerciseLoad: 0, totalWorkoutLoad: 0, sessionId
  };
}

const DATE = '2026-07-15';
const S1 = DATE + '-090000';   // Back, morning
const S2 = DATE + '-173000';   // Chest, evening
// Back:  800 + 600 + 1080 = 2480 ; Chest: 925 + 925 = 1850 ; day = 4330
const rows = [
  row(DATE, 'Back',  'Pull-up', 1, 100, 8, S1),
  row(DATE, 'Back',  'Pull-up', 2, 100, 6, S1),
  row(DATE, 'Back',  'BB Row',  1, 135, 8, S1),
  row(DATE, 'Chest', 'Bench',   1, 185, 5, S2),
  row(DATE, 'Chest', 'Bench',   2, 185, 5, S2),
];

test('combinedDayLoad sums raw set loads across both sessions', () => {
  assert.equal(combinedDayLoad(rows, DATE), 4330);
});

test('sessionsOnDate yields two ordered sub-groups', () => {
  const sessions = sessionsOnDate(rows, DATE);
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].sessionId, S1);
  assert.equal(sessions[0].workoutDay, 'Back');
  assert.equal(sessions[1].sessionId, S2);
  assert.equal(sessions[1].workoutDay, 'Chest');
});

test('per-session subtotal sums r.load within each session', () => {
  const sessions = sessionsOnDate(rows, DATE);
  const sub = s => s.rows.reduce((a, r) => a + r.load, 0);
  assert.equal(sub(sessions[0]), 2480);
  assert.equal(sub(sessions[1]), 1850);
});

test('de-duplicated multi-type header derives ["Back","Chest"]', () => {
  const sessions = sessionsOnDate(rows, DATE);
  const types = [];
  for (const s of sessions) if (types.indexOf(s.workoutDay) === -1) types.push(s.workoutDay);
  assert.deepEqual(types, ['Back', 'Chest']);
});

test('reorderSessionExercises reorders only the target session', () => {
  const out = reorderSessionExercises(rows, S1, ['BB Row', 'Pull-up']);
  const s1ex = [...new Set(out.filter(r => r.sessionId === S1).map(r => r.exercise))];
  assert.deepEqual(s1ex, ['BB Row', 'Pull-up']);           // S1 reordered
  const s2 = out.filter(r => r.sessionId === S2);
  assert.deepEqual(s2.map(r => r.setNumber), ['1', '2']);  // S2 untouched
  assert.equal(combinedDayLoad(out, DATE), 4330);          // totals invariant to order
});
```

- [ ] **Step 2: Run the test (gate on Foundation).** `node --test tests/dashboard-aggregation.test.js` — expected **PASS** against Foundation's `core.js`. A `Cannot find module '../core.js'` or missing-export failure is the integration gate proving Foundation must land first; a value mismatch is a Foundation math defect.
- [ ] **Step 3: Commit.** `git add tests/dashboard-aggregation.test.js && git commit -m "test(dashboard): 2-session day aggregation + session-scoped reorder scenario"`

---

### Task 4.2: Rewrite `renderDayDetail` for combined totals, session sub-groups, multi-type header, dynamic color, and edit-order rendering

**Files:**
- Modify `app.js` — replace the whole `renderDayDetail` function body (lines **706-774**).

**Interfaces:**
- Consumes: `sessionsOnDate`, `combinedDayLoad`, `calcWeekLoad` (core.js); `applyDayColor` (app.js, Foundation); `formatLoad`, `formatWeight`, `formatDisplayDate` (app.js)
- Produces: `renderDayDetail(containerEl, rows, dateStr, opts)` — new optional 4th arg `opts = { dayColors:{name→hex}, editSessionId:string|null, editOrder:string[]|null }` (all default-safe; sole caller is dashboard.html)

**Steps:**

- [ ] **Step 1: Replace `renderDayDetail` (app.js:706-774)** with the version below. It replaces `dayRows[0].totalWorkoutLoad` (old :716) with `combinedDayLoad`, replaces `sets[0].exerciseLoad` (old :738) with a summed subtotal, groups by `Session Id` via `sessionsOnDate`, renders a de-duplicated colored multi-type header, per-session labeled sub-groups (session type + subtotal shown when >1 session), an `Edit order` control per session, and up/down controls while editing:

```js
function renderDayDetail(containerEl, rows, dateStr, opts) {
  opts = opts || {};
  const dayColors     = opts.dayColors || {};
  const editSessionId = opts.editSessionId || null;
  const editOrder     = opts.editOrder || null;

  const sessions = sessionsOnDate(rows, dateStr);
  if (sessions.length === 0) {
    containerEl.innerHTML = '<div class="empty-state">No workout logged for this date.</div>';
    return;
  }

  const displayDate = formatDisplayDate(dateStr);
  const dayTotal    = combinedDayLoad(rows, dateStr);
  const weekLoad    = calcWeekLoad(rows, dateStr);
  const multi       = sessions.length > 1;

  // Ordered, de-duplicated workout-day names for the combined header.
  const dayTypes = [];
  for (const s of sessions) if (dayTypes.indexOf(s.workoutDay) === -1) dayTypes.push(s.workoutDay);

  const colorAttr = name => (dayColors[name] ? ' data-day-color="' + dayColors[name] + '"' : '');

  let html = '<div class="day-detail">';

  // Combined day header: colored multi-type chips + date.
  html += '<div class="day-detail-header"><div class="day-detail-type">';
  html += dayTypes.map(name => '<span class="day-type-chip"' + colorAttr(name) + '>' + name + '</span>')
                  .join('<span class="day-type-sep"> + </span>');
  html += '</div><div class="day-detail-date">' + displayDate + '</div></div>';

  // Sessions.
  for (const session of sessions) {
    const editing = session.sessionId === editSessionId;

    // Group this session's rows by exercise, preserving first-seen order; sort sets.
    const exMap = new Map();
    for (const r of session.rows) {
      if (!exMap.has(r.exercise)) exMap.set(r.exercise, []);
      exMap.get(r.exercise).push(r);
    }
    for (const setsArr of exMap.values()) {
      setsArr.sort((a, b) => String(a.setNumber).localeCompare(String(b.setNumber), undefined, { numeric: true }));
    }

    // Display order: live edit-preview order when editing, else natural row order.
    let exNames = [...exMap.keys()];
    if (editing && editOrder) {
      const known = editOrder.filter(n => exMap.has(n));
      exNames = known.concat(exNames.filter(n => known.indexOf(n) === -1));
    }

    const sessionSubtotal = session.rows.reduce((s, r) => s + r.load, 0);

    html += '<div class="detail-session" data-session-id="' + session.sessionId + '">';
    html += '<div class="detail-session-header">';
    if (multi) {
      html += '<span class="detail-session-type"' + colorAttr(session.workoutDay) + '>' + session.workoutDay + '</span>';
      html += '<span class="detail-session-subtotal">' + formatLoad(sessionSubtotal) + '</span>';
    }
    if (editing) {
      html += '<span class="edit-order-actions">' +
        '<button class="btn btn-secondary btn-sm edit-order-cancel" data-session-id="' + session.sessionId + '">Cancel</button>' +
        '<button class="btn btn-primary btn-sm edit-order-save" data-session-id="' + session.sessionId + '">Save order</button>' +
        '</span>';
    } else {
      html += '<button class="btn btn-secondary btn-sm session-edit-btn" data-session-id="' + session.sessionId + '">Edit order</button>';
    }
    html += '</div>';

    exNames.forEach((exerciseName, idx) => {
      const sets       = exMap.get(exerciseName);
      const exSubtotal = sets.reduce((s, r) => s + r.load, 0);
      const totalReps  = sets.reduce((s, r) => s + r.reps, 0);

      html += '<div class="detail-exercise"><div class="detail-exercise-head">';
      html += '<div class="detail-exercise-name">' + exerciseName + '</div>';
      if (editing) {
        const up   = idx === 0 ? ' disabled' : '';
        const down = idx === exNames.length - 1 ? ' disabled' : '';
        html += '<span class="ex-reorder">' +
          '<button class="ex-move ex-up" data-ex="' + encodeURIComponent(exerciseName) + '"' + up + ' aria-label="Move up">&uarr;</button>' +
          '<button class="ex-move ex-down" data-ex="' + encodeURIComponent(exerciseName) + '"' + down + ' aria-label="Move down">&darr;</button>' +
          '</span>';
      }
      html += '</div>';

      html += '<div class="detail-set-row header-row"><span>Set</span><span>Weight</span><span>Reps</span><span>Load</span></div>';
      for (const set of sets) {
        html += '<div class="detail-set-row">' +
          '<span class="set-col mono">' + set.setNumber + '</span>' +
          '<span class="mono">' + formatWeight(set.weight) + ' lb</span>' +
          '<span class="mono">' + set.reps + '</span>' +
          '<span class="vol-col mono">' + formatLoad(set.load) + '</span>' +
          '</div>';
      }
      html += '<div class="detail-exercise-subtotal">' +
        '<span>' + sets.length + ' sets \u00b7 ' + totalReps + ' reps</span>' +
        '<span class="vol">' + formatLoad(exSubtotal) + '</span>' +
        '</div></div>';
    });

    html += '</div>'; // .detail-session
  }

  html += '<div class="session-total-bar"><span class="label-text">Day total</span>' +
          '<span class="total-num">' + formatLoad(dayTotal) + '</span></div>';
  html += '<div class="session-total-bar week-load-bar"><span class="label-text">Week load</span>' +
          '<span class="total-num">' + formatLoad(weekLoad) + '</span></div>';
  html += '</div>'; // .day-detail

  containerEl.innerHTML = html;

  // Apply dynamic day colors via the shared helper (replaces fixed [data-day] CSS).
  containerEl.querySelectorAll('[data-day-color]')
    .forEach(el => applyDayColor(el, el.getAttribute('data-day-color')));
}
```

- [ ] **Step 2: Local render verification** is performed at the end of the controller task (Task N: dashboard wiring), where `opts` is supplied. Standalone sanity: in DevTools on the dashboard, `renderDayDetail(document.getElementById('detail-region'), dash.rows, dash.currentDate)` (no opts) must still render a single-session day with a "Day total" bar and an "Edit order" button and throw nothing.
- [ ] **Step 3: Commit.** `git add app.js && git commit -m "feat(dashboard): combined day total, session sub-groups, multi-type header, edit-order render"`

---

### Task 4.3: Remove dead code made unreachable by the aggregation rewrite

`getSessionsOnDate` (app.js) loses its only caller once `renderDayDetail` switches to `sessionsOnDate`; `formatVolume` and `groupByDate` are already unreferenced. Verified by repo-wide grep: `formatVolume` — only definition at app.js:694; `groupByDate` — only definition at app.js:279; `getSessionsOnDate` — definition at app.js:288 and the single use at app.js:707 (removed in the previous task). No HTML page references any of the three.

**Files:**
- Modify `app.js` — delete `groupByDate` (279-286), `getSessionsOnDate` (288-290), `formatVolume` (694-696).

**Steps:**

- [ ] **Step 1: Re-confirm zero references** after the render rewrite: `git grep -nE "formatVolume|groupByDate|getSessionsOnDate" -- '*.js' '*.html'` must show only the three definition lines in `app.js` (and this plan doc). Any other hit blocks deletion.
- [ ] **Step 2: Delete `groupByDate`** — remove exactly:

```js
function groupByDate(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.date)) map.set(row.date, []);
    map.get(row.date).push(row);
  }
  return new Map([...map.entries()].sort((a, b) => b[0].localeCompare(a[0])));
}
```

- [ ] **Step 3: Delete `getSessionsOnDate`** — remove exactly:

```js
function getSessionsOnDate(rows, dateStr) {
  return rows.filter(r => r.date === dateStr);
}
```

- [ ] **Step 4: Delete `formatVolume`** — remove exactly:

```js
function formatVolume(n) {
  return Math.round(n).toLocaleString('en-US');
}
```

- [ ] **Step 5: Verify nothing broke** — `node --test` (whole suite) passes, and `git grep -nE "formatVolume|groupByDate|getSessionsOnDate" -- '*.js' '*.html'` now returns nothing.
- [ ] **Step 6: Commit.** `git add app.js && git commit -m "chore(dashboard): drop dead formatVolume/groupByDate/getSessionsOnDate"`

---

### Task 4.4: Wire the dashboard controller — model/color load, session-aware rows, edit-order interaction + session-keyed commit

**Files:**
- Modify `dashboard.html`: remove `[data-day]` CSS (55-60); extend `dash` state (184-191); `loadData` + new `loadDayColors` (242-254); `renderDetail` (311-325); add a `#detail-region` click listener in `DOMContentLoaded` (near 211-213); add edit-order handlers + `commitEditOrder`.

**Interfaces:**
- Consumes: `parseWorkoutCSV`, `serializeWorkoutCSV`, `sessionsOnDate`, `reorderSessionExercises`, `adaptExercisesModel` (core.js); `getRawCSV`, `getRawExercises`, `replaceCSVContent`, `getDatesWithData`, `showToast` (app.js); `renderDayDetail(containerEl, rows, dateStr, opts)` (Task above)
- Produces: dashboard-local `loadDayColors`, `onDetailClick`, `enterEditOrder`, `moveExercise`, `commitEditOrder`

**Steps:**

- [ ] **Step 1: Remove the fixed day-color CSS block** in the dashboard `<style>` (lines **55-60**) — delete exactly (colors now come from `applyDayColor` / `var(--day-color)`):

```css
    /* Workout-day type color in detail header */
    .day-detail-type[data-day="Legs"]      { color: var(--day-legs); }
    .day-detail-type[data-day="Chest"]     { color: var(--day-chest); }
    .day-detail-type[data-day="Back"]      { color: var(--day-back); }
    .day-detail-type[data-day="Shoulders"] { color: var(--day-shoulders); }
    .day-detail-type[data-day="Arms"]      { color: var(--day-arms); }
```

- [ ] **Step 2: Extend `dash` state** (lines 184-191) — add three fields after `loaded: false`:

```js
const dash = {
  currentDate:  todayISO(),
  calYear:      0,
  calMonth:     0,
  rows:         [],
  datesWithData: new Set(),
  loaded:       false,
  dayColors:    {},        // { '<workout day name>': '#hex' } from v2 model
  editSessionId: null,     // session currently being reordered, or null
  editOrder:    null       // string[] preview order while editing
};
```

- [ ] **Step 3: Session-aware load + colors.** Replace `loadData` (242-254) and add `loadDayColors`:

```js
async function loadData() {
  setDetailLoading(true);
  try {
    const [rawCSV, dayColors] = await Promise.all([getRawCSV(), loadDayColors()]);
    dash.rows          = parseWorkoutCSV(rawCSV);
    dash.dayColors     = dayColors;
    dash.datesWithData = getDatesWithData(dash.rows);
    dash.loaded        = true;
    renderDetail();
  } catch (e) {
    setDetailError(e.message);
  }
}

// Day colors are optional chrome; a failed/absent model degrades to default text color.
async function loadDayColors() {
  try {
    const model = adaptExercisesModel(JSON.parse(await getRawExercises()));
    const map = {};
    for (const d of model.days) map[d.name] = d.color;
    return map;
  } catch (e) {
    return {};
  }
}
```

- [ ] **Step 4: Pass render options + drop the old color post-pass.** Replace `renderDetail` (311-325) with:

```js
/* ── Render day detail ────────────────────────────────────────── */
function renderDetail() {
  renderDayDetail(document.getElementById('detail-region'), dash.rows, dash.currentDate, {
    dayColors:     dash.dayColors,
    editSessionId: dash.editSessionId,
    editOrder:     dash.editOrder
  });
}
```

- [ ] **Step 5: Register the delegated click handler.** In `DOMContentLoaded`, immediately after the date-nav wiring (after line 213 `...addEventListener('click', openCalendar);`), add:

```js
  // Edit-order interactions (delegated; survives innerHTML re-renders)
  document.getElementById('detail-region').addEventListener('click', onDetailClick);
```

- [ ] **Step 6: Add the edit-order handlers.** Insert after `renderDetail` (before the "Calendar open/close" section):

```js
/* ── Edit past-day session order ──────────────────────────────── */
function onDetailClick(e) {
  const editBtn = e.target.closest('.session-edit-btn');
  if (editBtn) { enterEditOrder(editBtn.dataset.sessionId); return; }

  if (e.target.closest('.edit-order-cancel')) {
    dash.editSessionId = null; dash.editOrder = null; renderDetail(); return;
  }
  if (e.target.closest('.edit-order-save')) { commitEditOrder(); return; }

  const moveBtn = e.target.closest('.ex-move');
  if (moveBtn && !moveBtn.disabled) {
    moveExercise(decodeURIComponent(moveBtn.dataset.ex), moveBtn.classList.contains('ex-up') ? -1 : 1);
  }
}

function enterEditOrder(sessionId) {
  const session = sessionsOnDate(dash.rows, dash.currentDate).find(s => s.sessionId === sessionId);
  if (!session) return;
  const order = [];
  for (const r of session.rows) if (order.indexOf(r.exercise) === -1) order.push(r.exercise);
  dash.editSessionId = sessionId;
  dash.editOrder = order;
  renderDetail();
}

function moveExercise(name, delta) {
  const o = dash.editOrder;
  const i = o.indexOf(name), j = i + delta;
  if (i < 0 || j < 0 || j >= o.length) return;
  [o[i], o[j]] = [o[j], o[i]];
  renderDetail();
}

async function commitEditOrder() {
  const sessionId = dash.editSessionId;
  const order = dash.editOrder ? dash.editOrder.slice() : null;
  if (!sessionId || !order) return;
  try {
    showToast('Saving order\u2026');
    // Re-read fresh so the session-keyed rewrite never clobbers a concurrent edit.
    const fresh     = parseWorkoutCSV(await getRawCSV());
    const reordered = reorderSessionExercises(fresh, sessionId, order);
    await replaceCSVContent(serializeWorkoutCSV(reordered), 'Reorder exercises \u2014 ' + dash.currentDate);
    dash.rows          = reordered;
    dash.datesWithData = getDatesWithData(dash.rows);
    dash.editSessionId = null;
    dash.editOrder     = null;
    renderDetail();
    showToast('Order saved', 'success');
  } catch (e) {
    showToast('Save failed: ' + e.message, 'error');
  }
}
```

- [ ] **Step 7: Offline end-to-end verification (never touches live data).** Start a local static server (`python -m http.server 8080` from the repo root) and open `http://localhost:8080/dashboard.html`. In DevTools console, stub the data layer and drive the flow:

```js
getRawCSV = async () => `Date,Workout Day,Exercise,Set Number,Weight,Reps,Load,Exercise Load,Total Workout Load,Session Id
2026-07-15,Back,Pull-up,1,100,8,800,1400,2480,2026-07-15-090000
2026-07-15,Back,Pull-up,2,100,6,600,1400,2480,2026-07-15-090000
2026-07-15,Back,BB Row,1,135,8,1080,1080,2480,2026-07-15-090000
2026-07-15,Chest,Bench,1,185,5,925,1850,1850,2026-07-15-173000
2026-07-15,Chest,Bench,2,185,5,925,1850,1850,2026-07-15-173000`;
getRawExercises = async () => JSON.stringify({version:2,days:[
  {id:'back', name:'Back',  color:'#38bdf8', exercises:[]},
  {id:'chest',name:'Chest', color:'#fb923c', exercises:[]}]});
let CAPTURED = null;
replaceCSVContent = async (text) => { CAPTURED = text; return {}; };  // capture, no network
dash.currentDate = '2026-07-15';
await loadData();
```

  Confirm on screen: (a) header shows **Back + Chest** as two colored chips (blue + orange); (b) **two** session sub-groups, each with its own subtotal (**2,480** / **1,850**) and an **Edit order** button; (c) exactly **one** bottom **Day total** bar = **4,330**, plus the Week load bar. Then tap **Edit order** on the Back session, press **↓** on Pull-up, press **Save order**, and run `console.log(CAPTURED)` — the captured CSV's Back block must list `BB Row` before `Pull-up`, the Chest rows must be byte-identical to the fixture, and no network request is made.
- [ ] **Step 8: Commit.** `git add dashboard.html && git commit -m "feat(dashboard): dynamic day colors, session sub-groups, edit-past-day reorder commit"`

---

### Task 4.5: Session sub-group + reorder-control styles

**Files:**
- Modify `styles.css` — insert after the `.week-load-bar .total-num { … }` rule (ends line **1284**), before the `/* ── Calendar Popup ── */` comment (1287).

**Interfaces:** consumes existing tokens `--day-color` (set by `applyDayColor`), `--color-volume`, `--bg-panel`, `--bg-card`, `--border-subtle`, `--text-muted`, `--text-secondary`, `--text-primary`, `--font-mono`, `--radius-md`, `--tap-min`, `--space-*`.

**Steps:**

- [ ] **Step 1: Add the new rules** (insert at line 1285):

```css

/* ── Dashboard: multi-type header + session sub-groups ─────────── */
.day-type-chip { color: var(--day-color, var(--text-primary)); }
.day-type-sep  { color: var(--text-muted); font-weight: 600; }

.detail-session {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.detail-session-header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.detail-session-type {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--day-color, var(--text-primary));
}

.detail-session-subtotal {
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  color: var(--color-volume);
}

/* Push the Edit-order / Cancel+Save controls to the trailing edge. */
.session-edit-btn,
.edit-order-actions { margin-left: auto; }
.edit-order-actions { display: flex; gap: var(--space-2); }

/* Exercise header row carries the reorder controls while editing. */
.detail-exercise-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.ex-reorder { display: inline-flex; gap: var(--space-1); }

.ex-move {
  width: var(--tap-min);
  height: var(--tap-min);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-panel);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: 1rem;
  cursor: pointer;
}

.ex-move:disabled { opacity: 0.35; cursor: default; }
.ex-move:active:not(:disabled) { background: var(--bg-card); }
```

- [ ] **Step 2: Visual verification at 320/375px.** Re-run the Step 7 fixture from the controller task with the browser narrowed to 320px and 375px: the `Back + Chest` chips and each session's `[type] [subtotal] [Edit order]` header must stay on one row without clipping; in edit mode each exercise shows ↑/↓ buttons at the 44px tap size, the first row's ↑ and last row's ↓ are visibly disabled (35% opacity), and Cancel/Save sit at the trailing edge.
- [ ] **Step 3: Commit.** `git add styles.css && git commit -m "style(dashboard): session sub-group + reorder-control styling"`

---

**Sequencing within this section:** Test → `renderDayDetail` rewrite → dead-code removal → controller wiring → CSS. The section as a whole consumes Foundation (`core.js` + `applyDayColor` + session-id-bearing CSV) and must land after it. Files touched: `app.js`, `dashboard.html`, `styles.css`, `tests/dashboard-aggregation.test.js` (all absolute under `C:/Users/Auckie/OneDrive/Documents/1 - Coding Projects/.claude/Projects/Internal/Fitness/Workout Tracker v2/Workout-Tracker-live/`).


## Workstream 5 — Manage page: day + exercise CRUD + dynamic days

_spec §5.1, §5.2c_

> **Section: Manage page — day + exercise CRUD + dynamic days (spec §5.1).**
> **Depends on the Foundation section** (core.js must already exist with `adaptExercisesModel`, `serializeExercisesModel`, `slugifyDayId`, `parseWorkoutCSV`, `serializeWorkoutCSV`, `renameDayInRows`, and `applyDayColor` in app.js). Every function below either lives in a new pure block of core.js or consumes those contract functions — none of them is redefined here.

---

### Task 5.1: Day-level model CRUD in core.js (pure)

**Files:**
- Create `tests/manage-day-model.test.js`
- Modify `core.js` — insert new function declarations inside the UMD IIFE immediately **before** the `const api = {` line, and add the new names to the `api` object literal.

**Interfaces:**
- Consumes: `slugifyDayId(name, takenIds[])` (Foundation, same IIFE scope).
- Produces (all pure, return a new v2 model, never mutate input):
  - `cloneExercisesModel(model)` → deep copy of the v2 model.
  - `addDay(model, name, color)` → append `{id, name, color, exercises:[]}`; `id = slugifyDayId(name, existingIds)`; palette color if `color` falsy; throws on blank / case-insensitive duplicate day name.
  - `renameDay(model, dayId, newName)` → change only `name`; keep `id`+`exercises`; throws on blank / duplicate / unknown.
  - `removeDay(model, dayId)` → drop the day; throws on unknown.
  - `moveDay(model, dayId, delta)` → reorder by `delta` (−1 up / +1 down), clamped no-op at bounds.
  - `setDayColor(model, dayId, hex)` → set `color`; throws on non-`#rrggbb` / unknown.
  - `diffDayRenames(originalModel, currentModel)` → `[{oldName,newName}]` for days matched by `id` whose `name` changed.

- [ ] **Step 1: Write the failing test.** Create `tests/manage-day-model.test.js`:

```js
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
```

- [ ] **Step 2: Run — expect FAIL.** `node --test tests/manage-day-model.test.js` (fails: `core.addDay` is not a function).

- [ ] **Step 3: Minimal implementation.** In `core.js`, inside the UMD IIFE, immediately before the `const api = {` line, insert:

```js
var MANAGE_DAY_PALETTE = ['#c084fc', '#fb923c', '#38bdf8', '#facc15', '#f472b6', '#4ade80', '#f87171', '#a3a3a3'];

function cloneExercisesModel(model) {
  return {
    version: 2,
    days: (model.days || []).map(function (d) {
      return {
        id: d.id,
        name: d.name,
        color: d.color,
        exercises: (d.exercises || []).map(function (e) {
          return { name: e.name, defaultSets: e.defaultSets };
        })
      };
    })
  };
}

function _findDayIndex(model, dayId) {
  return (model.days || []).findIndex(function (d) { return d.id === dayId; });
}

function addDay(model, name, color) {
  var clean = (name || '').trim();
  if (!clean) throw new Error('Day name is required');
  var dup = (model.days || []).some(function (d) {
    return d.name.toLowerCase() === clean.toLowerCase();
  });
  if (dup) throw new Error('A day named "' + clean + '" already exists');
  var next = cloneExercisesModel(model);
  var takenIds = next.days.map(function (d) { return d.id; });
  var hex = (color || '').trim() || MANAGE_DAY_PALETTE[next.days.length % MANAGE_DAY_PALETTE.length];
  next.days.push({ id: slugifyDayId(clean, takenIds), name: clean, color: hex, exercises: [] });
  return next;
}

function renameDay(model, dayId, newName) {
  var clean = (newName || '').trim();
  if (!clean) throw new Error('Day name is required');
  var idx = _findDayIndex(model, dayId);
  if (idx === -1) throw new Error('Unknown day: ' + dayId);
  var dup = (model.days || []).some(function (d) {
    return d.id !== dayId && d.name.toLowerCase() === clean.toLowerCase();
  });
  if (dup) throw new Error('A day named "' + clean + '" already exists');
  var next = cloneExercisesModel(model);
  next.days[idx].name = clean;
  return next;
}

function removeDay(model, dayId) {
  var idx = _findDayIndex(model, dayId);
  if (idx === -1) throw new Error('Unknown day: ' + dayId);
  var next = cloneExercisesModel(model);
  next.days.splice(idx, 1);
  return next;
}

function moveDay(model, dayId, delta) {
  var idx = _findDayIndex(model, dayId);
  if (idx === -1) throw new Error('Unknown day: ' + dayId);
  var next = cloneExercisesModel(model);
  var target = idx + delta;
  if (target < 0 || target >= next.days.length) return next;
  var moved = next.days.splice(idx, 1)[0];
  next.days.splice(target, 0, moved);
  return next;
}

function setDayColor(model, dayId, hex) {
  var idx = _findDayIndex(model, dayId);
  if (idx === -1) throw new Error('Unknown day: ' + dayId);
  var clean = (hex || '').trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(clean)) throw new Error('Color must be a #rrggbb hex value');
  var next = cloneExercisesModel(model);
  next.days[idx].color = clean;
  return next;
}

function diffDayRenames(originalModel, currentModel) {
  var out = [];
  var origById = {};
  (originalModel.days || []).forEach(function (d) { origById[d.id] = d.name; });
  (currentModel.days || []).forEach(function (d) {
    var was = origById[d.id];
    if (was !== undefined && was !== d.name) out.push({ oldName: was, newName: d.name });
  });
  return out;
}
```

Then add these keys to the `api` object literal in core.js: `cloneExercisesModel, addDay, renameDay, removeDay, moveDay, setDayColor, diffDayRenames`.

- [ ] **Step 4: Run — expect PASS.** `node --test tests/manage-day-model.test.js`.

- [ ] **Step 5: Commit.**
```
git add core.js tests/manage-day-model.test.js && git commit -m "feat(core): day-level v2 model CRUD (add/rename/remove/move/recolor/diff)"
```

---

### Task 5.2: Exercise-level model CRUD in core.js (pure)

**Files:**
- Create `tests/manage-exercise-model.test.js`
- Modify `core.js` — insert function declarations before `const api = {` (after the Task-N day block) and add names to the `api` object.

**Interfaces:**
- Consumes: `cloneExercisesModel`, `_findDayIndex` (defined in the previous task, same IIFE scope).
- Produces (pure, return new model):
  - `addExercise(model, dayId, name, defaultSets)` → append `{name, defaultSets}`; case-insensitive dup guard **within the day only**; throws on blank name / sets `<1` / unknown day / duplicate.
  - `renameExercise(model, dayId, oldName, newName)` → rename in place; dup guard; throws on blank / unknown exercise / duplicate.
  - `removeExercise(model, dayId, name)` → remove by exact name.
  - `moveExercise(model, dayId, name, delta)` → reorder within the day, clamped.
  - `setDefaultSets(model, dayId, name, defaultSets)` → set `defaultSets` (int ≥1); throws on invalid / unknown.

- [ ] **Step 1: Write the failing test.** Create `tests/manage-exercise-model.test.js`:

```js
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
```

- [ ] **Step 2: Run — expect FAIL.** `node --test tests/manage-exercise-model.test.js`.

- [ ] **Step 3: Minimal implementation.** In `core.js`, before `const api = {` (after the Task-N day block), insert:

```js
function _requireDay(model, dayId) {
  var idx = _findDayIndex(model, dayId);
  if (idx === -1) throw new Error('Unknown day: ' + dayId);
  return idx;
}

function _normalizeSets(defaultSets) {
  var n = parseInt(defaultSets, 10);
  if (isNaN(n) || n < 1) throw new Error('Default sets must be a positive whole number');
  return n;
}

function addExercise(model, dayId, name, defaultSets) {
  var idx = _requireDay(model, dayId);
  var clean = (name || '').trim();
  if (!clean) throw new Error('Exercise name is required');
  var sets = _normalizeSets(defaultSets);
  var dup = model.days[idx].exercises.some(function (e) {
    return e.name.toLowerCase() === clean.toLowerCase();
  });
  if (dup) throw new Error('"' + clean + '" already exists under ' + model.days[idx].name);
  var next = cloneExercisesModel(model);
  next.days[idx].exercises.push({ name: clean, defaultSets: sets });
  return next;
}

function renameExercise(model, dayId, oldName, newName) {
  var idx = _requireDay(model, dayId);
  var clean = (newName || '').trim();
  if (!clean) throw new Error('Exercise name is required');
  var exs = model.days[idx].exercises;
  var pos = exs.findIndex(function (e) { return e.name === oldName; });
  if (pos === -1) throw new Error('Unknown exercise: ' + oldName);
  var dup = exs.some(function (e, i) {
    return i !== pos && e.name.toLowerCase() === clean.toLowerCase();
  });
  if (dup) throw new Error('"' + clean + '" already exists under ' + model.days[idx].name);
  var next = cloneExercisesModel(model);
  next.days[idx].exercises[pos].name = clean;
  return next;
}

function removeExercise(model, dayId, name) {
  var idx = _requireDay(model, dayId);
  var next = cloneExercisesModel(model);
  next.days[idx].exercises = next.days[idx].exercises.filter(function (e) {
    return e.name !== name;
  });
  return next;
}

function moveExercise(model, dayId, name, delta) {
  var idx = _requireDay(model, dayId);
  var pos = model.days[idx].exercises.findIndex(function (e) { return e.name === name; });
  if (pos === -1) throw new Error('Unknown exercise: ' + name);
  var next = cloneExercisesModel(model);
  var target = pos + delta;
  if (target < 0 || target >= next.days[idx].exercises.length) return next;
  var moved = next.days[idx].exercises.splice(pos, 1)[0];
  next.days[idx].exercises.splice(target, 0, moved);
  return next;
}

function setDefaultSets(model, dayId, name, defaultSets) {
  var idx = _requireDay(model, dayId);
  var sets = _normalizeSets(defaultSets);
  var pos = model.days[idx].exercises.findIndex(function (e) { return e.name === name; });
  if (pos === -1) throw new Error('Unknown exercise: ' + name);
  var next = cloneExercisesModel(model);
  next.days[idx].exercises[pos].defaultSets = sets;
  return next;
}
```

Then add to the `api` object: `addExercise, renameExercise, removeExercise, moveExercise, setDefaultSets`.

- [ ] **Step 4: Run — expect PASS.** `node --test tests/manage-exercise-model.test.js`.

- [ ] **Step 5: Commit.**
```
git add core.js tests/manage-exercise-model.test.js && git commit -m "feat(core): exercise-level v2 model CRUD (add/rename/remove/move/sets)"
```

---

### Task 5.3: Rebuild `exercise-library.html` into the Manage page (DOM)

**Files:**
- Modify `exercise-library.html`:
  - Delete the dead day-color rules at lines **115–119** (`.lib-day-heading[data-day="…"]`).
  - Insert the `.mng-*` CSS block just before `</style>` (line **141**).
  - Change the header title text at line **146** from `Exercise Library` to `Manage`.
  - Insert `<script src="core.js"></script>` before `<script src="app.js"></script>` (between lines **161–162**).
  - Replace the entire inline `<script> … </script>` block (lines **163–306**) with the new Manage script below.

**Interfaces:**
- Consumes: `adaptExercisesModel(raw)`, `serializeExercisesModel(model)`, `diffDayRenames`, all model-CRUD functions from the two tasks above, `parseWorkoutCSV`, `serializeWorkoutCSV`, `renameDayInRows` (all core.js); `applyDayColor(el, hex)`, `getRawExercises`, `replaceExercisesContent`, `getCSVFile`, `putToWorker`, `showToast` (all app.js).
- Produces: an in-memory v2 model edited entirely client-side; one **Save** → `replaceExercisesContent(model, …)` (which serializes to 2-space JSON, identical to `serializeExercisesModel`), plus an optional second commit that rewrites `workout_tracker.csv` day names via `renameDayInRows`. Each commit is SHA-guarded with one 409 retry.

- [ ] **Step 1: Delete the dead heading rules.** Remove lines **115–119** of `exercise-library.html`:

```css
    .lib-day-heading[data-day="Legs"]      { color: var(--day-legs); }
    .lib-day-heading[data-day="Chest"]     { color: var(--day-chest); }
    .lib-day-heading[data-day="Back"]      { color: var(--day-back); }
    .lib-day-heading[data-day="Shoulders"] { color: var(--day-shoulders); }
    .lib-day-heading[data-day="Arms"]      { color: var(--day-arms); }
```

- [ ] **Step 2: Add the Manage CSS.** Immediately before `</style>` (line **141**), insert:

```css
    .mng-body { padding: var(--space-4) var(--space-4) var(--space-10); display:flex; flex-direction:column; gap: var(--space-4); }
    .mng-savebar { position: sticky; top: 0; z-index: 5; display:flex; align-items:center; gap: var(--space-3); padding: var(--space-2) 0; background: var(--bg-base); }
    .mng-rename-opt { font-size: 0.75rem; color: var(--text-secondary); display:flex; gap: var(--space-2); align-items:flex-start; line-height:1.4; }
    .mng-day-card { background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: var(--space-3); display:flex; flex-direction:column; gap: var(--space-3); }
    .mng-day-head { display:flex; align-items:center; gap: var(--space-2); }
    .mng-day-dot { width:12px; height:12px; border-radius:50%; flex-shrink:0; background: var(--day-color, var(--text-muted)); }
    .mng-day-name { flex:1; min-width:0; font-weight:700; color: var(--day-color, var(--text-primary)); }
    .mng-day-ops { display:flex; align-items:center; gap: var(--space-1); flex-shrink:0; }
    .mng-swatches { display:flex; flex-wrap:wrap; gap: var(--space-2); }
    .mng-swatch { width:24px; height:24px; border-radius:50%; border:2px solid transparent; cursor:pointer; padding:0; }
    .mng-swatch.is-active { border-color: var(--text-primary); }
    .mng-ex-list { display:flex; flex-direction:column; gap: var(--space-2); }
    .mng-ex-row { display:flex; align-items:center; gap: var(--space-2); }
    .mng-ex-name { flex:1; min-width:0; }
    .mng-ex-sets { width:56px; flex-shrink:0; text-align:center; }
    .mng-add-ex { display:flex; gap: var(--space-2); align-items:center; }
    .mng-add-ex .input:first-child { flex:1; min-width:0; }
    .mng-add-day { display:flex; gap: var(--space-2); align-items:center; margin-top: var(--space-2); }
    .mng-add-day .input { flex:1; min-width:0; }
    .mng-op { min-width: var(--tap-min); padding-left:0; padding-right:0; }
    .mng-op-danger { color: var(--danger, #f87171); }
```

- [ ] **Step 3: Rename the header + add core.js.** At line **146** change `<div class="lib-header-title">Exercise Library</div>` to `<div class="lib-header-title">Manage</div>`. Between the config and app scripts (currently lines 161–162), insert so the order is:

```html
<script src="config.js"></script>
<script src="core.js"></script>
<script src="app.js"></script>
```

- [ ] **Step 4: Replace the inline script (lines 163–306) with the Manage controller.**

```html
<script>
'use strict';

const MANAGE_PALETTE = ['#c084fc', '#fb923c', '#38bdf8', '#facc15', '#f472b6', '#4ade80', '#f87171', '#a3a3a3'];

const manageState = { model: null, original: null, saving: false, wired: false };

document.addEventListener('DOMContentLoaded', () => {
  if (!WORKER_CONFIG.isConfigured) {
    document.getElementById('library-region').innerHTML =
      '<div style="padding: var(--space-5) var(--space-4);">' +
      '<div class="error-state"><strong>config.js not configured.</strong><br><br>' +
      'Open <code>config.js</code> and set <code>WORKER_CONFIG.baseUrl</code> to your ' +
      'deployed Cloudflare Worker URL before using Manage.</div></div>';
    return;
  }
  loadManage();
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function loadManage() {
  const region = document.getElementById('library-region');
  region.innerHTML =
    '<div class="detail-loading" style="padding: var(--space-12) var(--space-4);">' +
    '<div class="spinner"></div><span>Loading…</span></div>';
  try {
    const raw = await getRawExercises();
    manageState.model = adaptExercisesModel(JSON.parse(raw));
    manageState.original = adaptExercisesModel(JSON.parse(raw));
    renderManage();
    wireManage();
  } catch (e) {
    region.innerHTML =
      '<div style="padding: var(--space-5) var(--space-4);">' +
      '<div class="error-state">Could not load the exercise library.<br>' +
      '<span style="font-size:0.8125rem; opacity:0.7;">' + e.message + '</span></div></div>';
  }
}

function renderManage() {
  const region = document.getElementById('library-region');
  const model = manageState.model;
  const renames = diffDayRenames(manageState.original, model);

  let html = '<div class="mng-body">';

  html += '<div class="mng-savebar">';
  html += '<button class="btn btn-primary" data-act="save">Save changes</button>';
  html += '<span class="save-status" id="mng-save-status" data-state="idle">' +
          '<span class="save-status-dot"></span><span id="mng-save-status-text"></span></span>';
  html += '</div>';

  if (renames.length > 0) {
    html += '<label class="mng-rename-opt"><input type="checkbox" id="mng-rename-history" checked /> ' +
      'Also rename ' +
      renames.map(r => '\u201C' + escapeHtml(r.oldName) + '\u201D\u2192\u201C' + escapeHtml(r.newName) + '\u201D').join(', ') +
      ' in past workout history</label>';
  }

  for (const day of model.days) {
    html += '<div class="mng-day-card">';
    html += '<div class="mng-day-head">';
    html += '<span class="mng-day-dot" data-day-color="' + day.id + '"></span>';
    html += '<input class="input mng-day-name" data-field="day-name" data-day-id="' + day.id +
            '" value="' + escapeHtml(day.name) + '" maxlength="40" />';
    html += '<div class="mng-day-ops">';
    html += '<button class="btn btn-sm mng-op" data-act="day-up" data-day-id="' + day.id + '" aria-label="Move day up">\u2191</button>';
    html += '<button class="btn btn-sm mng-op" data-act="day-down" data-day-id="' + day.id + '" aria-label="Move day down">\u2193</button>';
    html += '<button class="btn btn-sm mng-op mng-op-danger" data-act="day-remove" data-day-id="' + day.id + '" aria-label="Remove day">\u2715</button>';
    html += '</div></div>';

    html += '<div class="mng-swatches">';
    for (const hex of MANAGE_PALETTE) {
      const active = hex.toLowerCase() === (day.color || '').toLowerCase() ? ' is-active' : '';
      html += '<button class="mng-swatch' + active + '" data-act="day-color" data-day-id="' + day.id +
              '" data-color="' + hex + '" style="background:' + hex + '" aria-label="Set color ' + hex + '"></button>';
    }
    html += '</div>';

    html += '<div class="mng-ex-list">';
    for (const ex of day.exercises) {
      const en = escapeHtml(ex.name);
      html += '<div class="mng-ex-row">';
      html += '<input class="input mng-ex-name" data-field="ex-name" data-day-id="' + day.id +
              '" data-ex-name="' + en + '" value="' + en + '" maxlength="60" />';
      html += '<input class="input mng-ex-sets" data-field="ex-sets" data-day-id="' + day.id +
              '" data-ex-name="' + en + '" type="number" inputmode="numeric" min="1" max="10" value="' + ex.defaultSets + '" />';
      html += '<button class="btn btn-sm mng-op" data-act="ex-up" data-day-id="' + day.id + '" data-ex-name="' + en + '" aria-label="Move exercise up">\u2191</button>';
      html += '<button class="btn btn-sm mng-op" data-act="ex-down" data-day-id="' + day.id + '" data-ex-name="' + en + '" aria-label="Move exercise down">\u2193</button>';
      html += '<button class="btn btn-sm mng-op mng-op-danger" data-act="ex-remove" data-day-id="' + day.id + '" data-ex-name="' + en + '" aria-label="Remove exercise">\u2715</button>';
      html += '</div>';
    }
    html += '</div>';

    html += '<div class="mng-add-ex">';
    html += '<input class="input" data-field="new-ex-name" data-day-id="' + day.id + '" type="text" placeholder="Add exercise\u2026" maxlength="60" />';
    html += '<input class="input mng-ex-sets" data-field="new-ex-sets" data-day-id="' + day.id + '" type="number" inputmode="numeric" min="1" max="10" value="3" />';
    html += '<button class="btn btn-secondary btn-sm" data-act="add-ex" data-day-id="' + day.id + '">Add</button>';
    html += '</div>';

    html += '</div>';
  }

  html += '<div class="mng-add-day">';
  html += '<input class="input" id="mng-new-day-name" type="text" placeholder="New day name\u2026" maxlength="40" />';
  html += '<button class="btn btn-primary btn-sm" data-act="add-day">Add day</button>';
  html += '</div>';

  html += '</div>';

  region.innerHTML = html;

  // Contract: colors are applied at runtime via applyDayColor (sets --day-color).
  for (const day of model.days) {
    const dot = region.querySelector('.mng-day-dot[data-day-color="' + day.id + '"]');
    if (dot) applyDayColor(dot, day.color);
    const nameInput = region.querySelector('.mng-day-name[data-day-id="' + day.id + '"]');
    if (nameInput) applyDayColor(nameInput, day.color);
  }
}

function wireManage() {
  if (manageState.wired) return;
  const region = document.getElementById('library-region');
  region.addEventListener('click', onManageClick);
  region.addEventListener('change', onManageChange);
  manageState.wired = true;
}

function onManageClick(e) {
  const region = document.getElementById('library-region');
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const dayId = btn.dataset.dayId;
  const exName = btn.dataset.exName;
  try {
    if (act === 'save') { doSave(); return; }
    else if (act === 'day-up')     manageState.model = moveDay(manageState.model, dayId, -1);
    else if (act === 'day-down')   manageState.model = moveDay(manageState.model, dayId, 1);
    else if (act === 'day-remove') {
      const day = manageState.model.days.find(d => d.id === dayId);
      const msg = 'Remove \u201C' + day.name + '\u201D? Past workouts logged under this name stay in ' +
                  'your history but lose their picker entry.';
      if (!window.confirm(msg)) return;
      manageState.model = removeDay(manageState.model, dayId);
    }
    else if (act === 'day-color')  manageState.model = setDayColor(manageState.model, dayId, btn.dataset.color);
    else if (act === 'ex-up')      manageState.model = moveExercise(manageState.model, dayId, exName, -1);
    else if (act === 'ex-down')    manageState.model = moveExercise(manageState.model, dayId, exName, 1);
    else if (act === 'ex-remove')  manageState.model = removeExercise(manageState.model, dayId, exName);
    else if (act === 'add-ex') {
      const nameEl = region.querySelector('[data-field="new-ex-name"][data-day-id="' + dayId + '"]');
      const setsEl = region.querySelector('[data-field="new-ex-sets"][data-day-id="' + dayId + '"]');
      manageState.model = addExercise(manageState.model, dayId, nameEl.value, setsEl.value);
    }
    else if (act === 'add-day') {
      const nameEl = document.getElementById('mng-new-day-name');
      manageState.model = addDay(manageState.model, nameEl.value);
    }
    else return;
    renderManage();
  } catch (err) {
    showToast(err.message, 'error', 3500);
  }
}

function onManageChange(e) {
  const el = e.target.closest('[data-field]');
  if (!el) return;
  const field = el.dataset.field;
  const dayId = el.dataset.dayId;
  const exName = el.dataset.exName;
  try {
    if (field === 'day-name')      manageState.model = renameDay(manageState.model, dayId, el.value);
    else if (field === 'ex-name')  manageState.model = renameExercise(manageState.model, dayId, exName, el.value);
    else if (field === 'ex-sets')  manageState.model = setDefaultSets(manageState.model, dayId, exName, el.value);
    else return;
    renderManage();
  } catch (err) {
    showToast(err.message, 'error', 3500);
    renderManage(); // discard the invalid edit by restoring model values
  }
}

async function saveExercisesModelWithRetry(model) {
  try {
    return await replaceExercisesContent(model, 'Update days & exercises (Manage)');
  } catch (e) {
    if (/\b409\b/.test(e.message)) {
      // replaceExercisesContent re-reads the sha on each call, so retrying resolves a stale SHA.
      return await replaceExercisesContent(model, 'Update days & exercises (Manage) \u2014 retry');
    }
    throw e;
  }
}

async function renameDaysInHistoryWithRetry(renames) {
  async function attempt() {
    const { content, sha } = await getCSVFile();
    let rows = parseWorkoutCSV(content);
    for (const r of renames) rows = renameDayInRows(rows, r.oldName, r.newName);
    return putToWorker('/csv', serializeWorkoutCSV(rows), sha, 'Rename workout day(s) in history (Manage)');
  }
  try {
    return await attempt();
  } catch (e) {
    if (/\b409\b/.test(e.message)) return await attempt();
    throw e;
  }
}

async function doSave() {
  if (manageState.saving) return;
  const statusEl = document.getElementById('mng-save-status');
  const statusText = document.getElementById('mng-save-status-text');
  const renames = diffDayRenames(manageState.original, manageState.model);
  const historyBox = document.getElementById('mng-rename-history');
  const doHistory = renames.length > 0 && historyBox && historyBox.checked;

  manageState.saving = true;
  statusEl.dataset.state = 'saving';
  statusText.textContent = 'Saving\u2026';

  try {
    await saveExercisesModelWithRetry(manageState.model);
    if (doHistory) {
      statusText.textContent = 'Updating history\u2026';
      await renameDaysInHistoryWithRetry(renames);
    }
    // Re-pin the baseline so subsequent edits diff from the just-saved state.
    manageState.original = adaptExercisesModel(JSON.parse(serializeExercisesModel(manageState.model)));
    showToast('Changes saved', 'success');
    renderManage();
    document.getElementById('mng-save-status').dataset.state = 'saved';
    document.getElementById('mng-save-status-text').textContent = 'Saved';
  } catch (e) {
    statusEl.dataset.state = 'error';
    statusText.textContent = 'Failed';
    showToast(e.message, 'error', 4000);
  } finally {
    manageState.saving = false;
  }
}
</script>
```

- [ ] **Step 5: Local verification (no DOM test runner).** With a dev `config.js` pointing at the Worker, serve the folder statically and open the page:
  - `python -m http.server 8080` (run from the repo root), then open `http://localhost:8080/exercise-library.html`.
  - Confirm: each day renders as a card with a colored dot + name matching its `color`; up/down reorders days and exercises; the swatch strip recolors the dot and name live; "Add day" / "Add exercise" append and clear their inputs; a case-insensitive duplicate exercise name toasts an error and is discarded; editing a day name surfaces the "Also rename … in past workout history" checkbox.
  - **Save path (branch only, never a live-data throwaway test on `main`):** on the feature branch, make one exercise-only edit and Save → verify exactly **one** commit touching `exercises.json` (now v2 shape). Then rename a day with the checkbox left on and Save → verify **two** commits: `exercises.json` first, then `workout_tracker.csv` with the `Workout Day` column rewritten old→new. Unchecking the box produces only the `exercises.json` commit.

- [ ] **Step 6: Commit.**
```
git add exercise-library.html && git commit -m "feat(manage): day + exercise CRUD editor with save + rename-history rewrite"
```

---

### Task 5.4: Dynamic home day buttons + derived `DAY_ORDER` in `index.html`

**Files:**
- Modify `index.html`: lines **63–87** (static buttons → empty grid), **125–126** (add core.js), **138** (add `DAYS_MODEL`), **161–167** (call order + drop static wiring), **192–200** (`loadExercises`), add `renderDayButtons`, line **204** (resume-banner day list), line **380** (`DAY_ORDER` → `let`).
- Modify `styles.css`: lines **450–461** (`.day-dot` uses `var(--day-color)`, delete the five `[data-day]` rules).

**Interfaces:**
- Consumes: `adaptExercisesModel`, `applyDayColor`, `getRawExercises`. Produces a flat `EXERCISES` map (`{ '<dayName>': exercises[] }`) so the existing logger helpers (`getDayExerciseDefs`, `findExerciseDef`, `buildAllExercisesSelect`) keep working unchanged, plus a `DAYS_MODEL` array and a `DAY_ORDER` name list both derived from `model.days`.

- [ ] **Step 1: Replace the static day buttons.** Replace lines **63–87** with:

```html
  <div class="day-grid" id="day-grid"></div>
```

- [ ] **Step 2: Add core.js before app.js.** Between lines **125–126**, make the order:

```html
<script src="config.js"></script>
<script src="core.js"></script>
<script src="app.js"></script>
```

- [ ] **Step 3: Add the `DAYS_MODEL` global.** After line **138** (`let EXERCISES = null;`) add:

```js
let DAYS_MODEL = [];
```

- [ ] **Step 4: Fix the init sequence and drop static wiring.** Replace lines **161–167**:

```js
  document.getElementById('home-date-label').textContent = formatDisplayDate(todayISO());
  renderResumeBanners();
  await loadExercises();

  document.querySelectorAll('.day-btn').forEach(btn => {
    btn.addEventListener('click', () => startSession(btn.dataset.day));
  });
```
with (buttons are now built + wired inside `loadExercises`, and resume banners need `DAY_ORDER` populated first):
```js
  document.getElementById('home-date-label').textContent = formatDisplayDate(todayISO());
  await loadExercises();
  renderResumeBanners();
```

- [ ] **Step 5: Make `loadExercises` build the model + flat map + dynamic buttons.** Replace lines **192–200**:

```js
async function loadExercises() {
  try {
    const raw = await getRawExercises();
    const model = adaptExercisesModel(JSON.parse(raw));
    DAYS_MODEL = model.days;
    DAY_ORDER = model.days.map(d => d.name);
    EXERCISES = {};
    for (const d of model.days) EXERCISES[d.name] = d.exercises;
  } catch (e) {
    showToast('Could not load exercise library', 'error', 4000);
    DAYS_MODEL = [];
    DAY_ORDER = [];
    EXERCISES = {};
  }
  renderDayButtons();
}

function renderDayButtons() {
  const grid = document.getElementById('day-grid');
  grid.innerHTML = '';
  for (const day of DAYS_MODEL) {
    const btn = document.createElement('button');
    btn.className = 'day-btn';
    btn.dataset.day = day.name;
    applyDayColor(btn, day.color);
    btn.innerHTML =
      '<span class="day-dot"></span>' +
      '<span class="day-btn-label"></span>' +
      '<span class="day-btn-arrow">&rsaquo;</span>';
    btn.querySelector('.day-btn-label').textContent = day.name;
    btn.addEventListener('click', () => startSession(day.name));
    grid.appendChild(btn);
  }
}
```

- [ ] **Step 6: Drive resume banners from `DAY_ORDER`.** At line **204**, replace `const days = ['Legs', 'Chest', 'Back', 'Shoulders', 'Arms'];` with:

```js
  const days = DAY_ORDER;
```

- [ ] **Step 7: Make `DAY_ORDER` reassignable.** At line **380**, change `const DAY_ORDER = ['Legs', 'Chest', 'Back', 'Shoulders', 'Arms'];` to:

```js
let DAY_ORDER = [];
```

- [ ] **Step 8: Wire the dot color to `--day-color` in `styles.css`.** Replace the `.day-dot` block plus the five `[data-day]` rules (lines **450–461**) with:

```css
.day-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--day-color, var(--text-muted));
}
```
(`applyDayColor` sets `--day-color` on the `.day-btn`; the custom property inherits to the child `.day-dot`.)

- [ ] **Step 9: Local verification.** Serve statically (`python -m http.server 8080`) with a dev `config.js` and open `http://localhost:8080/index.html`: the home screen renders one button per `model.days` entry, in model order, each dot colored from its `color`; tapping a button opens that day's session seeded from its exercises; a day added via Manage appears here after reload; a local draft for any day still surfaces its resume banner.

- [ ] **Step 10: Commit.**
```
git add index.html styles.css && git commit -m "feat(home): render day buttons dynamically from v2 model with applyDayColor"
```

---

### Task 5.5: Dynamic day grouping + colors in `records.html`

**Files:**
- Modify `records.html`: lines **41–47** (heading color → `var(--day-color)`), line **68** (add core.js), line **76** (add `dayColors` field), line **79** (`DAY_ORDER` → `let`), lines **96–104** (`loadExercisesConfig`), after line **201** (apply colors post-render).

**Interfaces:**
- Consumes: `adaptExercisesModel`, `applyDayColor`, `getRawExercises`. Produces a `DAY_ORDER` name list and `recState.exercisesByDay` / `recState.dayColors` maps keyed by day name, all derived from `model.days`; the existing `renderRecords` day loop is otherwise unchanged.

- [ ] **Step 1: Wire the heading color to `--day-color`.** Replace lines **41–47**:

```css
      color: var(--text-secondary);
    }
    .records-day-heading[data-day="Legs"]      { color: var(--day-legs); }
    .records-day-heading[data-day="Chest"]     { color: var(--day-chest); }
    .records-day-heading[data-day="Back"]      { color: var(--day-back); }
    .records-day-heading[data-day="Shoulders"] { color: var(--day-shoulders); }
    .records-day-heading[data-day="Arms"]      { color: var(--day-arms); }
```
with:
```css
      color: var(--day-color, var(--text-secondary));
    }
```

- [ ] **Step 2: Add core.js before app.js.** At line **68**, make the order:

```html
<script src="config.js"></script>
<script src="core.js"></script>
<script src="app.js"></script>
```

- [ ] **Step 3: Add the `dayColors` state field.** In the `recState` object (line **76**), add the field:

```js
  exercisesByDay: null,  // populated from exercises.json
  dayColors: null        // { '<dayName>': '#rrggbb' }
```

- [ ] **Step 4: Make `DAY_ORDER` reassignable.** At line **79**, change to:

```js
let DAY_ORDER = [];
```

- [ ] **Step 5: Build the maps from the v2 model.** Replace `loadExercisesConfig` (lines **96–104**):

```js
async function loadExercisesConfig() {
  try {
    const raw = await getRawExercises();
    const model = adaptExercisesModel(JSON.parse(raw));
    DAY_ORDER = model.days.map(d => d.name);
    recState.exercisesByDay = {};
    recState.dayColors = {};
    for (const d of model.days) {
      recState.exercisesByDay[d.name] = d.exercises;
      recState.dayColors[d.name] = d.color;
    }
  } catch (e) {
    // Non-fatal: fall back to flat alphabetical if exercises.json can't load
    recState.exercisesByDay = null;
    recState.dayColors = null;
  }
}
```

- [ ] **Step 6: Apply day colors after render.** Immediately after line **201** (`document.getElementById('btn-recalc').addEventListener('click', handleRecalculate);`), add:

```js
  region.querySelectorAll('.records-day-heading').forEach(h => {
    const c = recState.dayColors && recState.dayColors[h.dataset.day];
    if (c) applyDayColor(h, c);
  });
```
(The `data-day=""` "Other" bucket has no entry, so it stays `var(--text-secondary)`.)

- [ ] **Step 7: Local verification.** Serve statically and open `http://localhost:8080/records.html`: day sections render in `model.days` order, each heading colored from its `color`; renaming/reordering a day in Manage is reflected here after reload; records logged under a name no longer in the model still appear under "Other".

- [ ] **Step 8: Commit.**
```
git add records.html && git commit -m "feat(records): group and color record sections from the v2 day model"
```

---

**Notes for the assembler / other sections:**
- `applyDayColor(el, hex)`, `adaptExercisesModel`, `serializeExercisesModel`, `slugifyDayId`, `parseWorkoutCSV`, `serializeWorkoutCSV`, and `renameDayInRows` are **Foundation-owned** and only consumed above.
- The save path reuses `replaceExercisesContent(model, …)`, which serializes with `JSON.stringify(model, null, 2)` — byte-identical to `serializeExercisesModel(model)` plus the trailing newline — so no second exercises writer is introduced. `serializeExercisesModel` is exercised directly by the Foundation round-trip tests and by `doSave`'s baseline re-pin.
- Source anchors read for this section: `exercise-library.html` (full, 1–309), `app.js` 1–45 / 75–174 / 880–938, `index.html` 55–99 / 118–210 / 365–409, `records.html` 33–224, `styles.css` 37–41 / 415–470.

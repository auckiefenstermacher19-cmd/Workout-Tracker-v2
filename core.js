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

  /* ─── Workout CSV (10-col; Session Id appended last for BC) ─── */
  const CSV_HEADER =
    'Date,Workout Day,Exercise,Set Number,Weight,Reps,Load,Exercise Load,Total Workout Load,Session Id';

  // Quote a single CSV field per RFC-4180: wrap in double-quotes and double any
  // embedded quote when the value contains a comma, quote, CR or LF. Pure — no IO.
  function csvField(v) {
    v = String(v == null ? '' : v);
    return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }

  // Quote-aware single-line splitter. Exported (amendment B) so app.js's
  // parseRecordsCSV can share this implementation instead of duplicating it.
  // Collapses an escaped "" pair inside a quoted field back to a literal " so a
  // name like Bench "Press" survives a serialize→parse round-trip. Stays tolerant
  // of the existing unquoted data (which contains no quotes at all).
  function splitCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; } // "" → literal "
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) { result.push(current); current = ''; }
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
      ].map(csvField).join(',');
    });
    return [CSV_HEADER].concat(lines).join('\n') + '\n';
  }

  /* ─── Calendar-day aggregation & session grouping ─── */
  function combinedDayLoad(rows, dateStr) {
    return rows.reduce(function (sum, r) {
      return r.date === dateStr ? sum + r.load : sum;
    }, 0);
  }

  // Sums combinedDayLoad (not the per-session totalWorkoutLoad field) across every
  // unique date in [startDateISO, endDateISO] so a calendar day with multiple
  // sessions is never undercounted. Pure: does not mutate rows. Inclusive range.
  function weekLoad(rows, startDateISO, endDateISO) {
    const seen = new Set();
    const dates = [];
    for (const r of rows) {
      if (r.date >= startDateISO && r.date <= endDateISO && !seen.has(r.date)) {
        seen.add(r.date);
        dates.push(r.date);
      }
    }
    return dates.reduce(function (sum, d) {
      return sum + combinedDayLoad(rows, d);
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

  /* ─── Logger history: last session's numbers + personal-best badge ─── */

  // Superset sets carry an A/B suffix on the set number ("1A"/"1B"). A and B
  // are different movements sharing one exercise name, so every comparison is
  // scoped to the slot. Non-superset sets share the single '' slot.
  function setSlot(setNumber) {
    const m = /([AB])$/i.exec(String(setNumber == null ? '' : setNumber));
    return m ? m[1].toUpperCase() : '';
  }

  // True when `row` belongs to a session strictly earlier than the one being
  // logged. Ordering is (date, sessionId); session ids are YYYY-MM-DD-HHMMSS,
  // so two sessions on one day order correctly and the second sees the first.
  function isEarlierSession(row, currentSessionId, currentDate) {
    if (row.sessionId === currentSessionId) return false;
    if (row.date !== currentDate) return row.date < currentDate;
    return String(row.sessionId) < String(currentSessionId);
  }

  function compareSetNumber(a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true });
  }

  // Sets of the most recent earlier session that contains `exerciseName`,
  // whatever workout day it was logged under. [] when there is no such session.
  function lastSessionSets(rows, exerciseName, currentSessionId, currentDate) {
    const prior = (rows || []).filter(function (r) {
      return r.exercise === exerciseName &&
        isEarlierSession(r, currentSessionId, currentDate);
    });
    if (prior.length === 0) return [];

    let latest = null;
    for (const r of prior) {
      if (latest === null ||
          r.date > latest.date ||
          (r.date === latest.date && String(r.sessionId) > String(latest.sessionId))) {
        latest = { date: r.date, sessionId: r.sessionId };
      }
    }

    return prior
      .filter(function (r) { return r.sessionId === latest.sessionId; })
      .map(function (r) {
        return { setNumber: r.setNumber, weight: r.weight, reps: r.reps };
      })
      .sort(function (a, b) { return compareSetNumber(a.setNumber, b.setNumber); });
  }

  // One boolean per entry of `currentSets`, in order: does this set beat every
  // weight logged at the same rep count (and, for supersets, the same slot)?
  // The bar starts at the pre-session best and rises as earlier sets in this
  // session clear it, so a later set that merely ties an earlier one gets no
  // badge. Strictly greater than — ties never count.
  function markPersonalBests(rows, exerciseName, currentSets, currentSessionId, currentDate) {
    const best = new Map(); // slot + '|' + reps -> heaviest weight seen
    for (const r of (rows || [])) {
      if (r.exercise !== exerciseName) continue;
      if (!isEarlierSession(r, currentSessionId, currentDate)) continue;
      const w = parseFloat(r.weight);
      const reps = parseInt(r.reps, 10);
      if (!(w > 0) || !(reps > 0)) continue;
      const key = setSlot(r.setNumber) + '|' + reps;
      if (!best.has(key) || w > best.get(key)) best.set(key, w);
    }

    return (currentSets || []).map(function (s) {
      const w = parseFloat(s.weight);
      const reps = parseInt(s.reps, 10);
      if (!(w > 0) || !(reps > 0)) return false; // nothing usable logged yet
      const key = setSlot(s.setNumber) + '|' + reps;
      if (best.has(key) && w <= best.get(key)) return false;
      best.set(key, w);
      return true;
    });
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

  // Apply a whole batch of day renames in ONE pass via an original→final map, so a
  // chained rename (Legs→Chest then Chest→Push) never re-renames rows already
  // touched earlier in the batch. `renames` is [{oldName, newName}, …] (diffDayRenames
  // shape). Each row is matched against its ORIGINAL workoutDay only. Pure — no IO.
  function renameDaysInRows(rows, renames) {
    const map = new Map((renames || []).map(function (r) { return [r.oldName, r.newName]; }));
    return rows.map(function (r) {
      return map.has(r.workoutDay)
        ? Object.assign({}, r, { workoutDay: map.get(r.workoutDay) })
        : r;
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

  // v2 -> legacy {"<dayName>": [{name,defaultSets}]} projection (days order preserved),
  // so v1-shaped page readers keep working after the migration (controller amendment A).
  function modelToLegacyMap(model) {
    const legacy = {};
    (model && model.days ? model.days : []).forEach(function (d) {
      legacy[d.name] = (d.exercises || []).map(function (e) {
        return { name: e.name, defaultSets: e.defaultSets };
      });
    });
    return legacy;
  }

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

  const api = {
    calcLoad: calcLoad,
    calcExerciseLoad: calcExerciseLoad,
    calcWorkoutLoad: calcWorkoutLoad,
    makeSessionId: makeSessionId,
    CSV_HEADER: CSV_HEADER,
    csvField: csvField,
    splitCSVLine: splitCSVLine,
    parseWorkoutCSV: parseWorkoutCSV,
    serializeWorkoutCSV: serializeWorkoutCSV,
    combinedDayLoad: combinedDayLoad,
    weekLoad: weekLoad,
    sessionsOnDate: sessionsOnDate,
    lastSessionSets: lastSessionSets,
    markPersonalBests: markPersonalBests,
    rebuildSessionRows: rebuildSessionRows,
    commitReplaceSession: commitReplaceSession,
    renameDayInRows: renameDayInRows,
    renameDaysInRows: renameDaysInRows,
    reorderSessionExercises: reorderSessionExercises,
    slugifyDayId: slugifyDayId,
    adaptExercisesModel: adaptExercisesModel,
    serializeExercisesModel: serializeExercisesModel,
    modelToLegacyMap: modelToLegacyMap,
    dedupeOrder: dedupeOrder,
    resumeRenderOrder: resumeRenderOrder,
    cloneExercisesModel: cloneExercisesModel,
    addDay: addDay,
    renameDay: renameDay,
    removeDay: removeDay,
    moveDay: moveDay,
    setDayColor: setDayColor,
    diffDayRenames: diffDayRenames,
    addExercise: addExercise,
    renameExercise: renameExercise,
    removeExercise: removeExercise,
    moveExercise: moveExercise,
    setDefaultSets: setDefaultSets
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof globalThis !== 'undefined' ? globalThis : this);

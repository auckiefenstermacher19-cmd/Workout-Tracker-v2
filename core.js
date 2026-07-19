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

  // Quote-aware single-line splitter. Exported (amendment B) so app.js's
  // parseRecordsCSV can share this implementation instead of duplicating it.
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

  const api = {
    calcLoad: calcLoad,
    calcExerciseLoad: calcExerciseLoad,
    calcWorkoutLoad: calcWorkoutLoad,
    makeSessionId: makeSessionId,
    CSV_HEADER: CSV_HEADER,
    splitCSVLine: splitCSVLine,
    parseWorkoutCSV: parseWorkoutCSV,
    serializeWorkoutCSV: serializeWorkoutCSV
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof globalThis !== 'undefined' ? globalThis : this);

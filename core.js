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

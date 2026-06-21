'use strict';

/* ── GitHub API access via Cloudflare Worker proxy ───────────────
   The Worker holds the GitHub PAT as a server-side secret. The
   browser never sees it. WORKER_CONFIG.baseUrl points at your
   deployed Worker (set in config.js). All functions below keep
   the same names and signatures as before, so nothing in
   index.html / dashboard.html / records.html needs to change. */

async function getCSVFile() {
  const res = await fetch(WORKER_CONFIG.baseUrl + '/csv');
  const json = await res.json();

  if (!res.ok) {
    throw new Error('Worker read failed ' + res.status + ': ' + (json.message || json.error || res.statusText));
  }

  return { content: json.content, sha: json.sha };
}

async function getRawCSV() {
  const url = WORKER_CONFIG.baseUrl + '/raw/csv?t=' + Date.now();
  const res = await fetch(url, { cache: 'no-store' });

  if (!res.ok) {
    throw new Error('Raw CSV fetch failed ' + res.status + ': ' + res.statusText);
  }

  return res.text();
}

async function appendRowsToCSV(newRows) {
  if (!newRows || newRows.length === 0) {
    throw new Error('appendRowsToCSV: no rows provided');
  }

  const { content, sha } = await getCSVFile();
  const trimmed = content.trimEnd();
  const appended = trimmed + '\n' + newRows.join('\n') + '\n';

  return putToWorker('/csv', appended, sha, 'Log workout — ' + new Date().toISOString().slice(0, 10));
}

async function replaceCSVContent(fullCSVText, commitMessage) {
  const { sha } = await getCSVFile();
  const content = fullCSVText.trimEnd() + '\n';

  return putToWorker('/csv', content, sha, commitMessage || ('Update workout — ' + new Date().toISOString().slice(0, 10)));
}

async function getRecordsFile() {
  const res = await fetch(WORKER_CONFIG.baseUrl + '/records');
  const json = await res.json();

  if (!res.ok) {
    throw new Error('Worker read failed ' + res.status + ': ' + (json.message || json.error || res.statusText));
  }

  return { content: json.content, sha: json.sha };
}

async function getRawRecords() {
  const url = WORKER_CONFIG.baseUrl + '/raw/records?t=' + Date.now();
  const res = await fetch(url, { cache: 'no-store' });

  if (!res.ok) {
    throw new Error('Raw records fetch failed ' + res.status + ': ' + res.statusText);
  }

  return res.text();
}

async function replaceRecordsContent(fullCSVText, commitMessage) {
  const { sha } = await getRecordsFile();
  const content = fullCSVText.trimEnd() + '\n';

  return putToWorker('/records', content, sha, commitMessage || 'Update personal records');
}

/**
 * getExercisesFile()
 * Returns { content, sha } for exercises.json, authenticated via the Worker.
 */
async function getExercisesFile() {
  const res = await fetch(WORKER_CONFIG.baseUrl + '/exercises');
  const json = await res.json();

  if (!res.ok) {
    throw new Error('Worker read failed ' + res.status + ': ' + (json.message || json.error || res.statusText));
  }

  return { content: json.content, sha: json.sha };
}

/**
 * getRawExercises()
 * Returns the raw exercises.json text via the Worker's unauthenticated
 * passthrough endpoint, cache-busted.
 */
async function getRawExercises() {
  const url = WORKER_CONFIG.baseUrl + '/raw/exercises?t=' + Date.now();
  const res = await fetch(url, { cache: 'no-store' });

  if (!res.ok) {
    throw new Error('Raw exercises fetch failed ' + res.status + ': ' + res.statusText);
  }

  return res.text();
}

/**
 * replaceExercisesContent(exercisesObj, commitMessage)
 * Writes the full exercises.json object back to GitHub via the Worker.
 * Always reads the current sha first to avoid stale-write conflicts.
 */
async function replaceExercisesContent(exercisesObj, commitMessage) {
  const { sha } = await getExercisesFile();
  const content = JSON.stringify(exercisesObj, null, 2) + '\n';

  return putToWorker('/exercises', content, sha, commitMessage || 'Update exercise library');
}

/**
 * addExerciseToLibrary(day, exerciseName, defaultSets)
 * Convenience wrapper: reads the current library, validates the new
 * exercise doesn't already exist under that day, appends it, and
 * writes the result back. Throws if the name is a duplicate within
 * that day (case-insensitive) or if inputs are invalid.
 *
 * Returns the updated exercises object.
 */
async function addExerciseToLibrary(day, exerciseName, defaultSets) {
  const name = (exerciseName || '').trim();
  const sets = parseInt(defaultSets, 10);

  if (!name) {
    throw new Error('Exercise name is required');
  }
  if (!day) {
    throw new Error('Workout day is required');
  }
  if (isNaN(sets) || sets < 1) {
    throw new Error('Default set count must be a positive number');
  }

  const { content } = await getExercisesFile();
  const exercisesObj = JSON.parse(content);

  if (!exercisesObj[day]) {
    exercisesObj[day] = [];
  }

  const isDuplicate = exercisesObj[day].some(
    ex => ex.name.toLowerCase() === name.toLowerCase()
  );
  if (isDuplicate) {
    throw new Error('"' + name + '" already exists under ' + day);
  }

  exercisesObj[day].push({ name: name, defaultSets: sets });

  await replaceExercisesContent(exercisesObj, 'Add exercise: ' + name + ' (' + day + ')');

  return exercisesObj;
}

/**
 * putToWorker(path, content, sha, message)
 * Shared PUT helper -- sends plain-text content (not base64; the
 * Worker handles base64 encoding server-side) along with the
 * blob's current sha and a commit message.
 */
async function putToWorker(path, content, sha, message) {
  const res = await fetch(WORKER_CONFIG.baseUrl + path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, sha, message })
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err = new Error('Worker write failed ' + res.status + ': ' + (json.message || json.error || res.statusText));
    err.status = res.status;
    throw err;
  }

  return json;
}


function parseCSV(rawText) {
  if (!rawText || !rawText.trim()) return [];

  const lines = rawText.trim().split('\n');
  const dataLines = lines.slice(1);

  return dataLines
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      const cols = splitCSVLine(line);
      if (cols.length < 9) return null;

      return {
        date:              cols[0].trim(),
        workoutDay:        cols[1].trim(),
        exercise:          cols[2].trim(),
        setNumber:         parseInt(cols[3], 10),
        weight:            parseFloat(cols[4]),
        reps:              parseInt(cols[5], 10),
        load:              parseFloat(cols[6]),
        exerciseLoad:      parseFloat(cols[7]),
        totalWorkoutLoad:  parseFloat(cols[8])
      };
    })
    .filter(row => row !== null && !isNaN(row.setNumber));
}

function parseRecordsCSV(rawText) {
  if (!rawText || !rawText.trim()) return [];

  const lines = rawText.trim().split('\n');
  const dataLines = lines.slice(1);

  return dataLines
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      const cols = splitCSVLine(line);
      if (cols.length < 4) return null;
      return {
        exercise:      cols[0].trim(),
        repCount:      parseInt(cols[1], 10),
        weight:        parseFloat(cols[2]),
        dateAchieved:  cols[3].trim()
      };
    })
    .filter(row => row !== null && !isNaN(row.repCount));
}

function splitCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function serializeCSV(rows) {
  const header = 'Date,Workout Day,Exercise,Set Number,Weight,Reps,Load,Exercise Load,Total Workout Load';
  const lines = rows.map(r => [
    r.date, r.workoutDay, r.exercise, r.setNumber,
    r.weight, r.reps, r.load, r.exerciseLoad, r.totalWorkoutLoad
  ].join(','));
  return [header].concat(lines).join('\n') + '\n';
}

function serializeRecordsCSV(records) {
  const header = 'Exercise,RepCount,Weight,DateAchieved';
  const lines = records.map(r => [r.exercise, r.repCount, r.weight, r.dateAchieved].join(','));
  return [header].concat(lines).join('\n') + '\n';
}

function groupByDate(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.date)) map.set(row.date, []);
    map.get(row.date).push(row);
  }
  return new Map([...map.entries()].sort((a, b) => b[0].localeCompare(a[0])));
}

function getSessionsOnDate(rows, dateStr) {
  return rows.filter(r => r.date === dateStr);
}

function getDatesWithData(rows) {
  return new Set(rows.map(r => r.date));
}

function getLastSession(rows, workoutDay, excludeDate) {
  const dayRows = rows.filter(r =>
    r.workoutDay === workoutDay && r.date !== excludeDate
  );
  if (dayRows.length === 0) return new Map();

  const dates = [...new Set(dayRows.map(r => r.date))].sort().reverse();
  const lastDate = dates[0];
  const lastRows = dayRows.filter(r => r.date === lastDate);

  const result = new Map();
  for (const row of lastRows) {
    if (!result.has(row.exercise)) {
      result.set(row.exercise, { sets: [], date: lastDate });
    }
    result.get(row.exercise).sets.push({
      setNumber: row.setNumber,
      weight:    row.weight,
      reps:      row.reps
    });
  }

  for (const [, data] of result) {
    data.sets.sort((a, b) => a.setNumber - b.setNumber);
  }

  return result;
}

function getTopSet(sets) {
  if (!sets || sets.length === 0) return null;
  return sets.reduce((best, s) => {
    if (!best) return s;
    if (s.weight > best.weight) return s;
    if (s.weight === best.weight && s.reps > best.reps) return s;
    return best;
  }, null);
}

const STREAK_WINDOW = 8;

function getConsecutiveStreak(rows, exercise, workoutDay, excludeDate) {
  const relevantRows = rows.filter(r =>
    r.exercise === exercise &&
    r.workoutDay === workoutDay &&
    r.date !== excludeDate
  );

  if (relevantRows.length === 0) return null;

  const sessionDates = [...new Set(relevantRows.map(r => r.date))]
    .sort()
    .reverse();

  if (sessionDates.length < 2) return null;

  const topSetByDate = new Map();
  for (const date of sessionDates) {
    const dateRows = relevantRows.filter(r => r.date === date);
    topSetByDate.set(date, getTopSet(dateRows));
  }

  const windowDates = sessionDates.slice(0, STREAK_WINDOW);
  const windowSize  = windowDates.length;
  const majorityThreshold = Math.ceil(windowSize / 2);

  const tally = new Map();
  for (const date of windowDates) {
    const top = topSetByDate.get(date);
    if (!top) continue;
    const key = top.weight + 'x' + top.reps;
    if (!tally.has(key)) {
      tally.set(key, { weight: top.weight, reps: top.reps, count: 0, mostRecentDate: date });
    }
    const entry = tally.get(key);
    entry.count++;
  }

  if (tally.size === 0) return null;

  let winner = null;
  for (const entry of tally.values()) {
    if (!winner) { winner = entry; continue; }
    if (entry.count > winner.count) {
      winner = entry;
    } else if (entry.count === winner.count && entry.mostRecentDate > winner.mostRecentDate) {
      winner = entry;
    }
  }

  if (winner.count < majorityThreshold) return null;

  let trueCount = 0;
  for (const date of sessionDates) {
    const top = topSetByDate.get(date);
    if (top && top.weight === winner.weight && top.reps === winner.reps) {
      trueCount++;
    }
  }

  if (trueCount < 2) return null;

  return { weight: winner.weight, reps: winner.reps, count: trueCount };
}

function calcLoad(weight, reps) {
  const w = parseFloat(weight) || 0;
  const r = parseInt(reps, 10) || 0;
  return w * r;
}

function calcExerciseLoad(setsArray) {
  return setsArray.reduce((sum, s) => sum + calcLoad(s.weight, s.reps), 0);
}

function calcWorkoutLoad(exercisesMap) {
  let total = 0;
  for (const [, sets] of exercisesMap) {
    total += calcExerciseLoad(sets);
  }
  return total;
}

function calcWeekLoad(rows, isoDateInWeek) {
  const range = getWeekRange(isoDateInWeek);
  const start = range.start;
  const end = range.end;

  const seenDates = new Set();
  let total = 0;

  for (const row of rows) {
    if (row.date >= start && row.date <= end && !seenDates.has(row.date)) {
      seenDates.add(row.date);
      total += row.totalWorkoutLoad;
    }
  }

  return total;
}

function getWeekRange(isoDate) {
  const parts = isoDate.split('-').map(Number);
  const y = parts[0], m = parts[1], d = parts[2];
  const date = new Date(y, m - 1, d);
  const dayOfWeek = date.getDay();

  const sunday = new Date(date);
  sunday.setDate(date.getDate() - dayOfWeek);

  const saturday = new Date(sunday);
  saturday.setDate(sunday.getDate() + 6);

  return {
    start: isoFromDate(sunday),
    end:   isoFromDate(saturday)
  };
}

function isoFromDate(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function buildCSVRows(date, workoutDay, exercisesMap) {
  const totalWorkoutLoad = calcWorkoutLoad(exercisesMap);
  const rows = [];

  for (const entry of exercisesMap) {
    const exerciseName = entry[0];
    const sets = entry[1];
    const exerciseLoad = calcExerciseLoad(sets);

    sets.forEach((set, idx) => {
      const setNum = idx + 1;
      const load = calcLoad(set.weight, set.reps);
      rows.push(
        [
          date, workoutDay, exerciseName, setNum,
          set.weight, set.reps, load, exerciseLoad, totalWorkoutLoad
        ].join(',')
      );
    });
  }

  return rows;
}

function rebuildRowObjects(date, workoutDay, exercisesMap) {
  const totalWorkoutLoad = calcWorkoutLoad(exercisesMap);
  const rows = [];

  for (const entry of exercisesMap) {
    const exerciseName = entry[0];
    const sets = entry[1];
    const exerciseLoad = calcExerciseLoad(sets);

    sets.forEach((set, idx) => {
      rows.push({
        date: date,
        workoutDay: workoutDay,
        exercise: exerciseName,
        setNumber: idx + 1,
        weight: set.weight,
        reps: set.reps,
        load: calcLoad(set.weight, set.reps),
        exerciseLoad: exerciseLoad,
        totalWorkoutLoad: totalWorkoutLoad
      });
    });
  }

  return rows;
}

function computeAllTimeRecords(allWorkoutRows) {
  const best = new Map();

  for (const row of allWorkoutRows) {
    if (!row.reps || row.reps <= 0 || !row.weight || row.weight <= 0) continue;

    const key = row.exercise + '|' + row.reps;
    const existing = best.get(key);

    if (!existing || row.weight > existing.weight ||
        (row.weight === existing.weight && row.date > existing.dateAchieved)) {
      best.set(key, { weight: row.weight, dateAchieved: row.date });
    }
  }

  const records = [];
  for (const entry of best) {
    const key = entry[0];
    const val = entry[1];
    const sepIdx = key.lastIndexOf('|');
    const exercise = key.slice(0, sepIdx);
    const repCount = parseInt(key.slice(sepIdx + 1), 10);
    records.push({
      exercise: exercise,
      repCount: repCount,
      weight: val.weight,
      dateAchieved: val.dateAchieved
    });
  }

  records.sort((a, b) => {
    if (a.exercise !== b.exercise) return a.exercise.localeCompare(b.exercise);
    return a.repCount - b.repCount;
  });

  return records;
}

function mergeNewSetIntoRecords(existingRecords, exercise, weight, reps, date) {
  if (!weight || weight <= 0 || !reps || reps <= 0) return existingRecords;

  const result = existingRecords.map(r => Object.assign({}, r));
  const idx = result.findIndex(r => r.exercise === exercise && r.repCount === reps);

  if (idx === -1) {
    result.push({ exercise: exercise, repCount: reps, weight: weight, dateAchieved: date });
  } else if (weight > result[idx].weight) {
    result[idx].weight = weight;
    result[idx].dateAchieved = date;
  }

  result.sort((a, b) => {
    if (a.exercise !== b.exercise) return a.exercise.localeCompare(b.exercise);
    return a.repCount - b.repCount;
  });

  return result;
}

function getRecordsForExercise(records, exercise) {
  return records
    .filter(r => r.exercise === exercise)
    .sort((a, b) => a.repCount - b.repCount);
}

const LS_PREFIX = 'wt_session_';
const LS_COLLAPSE_PREFIX = 'wt_collapsed_';

function saveToLocalStorage(workoutDay, sessionData) {
  try {
    localStorage.setItem(LS_PREFIX + workoutDay, JSON.stringify(sessionData));
  } catch (e) {
    console.warn('localStorage save failed:', e);
  }
}

function loadFromLocalStorage(workoutDay) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + workoutDay);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function clearLocalStorage(workoutDay) {
  try {
    localStorage.removeItem(LS_PREFIX + workoutDay);
  } catch (e) {
  }
}

function hasLocalStorage(workoutDay) {
  try {
    return localStorage.getItem(LS_PREFIX + workoutDay) !== null;
  } catch (e) {
    return false;
  }
}

function setCollapsedState(exerciseKey, isCollapsed) {
  try {
    const all = JSON.parse(localStorage.getItem(LS_COLLAPSE_PREFIX + 'all') || '{}');
    all[exerciseKey] = isCollapsed;
    localStorage.setItem(LS_COLLAPSE_PREFIX + 'all', JSON.stringify(all));
  } catch (e) {
  }
}

function getCollapsedState(exerciseKey) {
  try {
    const all = JSON.parse(localStorage.getItem(LS_COLLAPSE_PREFIX + 'all') || '{}');
    return !!all[exerciseKey];
  } catch (e) {
    return false;
  }
}

function todayISO() {
  const d = new Date();
  return isoFromDate(d);
}

function formatDisplayDate(isoString) {
  if (!isoString) return '';
  const parts = isoString.split('-').map(Number);
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function stepDate(isoString, delta) {
  const parts = isoString.split('-').map(Number);
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  date.setDate(date.getDate() + delta);
  return isoFromDate(date);
}

function isoFromYMD(year, month, day) {
  return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

function getCalendarMonth(year, month) {
  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells = [];

  for (let i = 0; i < firstDay; i++) {
    cells.push({ iso: null, day: null, empty: true });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ iso: isoFromYMD(year, month, d), day: d, empty: false });
  }
  return cells;
}

function showToast(message, type, duration) {
  type = type || '';
  duration = duration || 2400;

  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.className = 'toast ' + type;
  toast.offsetHeight;
  toast.classList.add('show');

  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
}

function formatVolume(n) {
  return Math.round(n).toLocaleString('en-US');
}

function formatLoad(n) {
  return Math.round(n).toLocaleString('en-US');
}

function formatWeight(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function renderDayDetail(containerEl, rows, dateStr) {
  const dayRows = getSessionsOnDate(rows, dateStr);

  if (dayRows.length === 0) {
    containerEl.innerHTML = '<div class="empty-state">No workout logged for this date.</div>';
    return;
  }

  const workoutDay  = dayRows[0].workoutDay;
  const displayDate = formatDisplayDate(dateStr);
  const totalLoad   = dayRows[0].totalWorkoutLoad;
  const weekLoad    = calcWeekLoad(rows, dateStr);

  const exerciseMap = new Map();
  for (const row of dayRows) {
    if (!exerciseMap.has(row.exercise)) exerciseMap.set(row.exercise, []);
    exerciseMap.get(row.exercise).push(row);
  }
  for (const entry of exerciseMap) {
    entry[1].sort((a, b) => a.setNumber - b.setNumber);
  }

  let html = '';
  html += '<div class="day-detail">';
  html += '<div class="day-detail-header">';
  html += '<div class="day-detail-type">' + workoutDay + ' Day</div>';
  html += '<div class="day-detail-date">' + displayDate + '</div>';
  html += '</div>';

  for (const entry of exerciseMap) {
    const exerciseName = entry[0];
    const sets = entry[1];
    const exLoad = sets[0].exerciseLoad;
    const totalReps = sets.reduce((s, r) => s + r.reps, 0);

    html += '<div class="detail-exercise">';
    html += '<div class="detail-exercise-name">' + exerciseName + '</div>';
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
      '<span>' + sets.length + ' sets · ' + totalReps + ' reps</span>' +
      '<span class="vol">' + formatLoad(exLoad) + '</span>' +
      '</div>';
    html += '</div>';
  }

  html += '<div class="session-total-bar">' +
    '<span class="label-text">Workout load</span>' +
    '<span class="total-num">' + formatLoad(totalLoad) + '</span>' +
    '</div>';

  html += '<div class="session-total-bar week-load-bar">' +
    '<span class="label-text">Week load</span>' +
    '<span class="total-num">' + formatLoad(weekLoad) + '</span>' +
    '</div>';

  html += '</div>';

  containerEl.innerHTML = html;
}

function createAutosaveEngine(opts) {
  const debounceMs = opts.debounceMs || 1500;
  const onStatusChange = opts.onStatusChange || function () {};
  const getDate = opts.getDate;
  const getWorkoutDay = opts.getWorkoutDay;
  const getExercisesMap = opts.getExercisesMap;

  let debounceTimer = null;
  let isSaving = false;
  let pendingResave = false;

  function scheduleSave() {
    onStatusChange('pending');
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flush, debounceMs);
  }

  async function flush() {
    clearTimeout(debounceTimer);
    debounceTimer = null;

    if (isSaving) {
      pendingResave = true;
      return;
    }

    const exMap = getExercisesMap();
    let hasAnyValidSet = false;
    for (const entry of exMap) {
      if (entry[1].length > 0) { hasAnyValidSet = true; break; }
    }
    if (!hasAnyValidSet) {
      onStatusChange('idle');
      return;
    }

    isSaving = true;
    onStatusChange('saving');

    try {
      await commitTodaysWorkout(getDate(), getWorkoutDay(), exMap);
      onStatusChange('saved');
    } catch (e) {
      onStatusChange('error', e.message);
    } finally {
      isSaving = false;
      if (pendingResave) {
        pendingResave = false;
        scheduleSave();
      }
    }
  }

  function forceFlush() {
    if (debounceTimer) {
      flush();
    }
  }

  return { scheduleSave: scheduleSave, flush: flush, forceFlush: forceFlush };
}

async function commitTodaysWorkout(date, workoutDay, exercisesMap) {
  const fileData = await getCSVFile();
  const content = fileData.content;
  const sha = fileData.sha;
  const allRows = parseCSV(content);

  const otherRows = allRows.filter(r => !(r.date === date && r.workoutDay === workoutDay));
  const newRows = rebuildRowObjects(date, workoutDay, exercisesMap);

  const merged = otherRows.concat(newRows);
  const csvText = serializeCSV(merged);

  const result = await putToWorker('/csv', csvText, sha, 'Autosave ' + workoutDay + ' \u2014 ' + date);

  try {
    await updateRecordsFromSession(exercisesMap, date);
  } catch (e) {
    console.warn('Personal records update failed:', e);
  }

  return result;
}

async function updateRecordsFromSession(exercisesMap, date) {
  const fileData = await getRecordsFile();
  const content = fileData.content;
  const sha = fileData.sha;
  let records = parseRecordsCSV(content);
  let changed = false;

  for (const entry of exercisesMap) {
    const exerciseName = entry[0];
    const sets = entry[1];
    for (const set of sets) {
      if (!set.weight || set.weight <= 0 || !set.reps || set.reps <= 0) continue;
      const before = records.find(r => r.exercise === exerciseName && r.repCount === set.reps);
      const beforeWeight = before ? before.weight : -1;
      records = mergeNewSetIntoRecords(records, exerciseName, set.weight, set.reps, date);
      const after = records.find(r => r.exercise === exerciseName && r.repCount === set.reps);
      if (after && after.weight > beforeWeight) changed = true;
    }
  }

  if (!changed) return;

  const csvText = serializeRecordsCSV(records);

  await putToWorker('/records', csvText, sha, 'Update personal records \u2014 ' + date);
}

async function rebuildAllRecordsFromHistory() {
  const workoutRaw = await getRawCSV();
  const allRows = parseCSV(workoutRaw);
  const records = computeAllTimeRecords(allRows);

  const csvText = serializeRecordsCSV(records);
  await replaceRecordsContent(csvText, 'Recalculate personal records from full history');

  return records;
}

function buildExercisesMapFromDOM(sessionEntryEl) {
  const result = new Map();
  const blocks = sessionEntryEl.querySelectorAll('.exercise-block');

  for (const block of blocks) {
    const name = block.dataset.exercise;
    if (!name) continue;

    const setRows = block.querySelectorAll('.set-row');
    const sets = [];

    for (const row of setRows) {
      const weightInput = row.querySelector('.input-weight');
      const repsInput   = row.querySelector('.input-reps');
      if (!weightInput || !repsInput) continue;

      const weight = parseFloat(weightInput.value);
      const reps   = parseInt(repsInput.value, 10);

      if (!isNaN(weight) && weight > 0 && !isNaN(reps) && reps > 0) {
        sets.push({ weight: weight, reps: reps });
      }
    }

    if (sets.length > 0) {
      result.set(name, sets);
    }
  }

  return result;
}

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

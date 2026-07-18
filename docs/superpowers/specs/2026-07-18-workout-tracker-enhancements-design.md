# Workout Tracker v2 — Enhancements Design

**Date:** 2026-07-18
**Repo:** `auckiefenstermacher19-cmd/Workout-Tracker-v2` (live on GitHub Pages, served from `main`)
**Status:** Approved for planning

---

## 1. Summary

Four user-requested capabilities plus the data-model work they require:

1. **Editable workout days** — edit not just the exercises under each day, but the day
   *categories* themselves (add / rename / remove / reorder / recolor). Today the 5 days
   (Legs, Chest, Back, Shoulders, Arms) are hardcoded across HTML/JS/CSS.
2. **Reorder exercises in three places** — (a) live in the logger, (b) editing a past day
   from the dashboard, (c) the permanent per-day default order.
3. **Correct dashboard day-aggregation** — show *all* exercises done on a calendar day with
   a correct combined day total. "Load" and "volume" are the **same single number**
   (weight × reps); no new metric.
4. **Mobile framing fix** — the sub-page top nav (whose right-most "Log Workout" button is
   the back-to-logger action) is clipped off-screen on narrow phones. Give sub-pages a clear
   back affordance that fits down to 320px.

Enabling changes: version `exercises.json` to a structure that makes days first-class data,
and add a `Session Id` column to `workout_tracker.csv` so multiple sessions on one calendar
day (including same-category) are distinct and never overwrite each other.

## 2. Goals / Non-goals

**Goals**
- Days, their order, colors, and exercise lists are all editable data — no code edit to change them.
- Reordering is possible in-session (survives reload), for a past day, and as the permanent default.
- The dashboard day view sums load across every session that calendar day; multiple sessions
  are legible and never silently overwrite.
- Sub-page back navigation is reachable and well-framed on phones ≥320px.
- 100% backward compatible with the 146 existing CSV rows and existing personal records —
  no destructive migration; the deployed app never sees a half-migrated state (code + data
  ship in the same merge).

**Non-goals**
- No separate "volume" metric distinct from load (user confirmed they are one number here).
- No Cloudflare Worker changes (it is schema-agnostic — base64 text passthrough).
- No drag-and-drop in v1 (up/down controls are the mobile-friendly MVP; drag can come later).
- No change to the personal-records model (records are exercise-keyed, unaffected by sessions).
- No auth / multi-user (single shared repo file store, unchanged).

## 3. Architecture recap (current state)

- Static PWA, 4 pages: `index.html` (logger), `dashboard.html` (history), `records.html`
  (PRs), `exercise-library.html` (add-only exercise editor). Logic in `app.js`; styles in `styles.css`.
- Data = CSV files committed back to the repo via a **Cloudflare Worker** that holds the GitHub
  PAT (browser only ever talks to the Worker). Optimistic concurrency via blob SHA.
- `exercises.json` (v1): `{ "<Day>": [ { "name": string, "defaultSets": int }, … ] }`.
  Array order drives session render order.
- `workout_tracker.csv` header: `Date,Workout Day,Exercise,Set Number,Weight,Reps,Load,Exercise Load,Total Workout Load`.
  **One row = one set.** A "session" is implicitly every row sharing `(Date, Workout Day)`.
  `Load = Weight×Reps`; `Exercise Load` and `Total Workout Load` are per-session denormalized
  sums recomputed on every write. There is **no** session id and **no** explicit order column.
- Hardcoded day coupling to remove: `--day-legs…--day-arms` vars (`styles.css:37-41`),
  `[data-day="Legs"]…` color selectors in every page, `DAY_ORDER` (`index.html:380`,
  `records.html:79`), `LIB_DAY_ORDER` (`exercise-library.html:171`), the 5 home buttons
  (`index.html:63-85`).

## 4. Data model changes

### 4.1 `exercises.json` → version 2

```json
{
  "version": 2,
  "days": [
    {
      "id": "legs",
      "name": "Legs",
      "color": "#c084fc",
      "exercises": [ { "name": "BB Squat", "defaultSets": 4 }, … ]
    },
    …
  ]
}
```

- `days` is an **ordered** array — its order is the home-screen and picker order (replaces
  `DAY_ORDER`/`LIB_DAY_ORDER`).
- `id` is a stable slug (lowercase, non-colliding) used for DOM keys and color application.
  `name` is the user-facing label written into the CSV `Workout Day` column. `color` is a hex
  string chosen from a preset swatch palette (free entry allowed).
- `exercises[]` order is the permanent default order for that day.
- **Migration:** a one-time transform of the committed v1 file → v2, preserving current order
  and mapping current names to `--day-*` colors (Legs `#c084fc`, Chest `#fb923c`, Back
  `#38bdf8`, Shoulders `#facc15`, Arms `#f472b6`). Ships in the same PR as the reader/writer
  changes so the deployed app is always consistent.
- **Read compatibility:** a loader normalizes both shapes — if `version` is absent, adapt the
  v1 object into the v2 in-memory model. (Defensive; the committed file will already be v2.)

### 4.2 `workout_tracker.csv` → add `Session Id`

New header:
```
Date,Workout Day,Exercise,Set Number,Weight,Reps,Load,Exercise Load,Total Workout Load,Session Id
```

- `Session Id` is appended **last** so column indices 0–8 are unchanged and old parsing offsets
  stay valid.
- **Backward compatibility on read:** a row with an empty/missing `Session Id` gets a synthesized
  id `"<Date>|<Workout Day>"`. So the 146 legacy rows behave exactly as today (one session per
  `(date, day)`), with **no rewrite required**.
- **Session id format for new sessions:** assigned when a session starts, stable for its life,
  URL/CSV-safe, and monotonic-ish for readability — `"<YYYY-MM-DD>-<HHMMSS>"` derived from the
  session start time (collision-safe within a day because it includes seconds; a `-2` suffix is
  appended on the astronomically unlikely same-second collision).
- **Save keying:** `commitTodaysWorkout` filters out rows by `Session Id` (not `date+day`) and
  re-appends the current session's rows. Starting a new session mints a new id → a new block →
  **no overwrite**, even for two "Chest" sessions the same day.
- `Load` / `Exercise Load` / `Total Workout Load` stay **per-session** sums (unchanged
  semantics), now correctly scoped by session id.

### 4.3 Exercise order storage

Order stays **positional** (row order within a session block) — no ordinal column. All writers
already emit rows in the in-memory Map / DOM order and all readers preserve row order, so
reordering = reordering the rows of that session block. This avoids a second schema change.
(Adding an ordinal column was considered and rejected as unnecessary churn given positional
order already round-trips.)

## 5. Feature designs

### 5.1 Editable days (the "Manage" page)

Repurpose `exercise-library.html` (add-only today) into a **Manage** page with two levels,
both driven by the v2 model:

- **Days:** list in order; per day: rename, recolor (swatch palette), remove, reorder (up/down).
  "Add day" creates a new `{id, name, color, exercises:[]}`. Removing a day that has logged
  history warns first (history rows remain in the CSV under the old name; they simply lose their
  picker entry).
- **Exercises within a day:** list in order; per exercise: rename, set `defaultSets`, remove,
  reorder (up/down). "Add exercise" preserves the existing case-insensitive duplicate guard
  within a day; cross-day name reuse stays allowed.
- **Persistence:** edits mutate an in-memory v2 object; a single **Save** commits the whole
  `exercises.json` via the existing `replaceExercisesContent()` (one commit per Save, not per
  keystroke). SHA-guarded; a 409 (stale SHA) re-reads and retries.

**Rename-a-day → history rewrite (confirmed):** on save, if any day `name` changed, also rewrite
`workout_tracker.csv` rows whose `Workout Day` equals the old name → new name, and commit that
too (a second commit). Old↔new name mapping is tracked per edit session. A checkbox
("Also rename this day in past history", default **on**) lets the user opt out. Personal records
are exercise-keyed and need no change.

**Dynamic day rendering (removes hardcoding):**
- Home day buttons (`index.html`) render from `model.days` order.
- Day colors apply at runtime — set a `--day-color` custom property (or direct `color`/`background`)
  on each day-colored element from `day.color`, replacing the fixed `--day-*` vars and
  `[data-day="Name"]` selectors in `index.html`, `dashboard.html`, `records.html`,
  `exercise-library.html`, `styles.css`.
- `DAY_ORDER` / `LIB_DAY_ORDER` derive from `model.days`.

### 5.2 Reorder — three surfaces

- **(a) Live logger:** up/down buttons in each exercise card's header actions
  (`buildExerciseCard`, alongside swap + remove). Moving a card reorders DOM nodes (never past
  the trailing "add exercise" control) and calls `handleInputChange()`, so the next autosave
  writes the new order. **Durability:** extend the localStorage draft to persist an explicit
  ordered exercise-name list, and make `buildExerciseList` honor saved order on resume
  (falling back to default order for names not in the draft, and appending
  added-but-non-default exercises so they survive reload — fixing a current resume gap).
- **(b) Past day (dashboard):** an "Edit order" affordance on a day/session in the dashboard
  detail view; up/down reorders that session's exercises, then rewrites that session's rows in
  the CSV (keyed by session id) and re-commits. Scope = reorder only (not add/remove) in v1.
- **(c) Permanent default:** the exercise up/down in the Manage page (5.1) writes the new order
  into `exercises.json`, seeding all future sessions of that day.

### 5.3 Dashboard day-aggregation

`renderDayDetail` is already calendar-day scoped for the exercise *list* (`getSessionsOnDate`
ignores workout day). Fix the totals and make sessions legible:

- **Combined day total:** replace `dayRows[0].totalWorkoutLoad` with the sum of per-set load
  across all rows that date: `dayRows.reduce((s,r)=>s+r.load,0)`. (Cannot sum
  `totalWorkoutLoad` — it's duplicated per row.)
- **Per-exercise subtotal:** replace `sets[0].exerciseLoad` with the sum of that exercise's set
  loads, so a value stays correct even if an exercise appears in two sessions.
- **Sessions sub-grouping:** group `dayRows` by `Session Id`; render each session as a labeled
  sub-group (day name + per-session subtotal) under one combined **day total** header. A
  single-session day looks essentially as it does today.
- **Multi-type header:** derive the de-duplicated set of day names for the date; render them
  joined (e.g. "Back + Chest") with per-session color, instead of assuming one type.
- **Week bar:** fix `calcWeekLoad` to sum each date's raw set loads (not one row's
  `totalWorkoutLoad`) so it stays consistent with the corrected day total.
- Remove now-dead `formatVolume` / `groupByDate` if provably unused after these edits.

### 5.4 Mobile framing / back button

- Unify the three near-identical sub-page headers (`dashboard.html`, `records.html`,
  `exercise-library.html`) into one shared header pattern in `styles.css`
  (`.page-header` / `.page-header-actions`), removing the inline/unclassed variants.
- Give sub-pages a clear **back affordance**: a left back-arrow icon button (mirroring the
  logger's `#btn-back-home` ←) that returns to the logger, with the remaining nav as compact
  buttons that **wrap** (and title `min-width:0` to truncate) so nothing is clipped at 320–360px.
- Touch targets: raise the header nav buttons to the app's `--tap-min` (44px) from the current
  36px `btn-sm`.
- Do **not** touch safe-area/notch handling — it is already correct
  (`padding-top: max(var(--space-3), env(safe-area-inset-top))`, `viewport-fit=cover`).
- Remove dead `.app-header` / `.home-screen` / `.session-screen` CSS to reduce confusion.

## 6. Sequencing (independently shippable steps)

1. **Foundation** — `exercises.json` v2 model + loader/adapter; `Session Id` column + read
   fallback + session-id-keyed save. No visible feature yet, but everything below depends on it.
2. **Mobile framing** — fastest QoL win; isolated to headers/CSS.
3. **Logger reorder** — up/down + durable draft order.
4. **Dashboard** — combined totals, session sub-groups, edit-past-day reorder.
5. **Manage page** — day + exercise CRUD, dynamic day rendering, rename-history rewrite.

## 7. Testing strategy

The app's data layer requires the Worker, so tests run **locally against copies**, never the
live Worker/CSVs:

- **Pure-logic unit tests** (Node, no network) for the highest-risk functions: v1→v2 adapter,
  CSV parse/serialize round-trip with and without `Session Id`, legacy session-id synthesis,
  session-scoped save keying, combined day-total math, rename→history-rewrite transform,
  reorder→row-order round-trip. Factor these into a small testable module if needed.
- **Local page smoke test** with a stubbed data layer (fixture `exercises.json` v2 +
  `workout_tracker.csv`) to exercise: home renders dynamic days; logger reorder persists across a
  simulated resume; dashboard shows two same-day sessions with a correct combined total; sub-page
  headers fit at 320/360/375px with the back affordance reachable.
- **Manual pre-merge check** on a throwaway branch/Pages preview or the local server before the
  live merge.

## 8. Risks & mitigations

- **Live-data corruption** (app writes to `main`): work on a branch; never point dev testing at
  the live Worker; ship code+data migration atomically; keep reads backward-compatible so a
  partial rollout can't misread legacy rows. → **Primary risk; mitigated by branch + atomic PR + tests.**
- **Stale-SHA 409s** during multi-commit saves (rename does 2 commits): re-read SHA and retry per
  commit; do the `exercises.json` commit and the CSV-rewrite commit sequentially.
- **Day removal with history:** history rows persist under the old name; warn on remove; they
  render under an "Other"/uncategorized bucket in records (already handled there).
- **Session-id collision same second:** append numeric suffix; effectively impossible in single-user use.
- **Color contrast** of user-chosen day colors on dark UI: constrain the picker to a vetted
  swatch palette by default.

## 9. Rollout

Branch `feature/workout-qol-editable-days` → PR → local/manual verification → user review → merge
to `main` (auto-deploys via Pages). Because Pages deploys `main`, the merge is the go-live; no
separate deploy step.

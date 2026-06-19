# Workout Tracker

A three-page personal fitness PWA hosted on GitHub Pages. Workout
data lives in CSV files in this repository. A small Cloudflare
Worker acts as a proxy to GitHub's API, so the browser never holds
a GitHub credential directly.

---

## How it works

```
[index.html]  Workout Tracker  --writes-->   [Cloudflare Worker]  --authenticated-->  [GitHub API]
[dashboard.html] Dashboard     --reads--->        (holds the                          workout_tracker.csv
[records.html]  Records        --reads--->      GitHub token as                       personal_records.csv
                                                a server secret)
```

**index.html** is the mid-workout logger. Pick a day, log sets, every
keystroke autosaves (debounced ~1.5s) through the Worker to GitHub.

**dashboard.html** is the history viewer, browsable by date, with a
calendar popup and weekly load rollups.

**records.html** shows your all-time best weight at every rep count
you've logged, per exercise, grouped by workout day.

All three pages link to each other via the header/footer nav.

### Why a Worker is involved

A pure static site has no way to call GitHub's authenticated API
without embedding a token somewhere the browser can read it — which
makes that token effectively public, since anyone who loads the page
can view it. GitHub actively scans for exposed tokens like this and
revokes them, which causes exactly the kind of broken, hard-to-debug
failures this setup is built to avoid.

The Cloudflare Worker is a small piece of server-side code (free
tier, no credit card required) that holds the real GitHub token as
an environment secret. The browser talks only to the Worker; the
Worker talks to GitHub. The token never appears in any file in this
repository, in any browser console, or anywhere a person or an
automated scanner could read it from the deployed site.

---

## File structure

```
/
├── index.html              Workout Tracker
├── dashboard.html          Dashboard
├── records.html            Personal Records
├── styles.css              Shared stylesheet
├── app.js                  Shared logic -- calls the Worker, not GitHub directly
├── config.js               Holds only your Worker's URL -- no secrets
├── exercises.json           Exercise list by workout day
├── workout_tracker.csv      Logged workout data (append/update via the Worker)
├── personal_records.csv     Best weight per rep count, per exercise
├── cloudflare-worker/
│   └── worker.js            The Worker script -- deployed separately, NOT to GitHub Pages
└── README.md                This file
```

The `cloudflare-worker/` folder can live in this repo for reference,
but its contents are deployed to Cloudflare, not to GitHub Pages --
GitHub Pages only serves the files at the repo root.

---

## Setup: step by step

### 1. Create the GitHub repository

1. [github.com/new](https://github.com/new) -- name it anything,
   set visibility to **Public**, do not auto-add a README.
2. Push all files from this project to the repo's `main` branch,
   at the root (not nested in a subfolder).

### 2. Enable GitHub Pages

1. Repo **Settings -> Pages**
2. Source: **Deploy from a branch**. Branch: **main**, folder **/ (root)**
3. Save, wait ~60 seconds, your site will be live at
   `https://YOUR_USERNAME.github.io/YOUR_REPO/`

### 3. Create a GitHub Personal Access Token

This token will live ONLY in Cloudflare, never in this repo.

1. [github.com/settings/tokens](https://github.com/settings/tokens)
   (classic tokens -- simpler and avoids fine-grained-token
   dormancy-expiry quirks for a single personal-use token like this)
2. **Generate new token (classic)**
3. Expiration: **No expiration** (or your preferred rotation window)
4. Scopes: check the single **repo** checkbox
5. Generate, copy the token, and paste it somewhere temporary you
   control (a password manager, not a chat or a text file you'll
   forget about) -- you'll need it in the next step, once, and then
   never need to handle it directly again.

### 4. Deploy the Cloudflare Worker

1. Create a free account at [dash.cloudflare.com](https://dash.cloudflare.com)
2. In the dashboard, go to **Workers & Pages -> Create -> Create Worker**
3. Give it a name (e.g. `workout-tracker-proxy`), deploy the default
   starter
4. Click **Edit code**, delete everything in the editor, paste in
   the full contents of `cloudflare-worker/worker.js` from this repo
5. Click **Deploy**
6. Go to the Worker's **Settings -> Variables and Secrets**
7. Add these (mark `GITHUB_PAT` as **Secret**, the rest as plain
   **Variables**):
   - `GITHUB_PAT` (Secret) -- the token from Step 3
   - `GITHUB_OWNER` (Variable) -- your GitHub username
   - `GITHUB_REPO` (Variable) -- your repo name
   - `ALLOWED_ORIGIN` (Variable) -- your GitHub Pages URL, e.g.
     `https://YOUR_USERNAME.github.io`
8. Save. Copy your Worker's URL, shown at the top of the Worker's
   overview page -- looks like
   `https://workout-tracker-proxy.YOUR-SUBDOMAIN.workers.dev`

### 5. Point config.js at your Worker

Edit `config.js` in your repo (directly on GitHub is fine -- there's
no secret in this file, so push protection will never block it):

```js
var WORKER_CONFIG = {
  baseUrl: 'https://workout-tracker-proxy.YOUR-SUBDOMAIN.workers.dev',
  ...
};
```

Commit. That's the only edit this file ever needs.

---

## Rotating the token later

If you ever need to rotate the GitHub token:

1. Generate a new one (Step 3 above)
2. Cloudflare dashboard -> your Worker -> **Settings -> Variables and
   Secrets -> GITHUB_PAT -> Edit -> paste new value -> Save**
3. Revoke the old token on GitHub

No commit to this repo is ever required to rotate the token, and the
token is never at risk of triggering GitHub's push protection, since
it's never part of a git commit at all.

---

## Adding or editing exercises

Edit `exercises.json` directly. Structure:

```json
{
  "Back": [
    { "name": "BB Row", "defaultSets": 4 }
  ]
}
```

Add, reorder, or rename entries as needed; commit the change.
Renaming an exercise only affects new sessions going forward --
existing history under the old name stays under the old name.

---

## Known limitations

**Worker cold starts.** The free Cloudflare Workers tier may have a
brief (under 50ms typically) cold-start delay on the first request
after a period of inactivity. Not noticeable in normal use.

**Worker free tier limits.** 100,000 requests/day on the free plan
-- far more than a single person logging workouts will ever use.

**No offline support.** Both the Worker and GitHub need to be
reachable for any read or write. If you're offline mid-workout,
typed data still saves to your browser's local storage instantly
and will sync once you're back online and reload the page.

**Single-user only.** The Worker and token are scoped to one GitHub
repo with no per-user authentication of its own -- anyone who knows
your Worker's URL could read or write your workout data. Setting
`ALLOWED_ORIGIN` in the Worker restricts browser-based requests to
only your GitHub Pages domain, which covers the realistic threat
model for a personal tracker, but is not the same as real user
authentication.

## Test checklist before first real use

- [ ] Worker deployed, all 4 environment variables/secrets set
- [ ] `config.js` has the correct Worker URL
- [ ] Tap a workout day on index.html -- exercises appear
- [ ] Type a weight and reps -- save-status pill cycles
      Typing -> Saving -> Saved within ~2 seconds
- [ ] Open `workout_tracker.csv` in the repo -- new row appended
- [ ] dashboard.html shows today's session with correct load numbers
- [ ] records.html shows day-grouped personal records

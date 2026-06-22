/**
 * Cloudflare Worker — GitHub API proxy for Workout Tracker
 *
 * This Worker is the ONLY place the GitHub Personal Access Token
 * exists. It is stored as a Cloudflare secret (set via the
 * dashboard or `wrangler secret put`), never committed to any
 * repo, never sent to the browser.
 *
 * The browser calls this Worker's URL instead of api.github.com
 * directly. The Worker attaches the real Authorization header
 * server-side and relays GitHub's response back.
 *
 * ── Environment variables / secrets required (set in Cloudflare) ──
 *   GITHUB_PAT     - the GitHub Personal Access Token (secret)
 *   GITHUB_OWNER   - your GitHub username (plain variable, not secret)
 *   GITHUB_REPO    - the repo name (plain variable, not secret)
 *   ALLOWED_ORIGIN - your GitHub Pages URL, e.g.
 *                    https://auckiefenstermacher19-cmd.github.io
 *                    (used for CORS; restricts who can call this Worker)
 *
 * ── Endpoints exposed to the app ──
 *   GET  /csv              -> returns { content, sha } for workout_tracker.csv
 *   PUT  /csv               body: { content, sha, message } -> writes workout_tracker.csv
 *   GET  /records           -> returns { content, sha } for personal_records.csv
 *   PUT  /records            body: { content, sha, message } -> writes personal_records.csv
 *   GET  /exercises          -> returns { content, sha } for exercises.json
 *   PUT  /exercises          body: { content, sha, message } -> writes exercises.json
 *   GET  /raw/csv            -> returns raw CSV text (workout_tracker.csv), unauthenticated passthrough
 *   GET  /raw/records        -> returns raw CSV text (personal_records.csv), unauthenticated passthrough
 *   GET  /raw/exercises      -> returns raw JSON text (exercises.json), unauthenticated passthrough
 */

const GITHUB_API_BASE = 'https://api.github.com';

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function jsonResponse(data, status, env) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(env),
    },
  });
}

function textResponse(text, status, env) {
  return new Response(text, {
    status: status || 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      ...corsHeaders(env),
    },
  });
}

async function githubFetch(env, path, options) {
  options = options || {};
  const url = GITHUB_API_BASE + path;
  const headers = Object.assign(
    {
      'Authorization': 'token ' + env.GITHUB_PAT,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'workout-tracker-worker',
    },
    options.headers || {}
  );

  return fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body,
  });
}

async function handleGetFile(env, filePath) {
  const res = await githubFetch(env, '/repos/' + env.GITHUB_OWNER + '/' + env.GITHUB_REPO + '/contents/' + filePath);

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return jsonResponse({ error: 'GitHub read failed', status: res.status, message: body.message }, res.status, env);
  }

  const json = await res.json();
  // Decode base64 content here on the server so the app gets plain text directly
  const decoded = atob(json.content.replace(/\n/g, ''));

  return jsonResponse({ content: decoded, sha: json.sha }, 200, env);
}

async function handlePutFile(env, filePath, requestBody) {
  let parsed;
  try {
    parsed = JSON.parse(requestBody);
  } catch (e) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, env);
  }

  const { content, sha, message } = parsed;

  if (typeof content !== 'string' || typeof sha !== 'string') {
    return jsonResponse({ error: 'content and sha are required' }, 400, env);
  }

  const encoded = btoa(unescape(encodeURIComponent(content)));

  const res = await githubFetch(env, '/repos/' + env.GITHUB_OWNER + '/' + env.GITHUB_REPO + '/contents/' + filePath, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: message || ('Update ' + filePath),
      content: encoded,
      sha: sha,
      branch: 'main',
    }),
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    return jsonResponse({ error: 'GitHub write failed', status: res.status, message: json.message }, res.status, env);
  }

  return jsonResponse({ success: true, sha: json.content ? json.content.sha : null }, 200, env);
}

async function handleRawFile(env, filePath) {
  // Raw passthrough using the same authenticated contents endpoint
  // (works even if the underlying repo is private, unlike
  // raw.githubusercontent.com which requires the repo to be public
  // for unauthenticated access).
  const res = await githubFetch(env, '/repos/' + env.GITHUB_OWNER + '/' + env.GITHUB_REPO + '/contents/' + filePath);

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return textResponse('ERROR: ' + (body.message || res.statusText), res.status, env);
  }

  const json = await res.json();
  const decoded = atob(json.content.replace(/\n/g, ''));

  return textResponse(decoded, 200, env);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(env) });
    }

    try {
      if (path === '/csv' && method === 'GET') {
        return await handleGetFile(env, 'workout_tracker.csv');
      }

      if (path === '/csv' && method === 'PUT') {
        const body = await request.text();
        return await handlePutFile(env, 'workout_tracker.csv', body);
      }

      if (path === '/records' && method === 'GET') {
        return await handleGetFile(env, 'personal_records.csv');
      }

      if (path === '/records' && method === 'PUT') {
        const body = await request.text();
        return await handlePutFile(env, 'personal_records.csv', body);
      }

      if (path === '/exercises' && method === 'GET') {
        return await handleGetFile(env, 'exercises.json');
      }

      if (path === '/exercises' && method === 'PUT') {
        const body = await request.text();
        return await handlePutFile(env, 'exercises.json', body);
      }

      if (path === '/raw/csv' && method === 'GET') {
        return await handleRawFile(env, 'workout_tracker.csv');
      }

      if (path === '/raw/records' && method === 'GET') {
        return await handleRawFile(env, 'personal_records.csv');
      }

      if (path === '/raw/exercises' && method === 'GET') {
        return await handleRawFile(env, 'exercises.json');
      }

      return jsonResponse({ error: 'Not found', path: path }, 404, env);

    } catch (err) {
      return jsonResponse({ error: 'Worker exception', message: err.message }, 500, env);
    }
  },
};

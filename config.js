// -----------------------------------------------------------------
//  config.js -- Workout Tracker configuration
//
//  This file contains NO secrets. The GitHub token lives only in
//  your Cloudflare Worker's environment, set via the Cloudflare
//  dashboard or `wrangler secret put GITHUB_PAT`. The browser only
//  ever talks to your Worker, never to api.github.com directly.
// -----------------------------------------------------------------

var WORKER_CONFIG = {
  // Replace with your actual deployed Worker URL, e.g.
  // 'https://workout-tracker-proxy.your-subdomain.workers.dev'
  baseUrl: 'https://workout-tracker-proxy.auckiefenstermacher19.workers.dev',

  get isConfigured() {
    return (
      this.baseUrl !== 'YOUR_WORKER_URL_HERE' &&
      this.baseUrl.length > 0 &&
      this.baseUrl.indexOf('http') === 0
    );
  }
};

// Kept for backward compatibility with any code still checking
// GITHUB_CONFIG.isConfigured -- both now point at the same check.
var GITHUB_CONFIG = {
  get isConfigured() {
    return WORKER_CONFIG.isConfigured;
  }
};

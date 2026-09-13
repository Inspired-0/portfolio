/**
 * Playwright configuration for the portfolio site.
 *
 * The site is a folder of static files: there is no build step, so the tests run against the very
 * same files a static host would serve, started by Playwright itself through `webServer`.
 *
 * Options, one by one:
 *   testDir            — only `tests/` holds specs; `portfolio/` must never be scanned for tests.
 *   projects           — a single `chromium` project. One engine is enough for the scenarios this
 *                        suite covers (spec §14.5, §14.7, §14.9); cross-browser checking is a
 *                        manual, pre-delivery step per spec §11, not part of this harness.
 *   use.baseURL        — lets specs call `page.goto('/')`. 127.0.0.1 (not `localhost`) matches the
 *                        address `python -m http.server` binds to and avoids the IPv6/IPv4
 *                        `localhost` resolution split on Windows.
 *   webServer.command  — the exact command README documents for local runs, so tests and manual
 *                        checks look at the same server behaviour.
 *   webServer.url      — Playwright waits for this URL to answer before the first test starts.
 *   webServer.reuseExistingServer
 *                      — false: a foreign process already listening on the port becomes an
 *                        immediate, explicit error instead of the suite silently running against
 *                        whatever that process serves. Port 8765 is used (not 8000) because it
 *                        sits outside the common local-dev defaults (3000, 5000, 8000, 8080) and
 *                        outside this machine's Hyper-V/Docker dynamic-port reservation ranges,
 *                        so a collision here is a real signal, not routine noise.
 *   webServer.timeout  — 30 s is generous for a local `http.server` start; a longer wait would
 *                        only delay the report when Python is missing from PATH.
 *
 * Source (installed version, `node_modules/playwright/types/test.d.ts`, @playwright/test 1.63.0):
 * `webServer` — "If the url is specified, Playwright Test will wait for the URL to return a 2xx,
 * 3xx, 400, 401, 402, or 403 status code before running the tests."
 * See also https://playwright.dev/docs/test-webserver
 */

const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'tests',

  /*
   * One worker, no retries.
   *
   * `python -m http.server` occasionally refuses a connection when several workers hit it at
   * once: the run then fails with `net::ERR_CONNECTION_REFUSED` — on `page.goto` outright, or,
   * worse, on a module script, which aborts the whole module graph so the page loads unenhanced
   * and a dialog or rail test fails for a reason that has nothing to do with the code. Observed
   * roughly once in five parallel runs, never in a serial one. A single worker removes the race
   * at the source, and the suite is small enough (about 15 s end to end) that the parallelism was
   * not buying anything. Deliberately no `retries`: a retry would hide the flake instead of
   * removing it, and every remaining failure in this suite is a real one.
   */
  workers: 1,

  projects: [
    {
      name: 'chromium',
      // Plain Chromium, no device emulation: the layout specs set their own viewport per width.
      use: { browserName: 'chromium' },
    },
  ],

  use: {
    baseURL: 'http://127.0.0.1:8765',
  },

  webServer: {
    command: 'python -m http.server 8765 --directory portfolio',
    url: 'http://127.0.0.1:8765',
    reuseExistingServer: false,
    timeout: 30000,
  },
});

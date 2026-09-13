/**
 * Progressive-enhancement suite — spec §14 scenario 7:
 * «При выключенном JavaScript доступны история, подробности кейсов и контакты.»
 * (Quality requirement §11 «Надёжность»: main content and contacts work with JavaScript off.)
 *
 * The whole file runs in a browser context with scripting disabled, so it stays honest once the
 * later tasks add `navigation.js`, `case-dialog.js` and `motion.js`: anything those modules hide,
 * move or fold away must still be readable here. Assertions are structural (visibility, text
 * length, href shape) — no page copy is compared to a literal string, per spec §14 and CLAUDE.md.
 *
 * `javaScriptEnabled: false` is a browser-context option; Playwright's own locator engine runs in
 * an isolated world and keeps working, which is why `innerText()` below is still available.
 * Source (installed @playwright/test 1.63.0, node_modules/playwright-core/types/types.d.ts):
 * "Whether or not to enable JavaScript in the context. Defaults to `true`."
 * https://playwright.dev/docs/emulation#javascript-enabled
 */

const { test, expect } = require('@playwright/test');

test.use({ javaScriptEnabled: false });

// The six history chapters in document order (ids are the DOM contract from Task 1).
const CHAPTER_IDS = [
  'chapter-prologue',
  'chapter-kodologia',
  'chapter-urfu',
  'chapter-artsofte',
  'chapter-pressindex',
  'chapter-restaff',
];

// Shortest case description that still counts as "readable" rather than a stub or a teaser.
const MIN_CASE_DETAILS_LENGTH = 200;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('history chapters render without JavaScript', async ({ page }) => {
  for (const id of CHAPTER_IDS) {
    // Visibility, not mere presence: a reveal animation that starts at opacity 0 and waits for a
    // JS class would leave the chapter in the DOM but invisible — that is the failure to catch.
    await expect(page.locator(`#${id}`)).toBeVisible();
  }
});

test('case details are readable without JavaScript', async ({ page }) => {
  const details = page.locator('[data-case-details]');

  // Every card owns one readable description, including the GitHub projects.
  const cards = page.locator('.case-card');
  const count = await cards.count();
  expect(count).toBeGreaterThan(0);
  await expect(details).toHaveCount(count);

  for (let i = 0; i < count; i += 1) {
    const block = details.nth(i);
    await expect(block).toBeVisible();

    // innerText (rendered text, not textContent) ignores display:none subtrees, so a block that is
    // technically present but collapsed by CSS fails here instead of passing on hidden markup.
    const text = await block.innerText();
    expect(text.trim().length).toBeGreaterThan(MIN_CASE_DETAILS_LENGTH);
  }
});

test('contacts are reachable without JavaScript', async ({ page }) => {
  // Both contact channels are plain links with a real protocol: no JS handler, no fake form.
  const telegram = page.locator('#contacts a[href^="https://t.me/"]');
  const email = page.locator('#contacts a[href^="mailto:"]');

  for (const link of [telegram, email]) {
    await expect(link).toBeVisible();

    // A non-empty href beyond the scheme itself — `mailto:` or `https://t.me/` alone would match
    // the selector above while leading nowhere.
    const href = await link.getAttribute('href');
    expect(href).toBeTruthy();
    expect(href.replace(/^mailto:|^https:\/\/t\.me\//, '').length).toBeGreaterThan(0);
  }
});

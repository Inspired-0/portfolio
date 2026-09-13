/**
 * Reduced-motion suite — spec §14.8: «При включённом prefers-reduced-motion анимации отключены,
 * контент доступен» (spec §9 for the motion contract, §11 «Надёжность» for the console).
 *
 * The whole file runs in a browser context that reports `prefers-reduced-motion: reduce`, so it
 * grades `portfolio/scripts/motion.js` and `portfolio/styles/motion.css` from the far side of the
 * gate: with the preference on, `motion.js` must not set `data-motion="on"` at all, no reveal rule
 * may ever match, and every chapter must be readable the moment the page loads — before any
 * scrolling, which is exactly what a reveal-on-scroll effect would depend on.
 *
 * The failure this suite exists to catch is a reveal rule that hides content outside the
 * `[data-motion="on"]` scope: the page would then load with transparent chapters and only paint
 * them in on scroll, for a reader who asked for the opposite.
 *
 * Emulation (installed @playwright/test 1.63.0, node_modules/playwright-core/types/types.d.ts):
 * `reducedMotion` — "Emulates 'prefers-reduced-motion' media feature, supported values are
 * 'reduce', 'no-preference'." It is a context option, so `test.use` applies it to every test here.
 * https://playwright.dev/docs/emulation#reduced-motion
 *
 * Assertions are structural — computed opacity, dialog state, console output — and never compare
 * page copy to a literal (spec §14, CLAUDE.md).
 */

const { test, expect } = require('@playwright/test');

test.use({ reducedMotion: 'reduce' });

// One case is enough for the dialog round trip here: the dialog's own behaviour is covered by
// tests/case-dialog.spec.js; what this file adds is that reduced motion does not change it.
const CASE_CARD_ID = 'case-restaff-screening';
const CASE_DETAILS_ID = 'case-restaff-screening-details';

test('all chapters are visible immediately with reduced motion', async ({ page }) => {
  await page.goto('/');

  const state = await page.evaluate(() => ({
    // `motion.js` returns before touching the attribute when the preference is on; `undefined`
    // here is what proves the early return ran, not merely that the CSS happened to be harmless.
    motionFlag: document.documentElement.dataset.motion,
    // Read without scrolling first: a reveal-on-scroll effect is only visible as a failure while
    // the lower chapters have never entered the viewport.
    opacities: [...document.querySelectorAll('.chapter')]
      .map((chapter) => getComputedStyle(chapter).opacity),
    revealed: [...document.querySelectorAll('.chapter.is-inview')].length,
    chapterCount: document.querySelectorAll('.chapter').length,
  }));

  expect(state.chapterCount, 'the six history chapters are on the page').toBe(6);
  expect(state.motionFlag, 'motion.js set data-motion despite the reduce preference')
    .toBeUndefined();
  expect(state.revealed, 'the reveal class was added despite the reduce preference').toBe(0);
  // Every chapter, including the ones far below the fold, is fully opaque on load.
  expect(state.opacities, 'a chapter is not fully opaque with reduced motion')
    .toEqual(Array(state.chapterCount).fill('1'));
});

test('case dialog opens and closes with reduced motion', async ({ page }) => {
  await page.goto('/');

  const link = page.locator(`#${CASE_CARD_ID} [data-case-link]`);
  await link.click();

  const dialog = page.locator('#case-dialog');
  await expect(dialog).toBeVisible();
  // The panel is readable, not merely present: an open transition that never finishes (a
  // @starting-style rule leaking outside the motion gate) would leave it at opacity 0.
  await expect(page.locator(`#case-dialog-body #${CASE_DETAILS_ID}`)).toBeVisible();
  expect(await dialog.evaluate((node) => getComputedStyle(node).opacity),
    'the dialog panel is transparent with reduced motion').toBe('1');

  await page.locator('#case-dialog [data-dialog-close]').click();
  await expect(dialog).toBeHidden();
  // The borrowed node went home and focus came back — the close path is unaffected by the gate.
  await expect(page.locator(`#${CASE_CARD_ID} > #${CASE_DETAILS_ID}`)).toHaveCount(1);
  expect(await page.evaluate(() => document.activeElement.getAttribute('href')))
    .toBe(`#${CASE_DETAILS_ID}`);
});

test('no console errors with reduced motion', async ({ page }) => {
  const problems = [];

  // Attached before the first navigation, so nothing logged during load is missed.
  page.on('console', (message) => {
    if (message.type() === 'error') {
      problems.push(`console.error: ${message.text()}`);
    }
  });
  // Uncaught exceptions never reach page.on('console') — they arrive as 'pageerror'.
  page.on('pageerror', (error) => {
    problems.push(`pageerror: ${error.message}`);
  });

  await page.goto('/');

  // The full reading scenario: scroll the history, then open and close a case. With the gate on,
  // the observer never starts — anything that still assumes it did would throw here.
  await page.evaluate(async () => {
    const step = window.innerHeight;
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo({ top: y, left: 0, behavior: 'instant' });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  });

  await page.locator(`#${CASE_CARD_ID} [data-case-link]`).click();
  await expect(page.locator('#case-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#case-dialog')).toBeHidden();

  // The array carries the messages, so a failure names the broken script instead of "expected 0".
  expect(problems).toEqual([]);
});

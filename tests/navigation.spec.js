/**
 * Chapter-rail suite — spec §14 scenario 3: «При прокрутке истории индикатор главы отражает
 * текущую главу» (spec §9 for the behaviour: exactly one chapter is marked, and the mark is not
 * colour-only).
 *
 * What these tests grade is `portfolio/scripts/navigation.js` — the IntersectionObserver that
 * marks one rail link while the reader moves through `section#path`. They are written against the
 * DOM contract from Task 1 and never against page copy (spec §14, CLAUDE.md):
 *   `.chapter[data-chapter]` with the fixed chapter ids, in document order;
 *   `a.chapter-rail__link[data-chapter-link]` inside `#chapter-rail`, `href="#<chapter id>"`;
 *   `.is-current` + `aria-current="true"` — the two halves of the marked state, set together.
 * `--header-height` on `:root` is the same token the module reads to offset its observer, so the
 * scroll helper below positions headings against the header the way the module measures it.
 *
 * Both tests use auto-retrying locator assertions rather than a fixed wait: IntersectionObserver
 * callbacks are delivered asynchronously, after the frame in which the scroll is committed
 * (https://developer.mozilla.org/en-US/docs/Web/API/IntersectionObserver), so "wait for the
 * observer" is expressed as the expectation itself.
 */

const { test, expect } = require('@playwright/test');

// The third chapter of the history, counted in document order — deep enough that reaching it
// means several chapters have already scrolled past the header.
const THIRD_CHAPTER_ID = 'chapter-urfu';

const CURRENT_LINK = '.chapter-rail__link.is-current';

/**
 * Scrolls the page so that an element's top edge sits just below the sticky header.
 *
 * The offset mirrors what the reader sees: `navigation.js` shrinks its observation band from the
 * top by `--header-height`, so an element parked a few pixels below the header's bottom edge is
 * unambiguously the topmost thing inside that band — the position the "current chapter" rule is
 * defined for. The extra 8 px keeps the test off the exact boundary, where sub-pixel layout
 * rounding decides the answer.
 *
 * `behavior: 'instant'` is required: base.css sets `scroll-behavior: smooth` for readers without
 * a reduced-motion preference, and a smooth scroll would still be in flight when the assertions
 * start sampling.
 *
 * @param {import('@playwright/test').Page} page — the page under test.
 * @param {string} selector — CSS selector of the element to park under the header.
 * @returns {Promise<void>} resolves once the scroll has been applied.
 */
async function parkUnderHeader(page, selector) {
  await page.evaluate((target) => {
    const element = document.querySelector(target);
    const headerBottom = document.getElementById('site-header').getBoundingClientRect().bottom;
    const top = element.getBoundingClientRect().top + window.scrollY - headerBottom - 8;
    window.scrollTo({ top, left: 0, behavior: 'instant' });
  }, selector);
}

test.beforeEach(async ({ page }) => {
  // A tall-enough viewport for the rail and several chapters to be on screen at once; 1280 px is
  // the desktop width of the spec §11 matrix, where the rail is the vertical variant.
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
});

test('exactly one rail link is current while reading the history', async ({ page }) => {
  // The chapter's heading — not the article — is what a reader sees arrive under the header.
  await parkUnderHeader(page, `#${THIRD_CHAPTER_ID} .chapter__title`);

  // One link and one only: the mark moves, it is never duplicated across chapters.
  const current = page.locator(CURRENT_LINK);
  await expect(current).toHaveCount(1);
  // …and it is the third chapter's link, matched through the href contract rather than position.
  await expect(current).toHaveAttribute('href', `#${THIRD_CHAPTER_ID}`);
  // The class alone is decoration; assistive technology reads the attribute, so both must be set.
  await expect(current).toHaveAttribute('aria-current', 'true');
});

test('no rail link stays current past the history section', async ({ page }) => {
  // Below `section#path` there is no current chapter: a mark left behind here would tell the
  // reader they are still inside a history they have already left.
  await parkUnderHeader(page, '#cases-title');

  await expect(page.locator(CURRENT_LINK)).toHaveCount(0);
  // The attribute is removed together with the class — a stale `aria-current` would be read out
  // even though nothing is highlighted on screen.
  await expect(page.locator('.chapter-rail__link[aria-current]')).toHaveCount(0);
});

/**
 * Layout and navigation suite — spec §14 scenario 9 («На указанных ширинах и при увеличении текста
 * нет перекрытий и недоступных кнопок», checked here as: no horizontal page overflow at 360, 768,
 * 1280 and 1440 px) and scenario 5 («Из любой главы можно перейти к контактам; якоря не скрываются
 * под шапкой»), plus §11 «Надёжность» — no console errors in the main scenarios.
 *
 * These tests grade the CSS and JS tasks that follow, so they are written against the DOM contract
 * (ids, `.site-nav__link`, `#site-header`) and never against page copy.
 */

const { test, expect } = require('@playwright/test');

// Reference widths from spec §11. Height is fixed and deliberately short: a small viewport means
// more scrolling, which is exactly what the overflow check wants to exercise.
const WIDTHS = [360, 768, 1280, 1440];
const VIEWPORT_HEIGHT = 720;

/**
 * Waits until the page has stopped scrolling.
 *
 * An anchor click returns immediately, but `scroll-behavior: smooth` (added with the motion task)
 * animates for a few hundred milliseconds afterwards. Measuring right after the click would then
 * read a position mid-flight. A two-animation-frame check is not enough: the smooth scroll itself
 * only starts a frame or two after the hash changes, so those two frames can both land before any
 * movement happens and the helper would resolve at the pre-jump position. Instead this polls
 * `scrollY` every 50 ms and waits for it to stay unchanged for a 100 ms plateau (three consecutive
 * equal samples, i.e. two equal intervals). A genuine sub-second scroll animation keeps moving
 * between samples, so a 100 ms plateau cannot occur mid-animation; it settles in one round while
 * scrolling is instant, and follows the animation to its end once it is not.
 *
 * @param {import('@playwright/test').Page} page — the page to observe.
 * @returns {Promise<void>} resolves once the scroll offset has been stable for 100 ms.
 */
async function waitForScrollToSettle(page) {
  await page.waitForFunction(() => new Promise((resolve) => {
    let stableCount = 0;
    let lastY = window.scrollY;
    const interval = setInterval(() => {
      const currentY = window.scrollY;
      if (currentY === lastY) {
        stableCount += 1;
      } else {
        stableCount = 0;
        lastY = currentY;
      }
      // Three consecutive equal samples 50 ms apart = two equal intervals = a 100 ms plateau.
      if (stableCount >= 2) {
        clearInterval(interval);
        resolve(true);
      }
    }, 50);
  }), { timeout: 10000 });
}

/**
 * Scrolls the whole document top to bottom in viewport-sized steps.
 *
 * A single jump to the end would skip every intermediate position, and reveal-on-scroll effects
 * (motion task) only lay out the elements they pass. Stepping makes the overflow check see the
 * page in the same states a reader does.
 *
 * @param {import('@playwright/test').Page} page — the page to scroll.
 * @returns {Promise<void>} resolves at the bottom of the document.
 */
async function scrollToBottom(page) {
  await page.evaluate(async () => {
    const step = window.innerHeight;
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
}

for (const width of WIDTHS) {
  test(`no horizontal overflow at ${width} px`, async ({ page }) => {
    // Viewport first, then load: the page must be laid out at this width from the start, the way a
    // real device opens it — not reflowed from a wider first render.
    await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
    await page.goto('/');
    await scrollToBottom(page);

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      // documentElement, not body: a body narrower than its overflowing child would hide the leak.
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));

    // +1 px tolerance absorbs sub-pixel rounding of fractional layout widths; anything wider is a
    // real horizontal scrollbar for the reader.
    expect(scrollWidth, `horizontal overflow at ${width} px`).toBeLessThanOrEqual(clientWidth + 1);
  });
}

test('header nav anchors land below the sticky header', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: VIEWPORT_HEIGHT });
  await page.goto('/');

  const navLinks = page.locator('.site-nav__link');
  // The four main sections of the page; a fifth link would mean the nav contract changed.
  await expect(navLinks).toHaveCount(4);

  const hashes = await navLinks.evaluateAll((links) => links.map((link) => link.getAttribute('href')));

  for (const hash of hashes) {
    await page.locator(`.site-nav__link[href="${hash}"]`).click();
    await page.waitForFunction((expected) => window.location.hash === expected, hash);
    await waitForScrollToSettle(page);

    const metrics = await page.evaluate((sectionHash) => {
      const section = document.querySelector(sectionHash);
      // The section names its own heading through aria-labelledby (Task 1 markup contract); the
      // first heading inside is the fallback, so the test survives a change of labelling technique.
      const labelledBy = section.getAttribute('aria-labelledby');
      const heading = (labelledBy && document.getElementById(labelledBy))
        || section.querySelector('h1, h2, h3');
      const header = document.getElementById('site-header');

      return {
        headingTop: heading ? heading.getBoundingClientRect().top : null,
        headerBottom: header.getBoundingClientRect().bottom,
        headerPosition: getComputedStyle(header).position,
        viewportHeight: window.innerHeight,
      };
    }, hash);

    expect(metrics.headingTop, `no heading found for ${hash}`).not.toBeNull();

    // While the header still scrolls away with the page (before the sticky-header task) its bottom
    // edge sits above the viewport after a jump, so comparing against it would assert nothing.
    // In that state the meaningful requirement is simply that the heading is not scrolled past.
    const isOverlayHeader = metrics.headerPosition === 'sticky' || metrics.headerPosition === 'fixed';
    const lowestAllowedTop = isOverlayHeader ? metrics.headerBottom - 1 : -1;

    expect(metrics.headingTop, `${hash} heading hidden under the header`)
      .toBeGreaterThanOrEqual(lowestAllowedTop);
    // …and the jump actually brought the heading on screen instead of overshooting it.
    expect(metrics.headingTop, `${hash} heading below the fold after the jump`)
      .toBeLessThan(metrics.viewportHeight);
  }
});

test('no console errors on load and after anchor navigation', async ({ page }) => {
  const problems = [];

  // Listeners are attached before the first navigation so nothing logged during load is missed.
  page.on('console', (message) => {
    if (message.type() === 'error') {
      problems.push(`console.error: ${message.text()}`);
    }
  });
  // Uncaught exceptions never reach page.on('console') — they arrive as 'pageerror'.
  page.on('pageerror', (error) => {
    problems.push(`pageerror: ${error.message}`);
  });

  await page.setViewportSize({ width: 1280, height: VIEWPORT_HEIGHT });
  await page.goto('/');

  const hashes = await page.locator('.site-nav__link')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')));

  for (const hash of hashes) {
    await page.locator(`.site-nav__link[href="${hash}"]`).click();
    await page.waitForFunction((expected) => window.location.hash === expected, hash);
    await waitForScrollToSettle(page);
  }

  // The array carries the messages, so a failure names the broken script instead of "expected 0".
  expect(problems).toEqual([]);
});

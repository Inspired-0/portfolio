/**
 * Case-dialog suite — spec §14.6: «Кнопка "Подробнее" открывает модальное окно кейса; окно
 * закрывается кнопкой, Escape и кликом по фону; фокус возвращается на карточку.»
 * (Spec §9 for the behaviour, §11 «Клавиатура» for the focus requirements.)
 *
 * What these tests grade is `portfolio/scripts/case-dialog.js`: the progressive enhancement that
 * turns `a.case-card__more[data-case-link]` into a native `<dialog>` and MOVES the in-document
 * `[data-case-details]` node into `#case-dialog-body` for the duration of the dialog. The move —
 * not a copy — is what keeps DOM ids unique (spec §10), so several assertions below count
 * elements by id rather than merely checking that something is on screen.
 *
 * Deliberately not asserted: page copy. Per CLAUDE.md and spec §14 no test compares Russian text
 * to a literal; the contract here is structural (open state, node location, focus, scroll offset).
 *
 * Native `<dialog>` behaviour the suite relies on (MDN, HTML `<dialog>` element):
 *   - "Modal dialogs can also be closed by pressing the Esc key."
 *   - "When implementing modal dialogs, everything other than the `<dialog>` and its contents
 *     should be rendered inert … When using `<dialog>` along with the
 *     `HTMLDialogElement.showModal()` method, this behavior is provided by the browser."
 *   https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog
 */

const { test, expect } = require('@playwright/test');

// The three cases (Task 1 markup contract). Each card id + its details id; the card's
// `[data-case-link]` href is `#<detailsId>`.
const CASES = {
  screening: { card: 'case-restaff-screening', details: 'case-restaff-screening-details' },
  meetings: { card: 'case-restaff-meetings', details: 'case-restaff-meetings-details' },
  pipeline: { card: 'case-pressindex-pipeline', details: 'case-pressindex-pipeline-details' },
};

/**
 * Scrolls the page so a card's «Подробнее» link sits ~100 px below the viewport top.
 *
 * Done through an explicit `behavior: 'instant'` scroll rather than Playwright's auto-scroll on
 * click: the page has `scroll-behavior: smooth` (base.css, gated on prefers-reduced-motion), so a
 * default scroll would still be animating when the test reads `window.scrollY`. Positioning the
 * link in advance also means the later `click()` does not move the page by itself, which would
 * invalidate the "restore the exact offset" assertions.
 *
 * @param {import('@playwright/test').Page} page — the page under test.
 * @param {string} cardId — id of the `.case-card` whose link should be brought into view.
 * @returns {Promise<number>} the resulting vertical scroll offset, in CSS pixels.
 */
async function scrollLinkIntoView(page, cardId) {
  return page.evaluate((id) => {
    const link = document.querySelector(`#${id} [data-case-link]`);
    const target = link.getBoundingClientRect().top + window.scrollY - 100;
    window.scrollTo({ top: target, left: 0, behavior: 'instant' });
    return window.scrollY;
  }, cardId);
}

/**
 * Reads the dialog's state in one round trip.
 *
 * `dialog.open` (the IDL attribute) is the authoritative open flag; `contains(activeElement)`
 * answers the focus questions, and `bodyHoldsDetails` proves the details node was moved into the
 * dialog instead of being cloned there.
 *
 * @param {import('@playwright/test').Page} page — the page under test.
 * @param {string} detailsId — id of the details node expected inside the dialog.
 * @returns {Promise<{open: boolean, focusInside: boolean, bodyHoldsDetails: boolean,
 *                    detailsCount: number, activeIsCaseLink: boolean}>}
 */
async function readDialogState(page, detailsId) {
  return page.evaluate((id) => {
    const dialog = document.getElementById('case-dialog');
    const body = document.getElementById('case-dialog-body');
    const active = document.activeElement;
    return {
      open: Boolean(dialog && dialog.open),
      focusInside: Boolean(dialog && active && dialog.contains(active)),
      bodyHoldsDetails: Boolean(body && body.querySelector(`#${id}`)),
      // Exactly one node may ever carry the id — the move-not-copy contract of spec §10.
      detailsCount: document.querySelectorAll(`#${id}`).length,
      activeIsCaseLink: Boolean(active && active.dataset && active.dataset.caseLink !== undefined),
    };
  }, detailsId);
}

/**
 * Names who owns the focus right now, in one word the assertions can read.
 *
 * `'dialog'` — an element inside the open dialog;
 * `'document'` — `<body>` or `<html>`, i.e. no element is focused. Chromium's wrap-around inside
 *   a modal dialog passes through the document before returning to the dialog's first control
 *   (probed: close button → scrollable dialog body → document → close button → …), so this is a
 *   legitimate stop, not an escape: nothing in the inert page can be reached from it, and the
 *   next Tab lands back inside the dialog.
 * `'page:<tag>.<class>'` — anything else, which is the actual failure this test hunts: a control
 *   of the page behind the backdrop taking focus.
 *
 * @param {import('@playwright/test').Page} page — the page under test.
 * @returns {Promise<string>} the owner label described above.
 */
async function readFocusOwner(page) {
  return page.evaluate(() => {
    const dialog = document.getElementById('case-dialog');
    const active = document.activeElement;
    if (!active || active === document.body || active === document.documentElement) {
      return 'document';
    }
    if (dialog && dialog.contains(active)) {
      return 'dialog';
    }
    return `page:${active.tagName.toLowerCase()}.${active.className}`;
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('case card opens the dialog with the mouse', async ({ page }) => {
  const { card, details } = CASES.screening;
  await scrollLinkIntoView(page, card);
  await page.locator(`#${card} [data-case-link]`).click();

  const state = await readDialogState(page, details);
  expect(state.open, 'the dialog is open after a click on the card link').toBe(true);
  // The details node itself travelled into the dialog: present inside #case-dialog-body and still
  // unique in the document. A clone would make detailsCount 2 and break spec §10.
  expect(state.bodyHoldsDetails, 'the details node sits inside #case-dialog-body').toBe(true);
  expect(state.detailsCount, 'the details id stays unique').toBe(1);

  // The dialog is titled with the originating card's <h3> — the same text, not a fixed caption.
  const cardTitle = await page.locator(`#${card} .case-card__title`).innerText();
  await expect(page.locator('#case-dialog-title')).toHaveText(cardTitle.trim());

  // The moved details are visible inside the dialog: the JS-on hiding rule is scoped to
  // `.case-card [data-case-details]`, so it must stop applying once the node leaves the card.
  await expect(page.locator(`#case-dialog-body #${details}`)).toBeVisible();
});

test('close button closes the dialog and restores the scroll position', async ({ page }) => {
  const { card, details } = CASES.meetings;
  const offsetBefore = await scrollLinkIntoView(page, card);
  expect(offsetBefore, 'the card sits far enough down the page to make the check meaningful')
    .toBeGreaterThan(0);

  await page.locator(`#${card} [data-case-link]`).click();
  await expect(page.locator('#case-dialog')).toBeVisible();

  await page.locator('#case-dialog [data-dialog-close]').click();
  await expect(page.locator('#case-dialog')).toBeHidden();

  // Read immediately, with no settle wait: the restore must be instant. An animated
  // `window.scrollTo` (the page sets `scroll-behavior: smooth`) would still be in flight here and
  // fail this assertion — which is the point, a modal closing is not a scrolling gesture.
  const offsetAfter = await page.evaluate(() => window.scrollY);
  expect(Math.abs(offsetAfter - offsetBefore), 'the background is back at the exact offset')
    .toBeLessThanOrEqual(1);

  // …and the borrowed node went home: back inside its own card, still unique, visible again.
  const state = await readDialogState(page, details);
  expect(state.detailsCount).toBe(1);
  expect(state.bodyHoldsDetails, '#case-dialog-body is empty again').toBe(false);
  await expect(page.locator(`#${card} > #${details}`)).toHaveCount(1);
});

test('Escape closes the dialog and returns focus to the card link', async ({ page }) => {
  const { card, details } = CASES.pipeline;
  await scrollLinkIntoView(page, card);
  await page.locator(`#${card} [data-case-link]`).click();
  await expect(page.locator('#case-dialog')).toBeVisible();

  // Escape is the browser's own close path for a modal dialog (it fires `cancel`, then `close`);
  // the module must not re-implement it, only react to the resulting `close` event.
  await page.keyboard.press('Escape');
  await expect(page.locator('#case-dialog')).toBeHidden();

  const state = await readDialogState(page, details);
  expect(state.open).toBe(false);
  // Focus is back on a card link — and specifically on the one that opened the dialog.
  expect(state.activeIsCaseLink, 'focus returned to a [data-case-link]').toBe(true);
  const activeHref = await page.evaluate(() => document.activeElement.getAttribute('href'));
  expect(activeHref).toBe(`#${details}`);
});

test('Enter on the card link opens the dialog and moves focus inside', async ({ page }) => {
  const { card, details } = CASES.screening;
  await scrollLinkIntoView(page, card);

  // Keyboard path: focus the link and press Enter. On a link Enter dispatches a click, so this
  // also proves the module intercepts activation rather than listening for mouse events only.
  await page.locator(`#${card} [data-case-link]`).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#case-dialog')).toBeVisible();

  const state = await readDialogState(page, details);
  expect(state.open).toBe(true);
  // Focus must leave the now-hidden card: a modal that opens behind the user's focus is a trap in
  // the other direction — Tab would walk the (inert) page with nothing visible to show for it.
  expect(state.focusInside, 'focus moved into the dialog').toBe(true);
});

test('focus stays inside the open dialog when tabbing', async ({ page }) => {
  const { card, details } = CASES.meetings;
  await scrollLinkIntoView(page, card);
  await page.locator(`#${card} [data-case-link]`).click();
  await expect(page.locator('#case-dialog')).toBeVisible();

  // Ten presses is comfortably more than the dialog's focusable count, so the sequence has to wrap
  // at least once; anything that escaped into the inert page would be caught on the way round.
  const owners = [];
  for (let i = 0; i < 10; i += 1) {
    await page.keyboard.press('Tab');
    const owner = await readFocusOwner(page);
    owners.push(owner);
    expect(owner, `focus left the dialog after ${i + 1} Tab press(es)`).not.toMatch(/^page:/);
  }

  // Shift+Tab walks the ring backwards — the direction a hand-rolled trap usually gets wrong.
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press('Shift+Tab');
    const owner = await readFocusOwner(page);
    owners.push(owner);
    expect(owner, `focus left the dialog after ${i + 1} Shift+Tab press(es)`).not.toMatch(/^page:/);
  }

  // The loops above would also pass if focus had gone nowhere at all and stayed there; the ring
  // must actually keep coming back to the dialog's own controls.
  expect(owners.filter((owner) => owner === 'dialog').length,
    'tabbing never returned to a control inside the dialog').toBeGreaterThan(1);

  // The dialog is still the one that was opened — the ride round the ring moved nothing.
  const state = await readDialogState(page, details);
  expect(state.open).toBe(true);
  expect(state.bodyHoldsDetails).toBe(true);
});

test('background page does not scroll while the dialog is open', async ({ page }) => {
  const { card } = CASES.screening;
  const offsetBefore = await scrollLinkIntoView(page, card);
  await page.locator(`#${card} [data-case-link]`).click();
  await expect(page.locator('#case-dialog')).toBeVisible();

  /*
   * The background is measured through a reference element's viewport rectangle rather than
   * `window.scrollY`: the scroll lock takes the body out of flow, so `scrollY` legitimately reads
   * 0 while the dialog is open. What must not change is what the reader sees behind the dimmed
   * backdrop — the position of `#cases` on screen.
   */
  const topBefore = await page.evaluate(() => document.getElementById('cases').getBoundingClientRect().top);

  await page.mouse.wheel(0, 800);
  // Two animation frames: a wheel-driven scroll would have been committed and painted by then.
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));

  const topAfter = await page.evaluate(() => document.getElementById('cases').getBoundingClientRect().top);
  expect(Math.abs(topAfter - topBefore), 'the page behind the dialog moved under the wheel')
    .toBeLessThanOrEqual(1);

  // Closing proves the lock was not merely "sticky": the pre-open offset comes back untouched by
  // the wheel gesture that happened while the dialog was up.
  await page.locator('#case-dialog [data-dialog-close]').click();
  await expect(page.locator('#case-dialog')).toBeHidden();
  const offsetAfter = await page.evaluate(() => window.scrollY);
  expect(Math.abs(offsetAfter - offsetBefore), 'the wheel leaked into the background scroll offset')
    .toBeLessThanOrEqual(1);
});

test('dialog opens and closes at 360 px viewport', async ({ page }) => {
  // The narrowest width of the check matrix (spec §11). Viewport first, then reload, so the page is
  // laid out at 360 px from the start the way a phone opens it.
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/');

  const { card, details } = CASES.pipeline;
  await scrollLinkIntoView(page, card);
  await page.locator(`#${card} [data-case-link]`).click();
  await expect(page.locator('#case-dialog')).toBeVisible();

  // The close button must be reachable without scrolling the dialog first — on a near-full-screen
  // panel it is the only way out besides Escape, which a touch user does not have.
  const closeButton = page.locator('#case-dialog [data-dialog-close]');
  await expect(closeButton).toBeInViewport();

  const metrics = await page.evaluate(() => {
    const rect = document.getElementById('case-dialog').getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      viewportWidth: window.innerWidth,
      // The panel scrolls its own long content instead of overflowing the screen.
      bodyScrolls: document.getElementById('case-dialog').scrollHeight
        > document.getElementById('case-dialog').clientHeight
        || document.getElementById('case-dialog-body').scrollHeight
        > document.getElementById('case-dialog-body').clientHeight,
      documentOverflows: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  });
  expect(metrics.left, 'the panel hangs off the left edge').toBeGreaterThanOrEqual(-1);
  expect(metrics.right, 'the panel hangs off the right edge')
    .toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect(metrics.documentOverflows, 'the open dialog forces horizontal page scroll').toBe(false);
  // A case description is long; at 640 px of height it cannot fit, so the panel has to scroll.
  expect(metrics.bodyScrolls, 'the long case text is not scrollable inside the panel').toBe(true);

  await closeButton.click();
  await expect(page.locator('#case-dialog')).toBeHidden();
  const state = await readDialogState(page, details);
  expect(state.detailsCount, 'the details id stays unique after a narrow-screen round trip').toBe(1);
  expect(state.activeIsCaseLink, 'focus returned to the card link').toBe(true);
});

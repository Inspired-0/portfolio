/*
 * case-dialog.js — case details in a native modal dialog (spec §9, §10, plan Task 7).
 *
 * Responsibility: turn each card's «Подробности кейса» link — an ordinary in-page anchor — into
 * the opener of `<dialog id="case-dialog">`, and hand the dialog back to the page unchanged when
 * it closes.
 *
 * The move-and-restore contract
 * -----------------------------
 * The dialog shows the case description that already lives in the document; it never renders a
 * second copy of it. On open the module remembers the details node's parent and `nextSibling`,
 * then `append`s the node itself into `#case-dialog-body`; on close it puts the node back between
 * exactly those two, which is its original position whether or not anything else moved meanwhile
 * (`insertBefore(node, null)` appends, which is the right answer when the node was the last
 * child). Consequences worth stating, because everything else in this file follows from them:
 *   - DOM ids stay unique at every moment (spec §10) — there is only ever one details node;
 *   - the JS-on hiding rule in components.css is scoped to `.case-card [data-case-details]`, so
 *     the very same node that is hidden inside the card is visible once it sits in the dialog;
 *   - a failure in the middle of an open would leave the details outside the card, so the close
 *     path is a single function reached from every close reason (see `handleClose`).
 *
 * What this module deliberately does NOT do — the browser already does it for a dialog opened
 * with `showModal()` (MDN, HTMLDialogElement.showModal and <dialog>):
 *   - backdrop:   «A modal dialog displays in the top layer, along with a ::backdrop
 *                 pseudo-element» — styling only, in components.css;
 *   - Escape:     «By default, a dialog invoked by the showModal() method can be dismissed by
 *                 pressing the Esc key … When using <dialog>, this behavior is provided by the
 *                 browser». Esc fires `cancel` and then closes, so this module only listens for
 *                 the resulting `close` event and never touches the key itself;
 *   - focus trap: «Elements inside the same document as the dialog, except the dialog and its
 *                 descendants, become inert (as if the inert attribute is specified)».
 *   https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement/showModal
 *   https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog
 *
 * No history entries are created for dialogs (spec §9): no `pushState`, no hash writing. A hash
 * that is already in the address bar on load is honoured once — see the deep-link block at the
 * bottom of `initCaseDialog`.
 *
 * DOM contract consumed (index.html, fixed names):
 *   `a.case-card__more[data-case-link]`  — opener; its `href` is `#<details id>`;
 *   `div.case-details[data-case-details]` — the node that travels;
 *   `.case-card__title`                   — the dialog's title text;
 *   `#case-dialog` > `#case-dialog-title`, `[data-dialog-close]`, `#case-dialog-body`.
 * CSS contract produced: `body.has-open-dialog` plus an inline `top` on <body> — the scroll lock,
 * documented at `lockBackgroundScroll`.
 */

/** Openers. Class + attribute, so a future `[data-case-link]` elsewhere is not enhanced by accident. */
const LINK_SELECTOR = 'a.case-card__more[data-case-link]';
/** The card a link belongs to; its `<h3>` supplies the dialog title. */
const CARD_SELECTOR = '.case-card';
const CARD_TITLE_SELECTOR = '.case-card__title';
/** The dialog and its three fixed parts. */
const DIALOG_ID = 'case-dialog';
const TITLE_ID = 'case-dialog-title';
const BODY_ID = 'case-dialog-body';
const CLOSE_SELECTOR = '[data-dialog-close]';
/** Marker on <body> while a dialog is open; components.css owns what it looks like. */
const LOCK_CLASS = 'has-open-dialog';

/**
 * Enhances the case cards. Safe to call once, from main.js, after the DOM is parsed.
 *
 * Returns quietly, leaving the page exactly as served, when the feature cannot run: no dialog
 * element, no `showModal` in this browser (the `<dialog>` element would then be a styled div with
 * no modal semantics — worse than the plain anchors), a dialog missing one of its parts, or no
 * case links at all. In every one of those cases the links keep their native behaviour and jump
 * to the details section, which is the JavaScript-off experience.
 *
 * @returns {void}
 */
export function initCaseDialog() {
  const dialog = document.getElementById(DIALOG_ID);
  // Feature detection on the method, not on the element: `<dialog>` parses everywhere.
  if (!dialog || typeof dialog.showModal !== 'function') {
    return;
  }

  const titleElement = document.getElementById(TITLE_ID);
  const bodyElement = document.getElementById(BODY_ID);
  const closeButton = dialog.querySelector(CLOSE_SELECTOR);
  if (!titleElement || !bodyElement || !closeButton) {
    return;
  }

  const links = Array.from(document.querySelectorAll(LINK_SELECTOR));
  if (links.length === 0) {
    return;
  }

  /**
   * Everything needed to undo an open, or `null` while the dialog is closed.
   *
   * It is the module's only mutable state and the single source of truth for "is a case open":
   * `dialog.open` answers that too, but only this object knows where the borrowed node lives.
   *
   * @type {{link: HTMLAnchorElement, details: Element, parent: Node, nextSibling: Node|null,
   *         scrollY: number}|null}
   */
  let openCase = null;

  /**
   * Freezes the background at its current offset.
   *
   * `position: fixed` on <body> (the rule lives in components.css, behind `.has-open-dialog`)
   * rather than `overflow: hidden` on the scrolling element: overflow alone is ignored by iOS
   * Safari, which keeps scrolling the page behind a modal, and spec §11 lists Safari among the
   * browsers to support. Taking the body out of flow drops the document's scrollable height to
   * the viewport, so `window.scrollY` reads 0 while the dialog is open — which is why the offset
   * is captured here and restored explicitly on close, and why the negative `top` is needed: it
   * shifts the now-fixed body up by the amount the reader had scrolled, so the page behind the
   * backdrop does not jump back to its beginning.
   *
   * The `top` value is the one piece of inline style this module writes; it is per-open data
   * (the offset), not presentation, and it is cleared again by `unlockBackgroundScroll`.
   *
   * @param {number} scrollY — the offset to freeze at, in CSS pixels.
   * @returns {void}
   */
  function lockBackgroundScroll(scrollY) {
    document.body.style.top = `${-scrollY}px`;
    document.body.classList.add(LOCK_CLASS);
  }

  /**
   * Puts the background back in flow and returns it to `scrollY`.
   *
   * The scroll is explicitly instant: base.css sets `scroll-behavior: smooth` on <html> for
   * readers who did not ask for reduced motion, and a modal closing is not a scrolling gesture —
   * the page must simply be where it was, with no animation to watch.
   *
   * @param {number} scrollY — the offset captured when the dialog opened.
   * @returns {void}
   */
  function unlockBackgroundScroll(scrollY) {
    document.body.classList.remove(LOCK_CLASS);
    document.body.style.top = '';
    window.scrollTo({ top: scrollY, left: 0, behavior: 'instant' });
  }

  /**
   * Opens the dialog for one card link: moves the details in, titles the panel, locks the
   * background and calls `showModal()`.
   *
   * @param {HTMLAnchorElement} link — the `[data-case-link]` that was activated.
   * @returns {boolean} true when the dialog was opened (the caller then suppresses the anchor's
   *   own jump), false when this link has nothing to show and must stay a plain anchor.
   */
  function openDialogFor(link) {
    // A second open would throw InvalidStateError and, worse, orphan the first details node.
    if (openCase || dialog.open) {
      return false;
    }

    // The href is an in-page anchor: `#<details id>`. Anything else is not ours to handle.
    const href = link.getAttribute('href') || '';
    if (!href.startsWith('#') || href.length < 2) {
      return false;
    }
    const details = document.getElementById(decodeURIComponent(href.slice(1)));
    if (!details || !details.hasAttribute('data-case-details')) {
      return false;
    }

    const card = link.closest(CARD_SELECTOR);
    const cardTitle = card ? card.querySelector(CARD_TITLE_SELECTOR) : null;
    titleElement.textContent = cardTitle ? cardTitle.textContent.trim() : '';

    // Remembered before the move, used verbatim on close — the whole restore contract.
    openCase = {
      link,
      details,
      parent: details.parentNode,
      nextSibling: details.nextSibling,
      scrollY: window.scrollY,
    };

    bodyElement.append(details);
    lockBackgroundScroll(openCase.scrollY);
    dialog.showModal();

    /*
     * Initial focus, decided rather than inherited: the close button.
     *
     * The markup also carries `autofocus` on that button (MDN, <dialog>: «it is recommended to
     * add autofocus to the close button inside the dialog» when nothing else needs more
     * immediate interaction), but the UA's own choice for a dialog without a usable autofocus
     * target has varied between engines, so the focus is placed here too — one line that makes
     * the result identical everywhere. `preventScroll` keeps the browser from scrolling the
     * frozen background while doing it.
     */
    closeButton.focus({ preventScroll: true });
    return true;
  }

  /**
   * The single close path: undoes the open, whatever caused it — the close button, Escape (which
   * fires `cancel`, then closes), a backdrop click, or `dialog.close()` called from anywhere
   * else. Idempotent: `openCase` is the guard, so being called twice for one close costs
   * nothing, which is what lets `closeDialogNow` and the `close` listener both point here.
   *
   * Undoes the open in reverse order: node home, title cleared, focus back on the link that
   * opened the dialog, background unfrozen. Focus is moved with `preventScroll` and the scroll
   * position restored afterwards, so the browser's "scroll the focused element into view" cannot
   * land the reader somewhere other than where they left.
   *
   * It must run after the dialog is actually closed, never before: while a modal is open the
   * rest of the document is inert, and an inert element cannot take focus — `link.focus()` would
   * silently do nothing.
   *
   * @returns {void}
   */
  function handleClose() {
    if (!openCase) {
      return;
    }
    const { link, details, parent, nextSibling, scrollY } = openCase;
    // Cleared first: every step below must run against a closed state, and an exception in one
    // of them must not leave the module believing a dialog is still open.
    openCase = null;

    parent.insertBefore(details, nextSibling);
    titleElement.textContent = '';
    link.focus({ preventScroll: true });
    unlockBackgroundScroll(scrollY);
  }

  /**
   * Closes the dialog from a path this module controls (the close button, the backdrop) and
   * restores the page in the same task.
   *
   * The inline `handleClose()` is not redundant with the `close` listener below: the HTML
   * standard closes a dialog by *queueing* an element task to fire `close` («Queue an element
   * task on the user interaction task source given subject to fire an event named close at
   * subject» — HTML, "close the dialog"), so the event arrives strictly later than
   * `dialog.close()` returns. In that gap the page can be painted with the dialog gone and the
   * background still frozen at the top of the document — a visible jump. Restoring here closes
   * the gap; the queued event then finds `openCase` already null and does nothing.
   *
   * @returns {void}
   */
  function closeDialogNow() {
    dialog.close();
    handleClose();
  }

  for (const link of links) {
    link.addEventListener('click', (event) => {
      /*
       * Modified clicks stay the browser's: Ctrl/Cmd/Shift/Alt and the non-primary buttons open
       * the anchor in a new tab or window, where the hash deep link below takes over anyway.
       */
      if (event.defaultPrevented || event.button !== 0
        || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      // Enter on a focused link dispatches a click, so the keyboard path arrives here as well —
      // there is no separate keydown handler, and there must not be one.
      if (openDialogFor(link)) {
        event.preventDefault();
      }
    });
  }

  closeButton.addEventListener('click', () => {
    // type="button" inside a dialog with no form: nothing closes the dialog implicitly.
    closeDialogNow();
  });

  dialog.addEventListener('click', (event) => {
    /*
     * Backdrop click. The ::backdrop is the dialog's own pseudo-element, so a click on it is
     * dispatched with the dialog as the target — but so is a click on the dialog's padding.
     * Hence the second test: the pointer must also be outside the dialog's border box. A click
     * generated by the keyboard reports (0, 0), which would read as "outside", but such a click
     * targets the activated control and never the dialog, so the first test already excludes it.
     */
    if (event.target !== dialog) {
      return;
    }
    const rect = dialog.getBoundingClientRect();
    const insidePanel = event.clientX >= rect.left && event.clientX <= rect.right
      && event.clientY >= rect.top && event.clientY <= rect.bottom;
    if (!insidePanel) {
      closeDialogNow();
    }
  });

  // The catch-all: Escape (handled entirely by the browser) and any other `dialog.close()` end
  // up here. After `closeDialogNow` it is a no-op — see `handleClose`.
  dialog.addEventListener('close', handleClose);

  /*
   * Printing with a dialog open: close it first, through the ordinary close path.
   *
   * The details node is MOVED into the dialog, not copied, so while a case is open that node is
   * physically inside `#case-dialog` — which print.css hides. Printing in that state would drop
   * the open case from the paper version entirely, exactly the case the reader was looking at,
   * while the other two print expanded. `beforeprint` fires before the print layout is built, so
   * closing here puts the node back into its card in time for it to be laid out and printed.
   *
   * `closeDialogNow` rather than `dialog.close()` alone: the restore must happen in this same
   * task, since the `close` event is queued and would arrive after the print layout is done.
   * It also unfreezes the background — a `position: fixed` <body> at print time clips the
   * document to one page in Chromium.
   *
   * Listened for on `window`, which is where the HTML standard fires it (the event is fired at
   * the Window object; `onbeforeprint` is a Window event handler). The guard keeps it a no-op
   * for the normal flow, where nothing is open.
   */
  window.addEventListener('beforeprint', () => {
    if (openCase) {
      closeDialogNow();
    }
  });

  /*
   * Deep link, once, at init.
   *
   * `#case-…-details` is a legitimate address for a case: it is what the card link points at and
   * what a reader can copy out of the address bar with JavaScript off. With JavaScript on the
   * target is hidden inside its card, so the browser's own hash jump lands nowhere; opening the
   * dialog for it is the equivalent destination. The link is scrolled into view first, so the
   * offset the dialog captures — and returns to on close — is the card the reader asked for
   * rather than the top of the page. The hash itself is left untouched: no pushState, no
   * replaceState, no extra history entry (spec §9).
   */
  const hash = location.hash;
  if (hash.length > 1) {
    const target = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (target && target.hasAttribute('data-case-details')) {
      const link = links.find((candidate) => candidate.getAttribute('href') === `#${target.id}`);
      if (link) {
        link.scrollIntoView({ block: 'center', behavior: 'instant' });
        openDialogFor(link);
      }
    }
  }
}

/*
 * navigation.js — chapter tracking for the history rail (spec §9, plan Task 6).
 *
 * Responsibility: while the reader scrolls through `section#path`, mark exactly one
 * `a.chapter-rail__link` in `#chapter-rail` as the chapter currently being read — with the
 * `.is-current` class (components.css already styles it: heavier weight plus a marker, so the
 * state is not colour-only) and `aria-current="true"` for assistive technology.
 *
 * What this module deliberately does NOT do:
 *   - no scroll listener: position tracking is the browser's job through IntersectionObserver,
 *     which reports off the main thread instead of on every scroll tick;
 *   - no smooth-scroll hijacking and no `preventDefault` on the rail links: the anchors keep
 *     their native behaviour, so the rail works identically with JavaScript off;
 *   - no markup changes: it only toggles a class and an attribute on elements Task 1 shipped.
 *
 * DOM contract consumed (index.html, fixed names):
 *   `.chapter[data-chapter]`            — the six chapters, in document order;
 *   `#chapter-rail[data-chapter-rail]`  — the rail;
 *   `a.chapter-rail__link[data-chapter-link]` with `href="#<chapter id>"` — one link per chapter.
 * CSS contract consumed: `--header-height` on `:root` (layout.css), in px, redeclared per
 * breakpoint (56px, 64px from 768px up).
 *
 * IntersectionObserver behaviour is used per MDN, cited at each decision below:
 *   https://developer.mozilla.org/en-US/docs/Web/API/IntersectionObserver/IntersectionObserver
 *   https://developer.mozilla.org/en-US/docs/Web/API/IntersectionObserver/observe
 */

/** The chapters, in document order — which is also their visual order in the single column. */
const CHAPTER_SELECTOR = '.chapter[data-chapter]';
/** The rail itself; its absence means there is nothing to mark and the module stands down. */
const RAIL_SELECTOR = '#chapter-rail[data-chapter-rail]';
/** The rail's links; the `href` hash ties each one to its chapter's id. */
const LINK_SELECTOR = 'a.chapter-rail__link[data-chapter-link]';
/** Marker class; the styling for it lives in components.css and is not this module's business. */
const CURRENT_CLASS = 'is-current';

/**
 * Reads the sticky header's height from the CSS custom property.
 *
 * `--header-height` is declared on `:root` in layout.css and changed there (and only there)
 * per breakpoint, so reading the computed style of `<html>` gives the height that is actually
 * in effect at the current width, without measuring the header element or duplicating the
 * breakpoints in JavaScript.
 *
 * The token is documented as a px length; `parseFloat` therefore yields the pixel value. It
 * does not validate the unit — it stops at the first non-numeric character, so a value in
 * other units would be read as that bare number (`Number.parseFloat('3.5rem')` is 3.5, a
 * 3.5 px header). Keeping `--header-height` in px is part of the contract with layout.css.
 * Only a missing or unparsable property falls back to 0, which degrades the tracking to
 * "topmost chapter visible in the viewport" instead of throwing — a wrong-by-a-header-height
 * mark beats a broken feature.
 *
 * @returns {number} the header height in CSS pixels, never negative.
 */
function readHeaderHeight() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--header-height');
  const pixels = Number.parseFloat(raw);
  return Number.isFinite(pixels) && pixels > 0 ? pixels : 0;
}

/**
 * Starts chapter tracking. Safe to call once, from main.js, after the DOM is parsed.
 *
 * Returns quietly (doing nothing at all) when the feature cannot run: no
 * `IntersectionObserver` in this browser, no rail, no chapters, or no chapter with a matching
 * rail link. In every one of those cases the rail stays a plain list of working anchors, which
 * is exactly the JavaScript-off experience.
 *
 * @returns {void}
 */
export function initNavigation() {
  // Feature detection before anything else — an old browser gets the static rail, not an error.
  if (typeof IntersectionObserver !== 'function') {
    return;
  }

  const rail = document.querySelector(RAIL_SELECTOR);
  if (!rail) {
    return;
  }

  // querySelectorAll returns the elements in document order; the rest of this module relies on
  // that for the "topmost wins" rule, so the array is never re-sorted.
  const allChapters = Array.from(document.querySelectorAll(CHAPTER_SELECTOR));
  const links = Array.from(rail.querySelectorAll(LINK_SELECTOR));
  if (allChapters.length === 0 || links.length === 0) {
    return;
  }

  // Chapter -> its rail link, matched by the link's `#id` hash. A chapter without a link is not
  // observed at all: it could never be reflected in the rail anyway.
  const linkByChapter = new Map();
  const chapters = allChapters.filter((chapter) => {
    const link = links.find((candidate) => candidate.getAttribute('href') === `#${chapter.id}`);
    if (!link) {
      return false;
    }
    linkByChapter.set(chapter, link);
    return true;
  });
  if (chapters.length === 0) {
    return;
  }

  // The markup ships no marked link; clearing anyway makes "exactly one link is marked" true
  // from the first frame even if a future edit hard-codes a state into the HTML.
  for (const link of links) {
    link.classList.remove(CURRENT_CLASS);
    link.removeAttribute('aria-current');
  }

  /**
   * Latest known visibility per chapter.
   *
   * The callback receives only the chapters whose intersection changed ("You should not assume
   * the number of entries", MDN, IntersectionObserver() options), so the full picture has to be
   * accumulated here rather than recomputed from each batch.
   *
   * @type {Map<Element, boolean>}
   */
  const isVisible = new Map();

  /** The link currently carrying the mark, or null while no chapter is under the header. */
  let markedLink = null;

  /**
   * Moves the mark to `link` (or removes it entirely when `link` is null).
   *
   * Only two elements are ever touched — the one losing the state and the one gaining it — and
   * an unchanged target is a no-op, so a burst of observer callbacks does not thrash the DOM.
   *
   * @param {HTMLAnchorElement|null} link — the link that should be current.
   * @returns {void}
   */
  function markCurrentLink(link) {
    if (link === markedLink) {
      return;
    }
    if (markedLink) {
      markedLink.classList.remove(CURRENT_CLASS);
      markedLink.removeAttribute('aria-current');
    }
    if (link) {
      link.classList.add(CURRENT_CLASS);
      link.setAttribute('aria-current', 'true');
    }
    markedLink = link;
  }

  /**
   * Observer callback: refreshes the visibility map, then picks the current chapter.
   *
   * @param {IntersectionObserverEntry[]} entries — only the chapters whose state changed.
   * @returns {void}
   */
  function handleIntersections(entries) {
    for (const entry of entries) {
      /*
       * `isIntersecting` alone accepts an intersection rectangle of zero height, which happens
       * when a chapter's edge rests exactly on the shrunken root's edge — the situation an
       * anchor jump produces. Requiring a non-empty rectangle keeps the previous chapter from
       * counting as visible by a 0 px sliver and stealing the mark through the rule below.
       */
      isVisible.set(entry.target, entry.isIntersecting && entry.intersectionRect.height > 0);
    }

    /*
     * Tie-break: "topmost wins".
     *
     * Two or three chapters intersect the observed band at once whenever a chapter boundary is
     * on screen. `chapters` is in document order, i.e. top-to-bottom on the page, so the first
     * visible entry in it is the highest one — and because the band starts at the bottom edge
     * of the sticky header, the highest visible chapter is precisely the one running underneath
     * the header. It keeps the mark until its last pixel scrolls above the header, at which
     * point the next chapter becomes the topmost visible one.
     *
     * Entry order from the observer is deliberately not used: MDN only says entries "should be
     * ordered by the time they were generated", which is arrival order, not page order.
     */
    const currentChapter = chapters.find((chapter) => isVisible.get(chapter)) || null;
    markCurrentLink(currentChapter ? linkByChapter.get(currentChapter) : null);
  }

  /** The live observer, replaced (never kept alongside a second one) when the header resizes. */
  let observer = null;
  /** Header height the live observer was built for; `null` until the first build. */
  let observedHeaderHeight = null;

  /**
   * Creates (or re-creates) the observer for a given header height.
   *
   * @param {number} headerHeight — current `--header-height`, in CSS pixels.
   * @returns {void}
   */
  function observeChapters(headerHeight) {
    if (observer) {
      observer.disconnect();
      // Stale visibility would survive the disconnect and could outvote the fresh entries.
      isVisible.clear();
    }

    /*
     * Observer options.
     *
     * root:       left at the default (the viewport) — chapters scroll with the document.
     * rootMargin: `-<header>px 0px 0px 0px` shrinks the viewport from the top by exactly the
     *             sticky header, so the band the observer watches starts where the reader's
     *             view actually starts. Without it the chapter hidden behind the header would
     *             still count as visible and, being the topmost one, would hold the mark.
     *             Every side needs a unit — MDN: "Each offset value can be only expressed in
     *             pixels (px) or percentages (%)"; the default is "0px 0px 0px 0px", so the
     *             three untouched sides are spelled out as `0px` rather than left implicit.
     *             The bottom stays at 0px on purpose: the band reaches the bottom of the
     *             viewport, which guarantees some chapter is visible at every scroll position
     *             inside the history, so the mark never blinks off mid-section.
     * threshold:  0 — the default; the mark must follow a chapter that is visible *at all*,
     *             not one that has reached some percentage of visibility. Any higher value
     *             would leave short chapters unable to ever become current.
     */
    observer = new IntersectionObserver(handleIntersections, {
      rootMargin: `-${headerHeight}px 0px 0px 0px`,
      threshold: 0,
    });

    for (const chapter of chapters) {
      observer.observe(chapter);
    }
    observedHeaderHeight = headerHeight;

    // No manual "first pass" is needed: MDN, IntersectionObserver.observe() — "The observer
    // callback will always fire the first render cycle after observe() is called, even if the
    // observed element has not yet moved with respect to the viewport." That initial call is
    // what marks the right chapter when the page opens on a deep link such as #chapter-urfu.
  }

  observeChapters(readHeaderHeight());

  /*
   * `--header-height` changes at the 768 px breakpoint, and a wrong value would put the band's
   * edge above or below the header. Resize fires in long bursts, so the work is deferred to the
   * next animation frame and every event arriving before that frame collapses into it
   * (`resizeFrame` acting as the "already scheduled" flag). Rebuilding the observer is skipped
   * unless the height actually changed — resizing within one breakpoint, or the address-bar
   * show/hide on mobile, then costs one property read and nothing else.
   */
  let resizeFrame = 0;
  window.addEventListener('resize', () => {
    if (resizeFrame) {
      return;
    }
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      const headerHeight = readHeaderHeight();
      if (headerHeight !== observedHeaderHeight) {
        observeChapters(headerHeight);
      }
    });
  });
}

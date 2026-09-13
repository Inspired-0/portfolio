/*
 * motion.js — the switch that turns the motion layer on (spec §9, plan Task 8).
 *
 * Responsibility, and nothing beyond it: decide whether the page may move, and if it may, tell
 * each chapter when it has been seen. All of the movement itself is declared in styles/motion.css;
 * this module writes one attribute and one class and never touches a style property.
 *
 * The contract with motion.css
 * ----------------------------
 * `<html data-motion="on">` — set here, and only here. Every rule in motion.css that makes
 * something transparent or shifts it is scoped under that attribute, which is what makes the
 * whole layer fail safe: with JavaScript off, with a module that failed to load, in a browser
 * without IntersectionObserver, or for a reader who asked for reduced motion, the attribute is
 * simply absent and the page renders exactly as it is served — no transparent chapters, no blank
 * screen (spec §9, §11 «Надёжность»). `main.js` removes the attribute again if this function
 * throws after setting it, so even a half-finished start cannot leave content hidden.
 *
 * `.is-inview` on a `.chapter` — added once, when the chapter first enters the viewport, and then
 * never removed (see `revealChapter`). The reveal is a one-way door on purpose: content that
 * fades out again when the reader scrolls back is a re-reading tax, and a class that is only ever
 * added cannot leave an element in an unrevealed state.
 *
 * What this module deliberately does NOT do:
 *   - no scroll listener and no per-frame work: one IntersectionObserver reports entry, the
 *     browser runs the transitions, and nothing runs in between;
 *   - no `matchMedia` change listener: a reader who switches the preference on after load is
 *     covered by the `@media (prefers-reduced-motion: reduce)` block at the end of motion.css,
 *     which re-evaluates on its own and neutralises the rules this attribute enables. Re-running
 *     the decision in JavaScript would mean removing the attribute mid-transition for no gain;
 *   - no animation of numbers anywhere, in any form (spec §9).
 *
 * Platform behaviour used here, per MDN:
 *   prefers-reduced-motion — "reduce: Indicates that a user has enabled the setting on their
 *     device for reduced motion."
 *     https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion
 *   IntersectionObserver — the callback "will always fire the first render cycle after observe()
 *     is called, even if the observed element has not yet moved with respect to the viewport",
 *     which is what reveals the chapters that are already on screen at load.
 *     https://developer.mozilla.org/en-US/docs/Web/API/IntersectionObserver/observe
 */

/** The blocks that reveal. The same six articles navigation.js tracks; here the hook is the class
 *  alone, because a chapter without a rail link still deserves to appear. */
const CHAPTER_SELECTOR = '.chapter';
/** The one class this module writes; motion.css owns what it looks like. */
const INVIEW_CLASS = 'is-inview';
/** The media query that decides everything. `reduce` is the only value that means "yes". */
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Starts the motion layer. Safe to call once, from main.js, after the DOM is parsed.
 *
 * @returns {void}
 */
export function initMotion() {
  /*
   * The early return — the most important four lines in the file.
   *
   * A reader with the reduced-motion setting on gets no attribute, no observer, no listener and
   * no class: not a shorter animation, not an instant one, but a page on which this module never
   * ran. That is also why the check comes before everything else, including the feature
   * detection below — there is nothing to detect if the answer is already no.
   *
   * `window.matchMedia` itself is checked because a missing implementation would throw, and the
   * safe answer to "can I ask about the preference?" is to assume the preference is on.
   */
  if (typeof window.matchMedia !== 'function'
    || window.matchMedia(REDUCED_MOTION_QUERY).matches) {
    return;
  }

  // No observer means no way to ever add `.is-inview`, and the CSS would hide chapters that
  // nothing could reveal. An old browser therefore gets the static page, not a broken one.
  if (typeof IntersectionObserver !== 'function') {
    return;
  }

  const chapters = Array.from(document.querySelectorAll(CHAPTER_SELECTOR));
  if (chapters.length === 0) {
    return;
  }

  /*
   * From this line on the reveal rules in motion.css apply, so the chapters are transparent until
   * the observer reports on them — which it does in the first render cycle after `observe()`
   * below, before the browser paints. The attribute is set before observing (and not after) so
   * that the initial hidden state and the reveal happen within the same frame; setting it later
   * would paint the chapters once at full opacity and then hide them.
   */
  document.documentElement.dataset.motion = 'on';

  /**
   * Marks one chapter as seen and stops watching it.
   *
   * The class is added exactly once and never removed: `unobserve` guarantees no further callback
   * can arrive for this element, so nothing can undo the reveal when the chapter scrolls away.
   *
   * @param {Element} chapter — the `.chapter` that entered the viewport.
   * @param {IntersectionObserver} observer — the observer to stop watching it with.
   * @returns {void}
   */
  function revealChapter(chapter, observer) {
    chapter.classList.add(INVIEW_CLASS);
    observer.unobserve(chapter);
  }

  /**
   * Observer callback: reveals every chapter in the batch that is now intersecting.
   *
   * Only entering matters, so there is no state to accumulate between calls — unlike the rail
   * tracking in navigation.js, each entry here is answered on its own and then forgotten.
   *
   * @param {IntersectionObserverEntry[]} entries — the chapters whose intersection changed.
   * @param {IntersectionObserver} observer — the observer that produced them.
   * @returns {void}
   */
  function handleIntersections(entries, observer) {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        revealChapter(entry.target, observer);
      }
    }
  }

  /*
   * Observer options.
   *
   * root:       the viewport (the default) — chapters scroll with the document.
   * rootMargin: `0px 0px -10% 0px` pulls the bottom edge of the watched band up by a tenth of the
   *             viewport, so a chapter starts its 260 ms fade once it is properly on screen
   *             rather than while its first pixel is still under the fold. The margin is small on
   *             purpose: a chapter must never be able to sit inside the excluded strip at the
   *             maximum scroll offset and stay unrevealed — the history is followed by four more
   *             sections and a footer, so no chapter ever rests at the bottom of the document.
   * threshold:  0 — the default. Any part of the chapter entering the band is enough; requiring a
   *             percentage would leave a chapter taller than the viewport waiting forever.
   */
  const observer = new IntersectionObserver(handleIntersections, {
    rootMargin: '0px 0px -10% 0px',
    threshold: 0,
  });

  for (const chapter of chapters) {
    observer.observe(chapter);
  }
}

/*
 * main.js — the single entry point of the site's JavaScript (spec §10, plan Task 6).
 *
 * Responsibility: announce that scripting is alive, then start each enhancement in isolation.
 * It holds no feature logic of its own; every behaviour lives in its own module.
 *
 * Two rules shape this file:
 *
 * 1. Progressive enhancement. The page is complete and usable before this script runs — every
 *    section, anchor, case description and contact works with JavaScript off. This module only
 *    adds `data-js="on"` to `<html>`, the hook later CSS (Task 7 motion, Task 8 case dialog)
 *    uses to switch to its enhanced presentation. It is set first, synchronously, so no
 *    enhanced CSS can apply while the DOM is still unenhanced.
 *
 * 2. One broken feature must not take the page down. Each feature is called inside its own
 *    try/catch: an exception in one leaves the others running and the page fully readable. The
 *    catch logs through `console.warn` and never `console.error` — spec §11 «Надёжность»
 *    requires an error-free console in the main scenarios, and the Playwright suite fails the
 *    build on `console.error` and on uncaught exceptions alike.
 *
 * Loading: `<script type="module">` at the end of <body>. Module scripts are deferred by
 * default, so this runs after the document is parsed — no DOMContentLoaded wrapper is needed
 * and the feature modules can query the DOM immediately.
 */

import { initNavigation } from './navigation.js';
import { initCaseDialog } from './case-dialog.js';
import { initMotion } from './motion.js';

// The scripting flag: set before any feature runs, so it is on even if every one of them fails.
document.documentElement.dataset.js = 'on';

// Feature: chapter tracking in the history rail. Later tasks add their own guarded calls here,
// one try/catch each — the isolation is the point, so they are never merged into one block.
try {
  initNavigation();
} catch (error) {
  console.warn('main.js: chapter tracking is disabled, the rail stays a plain list.', error);
}

// Feature: case details in a native modal dialog. If this throws, the «Подробности кейса» links
// stay ordinary anchors — but the CSS hiding rule is keyed on `data-js="on"`, which is already
// set, so the failure would hide the in-card details with no way to open them. The catch
// therefore also takes the flag back off: the page returns to its fully static, readable state.
try {
  initCaseDialog();
} catch (error) {
  delete document.documentElement.dataset.js;
  console.warn('main.js: the case dialog is disabled, case details stay inline.', error);
}

// Feature: the motion layer. Same shape as the block above and for the same reason: every reveal
// rule in motion.css is scoped under `data-motion="on"`, so a failure *after* the flag was set
// would leave the chapters at opacity 0 with nothing left running to reveal them. Taking the flag
// back off restores the page to its plain, fully visible state; a failure before the flag was set
// leaves nothing to undo, and `delete` on a missing attribute is a no-op either way.
try {
  initMotion();
} catch (error) {
  delete document.documentElement.dataset.motion;
  console.warn('main.js: motion is disabled, the page renders without transitions.', error);
}

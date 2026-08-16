/**
 * Who owns the bottom edge in the Devski shell.
 *
 * Devski mounts T3's whole RootStack as the Code tab, so the bottom edge
 * belongs to the tab bar. Two rules follow, and both live here so the shell
 * and the screens it hosts read the same decision:
 *
 * 1. Home emits no bottom toolbar. The Mail-style glass toolbar replaces a
 *    tab bar in Mail rather than stacking on one; inside a tab, search,
 *    compose, and filter belong in the navigation bar.
 * 2. Routes that T3 pushes full-screen hide the tab bar, so their own
 *    bottom-pinned chrome (the thread composer, the review toolbar) is not
 *    laid out underneath it.
 *
 * Sheets are deliberately absent from rule 2: a form sheet floats above a
 * workspace that stays visible, so its tab bar must stay visible too.
 */

/** Upstream T3 sets this true by owning the whole screen; Devski does not. */
export const HOME_EMITS_BOTTOM_TOOLBAR: boolean = false;

/**
 * Clearance a tab root's own bottom padding must add for the tab bar.
 *
 * The native tab navigator adjusts content insets for a screen's
 * first-descendant scroll view, which the thread list is not, so tab roots
 * pay for their own last row. 56pt is what the floating glass bar occupies
 * above the home indicator, the same reserve the Mail toolbar asks for.
 */
export const TAB_BAR_CONTENT_CLEARANCE = 56;

const FULL_SCREEN_CODE_ROUTES: ReadonlySet<string> = new Set([
  "Thread",
  "ThreadTerminal",
  "ThreadReview",
  "ThreadFiles",
  "ThreadFile",
  "NotFound",
]);

/**
 * Tab bar visibility for the Code tab, from the focused route name of the
 * RootStack nested inside it. An unmounted nested stack reports `undefined`
 * and shows the tab bar, which is correct: its initial route is Home.
 */
export function codeTabBarDisplay(focusedRouteName: string | undefined): "flex" | "none" {
  return focusedRouteName !== undefined && FULL_SCREEN_CODE_ROUTES.has(focusedRouteName)
    ? "none"
    : "flex";
}

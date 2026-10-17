import type { Strings } from '../lib/i18n';
import { fitScale, settleFont } from '../lib/fit';
import { button } from './dom';

/**
 * The projector view: the groups on the wall, for the class to read.
 *
 * THE OVERLAY MOVES `#cg-results`; it never re-renders it. On entry the
 * results element is appended to the board and on exit put back exactly
 * where it was. That is why "a shuffle done on the board is what the page
 * shows on exit" needs no code of its own, and why a warning raised by a
 * board shuffle appears on the board: there is one element, one render
 * path, and nothing that can drift. A second rendering is how a projected
 * sheet ends up disagreeing with the screen.
 *
 * TWO ways of going full screen, because one is not reliable. The
 * Fullscreen API is used where it is granted; where it is refused -- iOS
 * Safari does not grant it on arbitrary elements at all, and any browser
 * may refuse outside a user gesture -- the board is a fixed full-viewport
 * layer instead. A refused promise landing in nothing would be a button
 * that silently does nothing, which is the defect this shape exists to
 * avoid.
 */

/** How long the bar waits, with no input, before fading out of the way. */
const FADE_AFTER_MS = 2500;

/**
 * The readable floor, and the size the sheet is drawn at.
 *
 * A projected name below about 24px stops being readable from the back of
 * a room. `fitScale` (src/lib/fit.ts) is where that decision lives and is
 * tested; these are the two numbers it is given.
 */
const BASE_PX = 40;

/** Readings `settleFont` may take before it ends at the floor (#743). */
const SETTLE_READINGS = 4;

/** How long between one group appearing and the next. */
const REVEAL_STEP_MS = 220;
/**
 * The readable floor, exported because it is a CONTRACT, not an internal.
 *
 * "The board scrolls only once it has shrunk this far" is a fact the board's
 * own tests have to assert, and a test that retyped `24` would be a second
 * home for the number: move one and the other keeps passing at a level
 * nobody chose.
 */
export const FLOOR_PX = 24;

export interface ProjectorHandlers {
  /** Re-run the shuffle. The board shows whatever the page then shows. */
  onShuffle: () => void;
  /**
   * Why the board may not be opened right now, or `null`.
   *
   * Task 6 wires the out-of-date refusal through this. A predicate, not a
   * boolean read once: the answer changes as the teacher edits.
   */
  refuseReason?: () => string | null;
  /**
   * Whether the roster cannot be dealt right now.
   *
   * The board's Shuffle button and the page's deal button are the same
   * action, so the board asks the page's own answer rather than keeping
   * one: when the page's button cannot deal, neither can the board's.
   */
  cannotDeal?: () => boolean;
  /**
   * Whether the groups should be revealed one at a time, or simply be
   * there.
   *
   * Asked at every entry rather than read once: a teacher can change the
   * animation setting between one showing and the next, and design spec
   * section 8 treats `prefers-reduced-motion` and the Skip choice as the
   * same instruction — the caller collapses them.
   */
  animates?: () => boolean;
  /**
   * Called as the board opens, before the results move onto it, and as it
   * closes, after they are back (#743): a board opened before any shuffle
   * shows the empty cards and the waiting list, and leaves the page as it
   * found it. The results are still one element with one render path.
   */
  onEnter?: () => void;
  onLeave?: () => void;
}

export interface Projector {
  setAvailable: (available: boolean) => void;
  /**
   * The board's Shuffle says what it will do: the page's own words before
   * the first deal, "Shuffle again" after it (#743).
   */
  setShuffleLabel: (label: string) => void;
  /** Re-measure — after a shuffle changes how much there is to show. */
  refit: () => void;
  /** Whether the board is up, so a deal knows it may travel (#744). */
  isOpen: () => boolean;
}

export function renderProjector(
  doc: Document,
  t: Strings,
  handlers: ProjectorHandlers,
): Projector | null {
  const board = doc.getElementById('cg-board');
  const bar = doc.getElementById('cg-board-bar');
  const openButton = doc.getElementById('cg-board-open');
  const results = doc.getElementById('cg-results');
  if (!board || !bar || !openButton || !results) return null;

  // Focusable, but not in the tab order: the board is a destination for
  // focus, never a stop on the way through the page.
  board.tabIndex = -1;

  const stage = doc.createElement('div');
  stage.className = 'cg-board-stage';
  stage.id = 'cg-board-stage';
  board.appendChild(stage);

  const shuffle = button(t.boardShuffle, 'cg-board-shuffle', doc);
  const exit = button(t.boardExit, 'cg-board-exit', doc);
  bar.append(shuffle, exit);

  /**
   * Where the results element goes back to.
   *
   * A PLACEHOLDER this module owns, not a captured `nextSibling`: that
   * would be a live reference to a node anything else on the page may
   * remove or move, and restoring relative to a detached node throws --
   * silently leaving the board open with the page underneath unclickable.
   * A comment node costs nothing, renders nothing, and cannot be
   * invalidated by anyone but us.
   */
  const placeholder = doc.createComment('cg-results');
  results.parentElement?.insertBefore(placeholder, results);

  let fadeTimer = 0;
  /**
   * The reveal's own timers, one per group, so they can be CANCELLED.
   *
   * Left running they outlive the showing that started them: a teacher who
   * leaves mid-reveal has the remaining timers fire against groups that are
   * back on the page, and a second showing has last showing's pending
   * timers re-adding `revealed` out of order behind the new one. Neither is
   * visible in a test that lets the reveal finish, which is why they are
   * tracked rather than fired and forgotten.
   */
  let revealTimers: number[] = [];
  let open = false;
  /**
   * Whether THIS showing actually got fullscreen.
   *
   * `fullscreenchange` fires for exits too, including the exit that tidies
   * up a grant which landed late from a PREVIOUS showing. Without this, that
   * stray event closed a board the current showing had just opened: enter,
   * Escape, enter again, and the second board vanished on its own. Found by
   * probing -- the bar never faded because there was no board.
   */
  let inFullscreen = false;

  /**
   * Never fade while the bar holds focus.
   *
   * A bar that vanishes under a focused button strands a keyboard user with
   * no visible way out -- the defect the fade would otherwise introduce,
   * and the reason this is a predicate rather than a plain timer.
   */
  const canFade = () => !bar.contains(doc.activeElement);

  const armFade = () => {
    bar.classList.remove('faded');
    window.clearTimeout(fadeTimer);
    if (!open) return;
    fadeTimer = window.setTimeout(() => {
      if (canFade()) bar.classList.add('faded');
    }, FADE_AFTER_MS);
  };

  /**
   * Size the stage so the groups fill the board without dropping below the
   * readable floor.
   *
   * Measured, then scaled, then told whether it still overflows -- the
   * decision itself is `fitScale`'s, which is pure and tested; this only
   * supplies the two boxes and applies the answer.
   */
  const refit = () => {
    if (!open) return;
    stage.style.removeProperty('transform');
    // MEASURED AT THE FONT THE ANSWER IS APPLIED AT (#189).
    //
    // This used to remove the property and measure whatever then cascaded
    // in. `.cg-board` declares no font-size at all, so that was the ROOT's
    // 16px -- while the answer was applied at `BASE_PX`, 40px. The sheet was
    // measured in one layout and scaled into another 2.5x bigger: 25
    // students in five groups measured 657px (a fit, so `scale` came back 1
    // and `scrolls` false) and then rendered 1110px inside the same 657px
    // clipping box. Two whole groups sat below the fold with no scrollbar
    // and no way to reach them.
    //
    // It also meant the shrink-to-fit never engaged in the ordinary case:
    // `scrollHeight` on a clipping box is never less than `clientHeight`, so
    // a sheet that fitted at 16px measured EXACTLY `available`, which is
    // `wanted === 1` every time.
    stage.style.fontSize = `${BASE_PX}px`;
    const available = board.clientHeight - bar.offsetHeight;
    const atBase = { font: BASE_PX, height: stage.scrollHeight };
    const { scale, scrolls: onTheFloor } = fitScale(
      available,
      atBase.height,
      FLOOR_PX,
      BASE_PX,
    );
    const applied = BASE_PX * scale;
    stage.style.fontSize = `${applied}px`;

    // MEASURE, SCALE, RE-MEASURE -- because height is not linear in the
    // scale. The board's grid tracks are `em` (deliberately: `rem` left a
    // 242px column holding 40px type and broke a name mid-word), so
    // shrinking the type narrows the columns and changes how many cards fit
    // on a row. Measured on this page: 3 columns at 40px, 4 at 32px, 5 at
    // 24px. One reading taken before the scale therefore describes a layout
    // that no longer exists once the scale lands.
    //
    // The correction SOLVES rather than nudges. `settleFont` (from `fontThatFits`, then a reading at each answer) is handed the
    // two readings already taken -- the sheet at the base font and the sheet
    // at the applied one -- and returns the font where the line through them
    // meets the box, clamped at the readable floor. A ratio correction only
    // converges: measured here, eight students in pairs went 38.2px -> 37.8px
    // and still overflowed, so the board scrolled 8px at almost full size.
    //
    // `onTheFloor` is the first answer saying it already sat at the floor.
    // There is nothing left to shrink, so the second measurement is skipped
    // rather than taken and ignored.
    if (!onTheFloor && stage.scrollHeight > stage.clientHeight) {
      const measure = (font: number): number => {
        stage.style.fontSize = `${font}px`;
        return stage.scrollHeight;
      };
      stage.style.fontSize = `${settleFont(
        stage.clientHeight,
        atBase,
        { font: applied, height: stage.scrollHeight },
        FLOOR_PX,
        measure,
        SETTLE_READINGS,
      )}px`;
    }

    // READ, never predicted. A verdict computed before the layout it
    // describes is what left five group cards unreachable; this one is taken
    // from the box that is actually on the screen, so "it does not fit" and
    // "it can be scrolled to" cannot disagree.
    //
    // ...and taken under the overflow it will produce (#674). Read while the
    // stage was `overflow: hidden`, Firefox reported an exact fit as
    // overflowing (CI, fonts not yet landed: 705px sheet, 705px stage,
    // `scrolls` left on at 37.6875px), and the board then offered a scrollbar
    // it did not need. So the class goes on first, the stage is read as
    // `overflow: auto`, and the class stays only if that reading overflows.
    board.classList.add('scrolls');
    board.classList.toggle('scrolls', stage.scrollHeight > stage.clientHeight);
  };

  // Declared before `enter` because the fullscreen grant handler inside it
  // has to be able to call this -- see that handler's own comment.
  let leave: () => Promise<void>;

  /**
   * Cancel a reveal in progress AND undo its half-finished state.
   *
   * Clearing the timers is not enough on its own: a card left carrying
   * `revealing` without `revealed` is a card mid-transition, and it goes
   * back to the page in that state. It happens to render normally today
   * only because the rule is scoped to `.cg-board .group.revealing` -- a
   * scope that is one stylesheet edit away from not saving it. Undone here
   * so the cards are clean wherever they end up, rather than relying on a
   * selector to hide the mess.
   */
  const stopReveal = () => {
    for (const timer of revealTimers) window.clearTimeout(timer);
    revealTimers = [];
    for (const group of stage.querySelectorAll<HTMLElement>('.group')) {
      group.classList.remove('revealing', 'revealed');
    }
  };

  /**
   * The reveal: each group arriving in turn, so a class watches rather than
   * reads a wall of names that was simply there.
   *
   * `revealing` goes on immediately and `revealed` follows one group at a
   * time; CSS carries the transition. Both classes are cleared first, so a
   * second showing reveals again rather than finding everything already
   * revealed.
   *
   * With animation off, the groups go straight to `revealed` and never
   * carry `revealing` at all -- not a faster animation, none.
   */
  const reveal = () => {
    stopReveal();
    const groups = Array.from(stage.querySelectorAll<HTMLElement>('.group'));
    if (handlers.animates?.() === false) {
      for (const group of groups) group.classList.add('revealed');
      return;
    }
    for (const group of groups) group.classList.add('revealing');
    groups.forEach((group, i) => {
      revealTimers.push(
        window.setTimeout(
          () => group.classList.add('revealed'),
          i * REVEAL_STEP_MS,
        ),
      );
    });
  };

  const enter = () => {
    if (open) return;
    if (handlers.refuseReason?.()) return;
    open = true;
    handlers.onEnter?.();
    stage.appendChild(results);
    board.hidden = false;
    doc.documentElement.classList.add('cg-board-open-page');
    // The API where it is granted. `.catch` is not a formality: iOS Safari
    // rejects on an arbitrary element, and the overlay below is already
    // showing either way, so a rejection costs nothing and is not an error
    // to report.
    // The request is asynchronous, and a teacher can press Escape before it
    // resolves -- a real race, not a theoretical one: the board is already
    // usable the instant it is shown, so the gap between asking for
    // fullscreen and getting it is a gap they can act in. Without the
    // `open` check below, a grant arriving after the exit puts the document
    // into fullscreen on a board that is already `display: none`, leaving
    // the whole page unreachable behind a blank fullscreen surface with no
    // way back but the browser's own.
    void board
      .requestFullscreen?.()
      .then(() => {
        // A grant that lands while the board is closed must be UNDONE, not
        // merely ignored -- ignoring it leaves the document in fullscreen
        // over a hidden board, with the whole page unclickable behind a
        // blank surface.
        if (!open) {
          if (doc.fullscreenElement)
            void doc.exitFullscreen?.().catch(() => {});
          return;
        }
        // While a board is open, the grant is that board's, whichever
        // showing asked for it: the request is always for this one element.
        // A real Android phone delivers the first showing's grant only once
        // the board is up again (#231), just ahead of the second showing's
        // own. Undoing it as a leftover took the document out of fullscreen
        // under the open board, and the `fullscreenchange` handler below
        // then closed that board with nobody asking.
        inFullscreen = true;
      })
      .catch(() => {});
    // Focus MOVES to the board, which is what an overlay owes a keyboard
    // user: without it focus is left on a control now hidden behind the
    // board, Escape and every other key still go to the page, and the bar
    // never learns anyone is there. The BOARD, not the bar -- focusing the
    // bar would hold `canFade` false forever and the bar would never fade
    // at all.
    board.focus();
    reveal();
    armFade();
    refit();
  };

  leave = async () => {
    if (!open && !doc.fullscreenElement) return;
    if (!open && doc.fullscreenElement) {
      // The late-grant case: already left, but a fullscreen request landed
      // afterwards. Undo just that, and leave the rest alone -- it is
      // already in its closed state.
      await doc.exitFullscreen?.().catch(() => {});
      return;
    }
    open = false;
    window.clearTimeout(fadeTimer);
    // BEFORE the results element is moved back: `stopReveal` reaches the
    // cards through the stage, and once they have left it they are out of
    // its reach and would go back to the page still mid-transition.
    stopReveal();
    bar.classList.remove('faded');

    // FULLSCREEN FIRST, and AWAITED. `exitFullscreen` is asynchronous, and
    // until it resolves the document is still in fullscreen mode -- with
    // the board hidden, that leaves a viewport where nothing at all is
    // painted and nothing on the page can be clicked. Found by probing the
    // hit-test after a first exit: `elementsFromPoint` at the Full screen
    // button returned `[HTML]` and the page still reported
    // `overflow: hidden` with the scroll position frozen, which is exactly
    // that state and nothing else.
    //
    // Chromium GRANTS fullscreen here, so this path is the normal one, not
    // the exception -- the overlay fallback is what the refusal case uses.
    inFullscreen = false;
    if (doc.fullscreenElement) {
      await doc.exitFullscreen?.().catch(() => {});
    }

    // Back exactly where it came from, before the board is hidden, so the
    // page is never briefly missing its results.
    placeholder.parentElement?.insertBefore(results, placeholder);
    handlers.onLeave?.();
    board.hidden = true;
    doc.documentElement.classList.remove('cg-board-open-page');
    stage.style.removeProperty('font-size');
  };

  openButton.addEventListener('click', enter);
  exit.addEventListener('click', () => void leave());
  shuffle.addEventListener('click', () => {
    // A press during a deal is not refused: it starts a new deal from the
    // top (operator, 2026-08-13 and #744). The page's deal supersedes the
    // running one itself -- `dealToken` and the travelling deal's abort --
    // so the abandoned deal lands nobody and sounds nothing. What this
    // refuses is only a roster the page cannot deal at all.
    if (handlers.cannotDeal?.()) return;
    handlers.onShuffle();
    // With animation on, the deal travels from the waiting list into cards
    // that are already up (#744), so the groups are not faded in on top of
    // it; with animation off, `reveal` shows them at once, as before.
    if (handlers.animates?.() === false) reveal();
    else stopReveal();
    // …and there may be more or less of them than before. Without this a
    // board shuffle never re-measured at all, so a taller arrangement was
    // sized to the previous one and lost its bottom group off the board.
    refit();
    armFade();
  });

  // Any sign of a person brings the bar back: a mouse, a finger, a key.
  // Pointer events on the BOARD, because they can only happen over it --
  // but KEYS on the document, because a key goes to whatever holds focus
  // and that is not always inside the board (a browser control, the page
  // behind an overlay that did not take focus). Scoped by `open` instead.
  for (const event of [
    'pointermove',
    'mousemove',
    'pointerdown',
    'touchstart',
  ] as const) {
    board.addEventListener(event, armFade);
  }
  doc.addEventListener('keydown', () => {
    if (open) armFade();
  });
  // …and the bar's own focus changes, so tabbing INTO it cancels a pending
  // fade rather than racing it.
  bar.addEventListener('focusin', armFade);

  doc.addEventListener('keydown', (event) => {
    // Escape exits, faded or not. The one key that always means "get me
    // out", and the only way back for a keyboard user whose bar has faded.
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      void leave();
    }
  });

  // Leaving fullscreen by the browser's own means (F11, the Escape the API
  // itself consumes) must close the board too, or the overlay is left
  // covering a page nobody asked it to cover. A browser can also end a
  // fullscreen it granted without anyone asking -- measured on macOS WebKit
  // under load (#344) -- and closing is right then as well: the page cannot
  // tell that exit from a teacher's Escape.
  //
  // `inFullscreen` is what makes this safe. The event also fires for the
  // EXIT that tidies up a grant landing late, while the board was closed,
  // from a previous showing, and acting on that closed the board the
  // current showing had just opened. Only a showing that actually got
  // fullscreen can be the one leaving it.
  doc.addEventListener('fullscreenchange', () => {
    if (open && inFullscreen && !doc.fullscreenElement) void leave();
  });

  window.addEventListener('resize', refit);

  // A web font that lands after the board opened changes the sheet's height
  // without any resize, so the verdict `refit` took against the fallback face
  // went stale: `scrolls` stayed on for a sheet that then fitted exactly (#674).
  // Like `resize` above, this stays wired and `refit` ignores it while closed.
  doc.fonts?.addEventListener('loadingdone', refit);

  return {
    setShuffleLabel: (label: string) => {
      shuffle.textContent = label;
    },
    setAvailable: (available: boolean) => {
      openButton.hidden = !available;
      if (!available) void leave();
    },
    refit,
    isOpen: () => open,
  };
}

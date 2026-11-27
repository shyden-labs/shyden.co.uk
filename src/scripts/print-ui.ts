/**
 * The print panel: its four choices, their memory, and the `data-`
 * attributes the print stylesheet keys off.
 *
 * Design spec section 10. A panel rather than a bare button because "the
 * teacher decides what goes on the paper" — and the two class-list tick
 * boxes are INDEPENDENT rather than three named sheets, so all four
 * combinations are reachable, including "only who is here, with the
 * letters", which named sheets could not express.
 *
 * This module writes ATTRIBUTES, never a second rendering of the roster.
 * The printed sheet is the same DOM restyled by `@media print`; a second
 * rendering is how a printed sheet ends up disagreeing with the screen.
 *
 * PRIVACY (design spec section 11): the four keys below hold `both` /
 * `class-list` / `groups` and `on` / `off`. Nothing about a class is
 * written, and classroom-groups-print.spec.ts asserts the exact key set
 * rather than a prefix.
 */

/** The same tolerant wrapper `classroom-groups.ts` uses — see its own doc
 *  comment: some privacy profiles throw on the mere act of touching
 *  localStorage, and a preference that cannot follow a teacher to their next
 *  lesson is not a reason to break the panel. */
export interface Remember {
  read: (key: string) => string | null;
  write: (key: string, value: string) => void;
}

/**
 * What to print. A closed set, because it is written into an attribute the
 * stylesheet matches on — a typo in a free string would silently print
 * nothing rather than fail.
 */
export type PrintWhat = 'class-list' | 'groups' | 'both';

const KEY = {
  what: 'cg-print-what',
  absent: 'cg-print-absent',
  letters: 'cg-print-letters',
  avatars: 'cg-print-avatars',
} as const;

const isWhat = (value: unknown): value is PrintWhat =>
  value === 'class-list' || value === 'groups' || value === 'both';

export interface PrintPanel {
  /** Whether the panel can be opened at all — see `setAvailable`. */
  setAvailable: (available: boolean) => void;
}

export interface PrintHandlers {
  /**
   * Whether printing is allowed right now, and why not if it is not.
   *
   * Task 6 wires the out-of-date refusal through this; Task 1 leaves it
   * always-allowed. A predicate rather than a boolean read once at wiring
   * time, because the answer changes as the teacher edits.
   */
  refuseReason?: () => string | null;
  /**
   * Called once, after the `data-print-*` attributes are set and before
   * `window.print()`.
   *
   * The sheet's header carries a class name typed on the page, which this
   * module has no business reading: it owns the panel, not the tool. The
   * caller writes it, at the one moment it is about to matter.
   */
  onApply?: () => void;
}

export function renderPrintPanel(
  doc: Document,
  remember: Remember,
  handlers: PrintHandlers = {},
): PrintPanel | null {
  const panel = doc.getElementById(
    'cg-print-panel',
  ) as HTMLDialogElement | null;
  const open = doc.getElementById('cg-print-open');
  const cancel = doc.getElementById('cg-print-cancel');
  const confirm = doc.getElementById('cg-print-confirm');
  const absent = doc.getElementById(
    'cg-print-absent',
  ) as HTMLInputElement | null;
  const letters = doc.getElementById(
    'cg-print-letters',
  ) as HTMLInputElement | null;
  const avatars = doc.getElementById(
    'cg-print-avatars',
  ) as HTMLInputElement | null;
  if (
    !panel ||
    !open ||
    !cancel ||
    !confirm ||
    !absent ||
    !letters ||
    !avatars
  ) {
    return null;
  }

  const whatRadios = Array.from(
    doc.querySelectorAll<HTMLInputElement>('input[name="print-what"]'),
  );

  const readWhat = (): PrintWhat => {
    const chosen = whatRadios.find((r) => r.checked)?.value;
    return isWhat(chosen) ? chosen : 'both';
  };

  /**
   * Load the remembered choices onto the controls.
   *
   * An ABSENT key leaves the control at its markup default rather than
   * forcing it off — design spec section 10 is explicit that all three tick
   * boxes start ticked and What to print starts on Both, and a first-time
   * teacher must get that, not whatever `null` coerces to. Only the two
   * literal strings this module writes are honoured; anything else in the
   * key (a stale value, a hand-edited one) falls through to the default for
   * the same reason.
   */
  const load = () => {
    const what = remember.read(KEY.what);
    if (isWhat(what)) {
      for (const radio of whatRadios) radio.checked = radio.value === what;
    }
    for (const [key, box] of [
      [KEY.absent, absent],
      [KEY.letters, letters],
      [KEY.avatars, avatars],
    ] as const) {
      const value = remember.read(key);
      if (value === 'on' || value === 'off') box.checked = value === 'on';
    }
  };

  /**
   * Save on every change, not on Print.
   *
   * Cancel must keep the choices a teacher just made -- they were still
   * choices, and a panel that discards them punishes backing out to check
   * something. Design spec section 10 says the panel "remembers all four
   * choices for next time" without qualifying it by how the panel was
   * closed.
   */
  const save = () => {
    remember.write(KEY.what, readWhat());
    remember.write(KEY.absent, absent.checked ? 'on' : 'off');
    remember.write(KEY.letters, letters.checked ? 'on' : 'off');
    remember.write(KEY.avatars, avatars.checked ? 'on' : 'off');
  };

  /**
   * The choices, onto `<html>`, where `@media print` can see them.
   *
   * On the root element rather than a wrapper: the print stylesheet needs to
   * reach the whole page including elements outside the tool, and a
   * descendant selector from `<html>` costs nothing.
   */
  const apply = () => {
    const root = doc.documentElement;
    root.dataset.printWhat = readWhat();
    root.dataset.printAbsent = absent.checked ? 'on' : 'off';
    root.dataset.printLetters = letters.checked ? 'on' : 'off';
    root.dataset.printAvatars = avatars.checked ? 'on' : 'off';
  };

  for (const control of [...whatRadios, absent, letters, avatars]) {
    control.addEventListener('change', save);
  }

  open.addEventListener('click', () => {
    if (handlers.refuseReason?.()) return;
    load();
    panel.showModal();
  });

  cancel.addEventListener('click', () => panel.close());

  confirm.addEventListener('click', () => {
    save();
    apply();
    handlers.onApply?.();
    panel.close();
    // The attributes are set BEFORE this, so the browser's own print
    // preview renders the sheet the teacher chose. Called last and
    // separately so a test can assert the attributes without ever reaching
    // a dialog Playwright cannot dismiss.
    window.print();
  });

  load();
  // …and onto the document, immediately. `load()` alone put the remembered
  // choices on the CONTROLS but not on `<html>`, so `data-print-*` was
  // absent until the first time the panel's own Print was pressed. A
  // teacher whose stored preference is "Groups only", printing from the
  // browser's own menu, got both sheets -- the panel and the paper
  // disagreeing about a choice the panel was showing correctly.
  apply();

  return {
    // Design spec section 10's panel only makes sense once there is
    // something to print. The BUTTON is what disappears, not the dialog:
    // a dialog that cannot be reached needs no state of its own.
    setAvailable: (available: boolean) => {
      open.hidden = !available;
    },
  };
}

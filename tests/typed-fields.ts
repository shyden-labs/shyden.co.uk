/**
 * Every field a visitor types into, and the font-size each one computes to,
 * measured inside the page (#352, #390).
 *
 * iOS Safari zooms the whole page when a visitor focuses a field whose
 * computed font-size is under 16px. Two legs hold that floor: the emulated
 * `tests/e2e/zoom-on-focus.spec.ts`, on every page in CI, and Journey 11 in
 * `tests/device/ios/journeys.journey.ts`, on a real iPhone. They used to
 * define "a typed field" separately, and the phone, the one leg that sees
 * real WebKit, checked only `input[type=text|number]`: no select, textarea or
 * email field. One definition now serves both.
 *
 * Both callers ship `measureTypedFields` as TEXT: Playwright serialises it into
 * the page, and the iOS leg sends `(${measureTypedFields})()` down a WebDriver
 * wire. So it closes over nothing and this module imports nothing: a binding
 * from outside would type-check here and be `undefined` there.
 * `tests/guards/typed-fields.test.ts` holds both properties.
 */

/** Below this computed font-size, focusing a field makes iOS zoom the page. */
export const IOS_ZOOM_FLOOR_PX = 16;

/**
 * Every control that takes typed text, with its computed font-size. A closed
 * `<details>` is searched too: computed style is defined there, and the
 * visitor who opens it is the one who gets zoomed. Left out: input types that
 * open no keyboard, and anything under `aria-hidden` (the honeypot no person
 * reaches).
 */
export const measureTypedFields = (): { field: string; fontSize: number }[] => {
  const notTyped = [
    'hidden',
    'checkbox',
    'radio',
    'button',
    'submit',
    'reset',
    'file',
    'image',
    'range',
    'color',
  ];
  const fields = document.querySelectorAll<HTMLElement>(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
  );
  // Array.from, not a spread: a spread can be lowered into a helper that
  // lives in this module and not in the page.
  return Array.from(fields)
    .filter(
      (el) =>
        !(el instanceof HTMLInputElement && notTyped.includes(el.type)) &&
        !el.closest('[aria-hidden="true"]'),
    )
    .map((el) => ({
      field: el.id ? `#${el.id}` : el.tagName.toLowerCase(),
      fontSize: parseFloat(getComputedStyle(el).fontSize),
    }));
};

/** The wrapper the device leg sends over WebDriver's `execute/sync`. */
export const measureTypedFieldsScript = (): string =>
  `return (${measureTypedFields})();`;

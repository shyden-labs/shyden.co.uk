/**
 * What a visitor can see of a text node: the lines its text sits on, each cut
 * down to what every clip above it leaves showing (#198, #619).
 *
 * Read by `tests/e2e/rendered-text.spec.ts` (which joins those lines) and by
 * `tests/e2e/text-over-ribbon.spec.ts` (which scores the ink on them). They
 * read lines apart until #619, and the ribbon scan, reading raw line boxes,
 * scored the pause control's screen-reader name, clipped to nothing, at
 * 1.00:1 on every engine (run 38485095201).
 *
 * Both callers ship it as TEXT, `visibleLinesReaderScript()`, and build it
 * inside the page with `new Function`: Playwright serialises a callback, and a
 * binding from outside would type-check here and be `undefined` there. So it
 * closes over nothing and this module imports nothing.
 * `tests/guards/visible-text.test.ts` holds both properties.
 */

/**
 * A reader for one page: call it once, then on each text node. Its clip cache
 * lives as long as the reader, one `evaluate` call.
 */
export const visibleLinesReader = (): ((node: Text) => DOMRect[]) => {
  type Edges = { left: number; top: number; right: number; bottom: number };

  // A computed length in px: `4px`, or `50%` of `size`. NaN for anything
  // else (a calc(), say), so a clip this cannot read is never applied.
  const px = (value: string, size: number) =>
    /^-?[\d.]+px$/.test(value)
      ? parseFloat(value)
      : /^-?[\d.]+%$/.test(value)
        ? (parseFloat(value) / 100) * size
        : NaN;

  // What an element's `clip-path: inset()` and `clip: rect()` leave showing.
  // Both cut the element and everything inside it, which is how a `.visually-hidden`
  // label keeps its layout and shows nothing. Other clip-path shapes are not
  // read, so they cut nothing here: a clip this misreads can only show more
  // text to a check, never hide some from it.
  const clipCache = new Map<Element, Edges[]>();
  const clipsOf = (el: Element): Edges[] => {
    const cached = clipCache.get(el);
    if (cached) return cached;
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    const clips: Edges[] = [];

    const inset = /^inset\(([^)]*)\)/.exec(style.clipPath);
    if (inset) {
      const [t, r = t, b = t, l = r] = inset[1]
        .split(' round ')[0]
        .trim()
        .split(/\s+/);
      clips.push({
        left: box.left + px(l, box.width),
        top: box.top + px(t, box.height),
        right: box.right - px(r, box.width),
        bottom: box.bottom - px(b, box.height),
      });
    }

    const rect = /^rect\(([^)]*)\)/.exec(style.getPropertyValue('clip'));
    if (rect && ['absolute', 'fixed'].includes(style.position)) {
      const [t, r, b, l] = rect[1].split(/,\s*|\s+/);
      const offset = (value: string, auto: number) =>
        value === 'auto' ? auto : px(value, 0);
      clips.push({
        left: box.left + offset(l, 0),
        top: box.top + offset(t, 0),
        right: box.left + offset(r, box.width),
        bottom: box.top + offset(b, box.height),
      });
    }

    const readable = clips.filter((clip) =>
      Object.values(clip).every(Number.isFinite),
    );
    clipCache.set(el, readable);
    return readable;
  };

  // A line of text cut down to what every clip above it leaves showing, or
  // null when that is nothing.
  const showing = (line: DOMRect, parent: Element): DOMRect | null => {
    let { left, top, right, bottom } = line;
    for (let el: Element | null = parent; el; el = el.parentElement) {
      for (const clip of clipsOf(el)) {
        left = Math.max(left, clip.left);
        top = Math.max(top, clip.top);
        right = Math.min(right, clip.right);
        bottom = Math.min(bottom, clip.bottom);
      }
    }
    return right > left && bottom > top
      ? new DOMRect(left, top, right - left, bottom - top)
      : null;
  };

  // The rest of the ways to keep text in the layout and paint none of it:
  // inside a closed <details>, `visibility: hidden`, `opacity: 0`. Each
  // option is passed under both of its names, because Safari shipped the
  // older ones first.
  const painted = (el: Element) => {
    if (typeof el.checkVisibility !== 'function') {
      throw new Error(
        'Element.checkVisibility() is missing, so this browser cannot say ' +
          'which text a visitor sees. Every line it reported would be a guess.',
      );
    }
    return el.checkVisibility({
      opacityProperty: true,
      visibilityProperty: true,
      checkOpacity: true,
      checkVisibilityCSS: true,
    });
  };

  return (node: Text): DOMRect[] => {
    const parent = node.parentElement;
    if (!parent || !painted(parent)) return [];
    const range = document.createRange();
    range.selectNodeContents(node);
    return [...range.getClientRects()]
      .filter((r) => r.width > 0)
      .map((r) => showing(r, parent))
      .filter((r): r is DOMRect => r !== null);
  };
};

/** The reader as source, for `new Function(script)()` inside the page. */
export const visibleLinesReaderScript = (): string =>
  `return (${visibleLinesReader})();`;

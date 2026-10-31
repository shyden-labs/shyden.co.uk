import { describe, expect, it, vi } from 'vitest';
import {
  CANARY_INSTALL_SCRIPT,
  CANARY_REMOVE_SCRIPT,
  CANARY_SCRIPT,
  FIELD_SCRIPT,
  KEYBOARD_GONE_SCRIPT,
  KEYBOARD_SCRIPT,
  LANDING_SCRIPT,
  OPTION_SCRIPT,
  MAX_SWIPES,
  PREPARE_SCRIPT,
  RealTapInteraction,
  runTapCanary,
  TapNotLandedError,
  type Calibration,
  type ScriptPort,
} from '../device/ios/interaction';
import type { PageElement } from '../device/ios/page-driver';
import type { Point } from '../device/ios/wda';

/**
 * Every iPhone tap is a real touch through WebDriverAgent (#838), and every
 * scroll a real finger's drag (global rule 2026-10-31: all device input is
 * real, with no fake fallback). The page and WDA are stand-ins that record
 * what was asked of them.
 */

const SCREEN = { x: 0, y: 0, width: 420, height: 912 };
const CALIBRATION: Calibration = {
  origin: { x: 0, y: 68 },
  innerHeight: 746,
  viewHeight: 746,
};
const RECT = { x: 100, y: 300, width: 100, height: 40 };
const VV = { offsetLeft: 0, offsetTop: 0, scale: 1 };

const prepared = (over: Record<string, unknown> = {}) => ({
  rect: RECT,
  vv: VV,
  hit: null,
  viewHeight: 746,
  innerHeight: 746,
  inView: true,
  ...over,
});
const landed = (over: Record<string, unknown> = {}) => ({
  touch: {
    isTrusted: true,
    pointerType: 'touch',
    clientX: 150,
    clientY: 320,
    ...over,
  },
  stray: null,
});

const element = (selector = '#cg-go') =>
  ({ selector, objectId: `obj-${selector}` }) as unknown as PageElement;

type Handler = (args: unknown[]) => unknown;

const NAMES = new Map<string, string>([
  [PREPARE_SCRIPT, 'prepare'],
  [LANDING_SCRIPT, 'landing'],
  [FIELD_SCRIPT, 'field'],
  [KEYBOARD_SCRIPT, 'keyboard'],
  [KEYBOARD_GONE_SCRIPT, 'keyboard-gone'],
  [OPTION_SCRIPT, 'option'],
  [CANARY_INSTALL_SCRIPT, 'canary-install'],
  [CANARY_SCRIPT, 'canary'],
  [CANARY_REMOVE_SCRIPT, 'canary-remove'],
]);

function fakes(handlers: Partial<Record<string, Handler>> = {}) {
  const log: string[] = [];
  const taps: Point[] = [];
  const keys: string[] = [];
  const swipes: [Point, Point][] = [];
  let menu = [{ x: 85, y: 551, width: 250, height: 36 }];
  const answers = new Map<string, Handler>([
    ['prepare', () => prepared()],
    ['landing', () => landed()],
    ['field', () => ({ value: '', focused: false })],
    ['keyboard', () => true],
    ['keyboard-gone', () => true],
    ['option', () => 'Skip the animation'],
    ['canary-install', () => true],
    [
      'canary',
      () => ({
        touch: {
          isTrusted: true,
          pointerType: 'touch',
          clientX: 210,
          clientY: 388,
        },
        innerHeight: 746,
        viewHeight: 746,
      }),
    ],
    ['canary-remove', () => true],
  ]);
  for (const [name, handler] of Object.entries(handlers))
    if (handler) answers.set(name, handler);
  const run = async <T>(script: string, args: unknown[] = []): Promise<T> => {
    const name = NAMES.get(script);
    if (name === undefined)
      throw new Error(`unexpected script: ${script.slice(0, 60)}`);
    log.push(name);
    return (answers.get(name) as Handler)(args) as T;
  };
  const page: ScriptPort = { executeScript: run, executeAsyncScript: run };
  const wda = {
    async tap(point: Point) {
      log.push('tap');
      taps.push(point);
    },
    async keys(text: string) {
      log.push('keys');
      keys.push(text);
    },
    async swipe(from: Point, to: Point) {
      log.push('swipe');
      swipes.push([from, to]);
    },
    async buttonsLabelled(label: string) {
      log.push(`menu:${label}`);
      return menu;
    },
  };
  return {
    page,
    wda,
    log,
    taps,
    keys,
    swipes,
    answers,
    setMenu: (m: typeof menu) => (menu = m),
  };
}

const interaction = (f: ReturnType<typeof fakes>) =>
  new RealTapInteraction(f.page, f.wda, CALIBRATION, SCREEN);

/** Answers each call from `list` in turn, the last one again once it runs out. */
const inTurn = (...list: unknown[]): Handler => {
  let i = 0;
  return () => list[Math.min(i++, list.length - 1)];
};

describe('RealTapInteraction.click: the tap', () => {
  it('prepares the element, taps, then reads the landing', async () => {
    const f = fakes();
    await interaction(f).click(element());
    expect(f.log).toEqual(['prepare', 'tap', 'landing']);
  });

  it('taps the mapped screen point once', async () => {
    const f = fakes();
    await interaction(f).click(element());
    expect(f.taps).toEqual([{ x: 150, y: 388 }]);
  });

  it('refuses, naming it, when something covers the element in the middle of the view, and never taps', async () => {
    const f = fakes({ prepare: () => prepared({ hit: 'div#overlay.cover' }) });
    const tapping = interaction(f).click(element());
    await expect(tapping).rejects.toBeInstanceOf(TapNotLandedError);
    await expect(tapping).rejects.toThrow(
      /#cg-go is covered: a finger at its centre would touch div#overlay\.cover/,
    );
    expect(f.taps).toEqual([]);
    expect(f.swipes).toEqual([]);
  });

  it('fails when no touch reaches the element', async () => {
    const f = fakes({ landing: () => ({ touch: null, stray: null }) });
    await expect(interaction(f).click(element())).rejects.toThrow(
      /a real tap on #cg-go did not land: no touch reached it within 2 s/,
    );
  });

  it('says where a missed touch went', async () => {
    const f = fakes({
      landing: () => ({
        touch: null,
        stray: { target: 'label', clientX: 150, clientY: 330 },
      }),
    });
    await expect(interaction(f).click(element())).rejects.toThrow(
      /did not land: the touch reached label at \(150, 330\) instead/,
    );
  });

  it('fails when the touch that arrived was not trusted', async () => {
    const f = fakes({ landing: () => landed({ isTrusted: false }) });
    await expect(interaction(f).click(element())).rejects.toThrow(
      /did not land: the event was untrusted/,
    );
  });

  it('fails when the event was not a touch', async () => {
    const f = fakes({ landing: () => landed({ pointerType: 'mouse' }) });
    await expect(interaction(f).click(element())).rejects.toThrow(
      /did not land: the event was a mouse, not a touch/,
    );
  });

  it("fails naming the drift when the touch landed outside the element's box", async () => {
    const f = fakes({ landing: () => landed({ clientY: 400 }) });
    await expect(interaction(f).click(element())).rejects.toThrow(
      /aimed at \(150, 320\) and landed at \(150, 400\)/,
    );
  });

  it("counts a touch on the element's own label as landing, as a finger on a radio button's option does", async () => {
    const f = fakes({
      landing: () => landed({ viaLabel: true, clientX: 29, clientY: 305 }),
    });
    await interaction(f).click(
      element('input[name="mode"][value="groupCount"]'),
    );
    expect(f.taps).toHaveLength(1);
  });

  it('passes each tap its own token, so a late event from an earlier tap cannot count', async () => {
    const tokens: unknown[] = [];
    const f = fakes({
      prepare: (args) => {
        tokens.push(args[1]);
        return prepared();
      },
    });
    const i = interaction(f);
    await i.click(element());
    await i.click(element());
    expect(tokens[0]).not.toEqual(tokens[1]);
  });
});

describe('RealTapInteraction.click: real scrolling', () => {
  const below = prepared({
    rect: { x: 100, y: 1200, width: 100, height: 40 },
    inView: false,
  });

  it('brings an element below the view up with a real swipe up the middle of the screen', async () => {
    const f = fakes({ prepare: inTurn(below, prepared()) });
    await interaction(f).click(element());
    expect(f.log).toEqual(['prepare', 'swipe', 'prepare', 'tap', 'landing']);
    const [[from, to]] = f.swipes;
    expect(
      [from.x, to.x],
      "in the page's right-hand margin, clear of every control",
    ).toEqual([412, 412]);
    expect(from.y - to.y, 'up, at most 60% of the view').toBeCloseTo(
      746 * 0.6,
      0,
    );
  });

  it('swipes down for an element above the view', async () => {
    const f = fakes({
      prepare: inTurn(
        prepared({
          rect: { x: 100, y: -200, width: 100, height: 40 },
          inView: false,
        }),
        prepared(),
      ),
    });
    await interaction(f).click(element());
    const [[from, to]] = f.swipes;
    expect(to.y).toBeGreaterThan(from.y);
  });

  it('swipes an element out from under a sticky bar at the edge of the view, then taps it', async () => {
    const f = fakes({
      prepare: inTurn(
        prepared({
          rect: { x: 100, y: 690, width: 100, height: 40 },
          hit: 'p.actions',
        }),
        prepared(),
      ),
    });
    await interaction(f).click(element('#cg-count'));
    expect(f.log).toEqual(['prepare', 'swipe', 'prepare', 'tap', 'landing']);
  });

  it('fails as covered when the page cannot scroll the element out from under the bar', async () => {
    const f = fakes({
      prepare: () =>
        prepared({
          rect: { x: 100, y: 690, width: 100, height: 40 },
          hit: 'p.actions',
        }),
    });
    await expect(interaction(f).click(element('#cg-count'))).rejects.toThrow(
      /#cg-count is covered: a finger at its centre would touch p\.actions/,
    );
    expect(
      f.swipes,
      'one swipe, then the page was seen not to move',
    ).toHaveLength(1);
  });

  it('fails naming the element when the page stops moving before it comes into view', async () => {
    const f = fakes({ prepare: () => below });
    await expect(interaction(f).click(element())).rejects.toThrow(
      /#cg-go did not come into view: a real swipe no longer moves it/,
    );
    expect(f.taps).toEqual([]);
  });

  it(`gives up after ${MAX_SWIPES} real swipes that move the page but never bring the element in`, async () => {
    let y = 5000;
    const f = fakes({
      prepare: () =>
        prepared({
          rect: { x: 100, y: (y += 1), width: 100, height: 40 },
          inView: false,
        }),
    });
    await expect(interaction(f).click(element())).rejects.toThrow(
      new RegExp(
        `#cg-go did not come into view after ${MAX_SWIPES} real swipes`,
      ),
    );
    expect(f.swipes).toHaveLength(MAX_SWIPES);
  });

  it("no page script scrolls the page: scrolling is a finger's", () => {
    for (const script of NAMES.keys())
      expect(script).not.toMatch(
        /scrollIntoView|scrollTo|scrollBy|scrollTop\s*=/,
      );
  });
});

describe('RealTapInteraction.click: the page moved on screen', () => {
  it('measures the origin again with a real tap when the view changed size, then taps with it', async () => {
    const f = fakes({
      prepare: () => prepared({ innerHeight: 843, viewHeight: 843 }),
      canary: () => ({
        touch: {
          isTrusted: true,
          pointerType: 'touch',
          clientX: 210,
          clientY: 470,
        },
        innerHeight: 843,
        viewHeight: 843,
      }),
    });
    await interaction(f).click(element());
    expect(f.log).toEqual([
      'prepare',
      'canary-install',
      'tap',
      'canary',
      'canary-remove',
      'prepare',
      'tap',
      'landing',
    ]);
    // The canary aims at the middle of the screen, never at a position an
    // earlier, possibly bad, measurement gave.
    expect(f.taps[0]).toEqual({ x: 210, y: 456 });
    // Origin now 456 - 470 = -14: the element's centre 320 lands at 306.
    expect(f.taps[1]).toEqual({ x: 150, y: 306 });
  });
});

describe('RealTapInteraction.type and clear', () => {
  it('taps the field, types on the keyboard, waits for the keyboard to settle, and checks the value', async () => {
    let value = '';
    const f = fakes({ field: () => ({ value, focused: false }) });
    f.wda.keys = async (text: string) => {
      f.log.push('keys');
      value += text;
    };
    await interaction(f).type(element('#cg-count'), '12');
    expect(f.log).toEqual([
      'field',
      'prepare',
      'tap',
      'landing',
      'keys',
      'keyboard',
      'field',
    ]);
  });

  it('does not tap a field it is already typing in', async () => {
    let value = '';
    const f = fakes({ field: () => ({ value, focused: true }) });
    f.wda.keys = async (text: string) => {
      value += text;
    };
    await interaction(f).type(element('#cg-count'), '12');
    expect(f.taps).toEqual([]);
  });

  it('fails when the keyboard does not come back after typing', async () => {
    const f = fakes({
      field: () => ({ value: '', focused: true }),
      keyboard: () => false,
    });
    await expect(
      interaction(f).type(element('#cg-count'), '12'),
    ).rejects.toThrow(
      /the keyboard did not come back and settle within 3 s after typing into #cg-count/,
    );
  });

  it('fails when the keyboard left a different value than was typed', async () => {
    const f = fakes({ field: () => ({ value: 'Ana', focused: true }) });
    await expect(interaction(f).type(element('#name'), 'ana')).rejects.toThrow(
      /typed "ana" into #name, which now holds "Ana"/,
    );
  });

  it('clear sends one backspace per character and checks the field is empty', async () => {
    let value = '20';
    const f = fakes({ field: () => ({ value, focused: false }) });
    f.wda.keys = async (text: string) => {
      f.keys.push(text);
      value = '';
    };
    await interaction(f).clear(element('#cg-count'));
    expect(f.keys).toEqual(['\b\b']);
  });

  it('clear fails when the field is not empty afterwards', async () => {
    const f = fakes({ field: () => ({ value: '2', focused: true }) });
    await expect(interaction(f).clear(element('#cg-count'))).rejects.toThrow(
      /cleared #cg-count, which still holds "2"/,
    );
  });
});

describe('runTapCanary', () => {
  it('measures the page origin, and the view it measured it in, from where its real tap lands', async () => {
    const f = fakes();
    expect(await runTapCanary(f.page, f.wda, SCREEN)).toEqual(CALIBRATION);
    expect(f.taps).toEqual([{ x: 210, y: 456 }]);
  });

  it("takes the visual viewport's scroll out of the origin, as a keyboard-open measurement needs", async () => {
    const f = fakes({
      canary: () => ({
        touch: {
          isTrusted: true,
          pointerType: 'touch',
          clientX: 210,
          clientY: 510,
        },
        innerHeight: 746,
        viewHeight: 423,
        offsetLeft: 0,
        offsetTop: 122,
        scale: 1,
      }),
    });
    expect((await runTapCanary(f.page, f.wda, SCREEN)).origin).toEqual({
      x: 0,
      y: 68,
    });
  });

  it('fails closed when the trusted event never arrives, and removes its layer', async () => {
    const f = fakes({
      canary: () => ({ touch: null, innerHeight: 746, viewHeight: 746 }),
    });
    await expect(runTapCanary(f.page, f.wda, SCREEN)).rejects.toThrow(
      /^iPhone real taps are not landing: no touch reached the page within 2 s\. The run stops here; it never falls back to el\.click\(\)\./,
    );
    expect(f.log).toContain('canary-remove');
  });

  it('fails closed on an untrusted event', async () => {
    const f = fakes({
      canary: () => ({
        touch: {
          isTrusted: false,
          pointerType: 'touch',
          clientX: 210,
          clientY: 388,
        },
        innerHeight: 746,
        viewHeight: 746,
      }),
    });
    await expect(runTapCanary(f.page, f.wda, SCREEN)).rejects.toThrow(
      /^iPhone real taps are not landing: the event was untrusted/,
    );
  });
});

describe('wdaUrlFrom', () => {
  it('refuses to start without WDA_URL, naming who starts WDA', async () => {
    const { wdaUrlFrom } = await import('../device/ios/session');
    expect(() => wdaUrlFrom({})).toThrow(
      /WDA_URL is not set: WebDriverAgent is started by scripts\/test-devices\.mjs/,
    );
  });
  it('hands on the URL the runner set', async () => {
    const { wdaUrlFrom } = await import('../device/ios/session');
    expect(wdaUrlFrom({ WDA_URL: 'http://[fd97::1]:8100' })).toBe(
      'http://[fd97::1]:8100',
    );
  });
});

describe('RealTapInteraction.select', () => {
  it("opens the menu with a real tap, then taps the option in the phone's own menu and checks the value", async () => {
    let value = 'normal';
    const f = fakes({ field: () => ({ value, focused: false }) });
    const tap = f.wda.tap;
    f.wda.tap = async (point: Point) => {
      await tap(point);
      if (f.taps.length === 2) value = 'skip';
    };
    await interaction(f).select(element('#cg-speed'), 'skip');
    expect(f.log).toEqual([
      'option',
      'prepare',
      'tap',
      'landing',
      'menu:Skip the animation',
      'tap',
      'field',
    ]);
    expect(f.taps[1]).toEqual({ x: 210, y: 569 });
  });

  it('fails when no option has that value', async () => {
    const f = fakes({ option: () => null });
    await expect(
      interaction(f).select(element('#cg-speed'), 'warp'),
    ).rejects.toThrow(/#cg-speed has no option with the value "warp"/);
    expect(f.taps).toEqual([]);
  });

  it("fails when the phone's menu never shows the option", async () => {
    vi.useFakeTimers();
    try {
      const f = fakes();
      f.setMenu([]);
      const choosing = interaction(f).select(element('#cg-speed'), 'skip');
      const verdict = expect(choosing).rejects.toThrow(
        /the phone's menu for #cg-speed never showed "Skip the animation" within 2 s/,
      );
      await vi.advanceTimersByTimeAsync(2_100);
      await verdict;
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails when the menu shows the label more than once', async () => {
    const f = fakes();
    f.setMenu([
      { x: 85, y: 551, width: 250, height: 36 },
      { x: 85, y: 600, width: 250, height: 36 },
    ]);
    await expect(
      interaction(f).select(element('#cg-speed'), 'skip'),
    ).rejects.toThrow(
      /the phone shows 2 buttons labelled "Skip the animation"/,
    );
  });

  it('fails when the tap left a different value', async () => {
    const f = fakes({ field: () => ({ value: 'normal', focused: false }) });
    await expect(
      interaction(f).select(element('#cg-speed'), 'skip'),
    ).rejects.toThrow(
      /chose "Skip the animation" in #cg-speed, which now holds "normal"/,
    );
  });
});

describe('RealTapInteraction.click: the keyboard is in the way', () => {
  const hidden = prepared({
    rect: { x: 100, y: 467, width: 100, height: 40 },
    inView: false,
    viewHeight: 423,
  });

  it("taps the keyboard bar's Done for real when the keyboard hides the target, waits for it to go, then taps", async () => {
    const f = fakes({ prepare: inTurn(hidden, prepared()) });
    f.setMenu([{ x: 355, y: 538, width: 40, height: 38 }]);
    await interaction(f).click(element('#cg-size'));
    expect(f.log).toEqual([
      'prepare',
      'menu:Done',
      'tap',
      'keyboard-gone',
      'prepare',
      'tap',
      'landing',
    ]);
    expect(f.taps[0]).toEqual({ x: 375, y: 557 });
  });

  // iPhone run 9, Journey 14 (id): the keyboard was found up only after the
  // first swipe, and every later drag was undone by Safari keeping the
  // focused field in view, 12 times over.
  it('closes the keyboard when it is found up between swipes, not only before the first', async () => {
    const f = fakes({
      prepare: inTurn(
        prepared({
          rect: { x: 100, y: 900, width: 100, height: 40 },
          inView: false,
        }),
        hidden,
        prepared(),
      ),
    });
    f.setMenu([{ x: 355, y: 538, width: 40, height: 38 }]);
    await interaction(f).click(element('#cg-size'));
    expect(f.log).toEqual([
      'prepare',
      'swipe',
      'prepare',
      'menu:Done',
      'tap',
      'keyboard-gone',
      'prepare',
      'tap',
      'landing',
    ]);
  });

  it('closes the keyboard too when the lifted bar covers the target', async () => {
    const f = fakes({
      prepare: inTurn(
        prepared({
          rect: { x: 100, y: 390, width: 100, height: 40 },
          viewHeight: 423,
          hit: 'p.actions',
        }),
        prepared(),
      ),
    });
    f.setMenu([{ x: 355, y: 538, width: 40, height: 38 }]);
    await interaction(f).click(element('#cg-count'));
    expect(f.log.slice(0, 3)).toEqual(['prepare', 'menu:Done', 'tap']);
  });

  it('fails naming the keyboard when the phone shows no single Done button', async () => {
    const f = fakes({ prepare: () => hidden });
    f.setMenu([]);
    await expect(interaction(f).click(element('#cg-size'))).rejects.toThrow(
      /the keyboard hides #cg-size, and the phone shows 0 buttons labelled "Done" to close it/,
    );
  });

  it('fails when the keyboard does not go after Done', async () => {
    const f = fakes({ prepare: () => hidden, 'keyboard-gone': () => false });
    f.setMenu([{ x: 355, y: 538, width: 40, height: 38 }]);
    await expect(interaction(f).click(element('#cg-size'))).rejects.toThrow(
      /tapped Done, and the keyboard was still up after 3 s/,
    );
  });
});

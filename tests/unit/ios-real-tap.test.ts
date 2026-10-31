import { describe, expect, it } from 'vitest';
import {
  LANDING_SCRIPT,
  PREPARE_SCRIPT,
  CANARY_SCRIPT,
  CANARY_REMOVE_SCRIPT,
  FIELD_SCRIPT,
  KEYBOARD_SCRIPT,
  MAX_SWIPES,
  RealTapInteraction,
  runTapCanary,
  TapNotLandedError,
  type ScriptPort,
} from '../device/ios/interaction';
import type { PageElement } from '../device/ios/page-driver';
import type { Point } from '../device/ios/wda';

/**
 * Every iPhone tap is a real touch through WebDriverAgent (#838): the target
 * is brought to the middle of the view, checked to be what a finger at its
 * centre would hit, touched for real, and checked to have received a trusted
 * touch. The page and WDA are stand-ins that record what was asked of them.
 */

const SCREEN = { x: 0, y: 0, width: 420, height: 912 };
const ORIGIN = { x: 0, y: 68 };
const RECT = { x: 100, y: 300, width: 100, height: 40 };
const VV = { offsetLeft: 0, offsetTop: 0, scale: 1 };

const element = (selector = '#cg-go') =>
  ({ selector, objectId: `obj-${selector}` }) as unknown as PageElement;

type Handler = (args: unknown[]) => unknown;

function fakes({
  prepare = (): unknown => ({
    rect: RECT,
    vv: VV,
    hit: null,
    viewHeight: 746,
    keyboard: false,
    inView: true,
  }),
  landing = (): unknown => ({
    touch: {
      isTrusted: true,
      pointerType: 'touch',
      clientX: 150,
      clientY: 320,
    },
    stray: null,
  }),
  field = (): unknown => ({ value: '', focused: false }),
  keyboard = (): unknown => true,
}: {
  prepare?: Handler;
  landing?: Handler;
  field?: Handler;
  keyboard?: Handler;
} = {}) {
  const log: string[] = [];
  const taps: Point[] = [];
  const keys: string[] = [];
  const swipes: [Point, Point][] = [];
  const handlers = new Map<string, Handler>([
    [PREPARE_SCRIPT, prepare],
    [LANDING_SCRIPT, landing],
    [FIELD_SCRIPT, field],
    [KEYBOARD_SCRIPT, keyboard],
  ]);
  const page: ScriptPort = {
    async executeScript<T>(script: string, args: unknown[] = []): Promise<T> {
      return this.executeAsyncScript<T>(script, args);
    },
    async executeAsyncScript<T>(
      script: string,
      args: unknown[] = [],
    ): Promise<T> {
      const handler = handlers.get(script);
      if (handler === undefined)
        throw new Error(`unexpected script: ${script.slice(0, 60)}`);
      log.push(
        script === PREPARE_SCRIPT
          ? 'prepare'
          : script === LANDING_SCRIPT
            ? 'landing'
            : script === KEYBOARD_SCRIPT
              ? 'keyboard'
              : 'field',
      );
      return handler(args) as T;
    },
  };
  const wda = {
    async tap(point: Point) {
      log.push('tap');
      taps.push(point);
    },
    async keys(text: string) {
      log.push('keys');
      keys.push(text);
    },
    async dismissKeyboard() {
      log.push('dismiss');
    },
    async swipe(from: Point, to: Point) {
      log.push('swipe');
      swipes.push([from, to]);
    },
  };
  return { page, wda, log, taps, keys, swipes, handlers };
}

const interaction = (f: ReturnType<typeof fakes>) =>
  new RealTapInteraction(f.page, f.wda, ORIGIN, SCREEN);

describe('RealTapInteraction.click', () => {
  it('prepares the element (scroll to centre, hit check, arm) before it taps, then reads the landing', async () => {
    const f = fakes();
    await interaction(f).click(element());
    expect(f.log).toEqual(['prepare', 'tap', 'landing']);
  });

  it('taps the mapped screen point once', async () => {
    const f = fakes();
    await interaction(f).click(element());
    expect(f.taps).toEqual([{ x: 150, y: 388 }]);
  });

  it('refuses when another element is the hit target, naming it, and never taps', async () => {
    const f = fakes({
      prepare: () => ({
        rect: RECT,
        vv: VV,
        hit: 'div#overlay.cover',
        viewHeight: 746,
        inView: true,
        keyboard: false,
      }),
    });
    const tapping = interaction(f).click(element());
    await expect(tapping).rejects.toBeInstanceOf(TapNotLandedError);
    await expect(tapping).rejects.toThrow(
      /#cg-go is covered: a finger at its centre would touch div#overlay\.cover/,
    );
    expect(f.taps).toEqual([]);
  });

  it('fails when no touch reaches the element', async () => {
    const f = fakes({ landing: () => ({ touch: null, stray: null }) });
    await expect(interaction(f).click(element())).rejects.toThrow(
      /a real tap on #cg-go did not land: no touch reached it within 2 s/,
    );
  });

  it('fails when the touch that arrived was not trusted', async () => {
    const f = fakes({
      landing: () => ({
        touch: {
          isTrusted: false,
          pointerType: 'touch',
          clientX: 150,
          clientY: 320,
        },
        stray: null,
      }),
    });
    await expect(interaction(f).click(element())).rejects.toThrow(
      /did not land: the event was untrusted/,
    );
  });

  it('fails when the event was not a touch', async () => {
    const f = fakes({
      landing: () => ({
        touch: {
          isTrusted: true,
          pointerType: 'mouse',
          clientX: 150,
          clientY: 320,
        },
        stray: null,
      }),
    });
    await expect(interaction(f).click(element())).rejects.toThrow(
      /did not land: the event was a mouse, not a touch/,
    );
  });

  it("fails naming the drift when the touch landed outside the element's box", async () => {
    const f = fakes({
      landing: () => ({
        touch: {
          isTrusted: true,
          pointerType: 'touch',
          clientX: 150,
          clientY: 400,
        },
        stray: null,
      }),
    });
    await expect(interaction(f).click(element())).rejects.toThrow(
      /aimed at \(150, 320\) and landed at \(150, 400\)/,
    );
  });

  it('closes the keyboard with Done when it hides the target, then prepares again and taps', async () => {
    const f = fakes();
    let calls = 0;
    f.handlers.set(PREPARE_SCRIPT, () =>
      ++calls === 1
        ? {
            rect: { x: 100, y: 700, width: 100, height: 40 },
            vv: VV,
            hit: null,
            viewHeight: 400,
            inView: false,
            keyboard: true,
          }
        : {
            rect: RECT,
            vv: VV,
            hit: null,
            viewHeight: 746,
            inView: true,
            keyboard: false,
          },
    );
    await interaction(f).click(element());
    expect(f.log).toEqual(['prepare', 'dismiss', 'prepare', 'tap', 'landing']);
  });

  it('fails naming the keyboard when Done did not uncover the target', async () => {
    const f = fakes({
      prepare: () => ({
        rect: { x: 100, y: 700, width: 100, height: 40 },
        vv: VV,
        hit: null,
        viewHeight: 400,
        inView: false,
        keyboard: true,
      }),
    });
    await expect(interaction(f).click(element())).rejects.toThrow(
      /#cg-go is behind the keyboard: its centre is at y 720 and the visible page ends at 400, even after tapping Done/,
    );
  });

  it('says where a missed touch went', async () => {
    const f = fakes({
      landing: () => ({
        touch: null,
        stray: { target: 'div.keyboard-shim', clientX: 150, clientY: 330 },
      }),
    });
    await expect(interaction(f).click(element())).rejects.toThrow(
      /did not land: the touch reached div\.keyboard-shim at \(150, 330\) instead/,
    );
  });

  it('brings an element below the view up with a real swipe, never a script scroll', async () => {
    const f = fakes();
    let calls = 0;
    f.handlers.set(PREPARE_SCRIPT, () =>
      ++calls === 1
        ? {
            rect: { x: 100, y: 1200, width: 100, height: 40 },
            vv: VV,
            hit: null,
            viewHeight: 746,
            keyboard: false,
            inView: false,
          }
        : {
            rect: RECT,
            vv: VV,
            hit: null,
            viewHeight: 746,
            keyboard: false,
            inView: true,
          },
    );
    await interaction(f).click(element());
    expect(f.log).toEqual(['prepare', 'swipe', 'prepare', 'tap', 'landing']);
    const [[from, to]] = f.swipes;
    expect(from.x).toBe(210);
    expect(to.x).toBe(210);
    expect(
      from.y - to.y,
      'the finger moves up, at most 60% of the view',
    ).toBeCloseTo(746 * 0.6, 0);
  });

  it('swipes down for an element above the view', async () => {
    const f = fakes();
    let calls = 0;
    f.handlers.set(PREPARE_SCRIPT, () =>
      ++calls === 1
        ? {
            rect: { x: 100, y: -200, width: 100, height: 40 },
            vv: VV,
            hit: null,
            viewHeight: 746,
            keyboard: false,
            inView: false,
          }
        : {
            rect: RECT,
            vv: VV,
            hit: null,
            viewHeight: 746,
            keyboard: false,
            inView: true,
          },
    );
    await interaction(f).click(element());
    const [[from, to]] = f.swipes;
    expect(to.y).toBeGreaterThan(from.y);
  });

  it('fails naming the element when real swipes never bring it into view', async () => {
    const f = fakes({
      prepare: () => ({
        rect: { x: 100, y: 5000, width: 100, height: 40 },
        vv: VV,
        hit: null,
        viewHeight: 746,
        keyboard: false,
        inView: false,
      }),
    });
    await expect(interaction(f).click(element())).rejects.toThrow(
      new RegExp(
        `#cg-go did not come into view after ${MAX_SWIPES} real swipes`,
      ),
    );
    expect(f.swipes).toHaveLength(MAX_SWIPES);
    expect(f.taps).toEqual([]);
  });

  it("no page script scrolls the page: scrolling is a finger's", () => {
    expect(PREPARE_SCRIPT).not.toMatch(
      /scrollIntoView|scrollTo|scrollBy|scrollTop\s*=/,
    );
  });

  it('passes each tap its own token, so a late event from an earlier tap cannot count', async () => {
    const f = fakes();
    const tokens: unknown[] = [];
    f.handlers.set(PREPARE_SCRIPT, (args) => {
      tokens.push(args[1]);
      return {
        rect: RECT,
        vv: VV,
        hit: null,
        viewHeight: 746,
        inView: true,
        keyboard: false,
      };
    });
    const i = interaction(f);
    await i.click(element());
    await i.click(element());
    expect(tokens[0]).not.toEqual(tokens[1]);
  });
});

describe('RealTapInteraction.type and clear', () => {
  it('taps the field, then types on the keyboard and checks the value', async () => {
    let value = '';
    const f = fakes({ field: () => ({ value, focused: false }) });
    f.wda.keys = async (text: string) => {
      f.log.push('keys');
      f.keys.push(text);
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
    expect(f.keys).toEqual(['12']);
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

  it('does not tap a field it is already typing in', async () => {
    let value = '';
    const f = fakes({ field: () => ({ value, focused: true }) });
    f.wda.keys = async (text: string) => {
      f.keys.push(text);
      value += text;
    };
    await interaction(f).type(element('#cg-count'), '12');
    expect(f.taps).toEqual([]);
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
  function canaryPage(touch: unknown) {
    const calls: string[] = [];
    const page: ScriptPort = {
      async executeScript<T>(script: string): Promise<T> {
        calls.push(script === CANARY_REMOVE_SCRIPT ? 'remove' : 'other');
        return null as T;
      },
      async executeAsyncScript<T>(script: string): Promise<T> {
        if (script === CANARY_SCRIPT) {
          calls.push('canary');
          return touch as T;
        }
        throw new Error('unexpected');
      },
    };
    return { page, calls };
  }

  it('measures the page origin from where its real tap lands', async () => {
    const { page } = canaryPage({
      isTrusted: true,
      pointerType: 'touch',
      clientX: 210,
      clientY: 388,
    });
    const taps: Point[] = [];
    const wda = {
      tap: async (p: Point) => void taps.push(p),
      keys: async () => {},
      dismissKeyboard: async () => {},
      swipe: async () => {},
    };
    expect(await runTapCanary(page, wda, SCREEN)).toEqual({ x: 0, y: 68 });
    expect(taps).toEqual([{ x: 210, y: 456 }]);
  });

  it('fails closed when the trusted event never arrives, and removes its layer', async () => {
    const { page, calls } = canaryPage(null);
    const wda = {
      tap: async () => {},
      keys: async () => {},
      dismissKeyboard: async () => {},
      swipe: async () => {},
    };
    await expect(runTapCanary(page, wda, SCREEN)).rejects.toThrow(
      /^iPhone real taps are not landing: no touch reached the page within 2 s\. The run stops here; it never falls back to el\.click\(\)\./,
    );
    expect(calls).toContain('remove');
  });

  it('fails closed on an untrusted event', async () => {
    const { page } = canaryPage({
      isTrusted: false,
      pointerType: 'touch',
      clientX: 210,
      clientY: 388,
    });
    const wda = {
      tap: async () => {},
      keys: async () => {},
      dismissKeyboard: async () => {},
      swipe: async () => {},
    };
    await expect(runTapCanary(page, wda, SCREEN)).rejects.toThrow(
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

import { describe, expect, it } from 'vitest';
import {
  LANDING_SCRIPT,
  PREPARE_SCRIPT,
  CANARY_SCRIPT,
  CANARY_REMOVE_SCRIPT,
  FIELD_SCRIPT,
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
  prepare = (): unknown => ({ rect: RECT, vv: VV, hit: null }),
  landing = (): unknown => ({
    isTrusted: true,
    pointerType: 'touch',
    clientX: 150,
    clientY: 320,
  }),
  field = (): unknown => ({ value: '', focused: false }),
}: { prepare?: Handler; landing?: Handler; field?: Handler } = {}) {
  const log: string[] = [];
  const taps: Point[] = [];
  const keys: string[] = [];
  const handlers = new Map<string, Handler>([
    [PREPARE_SCRIPT, prepare],
    [LANDING_SCRIPT, landing],
    [FIELD_SCRIPT, field],
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
  };
  return { page, wda, log, taps, keys, handlers };
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
      prepare: () => ({ rect: RECT, vv: VV, hit: 'div#overlay.cover' }),
    });
    const tapping = interaction(f).click(element());
    await expect(tapping).rejects.toBeInstanceOf(TapNotLandedError);
    await expect(tapping).rejects.toThrow(
      /#cg-go is covered: a finger at its centre would touch div#overlay\.cover/,
    );
    expect(f.taps).toEqual([]);
  });

  it('fails when no touch reaches the element', async () => {
    const f = fakes({ landing: () => null });
    await expect(interaction(f).click(element())).rejects.toThrow(
      /a real tap on #cg-go did not land: no touch reached it within 2 s/,
    );
  });

  it('fails when the touch that arrived was not trusted', async () => {
    const f = fakes({
      landing: () => ({
        isTrusted: false,
        pointerType: 'touch',
        clientX: 150,
        clientY: 320,
      }),
    });
    await expect(interaction(f).click(element())).rejects.toThrow(
      /did not land: the event was untrusted/,
    );
  });

  it('fails when the event was not a touch', async () => {
    const f = fakes({
      landing: () => ({
        isTrusted: true,
        pointerType: 'mouse',
        clientX: 150,
        clientY: 320,
      }),
    });
    await expect(interaction(f).click(element())).rejects.toThrow(
      /did not land: the event was a mouse, not a touch/,
    );
  });

  it("fails naming the drift when the touch landed outside the element's box", async () => {
    const f = fakes({
      landing: () => ({
        isTrusted: true,
        pointerType: 'touch',
        clientX: 150,
        clientY: 400,
      }),
    });
    await expect(interaction(f).click(element())).rejects.toThrow(
      /aimed at \(150, 320\) and landed at \(150, 400\)/,
    );
  });

  it('passes each tap its own token, so a late event from an earlier tap cannot count', async () => {
    const f = fakes();
    const tokens: unknown[] = [];
    f.handlers.set(PREPARE_SCRIPT, (args) => {
      tokens.push(args[1]);
      return { rect: RECT, vv: VV, hit: null };
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
      'field',
    ]);
    expect(f.keys).toEqual(['12']);
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
    };
    expect(await runTapCanary(page, wda, SCREEN)).toEqual({ x: 0, y: 68 });
    expect(taps).toEqual([{ x: 210, y: 456 }]);
  });

  it('fails closed when the trusted event never arrives, and removes its layer', async () => {
    const { page, calls } = canaryPage(null);
    const wda = { tap: async () => {}, keys: async () => {} };
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
    const wda = { tap: async () => {}, keys: async () => {} };
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

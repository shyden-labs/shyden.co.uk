import { describe, expect, it } from 'vitest';
import {
  toScreenPoint,
  WdaError,
  WdaSession,
  type Http,
} from '../device/ios/wda';

/**
 * The iPhone run's WebDriverAgent client (#838): where on the screen a page
 * element is, and the real touch and keyboard input sent there. WDA's HTTP is
 * a stand-in that records each call.
 */

const SCREEN = { x: 0, y: 0, width: 420, height: 912 };
const ORIGIN = { x: 0, y: 68 };

describe('toScreenPoint', () => {
  it('maps the centre at scale 1', () => {
    expect(
      toScreenPoint(
        { x: 10, y: 20, width: 100, height: 40 },
        { offsetLeft: 0, offsetTop: 0, scale: 1 },
        ORIGIN,
        SCREEN,
      ),
    ).toEqual({ x: 60, y: 108 });
  });

  it('applies visual-viewport offset and scale', () => {
    expect(
      toScreenPoint(
        { x: 10, y: 20, width: 100, height: 40 },
        { offsetLeft: 10, offsetTop: 20, scale: 2 },
        ORIGIN,
        SCREEN,
      ),
    ).toEqual({ x: 100, y: 108 });
  });

  it('refuses a point outside the screen', () => {
    expect(() =>
      toScreenPoint(
        { x: 10, y: 900, width: 100, height: 40 },
        { offsetLeft: 0, offsetTop: 0, scale: 1 },
        ORIGIN,
        SCREEN,
      ),
    ).toThrow(/\(60, 988\), which is outside the screen 420×912/);
  });
});

function recorder(answers: Record<string, unknown> = {}) {
  const calls: [string, string, unknown][] = [];
  const http: Http = async (method, path, body) => {
    calls.push([method, path, body]);
    const key = `${method} ${path}`;
    if (key in answers) return answers[key];
    if (method === 'POST' && path === '/session')
      return { sessionId: 'S1', capabilities: {} };
    return null;
  };
  return { calls, http };
}

describe('WdaSession', () => {
  it('attaches to the open Safari without relaunching it', async () => {
    const { calls, http } = recorder();
    await WdaSession.open(http);
    expect(calls[0]).toEqual([
      'POST',
      '/session',
      {
        capabilities: {
          alwaysMatch: {
            bundleId: 'com.apple.mobilesafari',
            forceAppLaunch: false,
            shouldWaitForQuiescence: false,
          },
        },
      },
    ]);
  });

  it('tap sends one touch pointer: move, down, 50 ms pause, up, and nothing else (WDA answers 404 to a release)', async () => {
    const { calls, http } = recorder();
    const wda = await WdaSession.open(http);
    await wda.tap({ x: 60.4, y: 108.6 });
    expect(calls.slice(1)).toEqual([
      [
        'POST',
        '/session/S1/actions',
        {
          actions: [
            {
              type: 'pointer',
              id: 'finger1',
              parameters: { pointerType: 'touch' },
              actions: [
                { type: 'pointerMove', duration: 0, x: 60, y: 109 },
                { type: 'pointerDown', button: 0 },
                { type: 'pause', duration: 50 },
                { type: 'pointerUp', button: 0 },
              ],
            },
          ],
        },
      ],
    ]);
  });

  it('swipe drags one finger from start to end, holds, then lifts (no fling)', async () => {
    const { calls, http } = recorder();
    const wda = await WdaSession.open(http);
    await wda.swipe({ x: 210, y: 600.4 }, { x: 210, y: 300.6 });
    expect(calls[1]).toEqual([
      'POST',
      '/session/S1/actions',
      {
        actions: [
          {
            type: 'pointer',
            id: 'finger1',
            parameters: { pointerType: 'touch' },
            actions: [
              { type: 'pointerMove', duration: 0, x: 210, y: 600 },
              { type: 'pointerDown', button: 0 },
              { type: 'pointerMove', duration: 400, x: 210, y: 301 },
              { type: 'pause', duration: 150 },
              { type: 'pointerUp', button: 0 },
            ],
          },
        ],
      },
    ]);
  });

  it('keys posts the text to wda/keys as one value array', async () => {
    const { calls, http } = recorder();
    const wda = await WdaSession.open(http);
    await wda.keys('Ana');
    expect(calls[1]).toEqual([
      'POST',
      '/session/S1/wda/keys',
      { value: ['Ana'] },
    ]);
  });

  it("dismissKeyboard taps the keyboard bar's Done key", async () => {
    const { calls, http } = recorder();
    const wda = await WdaSession.open(http);
    await wda.dismissKeyboard();
    expect(calls[1]).toEqual([
      'POST',
      '/session/S1/wda/keyboard/dismiss',
      { keyNames: ['Done'] },
    ]);
  });

  it('windowRect reads the screen in points', async () => {
    const { http } = recorder({ 'GET /session/S1/window/rect': SCREEN });
    const wda = await WdaSession.open(http);
    expect(await wda.windowRect()).toEqual(SCREEN);
  });

  it('close deletes the session', async () => {
    const { calls, http } = recorder();
    const wda = await WdaSession.open(http);
    await wda.close();
    expect(calls[1]).toEqual(['DELETE', '/session/S1', undefined]);
  });

  it('refuses a session answer with no id, naming what came back', async () => {
    const { http } = recorder({ 'POST /session': { value: {} } });
    await expect(WdaSession.open(http)).rejects.toThrow(
      /no session id; .*"value":\{\}/,
    );
  });
});

describe('WdaError', () => {
  it("names the method, path and WDA's message", () => {
    expect(
      new WdaError('POST', '/session/S1/actions', 404, 'invalid session id')
        .message,
    ).toBe(
      'WebDriverAgent POST /session/S1/actions answered 404: invalid session id',
    );
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RealTapInteraction,
  describeInteractionMode,
  detectInteractionMode,
  realTap,
} from '../device/ios/interaction';
import { WebDriver } from '../device/ios/webdriver';

/**
 * Real taps on the iPhone (#838).
 *
 * Measured 2026-10-16 on the iPhone Air, iOS 27.0.1 (24A446): Safari's own
 * WebDriver delivers the press of `element/click`, or of a W3C action
 * sequence holding both press and release, and drops the release. Press and
 * release sent as two separate `POST /actions` calls, then `DELETE /actions`,
 * give the whole trusted tap: pointerdown, touchstart, pointerup, touchend,
 * mousedown, mouseup, click (20 of 20). These tests pin that wire shape, and
 * that a tap which does not land fails the run instead of falling back to a
 * click dispatched inside the page.
 *
 * Run without a phone: `fetch` is a stand-in that records every request and
 * answers as safaridriver does, so no socket is opened.
 */
const SERVER = 'http://127.0.0.1:4444';
const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';

interface Sent {
  method: string;
  path: string;
  body: unknown;
}

function wire(answer: (sent: Sent) => unknown = () => null) {
  const sent: Sent[] = [];
  vi.stubGlobal(
    'fetch',
    async (url: string, init: { method: string; body?: string }) => {
      const record = {
        method: init.method,
        path: url.slice(SERVER.length),
        body: init.body === undefined ? undefined : JSON.parse(init.body),
      };
      sent.push(record);
      const value =
        record.path === '/session'
          ? { sessionId: 's1', capabilities: {} }
          : answer(record);
      return new Response(JSON.stringify({ value }), { status: 200 });
    },
  );
  return sent;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const session = () =>
  WebDriver.createSession(SERVER, { browserName: 'safari' });

describe('a real tap is press and release as separate W3C action calls (#838)', () => {
  it('presses at the element in one call, releases in a second, then releases all', async () => {
    const sent = wire();
    const driver = await session();
    await realTap(driver, 'e1');
    expect(sent.slice(1).map(({ method, path }) => `${method} ${path}`)).toEqual([
      'POST /session/s1/actions',
      'POST /session/s1/actions',
      'DELETE /session/s1/actions',
    ]);
  });

  it('the first call moves to the element and presses, and nothing else', async () => {
    const sent = wire();
    const driver = await session();
    await realTap(driver, 'e1');
    expect(sent[1].body).toEqual({
      actions: [
        {
          type: 'pointer',
          id: 'finger',
          parameters: { pointerType: 'mouse' },
          actions: [
            {
              type: 'pointerMove',
              duration: 0,
              origin: { [ELEMENT_KEY]: 'e1' },
              x: 0,
              y: 0,
            },
            { type: 'pointerDown', button: 0 },
          ],
        },
      ],
    });
  });

  it('the second call only releases', async () => {
    const sent = wire();
    const driver = await session();
    await realTap(driver, 'e1');
    expect(sent[2].body).toEqual({
      actions: [
        {
          type: 'pointer',
          id: 'finger',
          parameters: { pointerType: 'mouse' },
          actions: [{ type: 'pointerUp', button: 0 }],
        },
      ],
    });
  });
});

describe('the interaction a session hands its tests', () => {
  it('clicks with the real tap', async () => {
    const sent = wire();
    const driver = await session();
    const interaction = new RealTapInteraction(driver);
    await interaction.click({ elementId: 'e7' } as never);
    expect(sent.slice(1).map(({ method, path }) => `${method} ${path}`)).toEqual([
      'POST /session/s1/actions',
      'POST /session/s1/actions',
      'DELETE /session/s1/actions',
    ]);
  });

  it('says its text entry is a stand-in, by name', () => {
    expect(describeInteractionMode('real-tap')).toContain(
      'text entry is a marked stand-in',
    );
  });
});

describe('the canary refuses a tap that does not land (#838 AC2)', () => {
  // The canary page's output reads CLICKED only when the click listener ran.
  const canaryAnswers = (out: string) => (sent: Sent) =>
    sent.path.endsWith('/element')
      ? { [ELEMENT_KEY]: (sent.body as { value: string }).value.slice(1) }
      : sent.path.endsWith('/text')
        ? out
        : null;

  it('reports real-tap when the tap lands', async () => {
    wire(canaryAnswers('CLICKED'));
    const driver = await session();
    await expect(
      detectInteractionMode(driver, { timeoutMs: 40 }),
    ).resolves.toBe('real-tap');
  });

  it('fails the run, naming the cause, when the tap does not land', async () => {
    wire(canaryAnswers('UNCLICKED'));
    const driver = await session();
    await expect(
      detectInteractionMode(driver, { timeoutMs: 40 }),
    ).rejects.toThrow(
      /a real tap did not land on the iPhone \(#838\)/,
    );
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isPlistDictionary } from '../device/ios/inspector/bplist';
import { ProtocolShapeError } from '../device/ios/inspector/fields';
import { InspectorError, PageProtocol } from '../device/ios/inspector/protocol';
import { recordedFrames } from './ios-inspector-fixtures';
import {
  deliverFrames,
  type FakeTransport,
  fromTarget,
  pageData,
  wirOver,
  writtenPlists,
} from './ios-inspector-transport';

/** The JSON protocol to the page's target, inside the Web Inspector RPC (#811 Task 9). */
const IN = recordedFrames('wir', 'in');
/** The recorded frames, from Target.targetCreated on: each command's outer and inner answers, in order. */
const FROM_TARGET = IN.slice(
  IN.findIndex((frame) => frame.includes('Target.targetCreated')),
);
const recorded = (needle: string): Buffer => {
  const frame = FROM_TARGET.find((candidate) => candidate.includes(needle));
  if (!frame) throw new Error(`no recorded frame holds ${needle}`);
  return frame;
};

function setUp(): { transport: FakeTransport; page: PageProtocol } {
  const { transport, wir } = wirOver();
  wir.attach('PID:86196', 1);
  return { transport, page: new PageProtocol(wir) };
}

const deliver = deliverFrames;

/** The protocol text of the last frame written. */
function lastText(transport: FakeTransport): string {
  const argument = writtenPlists(transport, 'length').at(-1)?.__argument;
  if (!argument || !isPlistDictionary(argument))
    throw new Error('not a WIR message');
  return (argument.WIRSocketDataKey as Buffer).toString('utf8');
}

async function attached(): Promise<{
  transport: FakeTransport;
  page: PageProtocol;
}> {
  const set = setUp();
  const target = set.page.targetCreated(10_000);
  deliver(set.transport, recorded('Target.targetCreated'));
  await target;
  return set;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the page's target", () => {
  it('is the one the recorded Target.targetCreated names', async () => {
    const { page } = await attached();
    expect(page.targetId).toBe('page-39');
  });

  it('past its ceiling, the wait names what it waited for', async () => {
    const { page } = setUp();
    const target = page.targetCreated(10_000);
    const verdict = expect(target).rejects.toThrow(
      'no Target.targetCreated within 10 s',
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await verdict;
  });
});

describe('a command', () => {
  it('goes to the target wrapped in Target.sendMessageToTarget, ids counting from 1', async () => {
    const { transport, page } = await attached();
    const result = page.command('Runtime.evaluate', {
      expression: '1+1',
      returnByValue: true,
    });
    expect(lastText(transport)).toBe(
      '{"id":2,"method":"Target.sendMessageToTarget","params":{"targetId":"page-39","message":"{\\"id\\":1,\\"method\\":\\"Runtime.evaluate\\",\\"params\\":{\\"expression\\":\\"1+1\\",\\"returnByValue\\":true}}"}}',
    );
    deliver(
      transport,
      recorded('{"result":{},"id":2}'),
      recorded('\\"id\\":1}'),
    );
    expect(await result).toEqual({
      result: { type: 'number', value: 2, description: '2' },
      wasThrown: false,
    });
  });

  it("an error from the page's domain is an InspectorError with the method, its parameters and WebKit's words", async () => {
    const { transport, page } = await attached();
    const result = page.command('No.such', {});
    deliver(
      transport,
      pageData('{"result":{},"id":2}'),
      fromTarget({
        error: { code: -32601, message: "'No' domain was not found" },
        id: 1,
      }),
    );
    const error = await result.then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(InspectorError);
    expect((error as InspectorError).method).toBe('No.such');
    expect((error as InspectorError).params).toEqual({});
    expect((error as InspectorError).message).toBe(
      "No.such failed on the page: 'No' domain was not found",
    );
  });

  it('an error on the wrapper (the target is gone) names the target', async () => {
    const { transport, page } = await attached();
    const result = page.command('Page.reload');
    deliver(
      transport,
      pageData(
        '{"error":{"message":"Missing target for given targetId"},"id":2}',
      ),
    );
    await expect(result).rejects.toThrow(
      'Page.reload could not reach target page-39: Missing target for given targetId',
    );
  });

  it('with no answer, fails at its ceiling naming the method', async () => {
    const { page } = await attached();
    const result = page.command('Page.enable', {}, 15_000);
    const verdict = expect(result).rejects.toThrow(
      'no answer to Page.enable within 15 s',
    );
    await vi.advanceTimersByTimeAsync(15_000);
    await verdict;
  });
});

describe('events', () => {
  it('the recorded Console.messageAdded reaches a listener, not a waiting command', async () => {
    const { transport, page } = await attached();
    const seen: unknown[] = [];
    page.on('Console.messageAdded', (params) => seen.push(params));
    const result = page.command('Console.enable');
    deliver(
      transport,
      pageData('{"result":{},"id":2}'),
      recorded('Console.messageAdded'),
      fromTarget({ result: {}, id: 1 }),
    );
    expect(await result).toEqual({});
    expect(seen).toHaveLength(1);
    expect(JSON.stringify(seen[0])).toContain('wi-fixture-sentinel');
  });

  it('after unsubscribing, that listener hears nothing while one still subscribed hears the event', async () => {
    const { transport, page } = await attached();
    const heard: string[] = [];
    const stop = page.on('Console.messageAdded', () => heard.push('stopped'));
    page.on('Console.messageAdded', () => heard.push('kept'));
    stop();
    const result = page.command('Console.enable');
    deliver(
      transport,
      recorded('Console.messageAdded'),
      fromTarget({ result: {}, id: 1 }),
    );
    await result;
    expect(heard).toEqual(['kept']);
  });

  it('a listener that throws fails the wait it happened in, naming it, and the next command still works', async () => {
    const { transport, page } = await attached();
    page.on('Console.messageAdded', () => {
      throw new Error('listener broke');
    });
    const first = page.command('Console.enable');
    deliver(transport, recorded('Console.messageAdded'));
    await expect(first).rejects.toThrow(
      'a listener for Console.messageAdded threw: listener broke',
    );
    const second = page.command('Runtime.evaluate', { expression: '1' });
    deliver(transport, fromTarget({ result: { value: 1 }, id: 3 }));
    expect(await second).toEqual({ value: 1 });
  });
});

describe('a cross-origin navigation swaps the target', () => {
  it('later commands go to the new target', async () => {
    const { transport, page } = await attached();
    const evaluated = page.command('Runtime.evaluate', { expression: '1' });
    deliver(
      transport,
      pageData(
        '{"method":"Target.didCommitProvisionalTarget","params":{"oldTargetId":"page-39","newTargetId":"page-40"}}',
      ),
      fromTarget({ result: {}, id: 1 }),
    );
    await evaluated;
    void page.command('Page.enable').catch(() => undefined);
    expect(JSON.parse(lastText(transport)).params.targetId).toBe('page-40');
  });
});

describe('malformed text from the phone', () => {
  it('fails the waiting command with the first 80 characters, and every later one', async () => {
    const { transport, page } = await attached();
    const result = page.command('Page.enable');
    const junk = `not json ${'x'.repeat(100)}`;
    deliver(transport, pageData(junk));
    await expect(result).rejects.toThrow(
      new ProtocolShapeError(
        `the page sent text that is not JSON: ${JSON.stringify(junk.slice(0, 80))}`,
      ),
    );
    await expect(page.command('Page.enable')).rejects.toBeInstanceOf(
      ProtocolShapeError,
    );
  });
});

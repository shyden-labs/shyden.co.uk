import { describe, expect, it } from 'vitest';
import { PageDriver, PageScriptError } from '../device/ios/page-driver';
import { fakePage, recorded, WINDOW } from './page-driver-fake';

/**
 * The iPhone run's page driver (#859): each method is pinned on the commands
 * it sends and on the answers the phone gave in the 2026-10-31 probes.
 */

describe('executeScript: a function body run on the page, its value returned', () => {
  it('runs the body on a fresh window handle and returns the value', async () => {
    const page = fakePage({
      'Runtime.evaluate': [WINDOW],
      'Runtime.callFunctionOn': [recorded('callFunctionOn handle')],
    });
    const value = await new PageDriver(page).executeScript<string>(
      'return arguments[0] + arguments[1];',
      ['a', 2],
    );
    expect(value).toBe('A!');
    expect(page.sent).toEqual([
      { method: 'Runtime.evaluate', params: { expression: 'window' } },
      {
        method: 'Runtime.callFunctionOn',
        params: {
          objectId: WINDOW.result.objectId,
          functionDeclaration:
            'function () {return arguments[0] + arguments[1];\n}',
          arguments: [{ value: 'a' }, { value: 2 }],
          returnByValue: true,
        },
      },
    ]);
  });

  it('turns an exception the page threw into a PageScriptError naming the script and the error', async () => {
    const page = fakePage({
      'Runtime.evaluate': [WINDOW],
      'Runtime.callFunctionOn': [recorded('thrown error')],
    });
    const run = new PageDriver(page).executeScript('\n  return boom();\n');
    await expect(run).rejects.toThrow(
      new PageScriptError(
        'page script failed (return boom();): TypeError: probe boom',
        'return boom();',
        'TypeError',
      ),
    );
    await expect(run).rejects.toBeInstanceOf(PageScriptError);
  });
});

describe('executeAsyncScript: a body that calls its last argument, awaited', () => {
  it('runs the body inside a promise handed resolve last, then awaits that promise by value', async () => {
    const page = fakePage({
      'Runtime.evaluate': [WINDOW],
      'Runtime.callFunctionOn': [recorded('promise handle')],
      'Runtime.awaitPromise': [recorded('Runtime.awaitPromise resolve')],
    });
    const value = await new PageDriver(page).executeAsyncScript(
      'setTimeout(function () { arguments[1]({ waited: arguments[0] }); }, 50);',
      [50],
    );
    expect(value).toEqual({ waited: 50 });
    const [, call, awaited] = page.sent;
    const params = call?.params as Record<string, unknown>;
    expect(params.returnByValue).toBeUndefined();
    expect(params.arguments).toEqual([{ value: 50 }]);
    expect(params.functionDeclaration).toContain('args.push(resolve);');
    expect(params.functionDeclaration).toContain(
      'setTimeout(function () { arguments[1]({ waited: arguments[0] }); }, 50);',
    );
    expect(awaited).toEqual({
      method: 'Runtime.awaitPromise',
      params: {
        promiseObjectId: '{"injectedScriptId":1,"id":1}',
        returnByValue: true,
      },
    });
  });

  it('turns a rejected promise into a PageScriptError naming the error', async () => {
    const page = fakePage({
      'Runtime.evaluate': [WINDOW],
      'Runtime.callFunctionOn': [recorded('rejecting handle')],
      'Runtime.awaitPromise': [recorded('Runtime.awaitPromise reject')],
    });
    await expect(
      new PageDriver(page).executeAsyncScript('throw new RangeError("x");'),
    ).rejects.toThrow(
      'page script failed (throw new RangeError("x");): RangeError: probe reject',
    );
  });

  it('refuses at once, awaiting nothing, when the page threw before a promise existed', async () => {
    const page = fakePage({
      'Runtime.evaluate': [WINDOW],
      'Runtime.callFunctionOn': [recorded('thrown error')],
    });
    await expect(
      new PageDriver(page).executeAsyncScript('boom();'),
    ).rejects.toBeInstanceOf(PageScriptError);
    expect(page.sent.map((sent) => sent.method)).not.toContain(
      'Runtime.awaitPromise',
    );
  });
});

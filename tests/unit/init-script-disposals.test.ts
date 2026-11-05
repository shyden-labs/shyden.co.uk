import { describe, it, expect } from 'vitest';
import {
  disposeAll,
  type InitScriptDisposable,
} from '../device/init-script-disposals';

/**
 * The phone has one browser context for the whole run, so an init script one test adds keeps
 * running on every later test's page unless that test removes it (tests/e2e/fixtures.ts). The
 * fixture swallowed a refused removal, which is that leak made silent (#390 F125).
 */
const removes = (log: string[], name: string): InitScriptDisposable => ({
  dispose: async () => {
    log.push(name);
  },
});
const refuses = (
  log: string[],
  name: string,
  error: Error,
): InitScriptDisposable => ({
  dispose: async () => {
    log.push(name);
    throw error;
  },
});

/** What `disposeAll` rejected with, or a failure naming that it did not reject. */
const rejection = async (
  disposables: readonly InitScriptDisposable[],
): Promise<AggregateError> => {
  try {
    await disposeAll(disposables);
  } catch (error) {
    expect(error).toBeInstanceOf(AggregateError);
    return error as AggregateError;
  }
  throw new Error('disposeAll resolved over a refused removal');
};

describe('removing the init scripts a test added on the phone', () => {
  it('removes every one and resolves when all are removed', async () => {
    const log: string[] = [];
    await expect(
      disposeAll([removes(log, 'a'), removes(log, 'b')]),
    ).resolves.toBeUndefined();
    expect(log).toEqual(['a', 'b']);
  });

  it('still tries every later one after one refuses', async () => {
    const log: string[] = [];
    await rejection([
      refuses(log, 'a', new Error('gone')),
      removes(log, 'b'),
      refuses(log, 'c', new Error('also gone')),
    ]);
    expect(log).toEqual(['a', 'b', 'c']);
  });

  it('rejects with every refusal, in order, and says what is left running', async () => {
    const first = new Error('Target page, context or browser has been closed');
    const second = new Error('Protocol error');
    const error = await rejection([
      refuses([], 'a', first),
      removes([], 'b'),
      refuses([], 'c', second),
    ]);
    expect(error.errors).toEqual([first, second]);
    expect(error.errors[0]).toBe(first);
    expect(error.message).toBe(
      "2 init script(s) this test added could not be removed from the phone's shared " +
        "context, so they would run on every later test's page",
    );
  });

  it('rejects when only one of them refuses', async () => {
    const only = new Error('Protocol error');
    const error = await rejection([removes([], 'a'), refuses([], 'b', only)]);
    expect(error.errors).toEqual([only]);
  });

  it('has nothing to do for a test that added none', async () => {
    await expect(disposeAll([])).resolves.toBeUndefined();
  });
});

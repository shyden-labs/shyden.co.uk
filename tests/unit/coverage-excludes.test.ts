import { describe, expect, it } from 'vitest';
import type { CoverageProviderModule } from 'vitest/node';
import { delegatingTo, withOnlyOurExcludes } from '../coverage-excludes.mjs';
import { searched } from '../source-files';

/**
 * Vitest adds its own excludes to every coverage run (setup files, the test
 * files, the config) and says they "cannot be overridden"; tests are code
 * (Shyden 2026-10-22), so the V8 provider is wrapped to measure them (#912).
 * Measured in a throwaway project: the wrapped provider reported a test file
 * and a setup file the plain one left out. The wrapper reaches two internal
 * fields, so a Vitest upgrade that renames them must fail loudly here.
 */
const ours = ['**/*.d.ts'] as const;

/** A provider shaped as @vitest/coverage-v8 5.0.x's is, after `initialize`. */
const provider = () => {
  const p = {
    options: { exclude: ['**/*.d.ts', 'tests/setup.ts', 'tests/**/*.test.ts'] },
    globMatchers: { cached: true } as unknown,
    globCache: new Map([['/repo/tests/a.test.ts', false]]),
    initialized: 0,
    initialize(this: { initialized: number }, _ctx: unknown) {
      this.initialized += 1;
    },
  };
  return p;
};

describe('the V8 provider with only our excludes (#912)', () => {
  it('replaces Vitest’s excludes with ours once it has initialised', () => {
    const p = withOnlyOurExcludes(provider(), ours);
    p.initialize({});
    expect([p.initialized, p.options.exclude]).toEqual([1, ['**/*.d.ts']]);
  });

  it('drops the glob matchers it built from Vitest’s excludes', () => {
    const p = withOnlyOurExcludes(provider(), ours);
    p.initialize({});
    expect(p.globMatchers).toBeUndefined();
  });

  it('forgets every include verdict it cached under Vitest’s excludes', () => {
    const p = withOnlyOurExcludes(provider(), ours);
    const cachedBefore = p.globCache.size;
    p.initialize({});
    expect(
      searched([...p.globCache.keys()], {
        of: cachedBefore,
        what: 'include verdicts cached before the swap',
      }),
    ).toEqual([]);
  });

  it('refuses a provider with no exclude list, naming the field', () => {
    const p = { ...provider(), options: {} };
    expect(() => withOnlyOurExcludes(p, ours).initialize({})).toThrow(
      'coverage-excludes: the V8 provider has no options.exclude array after initialize; a Vitest upgrade changed it, so re-check tests/coverage-excludes.mjs',
    );
  });

  it('refuses a provider with no glob matcher cache, naming the field', () => {
    const { globMatchers: _dropped, ...rest } = provider();
    expect(() => withOnlyOurExcludes(rest, ours).initialize({})).toThrow(
      'coverage-excludes: the V8 provider has no globMatchers field after initialize; a Vitest upgrade changed it, so re-check tests/coverage-excludes.mjs',
    );
  });
});

/**
 * A module shaped as @vitest/coverage-v8 5.0.x's default export is: its
 * worker-side methods keep the inspector session on `this` (#912).
 */
const v8Module = () => {
  const mod = {
    session: null as null | { calls: string[] },
    startCoverage(this: { session: null | { calls: string[] } }) {
      this.session ??= { calls: [] };
      this.session.calls.push('start');
    },
    takeCoverage(this: { session: null | { calls: string[] } }) {
      if (!this.session)
        throw new Error('V8 provider missing inspector session.');
      this.session.calls.push('take');
      return 'taken';
    },
    stopCoverage(this: { session: null | { calls: string[] } }) {
      if (!this.session)
        throw new Error('V8 provider missing inspector session.');
      this.session.calls.push('stop');
    },
    getProvider: async () => provider(),
  };
  return mod;
};

/** The stand-in, as the module type Vitest declares. */
const asModule = (mod: object) => mod as unknown as CoverageProviderModule;

/** What Vitest passes each worker-side call. */
const START = {
  isolate: true,
  autoAttachSubprocess: false,
  reportsDirectory: 'coverage/unit',
};
const TAKE = { coverageFilesDirectory: 'coverage/unit/.tmp' };
const STOP = { isolate: true };

/** A worker-side method the delegating module must have. */
const method = <K extends 'startCoverage' | 'takeCoverage' | 'stopCoverage'>(
  mod: CoverageProviderModule,
  name: K,
) => {
  const found = mod[name];
  if (!found) throw new Error(`the delegating module has no ${name}`);
  return found;
};

describe('the custom provider module delegates to coverage-v8 (#912)', () => {
  // Vitest loads a custom provider module through its module runner, so a
  // worker can evaluate it again between test files; the session must live
  // on coverage-v8's own object, which Node loads once.
  it('keeps one session across two evaluations of the module', async () => {
    const v8 = v8Module();
    const first = delegatingTo(asModule(v8), ours);
    const second = delegatingTo(asModule(v8), ours);
    await method(first, 'startCoverage')(START);
    expect(await method(second, 'takeCoverage')(TAKE)).toBe('taken');
    await method(second, 'stopCoverage')(STOP);
    expect(v8.session?.calls).toEqual(['start', 'take', 'stop']);
  });

  it('hands Vitest a provider measuring with our excludes alone', async () => {
    const p = (await delegatingTo(
      asModule(v8Module()),
      ours,
    ).getProvider()) as unknown as ReturnType<typeof provider>;
    p.initialize({});
    expect(p.options.exclude).toEqual(['**/*.d.ts']);
  });

  it('refuses a coverage-v8 without its worker-side methods, naming them', () => {
    const { takeCoverage: _dropped, ...rest } = v8Module();
    expect(() => delegatingTo(asModule(rest), ours)).toThrow(
      'coverage-excludes: @vitest/coverage-v8 has no startCoverage, takeCoverage or stopCoverage; a Vitest upgrade changed it, so re-check tests/coverage-excludes.mjs',
    );
  });
});

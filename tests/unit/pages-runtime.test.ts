import { describe, it, expect } from 'vitest';
import {
  changedApartFromRuntime,
  compatibilityDateOf,
  productionConfigOf,
  runtimeMismatch,
  runtimePatch,
  syncRuntime,
} from '../../src/lib/pages-runtime';

/**
 * Each deploy sets its Pages project's Workers runtime to the one the
 * functions suite tests, through Cloudflare's API, and reads it back (#907;
 * Shyden's ruling 2026-11-07). The pure half: where git holds the date, what
 * the API answers, what the deploy sends, and when it must stop.
 */

/** A `GET /pages/projects/{name}` answer, cut to the fields read here. */
const project = (production: Record<string, unknown>) => ({
  success: true,
  errors: [],
  result: { name: 'shyden-site-dev', deployment_configs: { production } },
});

describe('compatibilityDateOf reads the one date git holds', () => {
  it('reads the date from the functions suite config', () => {
    expect(
      compatibilityDateOf('name = "x"\ncompatibility_date = "2026-10-20"\n'),
    ).toBe('2026-10-20');
  });

  it('ignores a date written in a comment', () => {
    expect(
      compatibilityDateOf(
        '# compatibility_date = "2020-01-01"\ncompatibility_date = "2026-10-20"\n',
      ),
    ).toBe('2026-10-20');
  });

  it('refuses a file with no date', () => {
    expect(() => compatibilityDateOf('name = "x"\n')).toThrow(
      'holds no compatibility_date',
    );
  });

  it('refuses a file with two dates', () => {
    expect(() =>
      compatibilityDateOf(
        'compatibility_date = "2026-10-20"\ncompatibility_date = "2026-10-21"\n',
      ),
    ).toThrow('holds 2 compatibility_date lines');
  });

  it('refuses a date that is not a real day', () => {
    expect(() =>
      compatibilityDateOf('compatibility_date = "2026-02-30"\n'),
    ).toThrow('2026-02-30 is not a real date');
  });
});

describe('productionConfigOf reads what the project runs in production', () => {
  it('returns the production deployment config', () => {
    const production = {
      compatibility_date: '2026-07-24',
      compatibility_flags: [],
      d1_databases: { REPORTS: { id: 'abc' } },
    };
    expect(productionConfigOf(project(production))).toEqual(production);
  });

  it('names the API errors when the call failed', () => {
    expect(() =>
      productionConfigOf({
        success: false,
        errors: [{ code: 10000, message: 'Authentication error' }],
        result: null,
      }),
    ).toThrow('Cloudflare refused: 10000 Authentication error');
  });

  it('refuses an answer with no production config', () => {
    expect(() =>
      productionConfigOf({
        success: true,
        errors: [],
        result: { deployment_configs: {} },
      }),
    ).toThrow('no production deployment config');
  });
});

describe('runtimeMismatch says when production runs another runtime', () => {
  it('is null when the date matches and no flag is set', () => {
    expect(
      runtimeMismatch('2026-10-20', {
        compatibility_date: '2026-10-20',
        compatibility_flags: [],
      }),
    ).toBeNull();
  });

  it('treats absent flags as none', () => {
    expect(
      runtimeMismatch('2026-10-20', { compatibility_date: '2026-10-20' }),
    ).toBeNull();
  });

  it('names both dates when they differ', () => {
    expect(
      runtimeMismatch('2026-10-20', {
        compatibility_date: '2026-07-24',
        compatibility_flags: [],
      }),
    ).toBe(
      'production runs compatibility date 2026-07-24 with no flags; the functions suite tests 2026-10-20 with no flags',
    );
  });

  it('names the flags when production carries one the suite does not', () => {
    expect(
      runtimeMismatch('2026-10-20', {
        compatibility_date: '2026-10-20',
        compatibility_flags: ['nodejs_compat'],
      }),
    ).toBe(
      'production runs compatibility date 2026-10-20 with flags nodejs_compat; the functions suite tests 2026-10-20 with no flags',
    );
  });

  it('names a missing date', () => {
    expect(runtimeMismatch('2026-10-20', {})).toBe(
      'production runs compatibility date (none) with no flags; the functions suite tests 2026-10-20 with no flags',
    );
  });
});

describe('runtimePatch sends only the runtime', () => {
  it('sets the production date and clears the flags, and nothing else', () => {
    expect(runtimePatch('2026-10-20')).toEqual({
      deployment_configs: {
        production: {
          compatibility_date: '2026-10-20',
          compatibility_flags: [],
        },
      },
    });
  });
});

describe('changedApartFromRuntime finds anything the update touched besides the runtime', () => {
  const before = {
    compatibility_date: '2026-07-24',
    compatibility_flags: [],
    d1_databases: { REPORTS: { id: 'abc' } },
    env_vars: { DEV_PASSWORD: { type: 'secret_text' } },
  };

  it('is empty when only the date and flags changed', () => {
    expect(
      changedApartFromRuntime(before, {
        ...before,
        compatibility_date: '2026-10-20',
      }),
    ).toEqual([]);
  });

  it('names a binding the update dropped', () => {
    const { d1_databases: _dropped, ...after } = before;
    expect(changedApartFromRuntime(before, after)).toEqual(['d1_databases']);
  });

  it('names a setting the update added or changed, by key only', () => {
    expect(
      changedApartFromRuntime(before, {
        ...before,
        env_vars: { DEV_PASSWORD: { type: 'plain_text', value: 'leaked' } },
        placement: { mode: 'smart' },
      }),
    ).toEqual(['env_vars', 'placement']);
  });
});

describe('syncRuntime sets the runtime once and proves it took', () => {
  const RUNNING = {
    compatibility_date: '2026-07-24',
    compatibility_flags: [],
    d1_databases: { REPORTS: { id: 'abc' } },
  };

  /** A project whose GETs answer `reads` in turn, recording each PATCH. */
  const fake = (...reads: Record<string, unknown>[]) => {
    const patches: unknown[] = [];
    let n = 0;
    return {
      patches,
      get: async () => project(reads[Math.min(n++, reads.length - 1)]!),
      patch: async (body: unknown) => {
        patches.push(body);
        return { success: true, errors: [], result: {} };
      },
    };
  };

  it('sends nothing when production already runs the date', async () => {
    const api = fake({ ...RUNNING, compatibility_date: '2026-10-20' });
    expect(await syncRuntime('2026-10-20', api)).toBe(
      'production already runs compatibility date 2026-10-20 with no flags',
    );
    expect(api.patches).toEqual([]);
  });

  it('sets the date and reads it back', async () => {
    const api = fake(RUNNING, { ...RUNNING, compatibility_date: '2026-10-20' });
    expect(await syncRuntime('2026-10-20', api)).toBe(
      'production moved from compatibility date 2026-07-24 to 2026-10-20, read back',
    );
    expect(api.patches).toEqual([runtimePatch('2026-10-20')]);
  });

  it('fails naming both dates when the read-back still differs', async () => {
    const api = fake(RUNNING, RUNNING);
    await expect(syncRuntime('2026-10-20', api)).rejects.toThrow(
      'after the update, production runs compatibility date 2026-07-24 with no flags; the functions suite tests 2026-10-20 with no flags',
    );
  });

  it('fails naming the setting the update changed besides the runtime', async () => {
    const { d1_databases: _dropped, ...withoutBinding } = RUNNING;
    const api = fake(RUNNING, {
      ...withoutBinding,
      compatibility_date: '2026-10-20',
    });
    await expect(syncRuntime('2026-10-20', api)).rejects.toThrow(
      'the update changed more than the runtime: d1_databases',
    );
  });

  it('fails naming the refusal when the update is refused', async () => {
    const api = {
      get: async () => project(RUNNING),
      patch: async () => ({
        success: false,
        errors: [{ code: 10000, message: 'Authentication error' }],
        result: null,
      }),
    };
    await expect(syncRuntime('2026-10-20', api)).rejects.toThrow(
      'the update was refused: 10000 Authentication error',
    );
  });
});

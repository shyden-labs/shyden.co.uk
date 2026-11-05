import { describe, it, expect } from 'vitest';
import { staleReason, type Snapshot } from '../../src/lib/staleness';
import { getStrings } from '../../src/lib/i18n';

// The catalogues as a page receives them: every message compiled into a
// function of its named slots (#136). A raw catalogue holds templates.
const en = getStrings('en');
const id = getStrings('id');

/**
 * Every assertion below compares against a LITERAL string, never against
 * `en.staleMode`/`id.staleMode` themselves.
 *
 * The first version of this file compared `staleReason(...)` to
 * `en.staleXxx` directly, the same way a careless copy of sections.test.ts's
 * OWN pattern would look right at a glance. Run before those keys existed in
 * en.ts, twelve of these thirteen tests passed anyway: `t.staleMode` reads
 * `undefined` off an object with no such key, `en.staleMode` reads the SAME
 * `undefined` off the same object, and `undefined === undefined` is true --
 * so the test could not have told a missing key from a correct one. Only
 * the Indonesian "not the English string" check caught it, because that one
 * assertion needed the two sides to DIFFER. Every other test here was
 * rewritten to a literal the moment this was noticed, mid-RED-phase, before
 * en.ts/id.ts were ever touched -- literals are what sections.test.ts itself
 * already does ('none added', not `en.stateNoneAdded`), and this file now
 * matches that, not the shortcut that slipped past on the first pass.
 */
describe('staleReason', () => {
  const base: Snapshot = {
    mode: JSON.stringify({ kind: 'perGroup', size: 4 }),
    leftovers: 'spread',
    sexMode: 'off',
    roster: '',
  };

  const EN_MODE = 'These groups are out of date — the group size changed.';
  const EN_LEFTOVERS =
    'These groups are out of date — the leftovers choice changed.';
  const EN_SEX_MODE =
    'These groups are out of date — how boys and girls are grouped changed.';
  const EN_ROSTER = 'These groups are out of date — the class list changed.';

  const ID_MODE =
    'Kelompok ini sudah tidak berlaku lagi — ukuran kelompok berubah.';
  const ID_LEFTOVERS =
    'Kelompok ini sudah tidak berlaku lagi — pilihan siswa tersisa berubah.';
  const ID_SEX_MODE =
    'Kelompok ini sudah tidak berlaku lagi — cara pengelompokan berdasarkan jenis kelamin berubah.';
  const ID_ROSTER =
    'Kelompok ini sudah tidak berlaku lagi — daftar kelas berubah.';

  it('is null when nothing has changed', () => {
    expect(staleReason(base, { ...base }, en)).toBeNull();
  });

  it('names the group-size change', () => {
    const now: Snapshot = {
      ...base,
      mode: JSON.stringify({ kind: 'perGroup', size: 3 }),
    };
    expect(staleReason(base, now, en)).toBe(EN_MODE);
  });

  // The brief's own two tests only ever change the NUMBER inside `mode`
  // while the radio's `kind` stays `perGroup`. A comparison that only ever
  // looked at `size`/`count` and ignored `kind` would still pass both of
  // those -- this is the one that would catch it: switching modes entirely,
  // with no number changed at all.
  it('names a mode-KIND change too, not just a number inside it', () => {
    const now: Snapshot = {
      ...base,
      mode: JSON.stringify({ kind: 'groupCount', count: 6 }),
    };
    expect(staleReason(base, now, en)).toBe(EN_MODE);
  });

  it('names the leftovers change', () => {
    const now: Snapshot = { ...base, leftovers: 'bunch' };
    expect(staleReason(base, now, en)).toBe(EN_LEFTOVERS);
  });

  // Unreachable from the live page this stage (the two sex switches are
  // permanently disabled -- see classroom-groups.ts's own `readSexMode`),
  // but the branch is real code and this pins it directly, the same way
  // sexOptions.test.ts already unit-tests messages the page cannot reach
  // yet.
  it('names the sex-mode change', () => {
    const now: Snapshot = { ...base, sexMode: 'mix' };
    expect(staleReason(base, now, en)).toBe(EN_SEX_MODE);
  });

  // Reachable from the live page today (Task 6 fix, C-1): `roster` folds
  // in #cg-count, the page's only population control this stage, via
  // `readRoster` (classroom-groups.ts) -- see Snapshot's own doc comment.
  // This test only pins staleReason's own comparison against an arbitrary
  // literal; classroom-groups.spec.ts's "changing the number of students
  // marks them out of date, naming the change" is what proves the live
  // page actually drives this branch.
  it('names the roster change', () => {
    const now: Snapshot = { ...base, roster: 'something changed' };
    expect(staleReason(base, now, en)).toBe(EN_ROSTER);
  });

  it('checks mode before leftovers when both have changed', () => {
    const now: Snapshot = {
      ...base,
      mode: JSON.stringify({ kind: 'perGroup', size: 3 }),
      leftovers: 'bunch',
    };
    expect(staleReason(base, now, en)).toBe(EN_MODE);
  });

  it('checks leftovers before sexMode when both have changed', () => {
    const now: Snapshot = { ...base, leftovers: 'bunch', sexMode: 'mix' };
    expect(staleReason(base, now, en)).toBe(EN_LEFTOVERS);
  });

  it('checks sexMode before roster when both have changed', () => {
    const now: Snapshot = { ...base, sexMode: 'mix', roster: 'x' };
    expect(staleReason(base, now, en)).toBe(EN_SEX_MODE);
  });

  // The whole point of "comparison, not a flag": once the higher-priority
  // mismatch is undone, the reason does not stay stuck on it and does not
  // drop to null either -- the NEXT recompute reports whichever mismatch is
  // still live. A one-shot "remember the first cause" implementation would
  // fail this.
  it('reports the remaining mismatch once the higher-priority one is undone', () => {
    const both: Snapshot = {
      ...base,
      mode: JSON.stringify({ kind: 'perGroup', size: 3 }),
      leftovers: 'bunch',
    };
    expect(staleReason(base, both, en)).toBe(EN_MODE);

    const modeReverted: Snapshot = { ...both, mode: base.mode };
    expect(staleReason(base, modeReverted, en)).toBe(EN_LEFTOVERS);
  });

  it('is null again once every changed field is reverted', () => {
    const changed: Snapshot = {
      ...base,
      mode: JSON.stringify({ kind: 'perGroup', size: 3 }),
      leftovers: 'bunch',
    };
    expect(staleReason(base, changed, en)).not.toBeNull();
    const reverted: Snapshot = {
      ...changed,
      mode: base.mode,
      leftovers: base.leftovers,
    };
    expect(staleReason(base, reverted, en)).toBeNull();
  });

  // A comparison, so equal-but-freshly-built snapshots (a different object,
  // same field values) must still read as "nothing changed" -- reference
  // equality would break the moment `snapshot()` is called twice in a row
  // with nothing touched in between, which is the common case (every
  // keystroke recomputes it).
  it('is null for two structurally-equal snapshots that are not the same object', () => {
    const copy: Snapshot = JSON.parse(JSON.stringify(base));
    expect(copy).not.toBe(base);
    expect(staleReason(base, copy, en)).toBeNull();
  });

  it('produces the Indonesian strings from the Indonesian table, for every branch', () => {
    const modeChanged: Snapshot = {
      ...base,
      mode: JSON.stringify({ kind: 'perGroup', size: 3 }),
    };
    expect(staleReason(base, modeChanged, id)).toBe(ID_MODE);
    expect(staleReason(base, { ...base, leftovers: 'bunch' }, id)).toBe(
      ID_LEFTOVERS,
    );
    expect(staleReason(base, { ...base, sexMode: 'mix' }, id)).toBe(
      ID_SEX_MODE,
    );
    expect(staleReason(base, { ...base, roster: 'x' }, id)).toBe(ID_ROSTER);
  });

  // Belt and suspenders on top of the literal comparisons above: even if a
  // future edit made the English and Indonesian copy accidentally
  // coincide, this would still catch it directly, the same shape of check
  // i18n.test.ts already runs for every other locale string in this repo.
  it('the four reasons actually differ between English and Indonesian', () => {
    expect(en.staleMode).not.toBe(id.staleMode);
    expect(en.staleLeftovers).not.toBe(id.staleLeftovers);
    expect(en.staleSexMode).not.toBe(id.staleSexMode);
    expect(en.staleRoster).not.toBe(id.staleRoster);
  });

  // I-2 (review): every Snapshot field is TYPED as a string, and since #115
  // `astro check` holds typed callers to it, but a snapshot built from the
  // DOM or through a cast is not held to anything. `mode` avoids the
  // consequence by explicitly JSON.stringify-ing at its own call site
  // (classroom-groups.ts's `readMode`); `roster` now does the same
  // (`readRoster`). But a future call site that skips that and assigns an
  // array or object directly would make every `!==` below compare by
  // REFERENCE, not value: `['x'] !== ['x']` is true regardless of what is
  // inside either array, so two freshly-built, content-identical snapshots
  // could never read as equal again -- the notice would stick on "the
  // class list changed" permanently, and no revert could ever clear it,
  // since no revert can make two different objects the same object. The
  // "structurally-equal snapshots" test above only ever exercises
  // primitives and would not catch this. This constructs the exact shape a
  // type checker would have refused -- the way it can genuinely arrive at
  // runtime, given this repo runs none -- and proves staleReason refuses it
  // loudly instead of silently producing that bug.
  it('throws if a non-string is ever assigned to a Snapshot field, instead of silently comparing by reference', () => {
    const badRoster = { ...base, roster: ['a', 'b'] } as unknown as Snapshot;
    expect(() => staleReason(base, badRoster, en)).toThrow(TypeError);
    expect(() => staleReason(badRoster, { ...base }, en)).toThrow(TypeError);

    const badMode = {
      ...base,
      mode: { kind: 'perGroup', size: 4 },
    } as unknown as Snapshot;
    expect(() => staleReason(base, badMode, en)).toThrow(TypeError);
  });
});

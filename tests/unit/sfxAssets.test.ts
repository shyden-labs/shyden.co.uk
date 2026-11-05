import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

/*
 * SWEPT FOR #24 AND IMMUNE BY CONSTRUCTION, recorded rather than assumed.
 *
 * The source-text guards in this repo can be satisfied by a file's own
 * documentation -- three have been (#23, #21 Stage 4, #35) -- so every suite
 * that reads a file was swept. This one reads BINARY: `readFileSync` here
 * takes no encoding and returns a Buffer of an .m4a, parsed for its container
 * duration. Everything else it asserts against comes from importing
 * `src/lib/sfxAssets` as a VALUE. There is no text for a comment to live in,
 * so there is nothing to strip.
 */
import { join } from 'node:path';
import { nonEmpty } from '../source-files';
import * as sfxAssets from '../../src/lib/sfxAssets';
import {
  SFX_MANIFEST,
  landAssetIndex,
  SFX_ASSET_GAIN,
  SFX_MAX_DURATION_S,
  type SfxRole,
} from '../../src/lib/sfxAssets';

// Every export here is pure -- no AudioContext, no window, no document, no
// fetch anywhere in the module (see its own doc comment) -- so every test
// below exercises the real module directly, no browser or build step
// involved. The duration tests below are the one place this file reaches
// past the module and reads the REAL committed binaries at
// src/assets/sfx/ -- see readM4aContainerDurationS's own doc comment for why.

const SFX_DIR = join('src', 'assets', 'sfx');
/**
 * Derived from the manifest, never written out. Every one of these records is
 * `Readonly<Record<SfxRole, …>>`, so the roles enumerate themselves.
 *
 * They were hand-written until #70, and the four loops below iterate this
 * list: a role added with a real asset file, a gain of 9 and a declared
 * maximum duration of 0.001s passed all 21 tests, because none of those loops
 * ever reached it.
 */
const ROLES = Object.keys(SFX_MANIFEST) as readonly SfxRole[];

describe('the module surface', () => {
  it('exports nothing that nothing uses', () => {
    // SfxRole (type-only) is erased at build time and never appears in
    // Object.keys, so it is correctly absent here by construction, not by
    // omission.
    expect(Object.keys(sfxAssets).sort()).toEqual(
      [
        'SFX_MANIFEST',
        'landAssetIndex',
        'SFX_ASSET_GAIN',
        'SFX_MAX_DURATION_S',
      ].sort(),
    );
  });
});

describe('the role list the assertions iterate', () => {
  it('is derived from the manifest, and the three records agree on it', () => {
    // Anti-vacuity: an empty derivation would make every loop below a no-op
    // that reports success. The cross-checks are the seam — a role added to
    // one record and forgotten in another is what this catches at runtime.
    expect(ROLES.length).toBeGreaterThan(0);
    expect(Object.keys(SFX_ASSET_GAIN).sort()).toEqual([...ROLES].sort());
    expect(Object.keys(SFX_MAX_DURATION_S).sort()).toEqual([...ROLES].sort());
  });
});

describe('SFX_MANIFEST', () => {
  it('every role names at least one file, and every filename ends .m4a', () => {
    for (const role of ROLES) {
      expect(SFX_MANIFEST[role].length).toBeGreaterThan(0);
      for (const file of SFX_MANIFEST[role]) expect(file).toMatch(/\.m4a$/);
    }
  });

  it('land names exactly four distinct files -- the whole reason round-robin exists', () => {
    expect(SFX_MANIFEST.land.length).toBe(4);
    expect(new Set(SFX_MANIFEST.land).size).toBe(4);
  });

  it('shuffle and done each name exactly one file', () => {
    expect(SFX_MANIFEST.shuffle.length).toBe(1);
    expect(SFX_MANIFEST.done.length).toBe(1);
  });

  it('matches the real files committed at src/assets/sfx/ exactly -- no drift in either direction', () => {
    const onDisk = nonEmpty(
      readdirSync(SFX_DIR)
        .filter((name) => name.endsWith('.m4a'))
        .sort(),
      `.m4a files in ${SFX_DIR}`,
    );
    const declared = Object.values(SFX_MANIFEST).flat().sort();
    expect(declared).toEqual(onDisk);
  });
});

describe('landAssetIndex (round-robin over SFX_MANIFEST.land)', () => {
  it('starts at index 0', () => {
    expect(landAssetIndex(0)).toBe(0);
  });

  it('cycles through all four indices, in order, before repeating', () => {
    expect([0, 1, 2, 3].map(landAssetIndex)).toEqual([0, 1, 2, 3]);
  });

  it('wraps back to 0 at index 4 -- round-robin, not clamped and not thrown', () => {
    expect(landAssetIndex(4)).toBe(0);
    expect(landAssetIndex(5)).toBe(1);
  });

  it('never returns the same index for two consecutive group indices, across many cycles', () => {
    for (let i = 0; i < 200; i++) {
      expect(landAssetIndex(i)).not.toBe(landAssetIndex(i + 1));
    }
  });

  it('every index it can ever return is a valid position in SFX_MANIFEST.land', () => {
    for (let i = 0; i < 50; i++) {
      const idx = landAssetIndex(i);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(SFX_MANIFEST.land.length);
    }
  });

  it('is a pure function -- the same index always gives the same answer', () => {
    expect(landAssetIndex(37)).toBe(landAssetIndex(37));
  });

  it('defensively floors negative and fractional input, the same as landFrequency/landPan (sfx.ts)', () => {
    expect(landAssetIndex(-5)).toBe(landAssetIndex(0));
    expect(landAssetIndex(2.9)).toBe(landAssetIndex(2));
  });
});

describe('SFX_ASSET_GAIN', () => {
  it('every role has a strictly positive gain at or under unity', () => {
    for (const role of ROLES) {
      expect(SFX_ASSET_GAIN[role]).toBeGreaterThan(0);
      expect(SFX_ASSET_GAIN[role]).toBeLessThanOrEqual(1);
    }
  });

  it('land -- the role triggered repeatedly, with real overlap risk -- carries the lowest gain of the three', () => {
    expect(SFX_ASSET_GAIN.land).toBeLessThan(SFX_ASSET_GAIN.shuffle);
    expect(SFX_ASSET_GAIN.land).toBeLessThan(SFX_ASSET_GAIN.done);
  });
});

describe('SFX_MAX_DURATION_S', () => {
  it('every role has a positive, finite ceiling', () => {
    for (const role of ROLES) {
      expect(SFX_MAX_DURATION_S[role]).toBeGreaterThan(0);
      expect(Number.isFinite(SFX_MAX_DURATION_S[role])).toBe(true);
    }
  });
});

/**
 * Reads a `moov > mvhd` box's declared duration, in seconds, from a raw M4A
 * (ISO-BMFF/MP4) file's bytes -- the container's OWN authoritative length
 * (which includes the AAC encoder's priming/remainder padding, so it runs
 * slightly longer than the trimmed/audible length CREDITS.md states; that
 * makes it the MORE conservative of the two for a ceiling meant to catch a
 * replacement that is wildly longer, not the exact number a listener would
 * perceive). Test-local, not exported from sfxAssets.ts: production code
 * never needs to parse a container header -- the browser's own
 * `decodeAudioData` does real decoding -- this exists solely so this test
 * measures the REAL committed bytes rather than trusting a hand-typed
 * duration that could go stale the moment a file is swapped. Version 0
 * `mvhd` (32-bit fields) only, because that is what every one of the six
 * committed files actually uses (verified by hand against `afinfo` before
 * this was written); anything else throws rather than silently
 * mis-measuring -- a parse failure must never read as "0 seconds, ceiling
 * trivially satisfied".
 */
function readM4aContainerDurationS(bytes: Buffer): number {
  const readBoxHeader = (
    offset: number,
  ): { size: number; type: string; bodyStart: number } => {
    if (offset + 8 > bytes.length) {
      throw new Error(
        `readM4aContainerDurationS: truncated box header at byte ${offset}`,
      );
    }
    const size = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (size < 8) {
      throw new Error(
        `readM4aContainerDurationS: implausible box size ${size} ('${type}' at byte ${offset})`,
      );
    }
    return { size, type, bodyStart: offset + 8 };
  };

  let offset = 0;
  while (offset + 8 <= bytes.length) {
    const box = readBoxHeader(offset);
    if (box.type === 'moov') {
      let inner = box.bodyStart;
      const moovEnd = offset + box.size;
      while (inner + 8 <= moovEnd) {
        const child = readBoxHeader(inner);
        if (child.type === 'mvhd') {
          const version = bytes.readUInt8(child.bodyStart);
          if (version !== 0) {
            throw new Error(
              `readM4aContainerDurationS: unsupported mvhd version ${version} (only version 0 is handled)`,
            );
          }
          // version 0 mvhd: [version+flags:4][creation:4][modification:4][timescale:4][duration:4]...
          const timescale = bytes.readUInt32BE(child.bodyStart + 12);
          const duration = bytes.readUInt32BE(child.bodyStart + 16);
          if (timescale <= 0) {
            throw new Error(
              'readM4aContainerDurationS: mvhd timescale is not positive',
            );
          }
          return duration / timescale;
        }
        inner += child.size;
      }
      throw new Error('readM4aContainerDurationS: moov box has no mvhd child');
    }
    offset += box.size;
  }
  throw new Error('readM4aContainerDurationS: no moov box found');
}

describe('the stated length ceiling holds against the REAL committed files', () => {
  // Data-driven over the manifest (not hand-listed), so this automatically
  // covers whatever SFX_MANIFEST actually declares -- the "matches the real
  // files" test above is what keeps that declaration honest against disk.
  for (const role of ROLES) {
    for (const file of SFX_MANIFEST[role]) {
      it(`${file} (role: ${role}) parses under its ${SFX_MAX_DURATION_S[role]}s ceiling`, () => {
        const bytes = readFileSync(join(SFX_DIR, file));
        const durationS = readM4aContainerDurationS(bytes);
        expect(durationS).toBeGreaterThan(0);
        expect(durationS).toBeLessThanOrEqual(SFX_MAX_DURATION_S[role]);
      });
    }
  }
});

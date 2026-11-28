import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';

/*
 * SWEPT FOR #24 AND IMMUNE BY CONSTRUCTION, recorded rather than assumed.
 *
 * The source-text guards in this repo can be satisfied by a file's own
 * documentation -- three have been (#23, #21 Stage 4, #35) -- so every suite
 * that reads a file was swept. This one reads BINARY for the durations:
 * `readFileSync` takes no encoding and returns a Buffer of an .m4a, parsed
 * for its container duration. The one text it reads is CREDITS.md, whose
 * whole job is to be read by people, so a name there is the claim itself.
 */
import { join } from 'node:path';
import { nonEmpty } from '../source-files';
import * as sfxAssets from '../../src/lib/sfxAssets';
import { SFX_MANIFEST, SFX_MAX_DURATION_S } from '../../src/lib/sfxAssets';
import { DEAL_INSTRUMENTS, SHIPPED_NOTES } from '../../src/lib/dealSound';

const SFX_DIR = join('src', 'assets', 'sfx');

/** Every recording the deal's player asks for (src/scripts/deal-audio.ts):
 *  one per shipped note, and the ending's own layers. */
const EXPECTED_NAMES = [
  ...DEAL_INSTRUMENTS.flatMap((instrument) =>
    SHIPPED_NOTES[instrument].map((midi) => `${instrument}-${midi}`),
  ),
  'timpani-hit',
  'timpani-roll',
  'whoosh',
  'impact',
  'drop',
  'bell',
  'sparkle',
].sort();

/** The five Freesound recordings the ending is layered from, by page. */
const FREESOUND_PAGES = [
  'https://freesound.org/people/sgossner/sounds/375598/',
  'https://freesound.org/people/AudioPapkin/sounds/648538/',
  'https://freesound.org/people/deleted_user_3277771/sounds/177242/',
  'https://freesound.org/people/Stereo%20Surgeon/sounds/261205/',
  'https://freesound.org/people/opticaillusions/sounds/554312/',
];

describe('the module surface', () => {
  it('exports nothing that nothing uses', () => {
    expect(Object.keys(sfxAssets).sort()).toEqual(
      ['SFX_MANIFEST', 'SFX_MAX_DURATION_S'].sort(),
    );
  });
});

describe('SFX_MANIFEST', () => {
  it('names exactly the recordings the deal plays', () => {
    expect(Object.keys(SFX_MANIFEST).sort()).toEqual(EXPECTED_NAMES);
  });

  it('ships each recording under its own name, as .m4a', () => {
    for (const [name, file] of Object.entries(SFX_MANIFEST)) {
      expect(file).toBe(`${name}.m4a`);
    }
  });

  it('matches the real files committed at src/assets/sfx/ exactly -- no drift in either direction', () => {
    const onDisk = nonEmpty(
      readdirSync(SFX_DIR)
        .filter((name) => name.endsWith('.m4a'))
        .sort(),
      `.m4a files in ${SFX_DIR}`,
    );
    expect(Object.values(SFX_MANIFEST).sort()).toEqual(onDisk);
  });

  it('weighs under 600 KB in all', () => {
    const bytes = Object.values(SFX_MANIFEST).reduce(
      (sum, file) => sum + statSync(join(SFX_DIR, file)).size,
      0,
    );
    expect(bytes).toBeLessThan(600 * 1024);
  });
});

describe('SFX_MAX_DURATION_S', () => {
  it('gives every recording a positive, finite ceiling', () => {
    expect(Object.keys(SFX_MAX_DURATION_S).sort()).toEqual(EXPECTED_NAMES);
    for (const ceiling of Object.values(SFX_MAX_DURATION_S)) {
      expect(ceiling).toBeGreaterThan(0);
      expect(Number.isFinite(ceiling)).toBe(true);
    }
  });
});

describe('CREDITS.md', () => {
  const credits = readFileSync(join(SFX_DIR, 'CREDITS.md'), 'utf8');

  it('credits VSCO 2 CE, CC0, by its repository', () => {
    expect(credits).toContain('VSCO 2 CE');
    expect(credits).toContain('https://github.com/sgossner/VSCO-2-CE');
  });

  for (const page of FREESOUND_PAGES) {
    it(`credits ${page}`, () => {
      expect(credits).toContain(page);
    });
  }

  it('names the licence, Creative Commons 0', () => {
    expect(credits).toContain('Creative Commons 0');
  });

  it('lists every file that ships', () => {
    for (const file of Object.values(SFX_MANIFEST)) {
      expect(credits, file).toContain(`\`${file}\``);
    }
  });

  it('no longer credits the Kenney files it replaced', () => {
    expect(credits).not.toContain('Kenney');
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
 * `mvhd` (32-bit fields) only, because that is what every one of the
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
  for (const [name, file] of Object.entries(SFX_MANIFEST)) {
    it(`${file} parses under its ${SFX_MAX_DURATION_S[name]}s ceiling`, () => {
      const durationS = readM4aContainerDurationS(
        readFileSync(join(SFX_DIR, file)),
      );
      expect(durationS).toBeGreaterThan(0);
      expect(durationS).toBeLessThanOrEqual(SFX_MAX_DURATION_S[name]);
    });
  }
});

import { describe, it, expect } from 'vitest';
import {
  DEAL_INSTRUMENTS,
  DEAL_BASES,
  SHIPPED_NOTES,
  dealStepMidi,
  dealLoudness,
  timpaniOnStep,
  nearestNote,
} from '../../src/lib/dealSound';

describe('the deal climbs a major-pentatonic scale', () => {
  it('starts on its base note', () => {
    expect(dealStepMidi(55, 0)).toBe(55);
  });

  it('reaches the major third on the third step', () => {
    expect(dealStepMidi(55, 2)).toBe(59);
  });

  it('reaches the sixth on the fifth step', () => {
    expect(dealStepMidi(55, 4)).toBe(64);
  });

  it('starts the second octave on the sixth step', () => {
    expect(dealStepMidi(55, 5)).toBe(67);
  });

  it('tops out on the tenth step, two octaves less a fourth up', () => {
    expect(dealStepMidi(55, 9)).toBe(76);
  });

  it('wraps back to its base note on the eleventh step', () => {
    expect(dealStepMidi(55, 10)).toBe(55);
  });

  it('still wraps for the hundredth student', () => {
    expect(dealStepMidi(55, 99)).toBe(dealStepMidi(55, 9));
  });
});

describe('the three instruments the deal plays together', () => {
  it('are marimba, harp and glockenspiel, an octave apart on G', () => {
    expect(DEAL_INSTRUMENTS).toEqual(['marimba', 'harp', 'glock']);
    expect(DEAL_BASES).toEqual({ marimba: 43, harp: 55, glock: 67 });
  });
});

describe('every note of a class of 100 plays from a real recording', () => {
  for (const instrument of DEAL_INSTRUMENTS) {
    it(`no ${instrument} note is nudged by more than three semitones`, () => {
      const worst = Math.max(
        ...Array.from({ length: 100 }, (_, i) =>
          Math.abs(
            nearestNote(instrument, dealStepMidi(DEAL_BASES[instrument], i))
              .semitones,
          ),
        ),
      );
      expect(worst).toBeLessThanOrEqual(3);
    });

    it(`every shipped ${instrument} recording is played by some note`, () => {
      const used = new Set(
        Array.from(
          { length: 10 },
          (_, i) =>
            nearestNote(instrument, dealStepMidi(DEAL_BASES[instrument], i))
              .sample,
        ),
      );
      expect(SHIPPED_NOTES[instrument].filter((n) => !used.has(n))).toEqual([]);
    });
  }
});

describe('nearestNote', () => {
  it('plays a shipped note from its own recording, unnudged', () => {
    const shipped = SHIPPED_NOTES.harp[0];
    expect(nearestNote('harp', shipped)).toEqual({
      sample: shipped,
      semitones: 0,
    });
  });

  it('says how far, and which way, the recording is nudged', () => {
    const shipped = SHIPPED_NOTES.harp[0];
    expect(nearestNote('harp', shipped + 1)).toEqual({
      sample: shipped,
      semitones: 1,
    });
  });

  it('on a tie, nudges the higher recording down', () => {
    const [low, high] = SHIPPED_NOTES.marimba;
    if ((high - low) % 2 !== 0) throw new Error('fixture needs an even gap');
    const middle = (low + high) / 2;
    expect(nearestNote('marimba', middle)).toEqual({
      sample: high,
      semitones: middle - high,
    });
  });
});

describe('the deal gets louder as it goes', () => {
  it('starts at the quietest for the first student', () => {
    expect(dealLoudness(0, 16)).toBe(0);
  });

  it('is halfway at the middle of the deal', () => {
    expect(dealLoudness(5, 11)).toBe(0.5);
  });

  it('is loudest for the last student', () => {
    expect(dealLoudness(15, 16)).toBe(1);
  });

  it('plays a lone student at full loudness, with no division by zero', () => {
    expect(dealLoudness(0, 1)).toBe(1);
  });
});

describe('a timpani hit marks every fourth student', () => {
  it('on the first', () => {
    expect(timpaniOnStep(0)).toBe(true);
  });

  it('on the fifth', () => {
    expect(timpaniOnStep(4)).toBe(true);
  });

  it('not on the fourth', () => {
    expect(timpaniOnStep(3)).toBe(false);
  });
});

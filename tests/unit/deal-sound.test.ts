import { describe, it, expect } from 'vitest';
import {
  DEAL_INSTRUMENTS,
  DEAL_BASES,
  SHIPPED_NOTES,
  dealStepMidi,
  dealLoudness,
  timpaniOnStep,
  nearestNote,
  CONFETTI_MIDI,
  ROLL_S,
  REVEAL_AT_S,
  FANFARE_STAGES_S,
  RING_OUT_S,
  endingPlan,
  type EndingEvent,
} from '../../src/lib/dealSound';
import { createPrng } from '../../src/lib/sfx';

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
      const played = [
        ...Array.from({ length: 10 }, (_, i) =>
          dealStepMidi(DEAL_BASES[instrument], i),
        ),
        ...(instrument === 'glock' ? CONFETTI_MIDI : []),
      ];
      const used = new Set(
        played.map((midi) => nearestNote(instrument, midi).sample),
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

const plan = (): EndingEvent[] => endingPlan(createPrng(1339));
const ofKind = (kind: EndingEvent['kind']): EndingEvent[] =>
  plan().filter((event) => event.kind === kind);

describe('the ending, timed from the last landing', () => {
  it('rolls the timpani for 1.6 s first', () => {
    expect(ROLL_S).toBe(1.6);
    expect(ofKind('roll').map(({ at, durationS }) => [at, durationS])).toEqual([
      [0, 1.6],
    ]);
  });

  it('reveals at 1.7 s, the fanfare stages half a second apart', () => {
    expect(REVEAL_AT_S).toBe(1.7);
    expect(FANFARE_STAGES_S).toEqual([0, 0.5, 1.0]);
  });

  it('plays three fanfare stages on C, F and G major', () => {
    expect(
      ofKind('fanfare').map(({ at, rootHz }) => [
        Number(at.toFixed(3)),
        Number(rootHz?.toFixed(2)),
      ]),
    ).toEqual([
      [1.7, 261.63],
      [2.2, 349.23],
      [2.7, 392.0],
    ]);
  });

  it('hits the timpani on the reveal and on the third stage', () => {
    expect(ofKind('timpaniHit').map(({ at }) => at)).toEqual([1.7, 2.7]);
  });

  it('brings the whoosh in half a second before the reveal', () => {
    expect(ofKind('whoosh').map(({ at }) => at)).toEqual([1.2]);
  });

  it('lands the impact, the low drop and the bell shimmer on the reveal', () => {
    for (const kind of ['impact', 'drop', 'bellShimmer'] as const) {
      expect(ofKind(kind).length, kind).toBeGreaterThan(0);
      for (const { at } of ofKind(kind)) {
        expect(at, kind).toBeGreaterThanOrEqual(1.7);
        expect(at, kind).toBeLessThan(1.8);
      }
    }
  });

  it('holds a final chord and the sparkle from just after the reveal', () => {
    expect(ofKind('finalChord').map(({ at }) => at)).toEqual([1.8]);
    expect(ofKind('sparkle').map(({ at }) => at)).toEqual([1.8]);
  });

  it('rings out for 7.5 s after the reveal, and no longer', () => {
    expect(RING_OUT_S).toBe(7.5);
    const ends = plan().map(({ at, durationS }) => at + durationS);
    expect(Math.max(...ends)).toBeLessThanOrEqual(1.7 + 7.5 + 1e-9);
    expect(Math.max(...ends)).toBeGreaterThanOrEqual(1.7 + 6);
  });

  it('scatters 66 glockenspiel confetti notes from 1.8 s to 6.6 s', () => {
    const confetti = ofKind('confettiNote');
    expect(confetti).toHaveLength(66);
    for (const { at } of confetti) {
      expect(at).toBeGreaterThanOrEqual(1.8);
      expect(at).toBeLessThanOrEqual(6.6);
    }
  });

  it('plays every confetti note from a glockenspiel recording, nudged at most three semitones', () => {
    for (const { midi } of ofKind('confettiNote')) {
      expect(CONFETTI_MIDI).toContain(midi);
      expect(
        Math.abs(nearestNote('glock', midi ?? Number.NaN).semitones),
      ).toBeLessThanOrEqual(3);
    }
  });

  it('lets the confetti fade as it goes', () => {
    const byTime = [...ofKind('confettiNote')].sort((a, b) => a.at - b.at);
    expect(byTime[0].gain).toBeGreaterThan(byTime.at(-1)?.gain ?? 1);
  });

  it('gives every event a positive length and a gain', () => {
    for (const { kind, durationS, gain } of plan()) {
      expect(durationS, kind).toBeGreaterThan(0);
      expect(gain, kind).toBeGreaterThan(0);
    }
  });

  it('is the same plan from the same seed', () => {
    expect(plan()).toEqual(plan());
  });

  it('differs from another seed only in the confetti', () => {
    const other = endingPlan(createPrng(7)).filter(
      (event) => event.kind !== 'confettiNote',
    );
    expect(other).toEqual(
      plan().filter((event) => event.kind !== 'confettiNote'),
    );
  });
});

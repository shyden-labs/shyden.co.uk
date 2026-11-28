/**
 * The deal's notes (#1339), as pure data and pure functions: which real
 * recording each student lands on, how far it is nudged, and how loud.
 * `src/scripts/deal-audio.ts` is the only thing that turns these numbers
 * into sound.
 *
 * Each student lands on marimba, harp and glockenspiel together, climbing a
 * major-pentatonic scale for two octaves and then wrapping, so a class of
 * 100 never runs off the top of the recordings. Every note is played from
 * the nearest recording shipped (VSCO 2 CE, CC0), nudged by at most three
 * semitones: Shyden heard pitch-shifted slices as "really bad and
 * synthetic", so no note is stretched further than that.
 */

export const DEAL_INSTRUMENTS = ['marimba', 'harp', 'glock'] as const;
export type DealInstrument = (typeof DEAL_INSTRUMENTS)[number];

/** Each instrument's first note, as MIDI: G2, G3 and G4. */
export const DEAL_BASES: Readonly<Record<DealInstrument, number>> = {
  marimba: 43,
  harp: 55,
  glock: 67,
};

/** The major pentatonic, in semitones above the base. */
const PENTATONIC = [0, 2, 4, 7, 9] as const;

/** Two octaves of the scale, then the deal starts again at the bottom. */
const DEAL_STEPS = PENTATONIC.length * 2;

/** The MIDI note of the `i`th student's landing, from `base`. */
export function dealStepMidi(base: number, i: number): number {
  const step = i % DEAL_STEPS;
  const octave = Math.floor(step / PENTATONIC.length);
  return base + octave * 12 + PENTATONIC[step % PENTATONIC.length];
}

/** 0 for the first student, 1 for the last; a lone student plays at 1. */
export function dealLoudness(i: number, n: number): number {
  return n <= 1 ? 1 : i / (n - 1);
}

/** A timpani hit marks the first student and every fourth after. */
export function timpaniOnStep(i: number): boolean {
  return i % 4 === 0;
}

/**
 * The MIDI note of every recording shipped, the fewest that keep every
 * deal note within three semitones (the tests derive that, they do not
 * trust this list): marimba G2 B2 F3 C4 G4, harp G3 D4 A4 E5, glockenspiel
 * G4 C5 G5 C6 G6.
 */
export const SHIPPED_NOTES: Readonly<
  Record<DealInstrument, readonly number[]>
> = {
  marimba: [43, 47, 53, 60, 67],
  harp: [55, 62, 69, 76],
  glock: [67, 72, 79, 84, 91],
};

/**
 * The recording to play `midi` from, and the semitones to nudge it by
 * (positive is up). On a tie the higher recording is nudged down.
 */
export function nearestNote(
  instrument: DealInstrument,
  midi: number,
): { sample: number; semitones: number } {
  let sample = SHIPPED_NOTES[instrument][0];
  for (const candidate of SHIPPED_NOTES[instrument]) {
    if (Math.abs(midi - candidate) <= Math.abs(midi - sample)) {
      sample = candidate;
    }
  }
  return { sample, semitones: midi - sample };
}

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
 * G4 C5 G5 C6 G6, and C7 for the ending's confetti.
 */
export const SHIPPED_NOTES: Readonly<
  Record<DealInstrument, readonly number[]>
> = {
  marimba: [43, 47, 53, 60, 67],
  harp: [55, 62, 69, 76],
  glock: [67, 72, 79, 84, 91, 96],
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

// ── the ending: a timpani roll, then the Jackpot (Shyden's choice) ────

/** Every layer of the ending. None is a noise source: Shyden heard hiss
 *  and crackle as "electrics sparking", so the union has no such kind. */
export type EndingKind =
  | 'roll'
  | 'whoosh'
  | 'timpaniHit'
  | 'impact'
  | 'drop'
  | 'bellShimmer'
  | 'fanfare'
  | 'finalChord'
  | 'sparkle'
  | 'confettiNote';

/** One layer, `at` seconds after the last student lands. `notes` are
 *  semitones above `rootHz` (or, for the bell, the recording's own pitch). */
export interface EndingEvent {
  at: number;
  kind: EndingKind;
  gain: number;
  durationS: number;
  rootHz?: number;
  notes?: readonly number[];
  midi?: number;
  pan?: number;
}

/** The timpani roll that swells under the last landing. */
export const ROLL_S = 1.6;
/** When the results are revealed and the Jackpot begins. */
export const REVEAL_AT_S = 1.7;
/** The three fanfare stages, after the reveal. */
export const FANFARE_STAGES_S: readonly number[] = [0, 0.5, 1.0];
/** How long the ending rings out after the reveal ("6-8 seconds"). */
export const RING_OUT_S = 7.5;

/** C4, and the fourth and fifth above it: C, F and G major. */
const FANFARE_ROOTS_HZ = [261.63, 349.23, 392.0] as const;
const FANFARE_CHORD = [0, 4, 7, 12, 16] as const;
/** The third stage opens up with the top fifth. */
const FANFARE_TOP_CHORD = [...FANFARE_CHORD, 19] as const;

/** The glockenspiel notes the confetti falls on: the pentatonic from G5. */
export const CONFETTI_MIDI: readonly number[] = Array.from(
  { length: 8 },
  (_, i) => dealStepMidi(79, i),
);
const CONFETTI_COUNT = 66;
const CONFETTI_FROM_S = 0.1;
const CONFETTI_SPREAD_S = 4.8;
const CONFETTI_PEAK_GAIN = 0.12;
/** The confetti's gain reaches 0 this long after the reveal. */
const CONFETTI_FADE_S = 5.5;

const round = (seconds: number): number => Math.round(seconds * 1000) / 1000;

/**
 * Every layer of the ending, timed from the last landing. Only the confetti
 * draws on `rng`: where each note falls, which note, and its pan.
 */
export function endingPlan(rng: () => number): EndingEvent[] {
  const r = REVEAL_AT_S;
  const [first, second, third] = FANFARE_STAGES_S;
  const events: EndingEvent[] = [
    { at: 0, kind: 'roll', gain: 1, durationS: ROLL_S },
    { at: round(r - 0.5), kind: 'whoosh', gain: 1, durationS: 0.6 },
    { at: r, kind: 'timpaniHit', gain: 1, durationS: 2.5 },
    { at: r, kind: 'impact', gain: 1.1, durationS: 6.5 },
    { at: r, kind: 'drop', gain: 0.9, durationS: 4 },
    ...[0, 7, 12].map((semitones, k): EndingEvent => ({
      at: round(r + k * 0.03),
      kind: 'bellShimmer',
      gain: 0.55,
      durationS: 5,
      notes: [semitones],
      pan: (k - 1) * 0.5,
    })),
    {
      at: round(r + first),
      kind: 'fanfare',
      gain: 0.05,
      durationS: 3.2,
      rootHz: FANFARE_ROOTS_HZ[0],
      notes: FANFARE_CHORD,
    },
    {
      at: round(r + second),
      kind: 'fanfare',
      gain: 0.05,
      durationS: 3,
      rootHz: FANFARE_ROOTS_HZ[1],
      notes: FANFARE_CHORD,
    },
    {
      at: round(r + third),
      kind: 'fanfare',
      gain: 0.055,
      durationS: 3.8,
      rootHz: FANFARE_ROOTS_HZ[2],
      notes: FANFARE_TOP_CHORD,
    },
    { at: round(r + third), kind: 'timpaniHit', gain: 0.8, durationS: 2.5 },
    {
      at: round(r + 0.1),
      kind: 'sparkle',
      gain: 1,
      durationS: round(RING_OUT_S - 0.1),
    },
    {
      at: round(r + 0.1),
      kind: 'finalChord',
      gain: 0.045,
      durationS: 6.5,
      rootHz: FANFARE_ROOTS_HZ[2],
      notes: FANFARE_CHORD,
    },
  ];
  for (let i = 0; i < CONFETTI_COUNT; i++) {
    const after = CONFETTI_FROM_S + rng() * CONFETTI_SPREAD_S;
    const midi = CONFETTI_MIDI[Math.floor(rng() * CONFETTI_MIDI.length)];
    events.push({
      at: round(r + after),
      kind: 'confettiNote',
      gain: CONFETTI_PEAK_GAIN * (1 - after / CONFETTI_FADE_S),
      durationS: 0.6,
      midi,
      pan: rng() * 1.8 - 0.9,
    });
  }
  return events;
}

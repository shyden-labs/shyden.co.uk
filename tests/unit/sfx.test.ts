import { describe, it, expect } from 'vitest';
import * as sfx from '../../src/lib/sfx';
import {
  envelopeTotalS,
  AUDIBLE_BAND_HZ,
  FAST_STEP_S,
  NORMAL_STEP_S,
  TONIC_HZ,
  semitoneRatio,
  LAND_SCALE_SEMITONES,
  landFrequency,
  LAND_PAN_RANGE,
  landPan,
  INHARMONIC_PARTIAL_RATIOS,
  INHARMONIC_PARTIAL_GAINS,
  LAND_PARTIAL_DECAYS_S,
  INHARMONIC_RELATIVE_DECAYS,
  LAND_RELEASE_S,
  PITCH_DROP_FRACTION,
  PITCH_GLIDE_S,
  VOICE_ATTACK_S,
  VOICE_BODY_DECAY_S,
  VOICE_BODY_SUSTAIN_LEVEL,
  LAND_TRANSIENT,
  LAND_TRANSIENT_PLUS_BODY_S,
  VOICE_SUB,
  MICRO_VARIATION_MAX,
  microVariation,
  createPrng,
  buildVoicePlan,
  LAND_PEAK_GAIN,
  LAND_REVERB_SEND,
  landVoicePlan,
  DONE_CHORD_SEMITONES,
  doneFrequencies,
  DONE_STAGGER_S,
  DONE_RELEASE_S,
  DONE_PEAK_GAIN,
  DONE_REVERB_SEND,
  doneVoicePlans,
  DONE_RISER,
  SHUFFLE_DURATION_S,
  SHUFFLE_GRAIN_BOUNDS,
  SHUFFLE_GRAIN_PEAK_GAIN,
  SHUFFLE_REVERB_SEND,
  shuffleGrainPlans,
  SHUFFLE_SUB,
  MAX_POLYPHONY,
  admitVoice,
  SATURATOR_DRIVE,
  SATURATOR_CURVE_SAMPLES,
  generateSaturatorCurve,
  REVERB_DURATION_S,
  REVERB_DECAY_TIME_CONSTANT_S,
  reverbEnvelopeGain,
  REVERB_LOWPASS_HZ,
  REVERB_NORMALIZE_PEAK,
  generateReverbImpulseResponse,
  MASTER_GAIN,
  MASTER_HIGHPASS_HZ,
  MASTER_LOWPASS_HZ,
  MASTER_COMPRESSOR,
  REVERB_RETURN_GAIN,
  type Envelope,
  type VoicePlan,
} from '../../src/lib/sfx';

// Every export here is pure -- no AudioContext, no window, no document, no
// Math.random() and no wall-clock read anywhere in the module (see its own
// doc comment) -- so every test below exercises the REAL synthesiser logic,
// not a fake standing in for Web Audio.

/** A fixed-value rng for exact edge-case tests -- NOT createPrng, because
 *  these tests need to pin an EXACT input (0, 0.5, 1, ...) rather than
 *  exercise the real generator. */
const constRng =
  (value: number): (() => number) =>
  () =>
    value;

/** Cycles through a fixed sequence -- for tests that need a few specific,
 *  known draws in a row (e.g. "the first draw picks the count, the rest
 *  shape each grain"). */
const seqRng = (values: number[]): (() => number) => {
  let i = 0;
  return () => values[i++ % values.length];
};

describe('the module surface', () => {
  it('exports nothing that nothing uses', () => {
    // Type-only exports (Envelope, VoicePartialPlan, TransientPlan,
    // SubTonePlan, VoicePlan, MicroVariation, GrainPlan, ReverbIR) are
    // erased at build time and never appear in Object.keys, so they are
    // correctly absent here by construction, not by omission.
    expect(Object.keys(sfx).sort()).toEqual(
      [
        'envelopeTotalS',
        'AUDIBLE_BAND_HZ',
        'FAST_STEP_S',
        'NORMAL_STEP_S',
        'TONIC_HZ',
        'semitoneRatio',
        'LAND_SCALE_SEMITONES',
        'landFrequency',
        'LAND_PAN_RANGE',
        'landPan',
        'INHARMONIC_PARTIAL_RATIOS',
        'INHARMONIC_PARTIAL_GAINS',
        'LAND_PARTIAL_DECAYS_S',
        'INHARMONIC_RELATIVE_DECAYS',
        'LAND_RELEASE_S',
        'PITCH_DROP_FRACTION',
        'PITCH_GLIDE_S',
        'VOICE_ATTACK_S',
        'VOICE_BODY_DECAY_S',
        'VOICE_BODY_SUSTAIN_LEVEL',
        'LAND_TRANSIENT',
        'LAND_TRANSIENT_PLUS_BODY_S',
        'VOICE_SUB',
        'MICRO_VARIATION_MAX',
        'microVariation',
        'createPrng',
        'buildVoicePlan',
        'LAND_PEAK_GAIN',
        'LAND_REVERB_SEND',
        'landVoicePlan',
        'DONE_CHORD_SEMITONES',
        'doneFrequencies',
        'DONE_STAGGER_S',
        'DONE_RELEASE_S',
        'DONE_PEAK_GAIN',
        'DONE_REVERB_SEND',
        'doneVoicePlans',
        'DONE_RISER',
        'SHUFFLE_DURATION_S',
        'SHUFFLE_GRAIN_BOUNDS',
        'SHUFFLE_GRAIN_PEAK_GAIN',
        'SHUFFLE_REVERB_SEND',
        'shuffleGrainPlans',
        'SHUFFLE_SUB',
        'MAX_POLYPHONY',
        'admitVoice',
        'SATURATOR_DRIVE',
        'SATURATOR_CURVE_SAMPLES',
        'generateSaturatorCurve',
        'REVERB_DURATION_S',
        'REVERB_DECAY_TIME_CONSTANT_S',
        'reverbEnvelopeGain',
        'REVERB_LOWPASS_HZ',
        'REVERB_NORMALIZE_PEAK',
        'generateReverbImpulseResponse',
        'MASTER_GAIN',
        'MASTER_HIGHPASS_HZ',
        'MASTER_LOWPASS_HZ',
        'MASTER_COMPRESSOR',
        'REVERB_RETURN_GAIN',
      ].sort(),
    );
  });
});

describe('envelopeTotalS', () => {
  it('sums attack + decay + release (sustainLevel is a level, not a duration)', () => {
    const env: Envelope = {
      attackS: 0.01,
      decayS: 0.02,
      sustainLevel: 0.5,
      releaseS: 0.03,
    };
    expect(envelopeTotalS(env)).toBeCloseTo(0.06, 10);
  });
});

describe('timing constants', () => {
  it('FAST_STEP_S is strictly shorter than NORMAL_STEP_S, both positive and finite', () => {
    expect(FAST_STEP_S).toBeGreaterThan(0);
    expect(NORMAL_STEP_S).toBeGreaterThan(FAST_STEP_S);
    expect(Number.isFinite(FAST_STEP_S)).toBe(true);
    expect(Number.isFinite(NORMAL_STEP_S)).toBe(true);
  });

  it('AUDIBLE_BAND_HZ is a well-formed, positive range', () => {
    expect(AUDIBLE_BAND_HZ.min).toBeGreaterThan(0);
    expect(AUDIBLE_BAND_HZ.max).toBeGreaterThan(AUDIBLE_BAND_HZ.min);
  });
});

describe('semitoneRatio', () => {
  it('is the identity every pitch calculation in this file rests on', () => {
    expect(semitoneRatio(0)).toBe(1);
    expect(semitoneRatio(12)).toBe(2);
    expect(semitoneRatio(-12)).toBeCloseTo(0.5, 10);
    expect(semitoneRatio(24)).toBe(4);
  });
});

describe('TONIC_HZ', () => {
  it('is D4, exactly as the brief states', () => {
    expect(TONIC_HZ).toBe(293.66);
  });
});

describe('the D minor pentatonic scale (LAND_SCALE_SEMITONES)', () => {
  it('is exactly D F G A C as semitone offsets from the tonic', () => {
    expect(LAND_SCALE_SEMITONES).toEqual([0, 3, 5, 7, 10]);
  });

  it('is given in strictly ascending order', () => {
    for (let i = 1; i < LAND_SCALE_SEMITONES.length; i++) {
      expect(LAND_SCALE_SEMITONES[i]).toBeGreaterThan(
        LAND_SCALE_SEMITONES[i - 1],
      );
    }
  });

  it('contains no semitone (one half-step) interval, including the wrap back to the octave above', () => {
    const intervals: number[] = [];
    for (let i = 0; i < LAND_SCALE_SEMITONES.length; i++) {
      const next =
        i + 1 < LAND_SCALE_SEMITONES.length
          ? LAND_SCALE_SEMITONES[i + 1]
          : LAND_SCALE_SEMITONES[0] + 12;
      intervals.push(next - LAND_SCALE_SEMITONES[i]);
    }
    for (const interval of intervals)
      expect(interval).toBeGreaterThanOrEqual(2);
    expect(intervals.reduce((a, b) => a + b, 0)).toBe(12);
  });
});

describe('landFrequency (group index -> fundamental)', () => {
  it('starts exactly on the tonic', () => {
    expect(landFrequency(0)).toBe(TONIC_HZ);
  });

  it('is strictly ascending within one cycle of the scale', () => {
    for (let i = 1; i < LAND_SCALE_SEMITONES.length; i++) {
      expect(landFrequency(i)).toBeGreaterThan(landFrequency(i - 1));
    }
  });

  it('cycles every 5 indices -- "wrapping after one octave", not climbing forever', () => {
    // The brief's own check list: 0, 1, 5, 12, 40, 500. 5, 40 and 500 are
    // all multiples of 5 (degree 0, same as index 0); 12 is degree 2 (same
    // as index 2). This is the strong form of "cycles": not merely
    // bounded, but landing on the EXACT SAME frequency, proving the
    // mapping truly repeats rather than growing slowly enough to look
    // bounded over one sample.
    expect(landFrequency(5)).toBe(landFrequency(0));
    expect(landFrequency(40)).toBe(landFrequency(0));
    expect(landFrequency(500)).toBe(landFrequency(0));
    expect(landFrequency(12)).toBe(landFrequency(2));
  });

  it("every frequency in the brief's own check list stays inside the audible band", () => {
    for (const i of [0, 1, 5, 12, 40, 500]) {
      const hz = landFrequency(i);
      expect(hz).toBeGreaterThanOrEqual(AUDIBLE_BAND_HZ.min);
      expect(hz).toBeLessThanOrEqual(AUDIBLE_BAND_HZ.max);
    }
  });

  it('is a pure function -- the same index always gives the same pitch', () => {
    expect(landFrequency(7)).toBe(landFrequency(7));
  });

  it('defensively floors negative/fractional input, the same as a pure function should never trust its caller to pre-validate', () => {
    expect(landFrequency(-3)).toBe(landFrequency(0));
    expect(landFrequency(2.9)).toBe(landFrequency(2));
  });
});

describe('landPan (group index -> stereo position)', () => {
  it('spans exactly -LAND_PAN_RANGE..+LAND_PAN_RANGE across one cycle of the scale', () => {
    expect(landPan(0)).toBe(-LAND_PAN_RANGE);
    expect(landPan(LAND_SCALE_SEMITONES.length - 1)).toBeCloseTo(
      LAND_PAN_RANGE,
      10,
    );
  });

  it("stays within the brief's own -0.35..+0.35 range, comfortably inside [-1, 1]", () => {
    for (const i of [0, 1, 2, 3, 4, 5, 12, 40, 500]) {
      const pan = landPan(i);
      expect(pan).toBeGreaterThanOrEqual(-LAND_PAN_RANGE - 1e-9);
      expect(pan).toBeLessThanOrEqual(LAND_PAN_RANGE + 1e-9);
      expect(pan).toBeGreaterThanOrEqual(-1);
      expect(pan).toBeLessThanOrEqual(1);
    }
  });

  it('cycles in lockstep with landFrequency -- the same pitch always arrives from the same rough direction', () => {
    expect(landPan(5)).toBe(landPan(0));
    expect(landPan(12)).toBe(landPan(2));
  });
});

describe('INHARMONIC_PARTIAL_RATIOS -- the property that separates 2020s from 1995', () => {
  it("is exactly the brief's three ratios: fundamental, then 2.756x, then 5.404x", () => {
    expect(INHARMONIC_PARTIAL_RATIOS).toEqual([1, 2.756, 5.404]);
  });

  it('is given in strictly ascending order', () => {
    for (let i = 1; i < INHARMONIC_PARTIAL_RATIOS.length; i++) {
      expect(INHARMONIC_PARTIAL_RATIOS[i]).toBeGreaterThan(
        INHARMONIC_PARTIAL_RATIOS[i - 1],
      );
    }
  });

  it('is INHARMONIC -- no partial above the fundamental sits within 0.03 of an integer', () => {
    // The fundamental itself (index 0, ratio exactly 1) is excluded: "1" is
    // what defines the fundamental, not a claim about a partial's
    // inharmonicity. Every ratio ABOVE it must clear the brief's own
    // 0.03 tolerance from the nearest integer -- an organ or an early GM
    // soundfont's partials sit exactly ON an integer (ratio 2, 3, 4, ...);
    // this is the test that would have caught the first attempt's own
    // partials (ratio 2 and 4, both integers).
    for (let i = 1; i < INHARMONIC_PARTIAL_RATIOS.length; i++) {
      const ratio = INHARMONIC_PARTIAL_RATIOS[i];
      const nearestInteger = Math.round(ratio);
      expect(Math.abs(ratio - nearestInteger)).toBeGreaterThan(0.03);
    }
  });
});

describe('INHARMONIC_PARTIAL_GAINS', () => {
  it("is exactly 1.0 : 0.38 : 0.14, the brief's own numbers", () => {
    expect(INHARMONIC_PARTIAL_GAINS).toEqual([1.0, 0.38, 0.14]);
  });

  it('each partial strictly quieter than the fundamental, and than the partial below it', () => {
    for (let i = 1; i < INHARMONIC_PARTIAL_GAINS.length; i++) {
      expect(INHARMONIC_PARTIAL_GAINS[i]).toBeGreaterThan(0);
      expect(INHARMONIC_PARTIAL_GAINS[i]).toBeLessThan(
        INHARMONIC_PARTIAL_GAINS[i - 1],
      );
    }
  });
});

describe('LAND_PARTIAL_DECAYS_S -- higher partials decay faster', () => {
  it("is exactly 260ms : 120ms : 55ms, the brief's own numbers", () => {
    expect(LAND_PARTIAL_DECAYS_S).toEqual([0.26, 0.12, 0.055]);
  });

  it('is strictly DECREASING as the partial ratio rises -- real materials lose their high modes first', () => {
    // The core physical claim this file makes: faking a flat decay across
    // partials (every mode ringing equally long) is exactly what makes a
    // synth read as cheap regardless of which ratios it uses -- see the
    // module doc comment. Checked index-for-index against
    // INHARMONIC_PARTIAL_RATIOS, which is already pinned ascending above.
    for (let i = 1; i < LAND_PARTIAL_DECAYS_S.length; i++) {
      expect(LAND_PARTIAL_DECAYS_S[i]).toBeLessThan(
        LAND_PARTIAL_DECAYS_S[i - 1],
      );
    }
  });
});

describe('INHARMONIC_RELATIVE_DECAYS', () => {
  it('is LAND_PARTIAL_DECAYS_S normalised to its own first (longest) entry', () => {
    expect(INHARMONIC_RELATIVE_DECAYS[0]).toBe(1);
    for (let i = 0; i < LAND_PARTIAL_DECAYS_S.length; i++) {
      expect(INHARMONIC_RELATIVE_DECAYS[i]).toBeCloseTo(
        LAND_PARTIAL_DECAYS_S[i] / LAND_PARTIAL_DECAYS_S[0],
        10,
      );
    }
  });

  it('preserves "higher partials decay faster" in relative form too', () => {
    for (let i = 1; i < INHARMONIC_RELATIVE_DECAYS.length; i++) {
      expect(INHARMONIC_RELATIVE_DECAYS[i]).toBeLessThan(
        INHARMONIC_RELATIVE_DECAYS[i - 1],
      );
    }
  });
});

describe('duration ceilings -- the transient+body fits the fast step, the release deliberately does not', () => {
  it("LAND_RELEASE_S is exactly the fundamental's own decay time from the brief", () => {
    expect(LAND_RELEASE_S).toBe(0.26);
  });

  it('LAND_TRANSIENT_PLUS_BODY_S is exactly transient duration + attack + body decay', () => {
    expect(LAND_TRANSIENT_PLUS_BODY_S).toBe(
      LAND_TRANSIENT.durationS + VOICE_ATTACK_S + VOICE_BODY_DECAY_S,
    );
  });

  it('the transient+body -- the part carrying onset information -- fits inside the fast step, with real margin', () => {
    expect(LAND_TRANSIENT_PLUS_BODY_S).toBeLessThan(FAST_STEP_S);
    const marginS = FAST_STEP_S - LAND_TRANSIENT_PLUS_BODY_S;
    expect(marginS / FAST_STEP_S).toBeGreaterThanOrEqual(0.2);
  });

  it('the full release is DELIBERATELY longer than the fast step -- the tail is meant to ring past it, pinned so nobody quietly shrinks it back', () => {
    expect(LAND_RELEASE_S).toBeGreaterThan(FAST_STEP_S);
    expect(DONE_RELEASE_S).toBeGreaterThan(FAST_STEP_S);
  });

  it("done's release is longer than land's -- an arrival, not a snap-off", () => {
    expect(DONE_RELEASE_S).toBeGreaterThan(LAND_RELEASE_S);
  });
});

describe('the pitch-drop envelope (shared by every partial)', () => {
  it("is exactly ~7% over 60ms, the brief's own numbers", () => {
    expect(PITCH_DROP_FRACTION).toBe(0.07);
    expect(PITCH_GLIDE_S).toBe(0.06);
  });

  it("the glide finishes within the voice's own overall release, not past it", () => {
    // Not compared against the SHORTEST partial's own decay (55ms, shorter
    // than the 60ms glide): that partial has already reached the floor
    // gain by the time it stops decaying, so its pitch continuing to move
    // for a few more milliseconds is inaudible. What actually matters is
    // that the glide completes within the voice's own lifetime.
    expect(PITCH_GLIDE_S).toBeLessThan(LAND_RELEASE_S);
  });
});

describe('the voice body envelope (the merge-point "voice gain (ADSR)")', () => {
  it('has a positive, finite attack and decay, and a sustain level strictly between 0 and 1', () => {
    expect(VOICE_ATTACK_S).toBeGreaterThan(0);
    expect(VOICE_BODY_DECAY_S).toBeGreaterThan(0);
    expect(VOICE_BODY_SUSTAIN_LEVEL).toBeGreaterThan(0);
    expect(VOICE_BODY_SUSTAIN_LEVEL).toBeLessThan(1);
  });
});

describe('LAND_TRANSIENT', () => {
  it('matches the brief exactly: 4ms, ~2.2x the fundamental, Q=6, gain 0.35', () => {
    expect(LAND_TRANSIENT).toEqual({
      durationS: 0.004,
      filterRatio: 2.2,
      q: 6,
      gain: 0.35,
    });
  });
});

describe('VOICE_SUB', () => {
  it('matches the brief exactly: 0.5x dropping to 0.38x over 70ms, gain 0.30', () => {
    expect(VOICE_SUB).toEqual({
      startRatio: 0.5,
      endRatio: 0.38,
      durationS: 0.07,
      gain: 0.3,
    });
  });

  it("the sub's own pitch descends -- endRatio below startRatio", () => {
    expect(VOICE_SUB.endRatio).toBeLessThan(VOICE_SUB.startRatio);
  });
});

describe('MICRO_VARIATION_MAX', () => {
  it("is exactly ±12 cents / ±6% gain, the brief's own numbers", () => {
    expect(MICRO_VARIATION_MAX).toEqual({
      detuneCents: 12,
      gainFraction: 0.06,
    });
  });
});

describe('microVariation', () => {
  it("rng() === 0.5 (the PRNG range's own midpoint) is the identity -- no variation at all", () => {
    const v = microVariation(constRng(0.5));
    expect(v.detuneCents).toBe(0);
    expect(v.gainMultiplier).toBe(1);
  });

  it('rng() === 0 gives the minimum: -12 cents, x0.94 gain', () => {
    const v = microVariation(constRng(0));
    expect(v.detuneCents).toBe(-MICRO_VARIATION_MAX.detuneCents);
    expect(v.gainMultiplier).toBeCloseTo(
      1 - MICRO_VARIATION_MAX.gainFraction,
      10,
    );
  });

  it('rng() === 1 gives the maximum: +12 cents, x1.06 gain', () => {
    const v = microVariation(constRng(1));
    expect(v.detuneCents).toBe(MICRO_VARIATION_MAX.detuneCents);
    expect(v.gainMultiplier).toBeCloseTo(
      1 + MICRO_VARIATION_MAX.gainFraction,
      10,
    );
  });

  it('stays within bounds across the whole rng domain', () => {
    for (let r = 0; r <= 1; r += 0.05) {
      const v = microVariation(constRng(r));
      expect(v.detuneCents).toBeGreaterThanOrEqual(
        -MICRO_VARIATION_MAX.detuneCents - 1e-9,
      );
      expect(v.detuneCents).toBeLessThanOrEqual(
        MICRO_VARIATION_MAX.detuneCents + 1e-9,
      );
      expect(v.gainMultiplier).toBeGreaterThanOrEqual(
        1 - MICRO_VARIATION_MAX.gainFraction - 1e-9,
      );
      expect(v.gainMultiplier).toBeLessThanOrEqual(
        1 + MICRO_VARIATION_MAX.gainFraction + 1e-9,
      );
    }
  });
});

describe('createPrng (the seeded PRNG, not Math.random)', () => {
  it('is deterministic for a given seed -- two fresh instances draw the same sequence', () => {
    const a = createPrng(42);
    const b = createPrng(42);
    const drawsA = Array.from({ length: 10 }, () => a());
    const drawsB = Array.from({ length: 10 }, () => b());
    expect(drawsA).toEqual(drawsB);
  });

  it('produces different values across successive calls on the same instance', () => {
    const rng = createPrng(7);
    const draws = Array.from({ length: 5 }, () => rng());
    const distinct = new Set(draws);
    expect(distinct.size).toBeGreaterThan(1);
  });

  it('produces a different sequence for a different seed', () => {
    const a = createPrng(1);
    const b = createPrng(2);
    expect(a()).not.toBe(b());
  });

  it('every draw stays within [0, 1)', () => {
    const rng = createPrng(123);
    for (let i = 0; i < 200; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('buildVoicePlan / landVoicePlan / doneVoicePlans -- the struck-voice architecture', () => {
  const midRng = () => constRng(0.5); // the identity micro-variation, for exact derivation checks

  it('has exactly 3 partials, at the inharmonic ratios, above the (possibly detuned) fundamental', () => {
    const plan = landVoicePlan(0, midRng());
    expect(plan.partials.length).toBe(3);
    plan.partials.forEach((p, i) => {
      expect(p.freqStartHz / plan.fundamentalHz).toBeCloseTo(
        INHARMONIC_PARTIAL_RATIOS[i],
        6,
      );
    });
  });

  it("every partial's pitch envelope DESCENDS -- end strictly below start", () => {
    for (const plan of [
      landVoicePlan(0, midRng()),
      landVoicePlan(3, midRng()),
    ]) {
      for (const partial of plan.partials) {
        expect(partial.freqEndHz).toBeLessThan(partial.freqStartHz);
      }
    }
  });

  it("the sub's pitch envelope also DESCENDS, for every voice", () => {
    const landPlan = landVoicePlan(1, midRng());
    expect(landPlan.sub.freqEndHz).toBeLessThan(landPlan.sub.freqStartHz);
    for (const donePlan of doneVoicePlans(midRng())) {
      expect(donePlan.sub.freqEndHz).toBeLessThan(donePlan.sub.freqStartHz);
    }
  });

  it('preserves "higher partials decay faster" in the RESOLVED plan, not just the raw constants', () => {
    const plan = landVoicePlan(2, midRng());
    for (let i = 1; i < plan.partials.length; i++) {
      expect(plan.partials[i].envelope.releaseS).toBeLessThan(
        plan.partials[i - 1].envelope.releaseS,
      );
    }
  });

  it("the transient's filter tracks the (detuned) fundamental at the brief's own ratio", () => {
    const plan = landVoicePlan(0, midRng());
    expect(plan.transient.filterCenterHz).toBeCloseTo(
      plan.fundamentalHz * LAND_TRANSIENT.filterRatio,
      6,
    );
    expect(plan.transient.q).toBe(LAND_TRANSIENT.q);
  });

  it('landVoicePlan carries landPan/LAND_REVERB_SEND; doneVoicePlans carries pan 0/DONE_REVERB_SEND', () => {
    const land = landVoicePlan(2, midRng());
    expect(land.pan).toBe(landPan(2));
    expect(land.reverbSend).toBe(LAND_REVERB_SEND);

    for (const done of doneVoicePlans(midRng())) {
      expect(done.pan).toBe(0);
      expect(done.reverbSend).toBe(DONE_REVERB_SEND);
    }
  });

  it("done's notes reuse land's own architecture, scaled to done's own (longer) release", () => {
    const land = landVoicePlan(0, midRng());
    const done = doneVoicePlans(midRng())[0];
    expect(land.bodyEnvelope.releaseS).toBe(LAND_RELEASE_S);
    expect(done.bodyEnvelope.releaseS).toBe(DONE_RELEASE_S);
    // Same SHAPE (each partial's release as a fraction of the voice's own
    // overall release), scaled by a different overall release.
    for (let i = 0; i < land.partials.length; i++) {
      expect(land.partials[i].envelope.releaseS / LAND_RELEASE_S).toBeCloseTo(
        done.partials[i].envelope.releaseS / DONE_RELEASE_S,
        9,
      );
    }
  });

  it('with the identity micro-variation (rng()===0.5), the fundamental is exactly the input frequency and bodyPeakGain is exactly peakGain', () => {
    const plan = buildVoicePlan({
      fundamentalHz: 440,
      peakGain: 0.5,
      overallReleaseS: 0.26,
      pan: 0.1,
      reverbSend: 0.18,
      rng: constRng(0.5),
    });
    expect(plan.fundamentalHz).toBe(440);
    expect(plan.bodyPeakGain).toBe(0.5);
  });

  it("bodyPeakGain stays within LAND_PEAK_GAIN's own micro-variation bounds", () => {
    const lo = landVoicePlan(0, constRng(0)).bodyPeakGain;
    const hi = landVoicePlan(0, constRng(1)).bodyPeakGain;
    expect(lo).toBeCloseTo(
      LAND_PEAK_GAIN * (1 - MICRO_VARIATION_MAX.gainFraction),
      10,
    );
    expect(hi).toBeCloseTo(
      LAND_PEAK_GAIN * (1 + MICRO_VARIATION_MAX.gainFraction),
      10,
    );
  });

  // DONE_PEAK_GAIN had no assertion at all: it was imported beside
  // LAND_PEAK_GAIN and never used, so the chime's level was free to drift to
  // any value while every test stayed green. Same shape as the LAND bounds
  // above, over every voice in the chord rather than one.
  it("every done voice's bodyPeakGain stays within DONE_PEAK_GAIN's bounds", () => {
    const lo = doneVoicePlans(constRng(0));
    const hi = doneVoicePlans(constRng(1));
    // Liveness, and CONTENT rather than entry count: an empty chord asserts
    // nothing, and so does a chord of voices carrying no gain.
    expect(lo).toHaveLength(DONE_CHORD_SEMITONES.length);
    expect(lo.length).toBeGreaterThan(1);
    expect(hi).toHaveLength(lo.length);
    for (const plan of lo)
      expect(plan.bodyPeakGain).toBeCloseTo(
        DONE_PEAK_GAIN * (1 - MICRO_VARIATION_MAX.gainFraction),
        10,
      );
    for (const plan of hi)
      expect(plan.bodyPeakGain).toBeCloseTo(
        DONE_PEAK_GAIN * (1 + MICRO_VARIATION_MAX.gainFraction),
        10,
      );
  });

  it('is deterministic: two calls fed fresh, identically-seeded PRNGs produce an identical plan', () => {
    const planA = landVoicePlan(4, createPrng(99));
    const planB = landVoicePlan(4, createPrng(99));
    expect(planA).toEqual(planB);
  });

  it('repeated triggers are NOT bit-identical -- successive draws from one ongoing PRNG stream vary the fundamental', () => {
    const rng = createPrng(2026);
    const first = landVoicePlan(0, rng);
    const second = landVoicePlan(0, rng);
    expect(first.fundamentalHz).not.toBe(second.fundamentalHz);
  });
});

describe('DONE_CHORD_SEMITONES / doneFrequencies -- a sus2/add9 cluster, not a plain triad', () => {
  it('is exactly D, E, A, D-an-octave-up: [0, 2, 7, 12]', () => {
    expect(DONE_CHORD_SEMITONES).toEqual([0, 2, 7, 12]);
  });

  it('is strictly ascending', () => {
    for (let i = 1; i < DONE_CHORD_SEMITONES.length; i++) {
      expect(DONE_CHORD_SEMITONES[i]).toBeGreaterThan(
        DONE_CHORD_SEMITONES[i - 1],
      );
    }
  });

  it("shares its root and its fifth with land's own scale -- the same tonal family", () => {
    expect(DONE_CHORD_SEMITONES).toContain(LAND_SCALE_SEMITONES[0]); // root, D
    expect(DONE_CHORD_SEMITONES).toContain(LAND_SCALE_SEMITONES[3]); // fifth, A
  });

  it("its 2nd/9th (E) is the one note NOT in land's own pentatonic scale -- the new colour that marks the arrival", () => {
    expect(LAND_SCALE_SEMITONES).not.toContain(2);
  });

  it('doneFrequencies returns one frequency per chord degree, rooted on the shared tonic, ascending, in the audible band', () => {
    const freqs = doneFrequencies();
    expect(freqs.length).toBe(DONE_CHORD_SEMITONES.length);
    expect(freqs[0]).toBe(TONIC_HZ);
    for (let i = 1; i < freqs.length; i++)
      expect(freqs[i]).toBeGreaterThan(freqs[i - 1]);
    for (const hz of freqs) {
      expect(hz).toBeGreaterThanOrEqual(AUDIBLE_BAND_HZ.min);
      expect(hz).toBeLessThanOrEqual(AUDIBLE_BAND_HZ.max);
    }
  });
});

describe("done()'s stagger", () => {
  it("is exactly 0 / 35 / 70 / 110ms, the brief's own numbers", () => {
    expect(DONE_STAGGER_S).toEqual([0, 0.035, 0.07, 0.11]);
  });

  it('has exactly one offset per chord note', () => {
    expect(DONE_STAGGER_S.length).toBe(DONE_CHORD_SEMITONES.length);
  });

  it("starts at the effect's own onset and is strictly ascending", () => {
    expect(DONE_STAGGER_S[0]).toBe(0);
    for (let i = 1; i < DONE_STAGGER_S.length; i++) {
      expect(DONE_STAGGER_S[i]).toBeGreaterThan(DONE_STAGGER_S[i - 1]);
    }
  });
});

describe('DONE_RISER', () => {
  it("is a 120ms sweep, matching the brief's own duration", () => {
    expect(DONE_RISER.durationS).toBe(0.12);
  });

  it('sweeps UP -- endHz strictly above startHz', () => {
    expect(DONE_RISER.endHz).toBeGreaterThan(DONE_RISER.startHz);
  });

  it('every field is positive and finite', () => {
    for (const v of Object.values(DONE_RISER)) {
      expect(v).toBeGreaterThan(0);
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

// The three reverb sends below are pinned to the brief's numbers. The three
// PEAK GAINS were not pinned to anything -- and the relationship assertions
// elsewhere in this file cannot do it, because they compare a plan's gain
// against the same constant the plan was built from. Move the constant and
// both sides move together, so those guards pass at any level. Mutation
// proved it: 0.12 -> 0.13 turned nothing red until this test existed.
describe('peak gains -- the levels themselves, not their shaping', () => {
  it("matches the brief's own numbers exactly: 0.14 / 0.12 / 0.055", () => {
    expect(LAND_PEAK_GAIN).toBe(0.14);
    expect(DONE_PEAK_GAIN).toBe(0.12);
    expect(SHUFFLE_GRAIN_PEAK_GAIN).toBe(0.055);
  });
});

describe('reverb send ordering -- "the longest tail of the three" is done, by construction', () => {
  it('DONE_REVERB_SEND > LAND_REVERB_SEND > SHUFFLE_REVERB_SEND', () => {
    expect(DONE_REVERB_SEND).toBeGreaterThan(LAND_REVERB_SEND);
    expect(LAND_REVERB_SEND).toBeGreaterThan(SHUFFLE_REVERB_SEND);
  });

  it("matches the brief's own numbers exactly: 0.28 / 0.18 / 0.12", () => {
    expect(DONE_REVERB_SEND).toBe(0.28);
    expect(LAND_REVERB_SEND).toBe(0.18);
    expect(SHUFFLE_REVERB_SEND).toBe(0.12);
  });
});

describe('SHUFFLE_DURATION_S / SHUFFLE_GRAIN_BOUNDS', () => {
  it("the effect runs ~260ms, the brief's own duration", () => {
    expect(SHUFFLE_DURATION_S).toBe(0.26);
  });

  it("matches the brief's own bounds exactly: 16-22 grains, 6-14ms, 900-4200Hz, pan ±0.6", () => {
    expect(SHUFFLE_GRAIN_BOUNDS).toEqual({
      countMin: 16,
      countMax: 22,
      durationMinS: 0.006,
      durationMaxS: 0.014,
      filterMinHz: 900,
      filterMaxHz: 4200,
      panRange: 0.6,
      q: 4,
    });
  });
});

describe('shuffleGrainPlans -- a granular riffle, not a swoosh', () => {
  // SHUFFLE_GRAIN_PEAK_GAIN had no assertion at all -- imported and never
  // used -- so the riffle's level was free to drift while every test stayed
  // green. It is a CEILING, not a flat level: each grain is scaled by
  // `0.15 + 0.85 * sin(PI * onset / duration)`, an arch that opens at 15% of
  // the constant, reaches it mid-gesture and falls back. Both ends are
  // asserted, because a guard on the peak alone would pass an envelope that
  // never rose, and one on the floor alone would pass an envelope stuck open.
  it('scales every grain by an arch that touches SHUFFLE_GRAIN_PEAK_GAIN once', () => {
    const gains = shuffleGrainPlans(constRng(0)).map((g) => g.peakGain);
    // countMin is 16, so grain 8 sits exactly at sin(PI/2) -- the ceiling is
    // hit exactly here rather than approached, which is why this is an
    // equality and not a bound.
    expect(gains).toHaveLength(SHUFFLE_GRAIN_BOUNDS.countMin);
    expect(Math.max(...gains)).toBeCloseTo(SHUFFLE_GRAIN_PEAK_GAIN, 10);
    expect(gains[0]).toBeCloseTo(0.15 * SHUFFLE_GRAIN_PEAK_GAIN, 10);
    // CONTENT, not entry count: a run of zero-gain grains is still a full
    // array, and silence is what a broken envelope sounds like.
    for (const gain of gains) {
      expect(gain).toBeGreaterThan(0);
      expect(gain).toBeLessThanOrEqual(SHUFFLE_GRAIN_PEAK_GAIN + 1e-12);
    }
  });

  it('holds that ceiling at the maximum grain count too', () => {
    // seqRng is what this builder's rng contract asks for -- the first draw
    // picks the count, the rest shape each grain -- and the helper was
    // written for exactly that and then never called.
    const gains = shuffleGrainPlans(seqRng([0.999999, 0])).map(
      (g) => g.peakGain,
    );
    expect(gains).toHaveLength(SHUFFLE_GRAIN_BOUNDS.countMax);
    expect(Math.max(...gains)).toBeCloseTo(SHUFFLE_GRAIN_PEAK_GAIN, 10);
    for (const gain of gains)
      expect(gain).toBeLessThanOrEqual(SHUFFLE_GRAIN_PEAK_GAIN + 1e-12);
  });

  it('emits exactly countMin grains when every draw is 0, and exactly countMax when every draw is just under 1', () => {
    expect(shuffleGrainPlans(constRng(0)).length).toBe(
      SHUFFLE_GRAIN_BOUNDS.countMin,
    );
    expect(shuffleGrainPlans(constRng(0.999999)).length).toBe(
      SHUFFLE_GRAIN_BOUNDS.countMax,
    );
  });

  it("every grain's own duration, filter centre and pan stay within the brief's bounds", () => {
    const grains = shuffleGrainPlans(createPrng(11));
    expect(grains.length).toBeGreaterThanOrEqual(SHUFFLE_GRAIN_BOUNDS.countMin);
    expect(grains.length).toBeLessThanOrEqual(SHUFFLE_GRAIN_BOUNDS.countMax);
    for (const g of grains) {
      const durationS = envelopeTotalS(g.envelope);
      expect(durationS).toBeGreaterThanOrEqual(
        SHUFFLE_GRAIN_BOUNDS.durationMinS - 1e-9,
      );
      expect(durationS).toBeLessThanOrEqual(
        SHUFFLE_GRAIN_BOUNDS.durationMaxS + 1e-9,
      );
      expect(g.filterCenterHz).toBeGreaterThanOrEqual(
        SHUFFLE_GRAIN_BOUNDS.filterMinHz,
      );
      expect(g.filterCenterHz).toBeLessThanOrEqual(
        SHUFFLE_GRAIN_BOUNDS.filterMaxHz,
      );
      expect(g.pan).toBeGreaterThanOrEqual(
        -SHUFFLE_GRAIN_BOUNDS.panRange - 1e-9,
      );
      expect(g.pan).toBeLessThanOrEqual(SHUFFLE_GRAIN_BOUNDS.panRange + 1e-9);
      expect(g.pan).toBeGreaterThanOrEqual(-1);
      expect(g.pan).toBeLessThanOrEqual(1);
    }
  });

  it('amplitude follows a soft arch -- quiet at both ends, loud in the middle', () => {
    // The arch depends only on each grain's own (evenly-spaced) position,
    // not on the rng draws, so this is exact regardless of seed.
    const grains = shuffleGrainPlans(createPrng(3));
    const first = grains[0];
    const middle = grains[Math.floor(grains.length / 2)];
    const last = grains[grains.length - 1];
    expect(first.peakGain).toBeLessThan(middle.peakGain);
    expect(last.peakGain).toBeLessThan(middle.peakGain);
  });

  it('is deterministic for a given seed', () => {
    expect(shuffleGrainPlans(createPrng(55))).toEqual(
      shuffleGrainPlans(createPrng(55)),
    );
  });

  it('repeated triggers are not bit-identical -- successive calls on one stream differ', () => {
    const rng = createPrng(2026);
    const a = shuffleGrainPlans(rng);
    const b = shuffleGrainPlans(rng);
    expect(a).not.toEqual(b);
  });
});

describe('SHUFFLE_SUB (the onset thump)', () => {
  it('matches its own stated shape and descends in pitch', () => {
    expect(SHUFFLE_SUB).toEqual({
      startHz: 110,
      endHz: 70,
      durationS: 0.08,
      gain: 0.28,
    });
    expect(SHUFFLE_SUB.endHz).toBeLessThan(SHUFFLE_SUB.startHz);
  });
});

describe('MAX_POLYPHONY / admitVoice -- the polyphony cap', () => {
  it("is 8, the brief's own number", () => {
    expect(MAX_POLYPHONY).toBe(8);
  });

  it('admits up to the cap without stealing anything', () => {
    let pool: number[] = [];
    for (let i = 0; i < MAX_POLYPHONY; i++) {
      const { activeVoices, stolen } = admitVoice(pool, i);
      expect(stolen).toBeNull();
      pool = activeVoices;
    }
    expect(pool.length).toBe(MAX_POLYPHONY);
    expect(pool).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('steals the OLDEST voice, not the newest, once the cap is exceeded', () => {
    let pool: number[] = [];
    for (let i = 0; i < MAX_POLYPHONY; i++)
      pool = admitVoice(pool, i).activeVoices;
    const { activeVoices, stolen } = admitVoice(pool, 8);
    expect(stolen).toBe(0);
    expect(activeVoices).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(activeVoices.length).toBe(MAX_POLYPHONY);
  });

  it('keeps stealing in strict FIFO order across many admits past the cap', () => {
    let pool: number[] = [];
    const stolenLog: (number | null)[] = [];
    for (let i = 0; i < 12; i++) {
      const { activeVoices, stolen } = admitVoice(pool, i);
      pool = activeVoices;
      stolenLog.push(stolen);
    }
    expect(stolenLog).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      0,
      1,
      2,
      3,
    ]);
  });

  it('honours a custom cap, for callers that need a smaller pool', () => {
    let pool: string[] = [];
    let stolen: string | null = null;
    for (const v of ['a', 'b', 'c'])
      ({ activeVoices: pool, stolen } = admitVoice(pool, v, 2));
    expect(pool).toEqual(['b', 'c']);
    expect(stolen).toBe('a');
  });
});

describe('the soft saturator curve (WaveShaper, tanh)', () => {
  it('SATURATOR_CURVE_SAMPLES is odd, so the curve has an exact centre sample', () => {
    expect(SATURATOR_CURVE_SAMPLES % 2).toBe(1);
  });

  it('has the requested length, every value finite', () => {
    const curve = generateSaturatorCurve(101);
    expect(curve.length).toBe(101);
    for (const v of curve) expect(Number.isFinite(v)).toBe(true);
  });

  it('is strictly increasing -- tanh never folds back on itself, so the curve never adds spurious harmonics', () => {
    const curve = generateSaturatorCurve();
    for (let i = 1; i < curve.length; i++)
      expect(curve[i]).toBeGreaterThan(curve[i - 1]);
  });

  it('maps -1 -> -1 and +1 -> +1 (unity at full scale) and 0 -> 0 (odd symmetry, no DC offset)', () => {
    const curve = generateSaturatorCurve();
    expect(curve[0]).toBeCloseTo(-1, 9);
    expect(curve[curve.length - 1]).toBeCloseTo(1, 9);
    expect(curve[(curve.length - 1) / 2]).toBeCloseTo(0, 9);
  });

  it('is odd-symmetric: curve(-x) === -curve(x) for every sample pair', () => {
    const curve = generateSaturatorCurve();
    for (let i = 0; i < curve.length; i++) {
      expect(curve[i]).toBeCloseTo(-curve[curve.length - 1 - i], 9);
    }
  });

  it('SATURATOR_DRIVE is positive and finite', () => {
    expect(SATURATOR_DRIVE).toBeGreaterThan(0);
    expect(Number.isFinite(SATURATOR_DRIVE)).toBe(true);
  });
});

describe("reverbEnvelopeGain (the IR's own exponential decay curve)", () => {
  it('starts at exactly 1 (no gain applied at t=0)', () => {
    expect(reverbEnvelopeGain(0)).toBe(1);
  });

  it('is strictly decreasing for increasing t -- monotonic decay, by construction', () => {
    const samples = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
    for (let i = 1; i < samples.length; i++) {
      expect(reverbEnvelopeGain(samples[i])).toBeLessThan(
        reverbEnvelopeGain(samples[i - 1]),
      );
    }
  });

  it('reaches near-silence by REVERB_DURATION_S -- comfortably below 1% of its own peak', () => {
    expect(reverbEnvelopeGain(REVERB_DURATION_S)).toBeLessThan(0.01);
  });

  it('never reaches exactly zero (an exponential only approaches it)', () => {
    expect(reverbEnvelopeGain(REVERB_DURATION_S)).toBeGreaterThan(0);
  });
});

describe('generateReverbImpulseResponse (the synthesised reverb tail -- no audio asset)', () => {
  it('is REVERB_DURATION_S long at the given sample rate', () => {
    const ir = generateReverbImpulseResponse(44100, createPrng(1));
    expect(ir.left.length).toBe(Math.round(44100 * REVERB_DURATION_S));
    expect(ir.right.length).toBe(ir.left.length);
  });

  it('is finite everywhere in both channels -- no NaN, no Infinity', () => {
    // One verdict per channel, not one `expect` per sample: 14,400 calls cost
    // 63-136 ms of own CPU, over the 0.1 s rule (#714). 8000 Hz for 0.9 s is
    // 7200 samples a channel, held as a literal so an empty buffer cannot pass.
    const ir = generateReverbImpulseResponse(8000, createPrng(2));
    const finite = (channel: Float64Array) =>
      channel.filter(Number.isFinite).length;
    expect({
      left: [ir.left.length, finite(ir.left)],
      right: [ir.right.length, finite(ir.right)],
    }).toEqual({ left: [7200, 7200], right: [7200, 7200] });
  });

  it("decays to near-silence -- the last tenth of the buffer's own peak is far below the first tenth's", () => {
    // A meaningful, non-flaky operationalisation of "decays monotonically
    // to near-silence": individual noise SAMPLES cannot be monotonic (that
    // is what makes it noise), so this compares coarse windows instead,
    // with a wide margin, rather than asserting sample-to-sample
    // monotonicity (see reverbEnvelopeGain's own test above for the exact,
    // analytic version of the monotonicity claim).
    const ir = generateReverbImpulseResponse(8000, createPrng(3));
    const windowLen = Math.floor(ir.left.length / 10);
    const peakOf = (channel: Float64Array, from: number, to: number) => {
      let peak = 0;
      for (let i = from; i < to; i++)
        peak = Math.max(peak, Math.abs(channel[i]));
      return peak;
    };
    const firstWindowPeak = Math.max(
      peakOf(ir.left, 0, windowLen),
      peakOf(ir.right, 0, windowLen),
    );
    const lastWindowPeak = Math.max(
      peakOf(ir.left, ir.left.length - windowLen, ir.left.length),
      peakOf(ir.right, ir.right.length - windowLen, ir.right.length),
    );
    expect(lastWindowPeak).toBeLessThan(firstWindowPeak * 0.05);
  });

  it('is peak-normalised to REVERB_NORMALIZE_PEAK, mathematically, not by ear', () => {
    const ir = generateReverbImpulseResponse(8000, createPrng(4));
    let peak = 0;
    for (const channel of [ir.left, ir.right]) {
      for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
    }
    expect(peak).toBeCloseTo(REVERB_NORMALIZE_PEAK, 6);
  });

  it('the two channels are decorrelated -- not sample-for-sample identical', () => {
    const ir = generateReverbImpulseResponse(8000, createPrng(5));
    const identical = ir.left.every((v, i) => v === ir.right[i]);
    expect(identical).toBe(false);
  });

  it('is deterministic for a given seed', () => {
    const a = generateReverbImpulseResponse(4000, createPrng(77));
    const b = generateReverbImpulseResponse(4000, createPrng(77));
    expect(Array.from(a.left)).toEqual(Array.from(b.left));
    expect(Array.from(a.right)).toEqual(Array.from(b.right));
  });
});

describe('the master bus', () => {
  it('MASTER_GAIN trims, it does not amplify', () => {
    expect(MASTER_GAIN).toBeGreaterThan(0);
    expect(MASTER_GAIN).toBeLessThanOrEqual(1);
  });

  it('MASTER_HIGHPASS_HZ sits strictly below MASTER_LOWPASS_HZ, leaving a real passband', () => {
    expect(MASTER_HIGHPASS_HZ).toBeGreaterThan(0);
    expect(MASTER_LOWPASS_HZ).toBeGreaterThan(MASTER_HIGHPASS_HZ);
  });

  it('MASTER_LOWPASS_HZ never eats a real note or a shuffle grain -- it sits above every fundamental and every grain centre this file produces', () => {
    const sampledLandHz = [0, 1, 5, 9, 12, 40, 500].map(landFrequency);
    const highest = Math.max(
      ...sampledLandHz,
      ...doneFrequencies(),
      SHUFFLE_GRAIN_BOUNDS.filterMaxHz,
    );
    expect(MASTER_LOWPASS_HZ).toBeGreaterThan(highest);
  });

  it('MASTER_COMPRESSOR has a real (>=1) ratio and positive, finite timing', () => {
    expect(MASTER_COMPRESSOR.ratio).toBeGreaterThanOrEqual(1);
    expect(MASTER_COMPRESSOR.attackS).toBeGreaterThan(0);
    expect(MASTER_COMPRESSOR.releaseS).toBeGreaterThan(0);
    expect(Number.isFinite(MASTER_COMPRESSOR.thresholdDb)).toBe(true);
    expect(MASTER_COMPRESSOR.kneeDb).toBeGreaterThanOrEqual(0);
  });

  it('the reverb return sits below unity, so overlapping tails cannot drown the hits', () => {
    // Measured, not preferred. At unity return, a ~0.9s tail retriggered every
    // NORMAL_STEP_S (110ms) never decays between landings: a capture of the real
    // page's master output showed 766 clipped samples across 503 separate runs
    // and a crest factor of 10.1dB, i.e. a continuous wash rather than discrete
    // strikes. Below unity, the same capture came back at 0 clipped samples and
    // 18.6dB. This asserts the property that produced that difference; asserting
    // the literal value instead is what let the wash ship in the first place.
    expect(REVERB_RETURN_GAIN).toBeGreaterThan(0);
    expect(REVERB_RETURN_GAIN).toBeLessThan(1);

    // A tail must have faded well below the next strike by the time it lands,
    // or the "discrete objects in motion" cue collapses into one texture.
    const tailsPerStep = REVERB_DURATION_S / NORMAL_STEP_S;
    expect(REVERB_RETURN_GAIN * tailsPerStep).toBeLessThan(MAX_POLYPHONY);
  });
});

describe('REVERB_LOWPASS_HZ / REVERB_NORMALIZE_PEAK / REVERB_DECAY_TIME_CONSTANT_S', () => {
  it("the reverb tail is darkened well below the master bus's own lowpass", () => {
    expect(REVERB_LOWPASS_HZ).toBeGreaterThan(0);
    expect(REVERB_LOWPASS_HZ).toBeLessThan(MASTER_LOWPASS_HZ);
  });

  it('REVERB_NORMALIZE_PEAK leaves headroom under full scale', () => {
    expect(REVERB_NORMALIZE_PEAK).toBeGreaterThan(0);
    expect(REVERB_NORMALIZE_PEAK).toBeLessThan(1);
  });

  it('REVERB_DECAY_TIME_CONSTANT_S is exactly REVERB_DURATION_S / 5', () => {
    expect(REVERB_DECAY_TIME_CONSTANT_S).toBe(REVERB_DURATION_S / 5);
  });
});

// A VoicePlan type-check -- exercised implicitly above, referenced here so
// a future edit that narrows the type cannot silently drop a field no
// runtime test happens to read.
const _typeCheck: (plan: VoicePlan) => number = (plan) => plan.partials.length;
void _typeCheck;

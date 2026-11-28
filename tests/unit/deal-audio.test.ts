import { describe, it, expect } from 'vitest';
import { createDealAudio } from '../../src/scripts/deal-audio';
import { endingPlan, nearestNote, dealStepMidi } from '../../src/lib/dealSound';
import { createPrng } from '../../src/lib/sfx';

/** A stand-in for Web Audio that records what is asked of it: every node
 *  made, every parameter change and every start and stop. */
class FakeParam {
  value = 1;
  readonly calls: [string, number, number?][] = [];
  setValueAtTime(v: number, t: number): this {
    this.calls.push(['set', v, t]);
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number, t: number): this {
    this.calls.push(['linear', v, t]);
    this.value = v;
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number): this {
    this.calls.push(['exponential', v, t]);
    this.value = v;
    return this;
  }
  cancelScheduledValues(t: number): this {
    this.calls.push(['cancel', t]);
    return this;
  }
}

class FakeNode {
  readonly outputs: FakeNode[] = [];
  constructor(readonly kind: string) {}
  connect<T extends FakeNode>(target: T): T {
    this.outputs.push(target);
    return target;
  }
  disconnect(): void {}
}

class FakeSource extends FakeNode {
  buffer: { name: string } | null = null;
  readonly playbackRate = new FakeParam();
  readonly frequency = new FakeParam();
  readonly detune = new FakeParam();
  type = 'sine';
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  onended: (() => void) | null = null;
  start(t = 0): void {
    this.startedAt = t;
  }
  stop(t = 0): void {
    this.stoppedAt = t;
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam();
}

class FakeContext {
  currentTime = 10;
  readonly destination = new FakeNode('destination');
  readonly sources: FakeSource[] = [];
  readonly gains: FakeGain[] = [];
  buffersCreated = 0;
  createBufferSource(): FakeSource {
    const node = new FakeSource('buffer');
    this.sources.push(node);
    return node;
  }
  createOscillator(): FakeSource {
    const node = new FakeSource('oscillator');
    this.sources.push(node);
    return node;
  }
  createGain(): FakeGain {
    const node = new FakeGain('gain');
    this.gains.push(node);
    return node;
  }
  createStereoPanner(): FakeNode & { pan: FakeParam } {
    return Object.assign(new FakeNode('panner'), { pan: new FakeParam() });
  }
  createBiquadFilter(): FakeNode & {
    type: string;
    frequency: FakeParam;
    Q: FakeParam;
  } {
    return Object.assign(new FakeNode('filter'), {
      type: 'lowpass',
      frequency: new FakeParam(),
      Q: new FakeParam(),
    });
  }
  createBuffer(): never {
    this.buffersCreated += 1;
    throw new Error('the deal never makes a buffer of its own');
  }
}

const setUp = (missing: (name: string) => boolean = () => false) => {
  const ctx = new FakeContext();
  const bus = new FakeNode('bus');
  const audio = createDealAudio({
    ctx: () => ctx as unknown as AudioContext,
    bus: () => bus as unknown as AudioNode,
    sample: (name) =>
      missing(name) ? null : ({ name } as unknown as AudioBuffer),
    rng: createPrng(1339),
  });
  const played = () =>
    ctx.sources.filter((s) => s.buffer).map((s) => s.buffer?.name);
  return { ctx, bus, audio, played };
};

const rate = (semitones: number) => 2 ** (semitones / 12);

describe('a student landing', () => {
  it('plays marimba, harp and glockenspiel from their nearest recordings', () => {
    const { ctx, audio } = setUp();
    audio.land(1, 16);
    const expected = (['marimba', 'harp', 'glock'] as const).map((inst) => {
      const base = { marimba: 43, harp: 55, glock: 67 }[inst];
      const { sample, semitones } = nearestNote(inst, dealStepMidi(base, 1));
      return [`${inst}-${sample}`, rate(semitones)];
    });
    expect(
      ctx.sources.map((s) => [s.buffer?.name, s.playbackRate.value]),
    ).toEqual(expected);
  });

  it('starts every note now', () => {
    const { ctx, audio } = setUp();
    audio.land(2, 16);
    expect(ctx.sources.map((s) => s.startedAt)).toEqual([10, 10, 10]);
  });

  it('adds a timpani hit on the first student', () => {
    const { audio, played } = setUp();
    audio.land(0, 16);
    expect(played()).toContain('timpani-hit');
  });

  it('adds no timpani hit on the fourth student', () => {
    const { audio, played } = setUp();
    audio.land(3, 16);
    expect(played()).not.toContain('timpani-hit');
  });

  it('plays the last student louder than the first', () => {
    const peak = (i: number) => {
      const { ctx, audio } = setUp();
      audio.land(i, 16);
      return Math.max(
        ...ctx.gains.flatMap((g) => g.gain.calls.map(([, value]) => value)),
      );
    };
    expect(peak(15)).toBeGreaterThan(peak(1));
  });

  it('sends every note to the bus it was given', () => {
    const { ctx, bus, audio } = setUp();
    audio.land(1, 16);
    const reaches = (node: FakeNode): boolean =>
      node === bus || node.outputs.some(reaches);
    expect(ctx.sources.every(reaches)).toBe(true);
  });

  it('falls back to a plain tone when a recording is not ready, never to noise', () => {
    const { ctx, audio } = setUp(() => true);
    audio.land(0, 16);
    expect(ctx.sources.length).toBeGreaterThan(0);
    expect(ctx.sources.every((s) => s.kind === 'oscillator')).toBe(true);
    expect(
      ctx.sources.every((s) => ['sine', 'triangle'].includes(s.type)),
    ).toBe(true);
    expect(ctx.buffersCreated).toBe(0);
  });
});

describe('the ending', () => {
  it('plays a recording for every recorded layer of the plan', () => {
    const { audio, played } = setUp();
    audio.done();
    const names = played();
    for (const name of [
      'timpani-roll',
      'whoosh',
      'timpani-hit',
      'impact',
      'drop',
      'bell',
      'sparkle',
    ]) {
      expect(names, name).toContain(name);
    }
  });

  it('schedules every layer at its time in the plan', () => {
    const { ctx, audio } = setUp();
    audio.done();
    const plan = endingPlan(createPrng(1));
    const starts = new Set(ctx.sources.map((s) => s.startedAt));
    for (const { at } of plan.filter((e) => e.kind !== 'confettiNote')) {
      expect([...starts], `at ${at}`).toContainEqual(
        expect.closeTo(10 + at, 3),
      );
    }
  });

  it('plays the fanfare on sawtooths and the final chord on triangles', () => {
    const { ctx, audio } = setUp();
    audio.done();
    const types = new Set(
      ctx.sources.filter((s) => s.kind === 'oscillator').map((s) => s.type),
    );
    expect([...types].sort()).toEqual(['sawtooth', 'triangle']);
  });

  it('stops every source by the end of the ring-out', () => {
    const { ctx, audio } = setUp();
    audio.done();
    for (const s of ctx.sources) {
      expect(s.stoppedAt).not.toBeNull();
      expect(s.stoppedAt ?? Infinity).toBeLessThanOrEqual(
        10 + 1.7 + 7.5 + 0.05,
      );
    }
  });

  it('makes no buffer of its own, so no noise can play', () => {
    const { ctx, audio } = setUp(() => true);
    audio.done();
    expect(ctx.buffersCreated).toBe(0);
  });
});

describe('stopping', () => {
  it('fades every live gain to silence within 0.12 s and stops every source', () => {
    const { ctx, audio } = setUp();
    audio.land(0, 4);
    audio.done();
    ctx.currentTime = 12;
    audio.stop();
    for (const g of ctx.gains) {
      const last = g.gain.calls.at(-1);
      expect(last?.[0]).toBe('linear');
      expect(last?.[1]).toBe(0);
      expect(last?.[2] ?? Infinity).toBeLessThanOrEqual(12.12);
    }
    for (const s of ctx.sources) {
      expect(s.stoppedAt ?? Infinity).toBeLessThanOrEqual(12.12);
    }
  });

  it('cancels what was scheduled before it fades', () => {
    const { ctx, audio } = setUp();
    audio.done();
    ctx.currentTime = 11;
    audio.stop();
    for (const g of ctx.gains) {
      expect(
        g.gain.calls.some(([kind, t]) => kind === 'cancel' && t === 11),
      ).toBe(true);
    }
  });

  it('leaves nothing for a second stop to touch', () => {
    const { ctx, audio } = setUp();
    audio.done();
    audio.stop();
    const counts = ctx.gains.map((g) => g.gain.calls.length);
    audio.stop();
    expect(ctx.gains.map((g) => g.gain.calls.length)).toEqual(counts);
  });

  it('forgets a source once it has ended on its own', () => {
    const { ctx, audio } = setUp();
    audio.land(1, 4);
    for (const s of ctx.sources) s.onended?.();
    const counts = ctx.gains.map((g) => g.gain.calls.length);
    audio.stop();
    expect(ctx.gains.map((g) => g.gain.calls.length)).toEqual(counts);
  });
});

describe('a new shuffle', () => {
  it('stops the ending before it plays', () => {
    const { ctx, audio } = setUp();
    audio.done();
    const ending = [...ctx.sources];
    ctx.currentTime = 13;
    audio.shuffle();
    for (const s of ending)
      expect(s.stoppedAt ?? Infinity).toBeLessThanOrEqual(13.12);
  });

  it('plays a soft timpani hit, and nothing made of noise', () => {
    const { ctx, audio, played } = setUp();
    audio.shuffle();
    expect(played()).toEqual(['timpani-hit']);
    expect(ctx.buffersCreated).toBe(0);
  });
});

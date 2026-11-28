/**
 * Plays the deal (#1339) with Web Audio, from the plans in
 * `src/lib/dealSound.ts`, and owns every node it starts so `stop()` can
 * silence all of them at once: on a new shuffle, when the board closes and
 * when the sound is switched off.
 *
 * Every layer is a real recording (`sample(name)`), or, when one is not
 * ready (a browser that cannot decode AAC), a plain sine tone at the same
 * pitch. The fanfare and the final chord are browser-made tones either way.
 * Nothing here makes a buffer of its own, so nothing can play noise:
 * Shyden heard hiss and crackle as "electrics sparking".
 */
import {
  DEAL_BASES,
  DEAL_INSTRUMENTS,
  dealLoudness,
  dealStepMidi,
  endingPlan,
  nearestNote,
  timpaniOnStep,
  type DealInstrument,
  type EndingEvent,
} from '../lib/dealSound';

export interface DealAudioDeps {
  ctx: () => AudioContext;
  /** Where every voice is sent. */
  bus: () => AudioNode;
  /** The decoded recording of that name, or null when it is not ready. */
  sample: (name: string) => AudioBuffer | null;
  rng: () => number;
}

export interface DealAudio {
  shuffle(): void;
  land(i: number, n: number): void;
  done(): void;
  stop(fadeS?: number): void;
}

/** How quickly a stop fades everything out. */
export const STOP_FADE_S = 0.12;

const midiHz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);
const semis = (semitones: number): number => 2 ** (semitones / 12);

/** A tone stand-in is far louder than a recording at the same gain. */
const TONE_FALLBACK_GAIN = 0.3;
/** The recordings' own pitches, for the tone stand-ins. */
const FALLBACK_HZ = {
  timpani: 65.41,
  impact: 55,
  drop: 41.2,
  bell: 1046.5,
} as const;

/** Each instrument's level and length on landing, from the approved
 *  preview: quiet at the start of the deal (p = 0), louder at its end. */
const LAND_LAYERS: Readonly<
  Record<
    DealInstrument,
    {
      gain: number;
      rise: number;
      durationS: number;
      fadeOutS: number;
      pan: -1 | 0 | 1;
    }
  >
> = {
  marimba: { gain: 0.35, rise: 0.3, durationS: 0.8, fadeOutS: 0.3, pan: 0 },
  harp: { gain: 0.35, rise: 0.35, durationS: 1.2, fadeOutS: 0.6, pan: 1 },
  glock: { gain: 0.15, rise: 0.25, durationS: 0.8, fadeOutS: 0.3, pan: -1 },
};

interface Voice {
  source: AudioScheduledSourceNode;
  gain: GainNode;
}

interface VoiceOptions {
  at: number;
  gain: number;
  durationS: number;
  fadeOutS: number;
  rate?: number;
  pan?: number;
  /** The tone to play when the recording is not ready; none, no stand-in. */
  fallbackHz?: number;
  /** A swell from this fraction of `gain`, as the timpani roll does. */
  swellFrom?: number;
}

export function createDealAudio(deps: DealAudioDeps): DealAudio {
  const live = new Set<Voice>();

  const track = (source: AudioScheduledSourceNode, gain: GainNode): void => {
    const voice = { source, gain };
    live.add(voice);
    source.onended = () => {
      live.delete(voice);
    };
  };

  /** Routes `node` to the bus, through a panner when it is panned. */
  const toBus = (ctx: AudioContext, node: AudioNode, pan: number): void => {
    if (pan === 0) {
      node.connect(deps.bus());
      return;
    }
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    node.connect(panner).connect(deps.bus());
  };

  /** One recording, or its tone stand-in, held then faded out. */
  const voice = (name: string, options: VoiceOptions): void => {
    const ctx = deps.ctx();
    const { at, durationS, fadeOutS, rate = 1, pan = 0 } = options;
    const buffer = deps.sample(name);
    let source: AudioScheduledSourceNode;
    let gainValue = options.gain;
    if (buffer) {
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.playbackRate.value = rate;
      source = node;
    } else if (options.fallbackHz === undefined) {
      return;
    } else {
      const node = ctx.createOscillator();
      node.type = 'sine';
      node.frequency.value = options.fallbackHz * rate;
      source = node;
      gainValue *= TONE_FALLBACK_GAIN;
    }
    const gain = ctx.createGain();
    const end = at + durationS;
    const fadeFrom = Math.max(at, end - fadeOutS);
    if (options.swellFrom === undefined) {
      gain.gain.setValueAtTime(gainValue, at);
      gain.gain.setValueAtTime(gainValue, fadeFrom);
    } else {
      gain.gain.setValueAtTime(gainValue * options.swellFrom, at);
      gain.gain.linearRampToValueAtTime(gainValue, fadeFrom);
    }
    gain.gain.linearRampToValueAtTime(0, end);
    source.connect(gain);
    toBus(ctx, gain, pan);
    source.start(at);
    source.stop(end);
    track(source, gain);
  };

  /** A browser-made tone with an attack and a long exponential decay. */
  const tone = (
    filter: AudioNode,
    hz: number,
    options: {
      at: number;
      type: OscillatorType;
      gain: number;
      attackS: number;
      holdS: number;
      endS: number;
      detune: number;
    },
  ): void => {
    const ctx = deps.ctx();
    const { at, gain: peak, attackS, holdS, endS } = options;
    const osc = ctx.createOscillator();
    osc.type = options.type;
    osc.frequency.value = hz;
    osc.detune.value = options.detune;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(peak, at + attackS);
    gain.gain.setValueAtTime(peak, at + attackS + holdS);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + endS);
    osc.connect(gain).connect(filter);
    osc.start(at);
    osc.stop(at + endS);
    track(osc, gain);
  };

  /** Three detuned sawtooths per note, through a lowpass that opens. */
  const fanfare = (start: number, event: EndingEvent): void => {
    const ctx = deps.ctx();
    const at = start + event.at;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(600, at);
    lowpass.frequency.linearRampToValueAtTime(2600, at + 0.12);
    lowpass.frequency.exponentialRampToValueAtTime(1200, at + event.durationS);
    lowpass.connect(deps.bus());
    for (const semitones of event.notes ?? []) {
      for (const detune of [-8, 0, 8]) {
        tone(lowpass, (event.rootHz ?? 0) * semis(semitones), {
          at,
          type: 'sawtooth',
          gain: event.gain,
          attackS: 0.02,
          holdS: 0,
          endS: event.durationS,
          detune,
        });
      }
    }
  };

  /** The sustained chord the ending rings out on, an octave below. */
  const finalChord = (start: number, event: EndingEvent): void => {
    const bus = deps.bus();
    (event.notes ?? []).forEach((semitones, k) => {
      tone(bus, ((event.rootHz ?? 0) * semis(semitones)) / 2, {
        at: start + event.at,
        type: 'triangle',
        gain: event.gain,
        attackS: 0.35,
        holdS: event.durationS * 0.25,
        endS: event.durationS,
        detune: k % 2 ? 5 : -5,
      });
    });
  };

  const glockNote = (midi: number, options: VoiceOptions): void => {
    const { sample, semitones } = nearestNote('glock', midi);
    voice(`glock-${sample}`, {
      ...options,
      rate: semis(semitones),
      fallbackHz: midiHz(sample),
    });
  };

  const ending = (start: number, event: EndingEvent): void => {
    const at = start + event.at;
    const base = {
      at,
      gain: event.gain,
      durationS: event.durationS,
      pan: event.pan,
    };
    switch (event.kind) {
      case 'roll':
        voice('timpani-roll', {
          ...base,
          fadeOutS: 0.05,
          swellFrom: 0.15,
          fallbackHz: FALLBACK_HZ.timpani,
        });
        return;
      case 'whoosh':
        voice('whoosh', { ...base, fadeOutS: 0.05 });
        return;
      case 'timpaniHit':
        voice('timpani-hit', {
          ...base,
          fadeOutS: 1.5,
          fallbackHz: FALLBACK_HZ.timpani,
        });
        return;
      case 'impact':
        voice('impact', {
          ...base,
          fadeOutS: 4,
          fallbackHz: FALLBACK_HZ.impact,
        });
        return;
      case 'drop':
        voice('drop', { ...base, fadeOutS: 2.5, fallbackHz: FALLBACK_HZ.drop });
        return;
      case 'bellShimmer':
        voice('bell', {
          ...base,
          fadeOutS: 3.5,
          rate: semis(event.notes?.[0] ?? 0),
          fallbackHz: FALLBACK_HZ.bell,
        });
        return;
      case 'sparkle':
        voice('sparkle', { ...base, fadeOutS: 5 });
        return;
      case 'fanfare':
        fanfare(start, event);
        return;
      case 'finalChord':
        finalChord(start, event);
        return;
      case 'confettiNote':
        glockNote(event.midi ?? 0, { ...base, fadeOutS: 0.4 });
        return;
    }
  };

  const stop = (fadeS = STOP_FADE_S): void => {
    const now = deps.ctx().currentTime;
    for (const { source, gain } of live) {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + fadeS);
      source.stop(now + fadeS);
    }
    live.clear();
  };

  return {
    shuffle(): void {
      stop();
      voice('timpani-hit', {
        at: deps.ctx().currentTime,
        gain: 0.25,
        durationS: 1.2,
        fadeOutS: 0.8,
        fallbackHz: FALLBACK_HZ.timpani,
      });
    },

    land(i: number, n: number): void {
      const at = deps.ctx().currentTime;
      const p = dealLoudness(i, n);
      const pan = (i % 2 ? 1 : -1) * (0.15 + 0.45 * p);
      for (const instrument of DEAL_INSTRUMENTS) {
        const layer = LAND_LAYERS[instrument];
        const midi = dealStepMidi(DEAL_BASES[instrument], i);
        const { sample, semitones } = nearestNote(instrument, midi);
        voice(`${instrument}-${sample}`, {
          at,
          gain: layer.gain + layer.rise * p,
          durationS: layer.durationS,
          fadeOutS: layer.fadeOutS,
          rate: semis(semitones),
          pan: layer.pan * pan,
          fallbackHz: midiHz(sample),
        });
      }
      if (timpaniOnStep(i)) {
        voice('timpani-hit', {
          at,
          gain: 0.3 + 0.35 * p,
          durationS: 2.5,
          fadeOutS: 1.5,
          fallbackHz: FALLBACK_HZ.timpani,
        });
      }
    },

    done(): void {
      const start = deps.ctx().currentTime;
      for (const event of endingPlan(deps.rng)) ending(start, event);
    },

    stop,
  };
}

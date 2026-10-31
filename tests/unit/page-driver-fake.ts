/**
 * A stand-in for the page's protocol (`PageProtocol`'s `command` and `on`),
 * for the page driver's unit tests (#859): no socket, no phone. Each command
 * takes the next answer queued for its method, so a test states exactly what
 * the phone said; a command nobody queued an answer for fails naming itself.
 * The answers come from `fixtures/ios-inspector/page-driving-2026-10-31.json`,
 * recorded on the iPhone Air.
 */
import { readFileSync } from 'node:fs';
import { InspectorError } from '../device/ios/inspector/protocol';
import type { PagePort } from '../device/ios/page-driver';

const FIXTURE = new URL(
  './fixtures/ios-inspector/page-driving-2026-10-31.json',
  import.meta.url,
);

const recordedAnswers = (
  JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
    answers: Record<string, unknown>;
  }
).answers;

/** One answer the phone gave in the 2026-10-31 probes, by the probe's label. */
export function recorded(label: string): unknown {
  if (!(label in recordedAnswers))
    throw new Error(`no recorded answer is labelled ${label}`);
  return structuredClone(recordedAnswers[label]);
}

/** An answer that is an error the page sent back, as `PageProtocol.command` throws it. */
export class Refusal {
  constructor(readonly message: string) {}
}

export interface FakePage extends PagePort {
  readonly sent: { method: string; params: unknown }[];
  /** `on:<event>` and `off:<event>`, interleaved with `send:<method>`, in order. */
  readonly log: string[];
  listenerCount(event: string): number;
  emit(event: string, params?: unknown): void;
}

export function fakePage(answers: Record<string, unknown[]>): FakePage {
  const queues = new Map(
    Object.entries(answers).map(([method, list]) => [method, [...list]]),
  );
  const listeners = new Map<string, Set<(params: unknown) => void>>();
  const sent: { method: string; params: unknown }[] = [];
  const log: string[] = [];
  return {
    sent,
    log,
    async command<T>(method: string, params: object = {}): Promise<T> {
      sent.push({ method, params });
      log.push(`send:${method}`);
      const next = queues.get(method)?.shift();
      if (next === undefined)
        throw new Error(`the fake page has no answer queued for ${method}`);
      if (next instanceof Refusal)
        throw new InspectorError(
          `${method} failed on the page: ${next.message}`,
          method,
          params,
        );
      return next as T;
    },
    on(event: string, listener: (params: unknown) => void): () => void {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
      log.push(`on:${event}`);
      return () => {
        set.delete(listener);
        log.push(`off:${event}`);
      };
    },
    listenerCount: (event) => listeners.get(event)?.size ?? 0,
    emit(event, params = {}) {
      for (const listener of [...(listeners.get(event) ?? [])])
        listener(params);
    },
  };
}

/** The answer `Runtime.evaluate('window')` gives: a handle to the page's window. */
export const WINDOW = {
  result: { type: 'object', objectId: '{"injectedScriptId":1,"id":99}' },
  wasThrown: false,
};

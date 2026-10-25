/**
 * The JSON protocol to a page (#811 Task 9), carried as text inside the Web
 * Inspector RPC.
 *
 * Since iOS 13 a page speaks through its target: a command `{ id, method,
 * params }` goes as the `message` of an outer `Target.sendMessageToTarget`,
 * and its answer comes back inside `Target.dispatchMessageFromTarget`.
 * Measured on the iPhone Air (iOS 27.0.1), 2026-10-24: the outer command is
 * answered first with its own `{ result: {}, id }`, then the inner answer
 * arrives; ids count up from 1 across inner and outer alike; events
 * (`Console.messageAdded`, `Page.defaultUserPreferencesDidChange`) arrive
 * inside the same dispatch with no id. A cross-origin navigation swaps the
 * target (`Target.didCommitProvisionalTarget`), and later commands follow it.
 */
import { ProtocolShapeError } from './fields';
import type { WirSession } from './wir';

export const COMMAND_CEILING_MS = 15_000;

/** A command the page answered with an error: which command, with what, and WebKit's words. */
export class InspectorError extends Error {
  constructor(
    message: string,
    readonly method: string,
    readonly params: unknown,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'InspectorError';
  }
}

interface Envelope {
  readonly id?: number;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
  readonly result?: unknown;
  readonly error?: { readonly message?: string };
}

type Channel = Pick<WirSession, 'sendData' | 'onData' | 'until'>;

export class PageProtocol {
  private target: string | undefined;
  private nextId = 1;
  private readonly answers = new Map<number, Envelope>();
  private readonly wrapperErrors = new Map<number, string>();
  private readonly listeners = new Map<
    string,
    Set<(params: unknown) => void>
  >();
  /** Text the phone sent that is not JSON: every wait from then on fails with it. */
  private broken: ProtocolShapeError | undefined;

  constructor(private readonly channel: Channel) {
    channel.onData((text) => this.take(text));
  }

  get targetId(): string {
    if (this.target === undefined)
      throw new InspectorError(
        'no target yet: wait for targetCreated',
        '',
        undefined,
      );
    return this.target;
  }

  targetCreated(ceilingMs: number): Promise<string> {
    return this.wait('Target.targetCreated', ceilingMs, () => this.target);
  }

  async command<T = unknown>(
    method: string,
    params: object = {},
    ceilingMs = COMMAND_CEILING_MS,
  ): Promise<T> {
    if (this.broken) throw this.broken;
    const innerId = this.nextId++;
    const outerId = this.nextId++;
    const target = this.targetId;
    this.channel.sendData(
      JSON.stringify({
        id: outerId,
        method: 'Target.sendMessageToTarget',
        params: {
          targetId: target,
          message: JSON.stringify({ id: innerId, method, params }),
        },
      }),
    );
    const answer = await this.wait(`answer to ${method}`, ceilingMs, () => {
      const wrapper = this.wrapperErrors.get(outerId);
      if (wrapper !== undefined)
        throw new InspectorError(
          `${method} could not reach target ${target}: ${wrapper}`,
          method,
          params,
        );
      return this.answers.get(innerId);
    });
    this.answers.delete(innerId);
    if (answer.error)
      throw new InspectorError(
        `${method} failed on the page: ${answer.error.message ?? JSON.stringify(answer.error)}`,
        method,
        params,
      );
    return answer.result as T;
  }

  on(method: string, listener: (params: unknown) => void): () => void {
    const set = this.listeners.get(method) ?? new Set();
    set.add(listener);
    this.listeners.set(method, set);
    return () => set.delete(listener);
  }

  private wait<T>(
    what: string,
    ceilingMs: number,
    pick: () => T | undefined,
  ): Promise<T> {
    return this.channel.until(what, ceilingMs, () => {
      if (this.broken) throw this.broken;
      return pick();
    });
  }

  private take(text: string): void {
    const outer = this.parse(text);
    if (outer === undefined) return;
    if (outer.method === 'Target.targetCreated') {
      const info = outer.params?.targetInfo as
        { targetId?: string } | undefined;
      this.target ??= info?.targetId;
      return;
    }
    if (outer.method === 'Target.didCommitProvisionalTarget') {
      this.target = outer.params?.newTargetId as string;
      return;
    }
    if (outer.method === 'Target.dispatchMessageFromTarget') {
      const inner = this.parse(String(outer.params?.message ?? ''));
      if (inner === undefined) return;
      if (inner.id !== undefined) this.answers.set(inner.id, inner);
      else if (inner.method) this.dispatch(inner.method, inner.params);
      return;
    }
    if (outer.id !== undefined && outer.error)
      this.wrapperErrors.set(
        outer.id,
        outer.error.message ?? JSON.stringify(outer.error),
      );
  }

  private dispatch(method: string, params: unknown): void {
    for (const listener of this.listeners.get(method) ?? []) {
      try {
        listener(params);
      } catch (error) {
        throw new InspectorError(
          `a listener for ${method} threw: ${(error as Error).message}`,
          method,
          params,
          { cause: error },
        );
      }
    }
  }

  private parse(text: string): Envelope | undefined {
    try {
      return JSON.parse(text) as Envelope;
    } catch {
      this.broken = new ProtocolShapeError(
        `the page sent text that is not JSON: ${JSON.stringify(text.slice(0, 80))}`,
      );
      return undefined;
    }
  }
}

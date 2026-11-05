/**
 * A stand-in for the artifact runtime's `db` capability, so an evidence page's
 * own script can be driven in a real browser (#172).
 *
 * This is the one mock the evidence page needs: the real runtime lives inside
 * claude.ai and cannot run in CI. It honours the parts of the published
 * contract (`db.d.ts`, runtime contract 0.2.47) that the page reaches for,
 * including the two a page gets wrong without any error:
 *
 * - every delivered snapshot is FROZEN, down through `data()` and everything
 *   under it, and a body that did not change is the same object across
 *   deliveries;
 * - a page's own write is delivered at once with `hasPendingWrites: true`, and
 *   again with `false` once the store has confirmed it.
 *
 * The contract does not say whether `set()` resolves before or after the
 * confirmed snapshot arrives. The probe on the real runtime (2026-09-14) saw
 * the promise resolve first. `order` runs both, so a page cannot pass by
 * leaning on one of them.
 *
 * Both of those complete a write 60 ms after it is made, well inside the
 * page's 400 ms save window, so they never put two writes in flight. A store
 * slower than that window does, and `as-released` hands every completion to
 * the test instead, to release one at a time in whatever order it is
 * exercising (#260).
 *
 * #172's last acceptance criterion ties this back to the real thing: a
 * throwaway page on the real runtime, measured the same way.
 */

/**
 * Which of a write's two completions reaches the page first, or
 * `as-released`: neither, until the test releases each one itself.
 */
export type WriteOrder =
  'resolve-then-confirm' | 'confirm-then-resolve' | 'as-released';

/** A write's two completions: its confirmed snapshot, and its promise resolving. */
export type Completion = 'confirm' | 'resolve';

export type StoredBody = Record<string, unknown>;

export interface DbStandInOptions {
  /**
   * The localStorage key the store lives under. It must be unique per test AND
   * per run. A real phone shares one browser context across every test, so a
   * fixed key would carry one test's store into the next; and it keeps one
   * Chrome profile from run to run, so a key unique only per test hands each
   * test the store its own previous run left (#229).
   */
  storeKey: string;
  /**
   * The prefix every earlier run of the same test wrote its store under.
   * Installing removes those stores, and no others: without this a key per
   * run would leave one more store per test on a phone after every run, never
   * read again, until localStorage refuses writes.
   */
  supersedes: string;
  order: WriteOrder;
  /** Documents that already exist, written only while the store is empty. */
  seed: Record<string, StoredBody>;
  /** Leave `claude.use('db')` unanswered until the test calls `answer()`. */
  holdUse: boolean;
  /**
   * Every subscription ends without delivering anything, with the terminal
   * `unavailable` error of a bridge that stops answering: late, once any read
   * has settled. From then on nothing is delivered, not even the echo of the
   * page's own writes.
   */
  subscriptionDies: boolean;
  /**
   * Every `get()` rejects with `unavailable`, late: a live subscription has
   * delivered by then, as when a transient failure hits a read while the
   * subscription carries on (db.d.ts).
   */
  getFails: boolean;
}

/** What a test reads and drives. The page under test never touches it. */
export interface DbStandInControl {
  /** The confirmed body at `path`, or null when no such document exists. */
  read(path: string): StoredBody | null;
  /** How many times the page has called `set()`. */
  writes(): number;
  /** Writes whose promise has not yet resolved or whose confirmation has not yet arrived. */
  inflight(): number;
  /** How many snapshots the page has received, from `get()` and `onSnapshot` alike. */
  deliveries(): number;
  /** Answer a held `claude.use('db')`. */
  answer(): void;
  /**
   * Under `as-released`, completes the oldest write still owing this
   * completion, and returns that write's number, counting from 1. Each
   * completion keeps its own line, oldest first, as a store that takes one
   * page's writes in order. A write is stored at whichever of its two
   * completions is released first. Throws when no write owes one, so a test
   * cannot release a write the page never made.
   */
  release(completion: Completion): number;
  /** Another viewer writes the whole document. */
  remoteWrite(path: string, body: StoredBody): void;
}

export interface StandInSnapshot {
  id: string;
  exists: boolean;
  data(): StoredBody | undefined;
  metadata: { fromCache: boolean; hasPendingWrites: boolean };
}

export interface StandInDocument {
  id: string;
  path: string;
  get(): Promise<StandInSnapshot>;
  set(data: StoredBody): Promise<void>;
  onSnapshot(
    next: (snap: StandInSnapshot) => void,
    error?: (failure: { code: string; message: string }) => void,
  ): () => void;
}

/** The page's `window` once the stand-in is installed: the real global, plus what it adds. */
export type StandInWindow = Window &
  typeof globalThis & {
    claude: {
      use(name: string): Promise<{ doc(path: string): StandInDocument } | null>;
    };
    __dbStandIn: DbStandInControl;
  };

/**
 * Installs the stand-in. Pass it to `page.addInitScript` together with its
 * options: Playwright serialises the function's source, so it must not
 * reference anything outside its own body.
 */
export function installDbStandIn(options: DbStandInOptions): void {
  const {
    storeKey,
    supersedes,
    order,
    seed,
    holdUse,
    subscriptionDies,
    getFails,
  } = options;
  const CONFIRM_AFTER_MS = 60;

  const earlierRuns = Array.from({ length: localStorage.length }, (_, i) =>
    localStorage.key(i),
  ).filter(
    (key): key is string =>
      key !== null && key.startsWith(supersedes) && key !== storeKey,
  );
  for (const key of earlierRuns) localStorage.removeItem(key);
  if (localStorage.getItem(storeKey) === null)
    localStorage.setItem(storeKey, JSON.stringify(seed));
  const confirmed = (): Record<string, StoredBody> =>
    JSON.parse(localStorage.getItem(storeKey) ?? '{}') as Record<
      string,
      StoredBody
    >;
  const persist = (path: string, body: StoredBody): void => {
    const all = confirmed();
    all[path] = body;
    localStorage.setItem(storeKey, JSON.stringify(all));
  };
  // What crosses the bridge between page and store: a copy, never a reference.
  const copyOf = (body: StoredBody): StoredBody =>
    JSON.parse(JSON.stringify(body)) as StoredBody;

  // A frozen copy, down through every nested object. JSON.parse hands its
  // reviver each value after that value's children, so freezing there freezes
  // the whole body, with no walker of our own (one-home.test.ts).
  const frozenCopyOf = (json: string): StoredBody =>
    JSON.parse(json, (_key: string, value: unknown) =>
      value !== null && typeof value === 'object'
        ? Object.freeze(value)
        : value,
    ) as StoredBody;

  // The last frozen body delivered per path, reused while it is unchanged.
  const lastDelivered = new Map<string, { json: string; body: StoredBody }>();
  const frozenBody = (path: string, body: StoredBody): StoredBody => {
    const json = JSON.stringify(body);
    const last = lastDelivered.get(path);
    if (last && last.json === json) return last.body;
    const frozen = frozenCopyOf(json);
    lastDelivered.set(path, { json, body: frozen });
    return frozen;
  };

  // This page's own writes not yet confirmed, oldest first. The view shows
  // the newest of them over the confirmed body (latency compensation).
  const unconfirmed = new Map<string, StoredBody[]>();
  let deliveries = 0;
  const view = (path: string): StandInSnapshot => {
    const queue = unconfirmed.get(path) ?? [];
    const latest =
      queue.length > 0 ? queue[queue.length - 1] : confirmed()[path];
    const body = latest === undefined ? undefined : frozenBody(path, latest);
    deliveries += 1;
    return Object.freeze({
      id: path.split('/').pop() ?? path,
      exists: body !== undefined,
      data: () => body,
      metadata: Object.freeze({
        fromCache: false,
        hasPendingWrites: queue.length > 0,
      }),
    });
  };

  const listeners = new Map<string, Set<(snap: StandInSnapshot) => void>>();
  const deliver = (path: string): void => {
    for (const next of listeners.get(path) ?? []) next(view(path));
  };

  let writes = 0;
  let inflight = 0;
  // Completions waiting for `release`, one line per kind, oldest first.
  const held: Record<Completion, { write: number; complete: () => void }[]> = {
    confirm: [],
    resolve: [],
  };
  const documentAt = (path: string): StandInDocument =>
    Object.freeze({
      id: path.split('/').pop() ?? path,
      path,
      get: () =>
        new Promise<StandInSnapshot>((resolve, reject) => {
          if (!getFails) {
            setTimeout(() => resolve(view(path)), 0);
            return;
          }
          const failure = Object.freeze({
            code: 'unavailable',
            message: 'the stand-in failed this read',
          });
          setTimeout(() => reject(failure), CONFIRM_AFTER_MS);
        }),
      set: (data: StoredBody) => {
        writes += 1;
        inflight += 1;
        const write = writes;
        const body = copyOf(data);
        const queue = unconfirmed.get(path) ?? [];
        queue.push(body);
        unconfirmed.set(path, queue);
        setTimeout(() => deliver(path), 0);
        return new Promise<void>((resolve) => {
          let stored = false;
          const store = (): void => {
            if (stored) return;
            stored = true;
            persist(path, body);
            queue.splice(queue.indexOf(body), 1);
          };
          if (order === 'as-released') {
            let owed = 2;
            const completing = (complete: () => void) => (): void => {
              store();
              complete();
              owed -= 1;
              if (owed === 0) inflight -= 1;
            };
            held.confirm.push({
              write,
              complete: completing(() => deliver(path)),
            });
            held.resolve.push({ write, complete: completing(() => resolve()) });
            return;
          }
          setTimeout(() => {
            store();
            if (order === 'resolve-then-confirm') {
              resolve();
              setTimeout(() => {
                deliver(path);
                inflight -= 1;
              }, 0);
            } else {
              deliver(path);
              setTimeout(() => {
                resolve();
                inflight -= 1;
              }, 0);
            }
          }, CONFIRM_AFTER_MS);
        });
      },
      onSnapshot: (
        next: (snap: StandInSnapshot) => void,
        error?: (failure: { code: string; message: string }) => void,
      ) => {
        if (subscriptionDies) {
          // Without an error callback the runtime reports a terminal error
          // through reportError, so the page's own error event sees it.
          const failure = Object.freeze({
            code: 'unavailable',
            message: 'the stand-in ended this subscription',
          });
          setTimeout(
            () => (error ? error(failure) : reportError(failure)),
            CONFIRM_AFTER_MS * 2,
          );
          return () => {};
        }
        const subscribed = listeners.get(path) ?? new Set();
        subscribed.add(next);
        listeners.set(path, subscribed);
        setTimeout(() => {
          if (subscribed.has(next)) next(view(path));
        }, 0);
        return () => {
          subscribed.delete(next);
        };
      },
    });

  const namespace = Object.freeze({ doc: documentAt });
  let answer = (): void => {};
  const answered = new Promise<void>((resolve) => {
    answer = resolve;
  });
  if (!holdUse) setTimeout(() => answer(), 0);

  Object.defineProperty(window, 'claude', {
    value: Object.freeze({
      use: (name: string) =>
        name === 'db' ? answered.then(() => namespace) : Promise.resolve(null),
    }),
  });

  const control: DbStandInControl = {
    read: (path) => confirmed()[path] ?? null,
    writes: () => writes,
    inflight: () => inflight,
    deliveries: () => deliveries,
    answer: () => answer(),
    release: (completion) => {
      const next = held[completion].shift();
      if (!next) throw new Error(`no write is waiting to ${completion}`);
      next.complete();
      return next.write;
    },
    remoteWrite: (path, body) => {
      persist(path, copyOf(body));
      deliver(path);
    },
  };
  Object.defineProperty(window, '__dbStandIn', {
    value: Object.freeze(control),
  });
}

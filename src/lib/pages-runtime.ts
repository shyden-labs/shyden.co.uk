/**
 * Each deploy sets its Pages project's Workers runtime to the one the
 * functions suite tests, through Cloudflare's API, and reads it back (#907;
 * Shyden's ruling 2026-11-07). Measured on 2026-10-21, both projects ran
 * 2026-07-24 while the suite tested a newer date, and the dashboard refused to
 * change it (2026-10-24).
 *
 * Pure: every function here works from its arguments alone, and returns a
 * value or throws. `scripts/pages-runtime.mjs` does the fetching. Node runs
 * this file by stripping its types, with no build step, so it uses erasable
 * TypeScript only, and imports by full name.
 */
import { errorsIn } from './cloudflare-envelope.ts';
import { isRecord } from './is-record.ts';

/** A Pages environment's deployment config, as the API returns it. */
export type DeploymentConfig = Record<string, unknown>;

/** The two fields of a deployment config that make up the runtime. */
const RUNTIME_KEYS = new Set(['compatibility_date', 'compatibility_flags']);

const DATE_LINE = /^\s*compatibility_date\s*=\s*"([^"]*)"\s*(?:#.*)?$/;

/**
 * The compatibility date a wrangler TOML file holds. Exactly one
 * uncommented `compatibility_date` line, holding a real `yyyy-mm-dd` day, or
 * it throws: git holds the date in one place, and a second spelling or an
 * unreadable one must not let a deploy guess.
 */
export const compatibilityDateOf = (toml: string): string => {
  const dates = toml
    .split('\n')
    .map((line) => DATE_LINE.exec(line)?.[1])
    .filter((date): date is string => date !== undefined);
  if (dates.length === 0)
    throw new Error('the file holds no compatibility_date');
  if (dates.length > 1)
    throw new Error(`the file holds ${dates.length} compatibility_date lines`);
  const [date] = dates as [string];
  const day = new Date(`${date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(day.getTime()) ||
    day.toISOString().slice(0, 10) !== date
  )
    throw new Error(`${date} is not a real date`);
  return date;
};

/**
 * Null when an API answer says it succeeded; otherwise Cloudflare's own
 * errors, `code message` each, so a bad token reads as a bad token.
 */
const refusalOf = (answer: unknown): string | null =>
  isRecord(answer) && answer.success === true
    ? null
    : errorsIn(answer).replace(/^ \((.*)\)$/s, '$1') || '(no error given)';

/**
 * The production deployment config out of a `GET /pages/projects/{name}`
 * answer. A refused call throws naming Cloudflare's own errors, so a bad
 * token reads as a bad token rather than as a missing date.
 */
export const productionConfigOf = (answer: unknown): DeploymentConfig => {
  if (!isRecord(answer)) throw new Error('the answer is not an object');
  const refused = refusalOf(answer);
  if (refused !== null) throw new Error(`Cloudflare refused: ${refused}`);
  const configs = isRecord(answer.result)
    ? answer.result.deployment_configs
    : undefined;
  const production = isRecord(configs) ? configs.production : undefined;
  if (!isRecord(production))
    throw new Error('the answer has no production deployment config');
  return production;
};

const flagsOf = (config: DeploymentConfig): string[] =>
  Array.isArray(config.compatibility_flags)
    ? config.compatibility_flags.map(String)
    : [];

const describeFlags = (flags: readonly string[]) =>
  flags.length === 0 ? 'no flags' : `flags ${flags.join(', ')}`;

/**
 * Null when production runs `date` with no flags, which is what the functions
 * suite tests; otherwise a sentence naming both runtimes.
 */
export const runtimeMismatch = (
  date: string,
  production: DeploymentConfig,
): string | null => {
  const deployed =
    typeof production.compatibility_date === 'string'
      ? production.compatibility_date
      : '(none)';
  const flags = flagsOf(production);
  if (deployed === date && flags.length === 0) return null;
  return `production runs compatibility date ${deployed} with ${describeFlags(flags)}; the functions suite tests ${date} with no flags`;
};

/** The `PATCH /pages/projects/{name}` body that sets the runtime and nothing else. */
export const runtimePatch = (date: string) => ({
  deployment_configs: {
    production: { compatibility_date: date, compatibility_flags: [] },
  },
});

/**
 * The keys of the production config, other than the runtime, that differ
 * between `before` and `after`. Keys only: a value may be a secret's.
 */
export const changedApartFromRuntime = (
  before: DeploymentConfig,
  after: DeploymentConfig,
): string[] =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => !RUNTIME_KEYS.has(key))
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .sort();

/** The two calls `syncRuntime` makes, each answering as the API does. */
export type PagesApi = {
  get: () => Promise<unknown>;
  patch: (body: ReturnType<typeof runtimePatch>) => Promise<unknown>;
};

/**
 * Bring production to `date` with no flags, and prove it took. Reads the
 * project; if it already runs `date`, sends nothing. Otherwise sends the
 * runtime alone, reads the project again, and throws unless the read-back
 * runs `date` and every other setting (each binding, variable and secret) is
 * exactly as it was. Returns one line for the deploy log.
 */
export const syncRuntime = async (
  date: string,
  api: PagesApi,
): Promise<string> => {
  const before = productionConfigOf(await api.get());
  if (runtimeMismatch(date, before) === null)
    return `production already runs compatibility date ${date} with no flags`;

  const refused = refusalOf(await api.patch(runtimePatch(date)));
  if (refused !== null) throw new Error(`the update was refused: ${refused}`);

  const after = productionConfigOf(await api.get());
  const still = runtimeMismatch(date, after);
  if (still !== null) throw new Error(`after the update, ${still}`);
  const changed = changedApartFromRuntime(before, after);
  if (changed.length > 0)
    throw new Error(
      `the update changed more than the runtime: ${changed.join(', ')}`,
    );
  return `production moved from compatibility date ${String(before.compatibility_date)} to ${date}, read back`;
};

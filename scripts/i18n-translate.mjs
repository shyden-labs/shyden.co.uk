#!/usr/bin/env node
/**
 * Seed a locale catalogue from `en.ts` with DeepL. #21 Stage 5.
 *
 *   npm run i18n:translate -- zh            # DRY RUN — sends nothing
 *   npm run i18n:translate -- zh --send     # actually calls DeepL
 *   npm run i18n:translate -- zh --prune    # drops stale drafts — no key, no request
 *
 * DRY RUN IS THE DEFAULT, deliberately. A translation run spends a finite
 * free-tier quota and is the kind of thing that gets triggered by a stray
 * shell-history arrow key; the dry run prints exactly what would be sent and
 * how many characters it costs, so the spend is a decision rather than a
 * side effect.
 *
 * A draft is kept only while its English is still sent (#164). The cache used
 * to keep every draft it had ever been given, so retired copy lingered in it
 * reading like live translation. A send drops the stale drafts as it writes;
 * `--prune` drops them with no key and no request, which is how a locale that
 * still has sentences to send is tidied without spending quota on them.
 *
 * Committed output, never a build step (#21's acceptance criteria). Nothing
 * here runs in CI: a deploy must not depend on a third-party API being up,
 * and `tests/unit/translate.test.ts` fails if any other npm script reaches
 * this file.
 *
 * The decisions live in `src/lib/i18n/translate.ts`, unit-tested without a
 * key or a network. This file is wiring: read, fetch, write.
 *
 * Node 24 strips TypeScript natively, so the catalogues import directly with
 * no build step and no new dependency — the zero-cost constraint.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { argv, env, exit } from 'node:process';
import { die } from './errors.mjs';

import {
  DO_NOT_TRANSLATE,
  betterDraft,
  buildRequestBody,
  deeplEndpoint,
  deeplLanguage,
  needsSending,
  pruneDrafts,
  slotsKept,
  translatableSentences,
  deeplDrafts,
  TRANSLATABLE_LOCALES,
} from '../src/lib/i18n/translate.ts';

const CACHE = 'src/lib/i18n/.translations.json';
/** DeepL accepts up to 50 texts per request. */
const BATCH = 50;
const OPTIONS = ['--send', '--prune'];
const USAGE = `usage: npm run i18n:translate -- <locale> [${OPTIONS.join(' | ')}]`;

/**
 * What one DeepL call needs: where to send it, what to sign it with, and which
 * locale it is for. Bound in `main` and passed in, because reading these off
 * module scope is what made this file load its key and send its catalogue on
 * import (#276).
 *
 * @typedef {object} Deepl
 * @property {string} endpoint
 * @property {string} apiKey
 * @property {(typeof TRANSLATABLE_LOCALES)[number]} target
 */

/**
 * @param {string} value
 * @returns {value is (typeof TRANSLATABLE_LOCALES)[number]} a PREDICATE, not a
 *   boolean: `includes` answers "is it in the list" and narrows nothing, so
 *   every later call had to take `string` and none of them do.
 */
const isTranslatable = (value) =>
  // The ARRAY is widened, never the value cast: `includes` on a readonly
  // tuple of literals demands the union it is trying to decide.
  /** @type {readonly string[]} */ (TRANSLATABLE_LOCALES).includes(value);

/**
 * The one way the cache is written, so a prune and a send cannot drift.
 *
 * @param {Record<string, Record<string, string>>} cache every locale's drafts
 * @param {string} target the locale being written
 * @param {Record<string, string>} known the drafts kept for it
 * @returns {void}
 */
function writeCache(cache, target, known) {
  cache[target] = known;
  writeFileSync(CACHE, `${JSON.stringify(cache, null, 2)}\n`);
}

/**
 *  Every source drafted, in order, 50 texts to a request.
 *
 * @param {string[]} sources
 * @param {Record<string, unknown>} options
 * @param {Deepl} deepl the endpoint, the key and the target locale
 */
async function draftAll(sources, options, deepl) {
  const drafts = [];
  for (let i = 0; i < sources.length; i += BATCH) {
    const batch = sources.slice(i, i + BATCH);
    const response = await fetch(deepl.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${deepl.apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      // The names and legal facts come back exactly as they went in, because
      // `buildRequestBody` wraps them in the tag this request ignores. Built
      // there, not here: in this file it could only be checked by calling the
      // network, and for one release it was not checked at all (#22).
      body: JSON.stringify(buildRequestBody(batch, deepl.target, options)),
    });
    // The status only, never the body: a DeepL error can echo the request.
    if (!response.ok) die(`DeepL responded ${response.status}`);
    // Checked before it is used: the caller pairs drafts with sources by
    // position, so a short answer would shift every later draft.
    drafts.push(...deeplDrafts(await response.json(), batch.length));
    console.log(`  ${Math.min(i + BATCH, sources.length)}/${sources.length}`);
  }
  return drafts;
}

/**
 * Draft the locale named on the command line, or report what a draft would
 * cost.
 *
 * EVERY EFFECT IS IN HERE, reached only under `import.meta.main` (#276).
 * Until then all of it ran at module scope, so importing this file read
 * `DEEPL_API_KEY`, SENT THE CATALOGUE TO DEEPL and rewrote the cache -- from
 * nothing more than a test that wanted one of its helpers.
 *
 * @returns {Promise<void>}
 */
export async function main() {
  // ── arguments ──────────────────────────────────────────────────────────────
  const args = argv.slice(2);
  const send = args.includes('--send');
  const prune = args.includes('--prune');
  const requested = args.find((a) => !a.startsWith('--'));

  // Refused, not ignored: a mistyped `--prune` read as no option at all is a
  // dry run, which at a glance looks like the prune it was meant to be.
  const unknown = args.filter(
    (a) => a.startsWith('--') && !OPTIONS.includes(a),
  );
  if (unknown.length > 0)
    die(`unknown option ${unknown.join(', ')} — ${USAGE}`);
  if (send && prune)
    die('--send and --prune cannot be combined: a send prunes as it writes');
  if (!requested) die(USAGE);
  const locales = args.filter((a) => !a.startsWith('--'));
  if (locales.length > 1)
    die(
      `name one locale, not ${locales.length} (${locales.join(', ')}) — ${USAGE}`,
    );
  if (!isTranslatable(requested))
    die(
      `${requested} is not an MVP locale (${TRANSLATABLE_LOCALES.join(', ')})`,
    );
  if (requested === 'en') die('en is the source language, not a target');

  /**
   * The validated target, as the LOCALE it has just been proved to be.
   *
   * `argv` gives a `string`; every function below takes the locale union, and
   * `Array.prototype.includes` narrows nothing on its own. The predicate above
   * is what makes this a rename rather than a cast that could outlive its own
   * check -- move a guard and this stops compiling, where a cast would go on
   * asserting something nothing had checked.
   */
  const target = requested;

  // ── what would be sent ─────────────────────────────────────────────────────
  const cache = existsSync(CACHE)
    ? JSON.parse(readFileSync(CACHE, 'utf8'))
    : {};

  /**
   * Every distinct sentence the translator is sent, from every catalogue the
   * site ships (`translatableSentences`, one home since #164).
   *
   * Cached by the SOURCE TEXT rather than a hash of it — no collisions, and the
   * cache file stays reviewable in a diff, which matters when the thing being
   * reviewed is a translation.
   */
  const strings = translatableSentences();

  /** The drafts still worth keeping, and the stale ones any write drops (#164). */
  const { kept: known, stale } = pruneDrafts(cache[target] ?? {}, strings);

  /**
   * Never drafted, or cached with a draft whose slots changed: a cached draft
   * `assembleMessage` would refuse is sent again rather than trusted (#136).
   */
  const pending = [...strings].filter((s) => needsSending(s, known[s]));
  const characters = pending.reduce((n, s) => n + s.length, 0);

  console.log(`target        ${target} → DeepL ${deeplLanguage(target)}`);
  console.log(`catalogue     ${strings.size} translatable strings`);
  console.log(`cached        ${strings.size - pending.length}`);
  console.log(
    `to send       ${pending.length} strings, ${characters} characters`,
  );
  console.log(`stale         ${stale.length} drafts no catalogue sends`);
  console.log(`do-not-send   ${DO_NOT_TRANSLATE.length} protected terms`);

  if (prune) {
    // Nothing stale, nothing written: a locale with no drafts is not given an
    // empty entry, and a cache that is already clean is left untouched.
    if (stale.length > 0) writeCache(cache, target, known);
    console.log(
      `\n✓ dropped ${stale.length} stale drafts — nothing sent, no key read.`,
    );
    exit(0);
  }

  if (!send) {
    console.log('\nDRY RUN — nothing sent. Add --send to spend quota.');
    exit(0);
  }

  // ── the call ───────────────────────────────────────────────────────────────
  /**
   * The key, read from the environment or `.env.local` -- and only here, in the
   * one mode that sends. A dry run and a prune never load it.
   *
   * Never printed, never interpolated into a URL or an error. `.env.local` is
   * gitignored (`.env.*`), and the same value lives as a repo secret.
   */
  const apiKey =
    env.DEEPL_API_KEY ??
    (existsSync('.env.local')
      ? (/^DEEPL_API_KEY=(.*)$/m.exec(
          readFileSync('.env.local', 'utf8'),
        )?.[1] ?? '')
      : '');
  if (!apiKey.trim()) die('DEEPL_API_KEY is not set (env or .env.local)');
  const endpoint = deeplEndpoint(apiKey);
  /** @type {Deepl} */
  const deepl = { endpoint, apiKey, target };

  (await draftAll(pending, { tagSlots: false }, deepl)).forEach((draft, n) => {
    known[pending[n]] = draft;
  });

  /**
   * Sent bare, a slot keeps its spacing and the words beside it whole, but DeepL
   * now and then drops one; sent tagged, it is kept but can be glued to a word.
   * So a sentence whose bare draft changed a slot is sent again with its slots
   * tagged, and the better of the two drafts kept (#136, measured in
   * translate.ts).
   */
  const retry = pending.filter((s) => !slotsKept(s, known[s]));
  if (retry.length > 0) {
    console.log(`retrying ${retry.length} with tagged slots`);
    (await draftAll(retry, { tagSlots: true }, deepl)).forEach((draft, n) => {
      known[retry[n]] = betterDraft(retry[n], known[retry[n]], draft);
    });
  }
  const unresolved = retry.filter((s) => !slotsKept(s, known[s]));
  for (const s of unresolved)
    console.log(
      `  both drafts changed a slot — needs a human: ${JSON.stringify(s)}`,
    );

  writeCache(cache, target, known);
  console.log(`\n✓ cache written to ${CACHE}`);
  console.log(`  dropped ${stale.length} stale drafts`);
}

if (import.meta.main) await main();

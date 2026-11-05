/**
 * Every label `.github/dependabot.yml` asks for must exist in the repository.
 *
 * Dependabot does not create a label named under an explicit `labels:` key.
 * It creates its own defaults only when that key is ABSENT — which is why
 * `javascript` exists here and `npm` did not: adding `labels:` to control the
 * labelling silently disabled it. A name with no label behind it is dropped,
 * the pull request opens anyway, and Dependabot posts a configuration-error
 * comment instead. Measured 2026-09-22 on the group PR #265, where
 * "The following labels could not be found: `npm`" had been repeating since
 * 2026-09-21 (#299).
 *
 * WHY A SCRIPT AND NOT A UNIT TEST. `supply-chain.test.ts` reads this same
 * file and asserts its ecosystems, its `target-branch`, its groups and its
 * ignore rules — every claim the file's own bytes can answer. `labels:` is
 * the one entry whose truth lives OUTSIDE the file, in repository state, so
 * no amount of reading the config can judge it. This runs where a token is.
 *
 * It runs in `ci.yml`'s `checks` job, which `build-and-test` needs, and
 * `build-and-test` is in `required_status_checks.contexts`. A new job would
 * not be a gate until that list named it or `build-and-test` needed it, and
 * that list is repository administration (#33, #163).
 *
 * The API call goes through `gh`, never a token this process handles: on a
 * developer's machine `gh` is routed to the `shyden-agent` App, and on a
 * runner it reads `GH_TOKEN` from the step. Either way no credential is
 * read, passed or logged here.
 */

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { argv } from 'node:process';

import { parse } from 'yaml';

import { die, messageOf } from './errors.mjs';

/**
 * A parsed YAML mapping, and not a scalar, a sequence or nothing.
 *
 * `parse()` returns `any`, and a property read off `any` is `any` too, which
 * strips the contextual type from every callback downstream -- the `.mjs`
 * hazard #157 measured, where 17 errors came from one signature. Narrowing
 * here is what gives the rest of this module real types to check against.
 *
 * @param {unknown} value Anything the YAML parser returned.
 * @returns {value is Record<string, unknown>} Whether it is a mapping.
 */
const isRecord = (value) => typeof value === 'object' && value !== null;

/** Where the config lives, relative to the repository root. */
export const DEPENDABOT = '.github/dependabot.yml';

/**
 * Every label named anywhere in the config, deduplicated and sorted.
 *
 * Derived from the PARSED document, so the file's own prose cannot satisfy a
 * check built on this — the same rule the rest of this repo's config guards
 * follow. Derived across EVERY ecosystem too: a hand-written list would cover
 * the ecosystems that existed the day it was written (#24, #49, #80).
 *
 * A label YAML reads as something other than text (`7`, `1.0`, `~`, `true`)
 * is refused rather than dropped: dropping it left a label nobody checked,
 * and `1.0` is no longer the text its author wrote once it has been parsed.
 *
 * @param {string} text The contents of `.github/dependabot.yml`.
 * @returns {string[]} The label names, sorted, without duplicates.
 * @throws {Error} When the config does not parse, or names such a label.
 */
export const declaredLabels = (text) => {
  /** @type {unknown} */
  let doc;
  try {
    doc = parse(text);
  } catch (error) {
    throw new Error(`cannot parse ${DEPENDABOT}: ${messageOf(error)}`);
  }

  const updates =
    isRecord(doc) && Array.isArray(doc.updates) ? doc.updates : [];

  /** @type {unknown[]} */
  const labels = updates.flatMap((entry) =>
    isRecord(entry) && Array.isArray(entry.labels) ? entry.labels : [],
  );

  const unreadable = labels.filter((label) => typeof label !== 'string');
  if (unreadable.length > 0)
    throw new Error(
      `${DEPENDABOT} names labels YAML does not read as text: ` +
        `${unreadable.map((label) => JSON.stringify(label)).join(', ')}.\n` +
        "Quote each one, e.g. labels: ['7'].",
    );

  const names = labels.filter((label) => typeof label === 'string');
  return [...new Set(names)].sort();
};

/**
 * The declared labels that no repository label answers to.
 *
 * Compared case-insensitively because GitHub treats two labels differing only
 * in case as the same label: matching exactly would report a label that plainly
 * exists as missing, and a check that cries wolf is worse than none (#121).
 *
 * @param {string[]} declared Labels the config asks for.
 * @param {string[]} existing Labels the repository actually has.
 * @returns {string[]} The declared labels with no match, in declared order.
 */
export const missingLabels = (declared, existing) => {
  const have = new Set(existing.map((name) => name.toLowerCase()));
  return declared.filter((name) => !have.has(name.toLowerCase()));
};

/**
 * What a developer reads when the check goes red.
 *
 * It names the command that fixes it, because the failure arrives in a CI log
 * where the reader has no repository in front of them.
 *
 * @param {string[]} missing The labels with nothing behind them.
 * @param {string[]} existing Every label the repository has.
 * @returns {string} The refusal.
 */
export const labelRefusal = (missing, existing) =>
  [
    `${DEPENDABOT} names ${missing.length} label${missing.length === 1 ? '' : 's'} this repository does not have:`,
    ...missing.map((name) => `  ${name}`),
    '',
    'Dependabot creates a label only when no `labels:` key names one, so each',
    'of these is dropped and it posts a configuration-error comment instead.',
    '',
    'Create it:  gh label create <name> --description "<what it marks>"',
    'Or stop asking for it: remove the name from the `labels:` list.',
    '',
    `Labels this repository has (${existing.length}): ${existing.join(', ')}`,
  ].join('\n');

/**
 * Every label on the repository `gh` resolves from the checkout.
 *
 * `--paginate` because a repository may hold more labels than one page, and a
 * truncated list reports labels that exist as missing.
 *
 * @returns {string[]} The label names.
 */
export const repositoryLabels = () => {
  const run = spawnSync(
    'gh',
    ['api', '--paginate', '/repos/{owner}/{repo}/labels', '--jq', '.[].name'],
    { encoding: 'utf8' },
  );

  if (run.error) die(`cannot run gh: ${messageOf(run.error)}`);
  if (run.status !== 0)
    die(
      `gh api exited ${run.status} reading this repository's labels.\n` +
        `${(run.stderr ?? '').trim()}`,
    );

  return (run.stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
};

/**
 * Refuse a config naming a label the repository does not have.
 *
 * @returns {void}
 */
const main = () => {
  if (argv.slice(2).length > 0)
    die('usage: node scripts/dependabot-labels.mjs   (no arguments)');

  /** @type {string} */
  let text;
  try {
    text = readFileSync(DEPENDABOT, 'utf8');
  } catch (error) {
    die(`cannot read ${DEPENDABOT}: ${messageOf(error)}`);
  }

  /** @type {string[]} */
  let declared;
  try {
    declared = declaredLabels(text);
  } catch (error) {
    die(messageOf(error));
  }
  // The liveness control. Every assertion below is satisfied for free by an
  // empty set, so a config that stopped naming labels at all -- or a parse
  // that quietly returned nothing -- would read exactly like a clean pass
  // (#112, #118).
  if (declared.length === 0)
    die(
      `${DEPENDABOT} names no labels at all.\n` +
        'Either it lost its `labels:` entries, or this check is reading the wrong file.',
    );

  const existing = repositoryLabels();
  if (existing.length === 0)
    die('gh returned no labels for this repository, which cannot be right.');

  const missing = missingLabels(declared, existing);
  if (missing.length > 0) die(labelRefusal(missing, existing));

  console.log(
    `${DEPENDABOT}: all ${declared.length} declared labels exist (${declared.join(', ')})`,
  );
};

// Only when run, never when imported: the unit suite imports the derivation.
if (import.meta.main) main();

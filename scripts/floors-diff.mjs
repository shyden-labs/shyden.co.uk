#!/usr/bin/env node
/**
 * What the CI recorder (#651) tells the branch it commits to: which floors
 * moved, `id: old -> new`, computed from the two JSON files themselves and
 * never from a hand-kept list.
 *
 *   node scripts/floors-diff.mjs <before.json> <after.json> <mode> <head-message> <message-out>
 *
 * Writes the measured commit's message (`<head-message>`) with the moves
 * added to `<message-out>`, for the amend, appends the summary to
 * `$GITHUB_STEP_SUMMARY`, and sets `changed=true|false` in `$GITHUB_OUTPUT`.
 * It judges nothing: a fall is refused by the recorder before the file is
 * written, and this only words what the recorder wrote.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { argv, env } from 'node:process';

import { die } from './errors.mjs';

/**
 * @typedef {{ id: string, old: number | undefined, next: number | undefined }} Move
 */

/**
 * Every id whose figure differs between the two files, in id order.
 *
 * @param {Readonly<Record<string, number>>} before
 * @param {Readonly<Record<string, number>>} after
 * @returns {Move[]}
 */
export const floorMoves = (before, after) =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .filter((id) => before[id] !== after[id])
    .map((id) => ({ id, old: before[id], next: after[id] }));

/**
 * One move as the commit and the summary word it.
 *
 * @param {Move} move
 * @returns {string}
 */
const line = ({ id, old, next }) =>
  `${id}: ${old === undefined ? 'new' : old} -> ${next === undefined ? 'removed' : next}`;

/** A trailer line as git reads one: `Token: value`. */
const TRAILER = /^[A-Za-z][A-Za-z0-9-]*: \S/;

/**
 * The measured commit's message with the moves added (operator 2026-10-10,
 * "Bot folds into the head": the figures are amended into the commit they
 * were measured on, so every commit stays green on its own). The block goes
 * ahead of the message's trailer paragraph, so `Co-Authored-By` and the rest
 * stay trailers git can read, or last when there is none. The subject is
 * never taken for a trailer, whatever its shape (`chore: x`).
 *
 * @param {string} original the measured commit's message
 * @param {readonly Move[]} moves
 * @param {string} mode `full`, `unit` or `functions`
 * @returns {string}
 */
export const amendedMessage = (original, moves, mode) => {
  const paragraphs = original.trimEnd().split(/\n{2,}/);
  const block = [
    `Floors recorded in CI (${mode}), ${moves.length} moved:`,
    ...moves.map(line),
  ].join('\n');
  const last = paragraphs.at(-1) ?? '';
  const trailers =
    paragraphs.length > 1 &&
    last.split('\n').every((entry) => TRAILER.test(entry));
  const body = trailers
    ? [...paragraphs.slice(0, -1), block, last]
    : [...paragraphs, block];
  return `${body.join('\n\n')}\n`;
};

/**
 * The job summary's lines.
 *
 * @param {readonly Move[]} moves
 * @param {string} mode
 * @returns {string[]}
 */
export const summaryLines = (moves, mode) =>
  moves.length === 0
    ? [`No floor moved (${mode}): nothing committed, nothing dispatched.`]
    : [
        `${moves.length} floor${moves.length === 1 ? '' : 's'} moved (${mode}):`,
        ...moves.map((move) => `- \`${line(move)}\``),
      ];

const main = () => {
  const [beforePath, afterPath, mode, headMessagePath, messagePath, ...rest] =
    argv.slice(2);
  if (
    rest.length > 0 ||
    beforePath === undefined ||
    afterPath === undefined ||
    mode === undefined ||
    headMessagePath === undefined ||
    messagePath === undefined
  )
    die(
      'usage: floors-diff.mjs <before.json> <after.json> <mode> <head-message> <message-out>',
    );
  const moves = floorMoves(
    JSON.parse(readFileSync(beforePath, 'utf8')),
    JSON.parse(readFileSync(afterPath, 'utf8')),
  );
  writeFileSync(
    messagePath,
    amendedMessage(readFileSync(headMessagePath, 'utf8'), moves, mode),
  );
  const summary = summaryLines(moves, mode).join('\n');
  console.log(summary);
  if (env.GITHUB_STEP_SUMMARY)
    appendFileSync(env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  if (env.GITHUB_OUTPUT)
    appendFileSync(env.GITHUB_OUTPUT, `changed=${moves.length > 0}\n`);
};

if (import.meta.main) main();

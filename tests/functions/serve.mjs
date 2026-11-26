#!/usr/bin/env node
/**
 * Build, reset the local D1, apply the real migration, then serve dist/ with
 * the real Functions (#97). Playwright's webServer runs this for every run,
 * never reusing a server, so each run and each mutation meets a fresh build
 * and a fresh database. The first test proves the binding and the migration.
 */
import { readdirSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { nonEmpty } from '../../scripts/errors.mjs';
import { testedCompatibilityDate } from '../../scripts/pages-runtime.mjs';
import {
  DATABASE_ID,
  DEV_PASS_SECRET_YAWELO,
  TEST_PASS_KEYS_ENV,
  PERSIST,
  PORT,
  SECRET,
  d1,
} from './local.mjs';

// This script is measured for coverage, and nothing it starts is (#913): the
// build loads src/ through Vite (#914's), and wrangler is not our code. Node
// fixed this process's coverage folder at startup, so only the children,
// which inherit this environment, lose it. First, before any process starts
// (`web-server-coverage.ts` holds it there).
delete process.env.NODE_V8_COVERAGE;

/** The public half of this run's throwaway DEV pass key, set by the config (#1262 AC2). */
function testPassKeys() {
  const keys = process.env[TEST_PASS_KEYS_ENV];
  if (!keys)
    throw new Error(
      `${TEST_PASS_KEYS_ENV} is not set: run this through playwright.functions.config.ts, which makes the run's key`,
    );
  return keys;
}

/**
 * @param {string} command
 * @param {string[]} args
 */
const step = (command, args) => {
  const run = spawnSync(command, args, { stdio: 'inherit' });
  if (run.status !== 0) {
    console.error(`${command} ${args.join(' ')} exited ${run.status}`);
    process.exit(run.status ?? 1);
  }
};

rmSync(PERSIST, { recursive: true, force: true });
step('npm', ['run', 'build']);
// Every migration, in order, read from the directory: a new one is applied
// the day it is added (#872). nonEmpty fails the run on an empty read.
for (const file of nonEmpty(
  readdirSync('migrations')
    .filter((name) => name.endsWith('.sql'))
    .sort(),
  'migrations',
))
  d1(['--file', `migrations/${file}`]);

const server = spawn(
  'npx',
  [
    'wrangler',
    'pages',
    'dev',
    'dist',
    '--ip',
    '127.0.0.1',
    '--port',
    String(PORT),
    '--compatibility-date',
    // The date's one home is ./wrangler.toml, which each deploy also sets
    // both Pages projects to (#907).
    testedCompatibilityDate(),
    '--d1',
    `REPORTS=${DATABASE_ID}`,
    '--persist-to',
    PERSIST,
    '--binding',
    `DEV_PASS_KEYS=${testPassKeys()}`,
    // #872: the limits on, at their defaults, so every report below runs
    // the counting batch on real D1.
    '--binding',
    'REPORT_LIMITS=on',
    '--binding',
    `REPORT_COUNTER_SECRET=${SECRET}`,
    // #1192: Yawelo Idle's dev-pass secret only; ShyTalk's stays unset.
    '--binding',
    `DEV_PASS_SECRET_YAWELO=${DEV_PASS_SECRET_YAWELO}`,
  ],
  {
    stdio: 'inherit',
    // `pages dev` otherwise loads .env.local unasked, which on a developer's
    // machine hands its secrets (the DeepL key) to the code under test.
    // Naming an --env-file does not stop that; this switch does (measured,
    // #97 Task 10: the startup banner then listed the gate's setting alone).
    //
    // The tests reach D1 through this server's own D1 object, on miniflare's
    // local explorer (`query` in local.mjs, #737). wrangler turns it on by
    // default; saying so here keeps it on if that default changes. Were
    // wrangler to drop the explorer, the first query would fail in the
    // server's own words, never quietly fall back to a second process.
    env: {
      ...process.env,
      CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
      X_LOCAL_EXPLORER: 'true',
    },
  },
);
for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM']))
  process.on(signal, () => server.kill(signal));
server.on('exit', (code) => process.exit(code ?? 1));

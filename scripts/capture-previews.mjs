#!/usr/bin/env node
/**
 * Captures every page's link preview (#1158): a 1200x630 screenshot of the
 * top of each page in each language, taken from the built site, written to
 * `public/previews/<locale>/<page>.png` and committed. Shyden ruled
 * (2026-11-14) that a link's preview is a picture of the page it opens.
 *
 * Run after any change to how the top of a page looks:
 *   npm run build && node scripts/capture-previews.mjs
 * then look at each image before committing it.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from '@playwright/test';

const PORT = 4329;
const ORIGIN = `http://localhost:${PORT}`;
const START_CEILING_MS = 30_000;

/** The paths to capture, read from the site's own list. */
async function previewPaths() {
  const { LOCALES } = await import('../src/lib/i18n/locales.ts');
  const { PREVIEW_PAGES, previewImageFor, PREVIEW_WIDTH, PREVIEW_HEIGHT } =
    await import('../src/lib/preview-image.ts');
  const pages = LOCALES.flatMap((locale) =>
    PREVIEW_PAGES.map((page) => (locale === 'en' ? page : `/${locale}${page}`)),
  );
  return {
    shots: pages.map((path) => ({ path, image: previewImageFor(path) })),
    viewport: { width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT },
  };
}

/** @param {import('node:child_process').ChildProcess} server */
async function waitForServer(server) {
  const deadline = Date.now() + START_CEILING_MS;
  while (Date.now() < deadline) {
    if (server.exitCode !== null)
      throw new Error(`astro preview exited with ${server.exitCode}`);
    const answered = await fetch(ORIGIN).then(
      (response) => response.ok,
      () => false,
    );
    if (answered) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`astro preview did not answer on ${ORIGIN} within 30 s`);
}

async function main() {
  if (process.argv.length > 2) {
    console.error(
      'usage: node scripts/capture-previews.mjs (it takes no arguments)',
    );
    process.exit(2);
  }
  const { shots, viewport } = await previewPaths();
  const server = spawn(
    'npx',
    ['astro', 'preview', '--port', String(PORT), '--host', 'localhost'],
    { stdio: 'ignore' },
  );
  try {
    await waitForServer(server);
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport, colorScheme: 'light' });
      for (const { path, image } of shots) {
        const response = await page.goto(`${ORIGIN}${path}`);
        if (!response?.ok())
          throw new Error(`${path} answered ${response?.status()}`);
        await page.evaluate(() => document.fonts.ready);
        const file = `public${image}`;
        mkdirSync(dirname(file), { recursive: true });
        await page.screenshot({ path: file, animations: 'disabled' });
        console.log(`${path} -> ${file}`);
      }
    } finally {
      await browser.close();
    }
  } finally {
    server.kill();
  }
}

if (import.meta.main) await main();

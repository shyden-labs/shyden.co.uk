/**
 * Records `tests/ios-ceilings.json`: how many tests, assertions, indirect
 * checks (calls to a helper that asserts or throws, and throws) and calls into
 * the harness (the phone session and what it returns) each test and hook under
 * `tests/device/ios/` makes (#858). The ceilings only ever fall. The
 * first record takes the figures as measured; after that a fall is written
 * and a rise refuses the whole record, naming it, because the only way a
 * count rises is a check added to an iPhone-only file, and a phone check is
 * one test both phones run (#839). Every figure that moves is printed.
 *
 * A record, not a suite: it reads files and writes one, and runs on the
 * laptop like `npm run format`. The guard that judges the result is
 * `tests/guards/ios-ceilings.test.ts`, which is CI's. The readers are
 * TypeScript with extensionless imports, so they load through the Vite
 * server `vitest/node` exports.
 *
 *   node scripts/record-ios-ceilings.mjs     (npm run ceilings:record)
 */
import { existsSync, writeFileSync } from 'node:fs';

async function main() {
  if (process.argv.length > 2) {
    console.error(
      'usage: node scripts/record-ios-ceilings.mjs (takes no arguments)',
    );
    process.exit(1);
  }
  const { createViteServer } = await import('vitest/node');
  const server = await createViteServer({
    root: process.cwd(),
    configFile: false,
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    /** @type {typeof import('../tests/ios-ceilings')} */
    const core = /** @type {any} */ (
      await server.ssrLoadModule('/tests/ios-ceilings.ts')
    );
    const reading = core.judgeSources(core.readIosSources(), core.readModule);
    const recorded = existsSync(core.CEILINGS_FILE)
      ? core.readCeilings()
      : undefined;
    const { next, refusals, deltas } = core.decideCeilings(
      reading.counts,
      recorded,
    );
    for (const delta of deltas) console.log(`ceilings: ${delta}`);
    const refused = [...reading.refusals, ...refusals];
    if (refused.length > 0 || next === undefined) {
      for (const reason of refused) console.error(`✗ ${reason}`);
      console.error('✗ nothing recorded');
      process.exitCode = 1;
      return;
    }
    writeFileSync(core.CEILINGS_FILE, `${JSON.stringify(next, null, 2)}\n`);
    console.log(
      `ceilings: ${Object.keys(next).length} files written to ${core.CEILINGS_FILE}, ${deltas.length} figures moved`,
    );
  } finally {
    await server.close();
  }
}

if (import.meta.main) await main();

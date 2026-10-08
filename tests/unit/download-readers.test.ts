import { describe, it, expect } from 'vitest';
import { expectNothingFound, type Reading } from './spec-scan';
import ts from 'typescript';
import { parseSource } from './ast';
import { callsIn, lineOf } from '../playwright-declarations';
import { withoutTsComments } from './source-text';
import { searched } from '../source-files';
import { floorBreach } from '../floors';

/**
 * A download's bytes are read in ONE place: `downloadText` (tests/e2e/helpers.ts).
 *
 * On the real Android phone a download is saved ON THE PHONE, and `downloadText` is the only
 * reader that knows to fetch it back over adb; `download.createReadStream()` and
 * `download.saveAs()` read Playwright's copy on the Mac, which a phone run never has (#308).
 * Until #308 the phone could not save a download at all, and every test reading bytes carried
 * `@requires-download-bytes` so the phone run could exclude it; this file replaced the guard that
 * kept that tag honest. The phone now runs those tests, so the invariant moved from "tagged" to
 * "read through the one reader that works everywhere".
 *
 * The exemption is structural, not a path: a read is allowed only INSIDE the declaration named
 * `downloadText`, so the helper can read what every spec must not.
 */

/** `Download`'s own byte readers. `path()` is left out: the name is far too common to mean it. */
const DIRECT_READERS = ['createReadStream', 'saveAs'];
const HOME = 'downloadText';

const calleeName = ({ expression }: ts.CallExpression): string | undefined =>
  ts.isPropertyAccessExpression(expression)
    ? expression.name.text
    : ts.isIdentifier(expression)
      ? expression.text
      : undefined;

/** True when `node` sits inside a variable or function declared with the home's name. */
const insideHome = (node: ts.Node): boolean => {
  for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
    if (
      (ts.isVariableDeclaration(at) || ts.isFunctionDeclaration(at)) &&
      at.name !== undefined &&
      ts.isIdentifier(at.name) &&
      at.name.text === HOME
    )
      return true;
  }
  return false;
};

/** A read of a download's bytes: the home's own call, or a direct reader's. */
const readsBytes = (call: ts.CallExpression): boolean =>
  calleeName(call) === HOME ||
  (DIRECT_READERS.includes(calleeName(call) ?? '') &&
    ts.isPropertyAccessExpression(call.expression));

/**
 * The same reads, as text: a call to the home or to a direct reader, comments
 * stripped. Independent of the parse tree, so a reader gone blind to a form
 * is caught by the file it found nothing in (#446).
 */
const BYTE_READ = /\bdownloadText\s*\(|\.(?:createReadStream|saveAs)\s*\(/;

/** The whole guard as one pure function of (path, source text): every byte read judged, and the ones outside the home. */
function read(file: string, text: string): Reading {
  const sf = parseSource(text, file);
  const reads = callsIn(sf).filter(readsBytes);
  const findings = reads
    .filter((call) => calleeName(call) !== HOME)
    .filter((call) => !insideHome(call))
    .map(
      (call) =>
        `${file}:${lineOf(sf, call)} reads a download's bytes with \`${calleeName(call)}\` ` +
        `instead of \`${HOME}\`, the only reader that works on the real phone (#308)`,
    );
  const judged = reads.map((call) => `${file}:${lineOf(sf, call)}`);
  return { judged, findings };
}

/** The findings alone, which is all the synthetic cases below ask about. */
const analyze = (file: string, text: string): readonly string[] =>
  read(file, text).findings;

describe('a download’s bytes are read only through downloadText', () => {
  it('no spec reads them any other way', () => {
    // Guards the guard: a scan that found no reads at all -- because the
    // helper was renamed, or `tests/e2e` moved -- would otherwise report a
    // clean sweep it never performed. Counted in reads, not in the files that
    // hold them, and ratcheted (#468).
    expectNothingFound(read, {
      what: 'download byte reads',
      floor: 'download-readers/byte-reads',
      carries: (_file, source) => BYTE_READ.test(withoutTsComments(source)),
    });
  });
});

describe('analyze() -- the scanner proven on synthetic input, not just trusted', () => {
  const scanned = (src: string[]) =>
    analyze('synthetic.spec.ts', src.join('\n'));
  /** Every byte read the scanner judged in the same input. */
  const judgedIn = (src: string[]) =>
    read('synthetic.spec.ts', src.join('\n')).judged;

  it('flags a spec reading a download with createReadStream, naming file and line', () => {
    const findings = scanned([
      "test('exports the roster', async ({ page }) => {",
      "  const [download] = await Promise.all([page.waitForEvent('download'), save(page)]);",
      '  const stream = await download.createReadStream();',
      '});',
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('synthetic.spec.ts:3');
    expect(findings[0]).toContain('createReadStream');
  });

  it('flags saveAs the same way', () => {
    const findings = scanned(["await download.saveAs('/tmp/x.csv');"]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('saveAs');
  });

  it('accepts a spec that reads through downloadText', () => {
    const src = ["const text = await downloadText(page, 'Download template');"];
    const reads = judgedIn(src);
    expect(
      searched(scanned(src), { of: reads, what: 'download byte reads' }),
    ).toEqual([]);
    expect(
      floorBreach('download-readers/accepted-reads', reads.length),
    ).toBeUndefined();
  });

  it('allows the read inside the home, and only there', () => {
    const home = [
      'export const downloadText = async (page, button) => {',
      '  const stream = await download.createReadStream();',
      '};',
    ];
    const reads = judgedIn(home);
    expect(
      searched(scanned(home), { of: reads, what: 'download byte reads' }),
    ).toEqual([]);
    expect(
      floorBreach('download-readers/reads-inside-home', reads.length),
    ).toBeUndefined();
    const elsewhere = home.map((line) =>
      line.replace('downloadText', 'readItMyself'),
    );
    expect(scanned(elsewhere)).toHaveLength(1);
  });

  it('ignores a read written only in a comment or a string', () => {
    // No call is a read here, so the units the scanner walked are the two
    // lines it was handed, each naming a direct reader in prose.
    const lines = [
      '// never call download.createReadStream() in a spec',
      "const hint = 'use download.saveAs() only in helpers';",
    ];
    expect(
      searched(scanned(lines), { of: lines, what: 'lines naming a reader' }),
    ).toEqual([]);
    expect(
      floorBreach('download-readers/commented-lines', lines.length),
    ).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { parseSource } from './ast';
import { presenceOverRawText } from './presence-text';

/**
 * The text reading anchored-presence's dataflow reader is checked against
 * (#477). Each form is written out by hand, never generated from either
 * reader's list (#446).
 */
const count = (...lines: string[]): number =>
  presenceOverRawText(parseSource(lines.join('\n'), 'fixture.test.ts'));

describe('presenceOverRawText counts, as text, presence over raw file text (#477)', () => {
  it('counts one whose subject reads the file in place', () => {
    expect(count("expect(readFileSync('a', 'utf8')).toContain('x');")).toBe(1);
  });

  it('counts toMatch as toContain', () => {
    expect(count("expect(readFileSync('a', 'utf8')).toMatch(/x/);")).toBe(1);
  });

  it('counts expect.soft as expect', () => {
    expect(
      count("expect.soft(readFileSync('a', 'utf8')).toContain('x');"),
    ).toBe(1);
  });

  it('reads an assertion prettier split over lines', () => {
    expect(
      count('expect(', "  readFileSync('a', 'utf8'),", ").toContain('x');"),
    ).toBe(1);
  });

  it('follows a binding that reads the file', () => {
    expect(
      count(
        "const text = readFileSync('a', 'utf8');",
        "expect(text).toContain('x');",
      ),
    ).toBe(1);
  });

  it('follows a function whose body reads it', () => {
    expect(
      count(
        "function read(path: string) { return readFileSync(path, 'utf8'); }",
        "expect(read('a')).toContain('x');",
      ),
    ).toBe(1);
  });

  it('follows bindings to a fixed point', () => {
    expect(
      count(
        "const lines = raw.split('\\n');",
        "const raw = readFileSync('a', 'utf8');",
        "expect(lines).toContain('x');",
      ),
    ).toBe(1);
  });

  it('sees a binding the enclosing describe makes', () => {
    expect(
      count(
        "describe('d', () => {",
        "  const text = readFileSync('a', 'utf8');",
        "  it('b', () => {",
        "    expect(text).toContain('x');",
        '  });',
        '});',
      ),
    ).toBe(1);
  });

  it('counts none through a JSON.parse', () => {
    expect(
      count(
        "const data = JSON.parse(readFileSync('a', 'utf8'));",
        "expect(data.keys).toContain('x');",
      ),
    ).toBe(0);
  });

  it('does not see a binding another test makes', () => {
    expect(
      count(
        "it('a', () => {",
        "  const text = readFileSync('a', 'utf8');",
        '});',
        "it('b', () => {",
        "  expect(text).toContain('x');",
        '});',
      ),
    ).toBe(0);
  });

  it('counts no inverse', () => {
    expect(count("expect(readFileSync('a', 'utf8')).not.toContain('x');")).toBe(
      0,
    );
  });

  it('counts none over a value read some other way', () => {
    expect(count("expect(page.url()).toContain('x');")).toBe(0);
  });

  it('takes neither a longer name nor a property for a binding', () => {
    expect(
      count(
        "const text = readFileSync('a', 'utf8');",
        "expect(context).toContain('x');",
        "expect(page.text).toContain('x');",
      ),
    ).toBe(0);
  });

  it('counts none a string, a template or a comment spells', () => {
    expect(
      count(
        "const s = \"expect(readFileSync('a')).toContain('x')\";",
        "const t = `expect(${readFileSync('a')}).toContain('x')`;",
        "// expect(readFileSync('a')).toContain('x');",
      ),
    ).toBe(0);
  });
});

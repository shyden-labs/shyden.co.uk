import { describe, expect, it } from 'vitest';
import { RETIRED_TOOL, retiredToolHits } from '../retired-tools';

/** The matcher behind the guard that keeps the retired tool out of the iPhone run (#859). */
describe('retiredToolHits: files whose code, not comments, names the retired tool', () => {
  it('finds the name in code', () => {
    expect(
      retiredToolHits([
        { path: 'a.ts', text: `spawn('${RETIRED_TOOL}', ['-p', '1']);` },
      ]),
    ).toEqual(['a.ts']);
  });

  it('passes a name that stands only in comments', () => {
    expect(
      retiredToolHits([
        {
          path: 'b.mjs',
          text: `// replaced ${RETIRED_TOOL}\n/* ${RETIRED_TOOL} */\nconst x = 1;`,
        },
      ]),
    ).toEqual([]);
  });

  it('reads a JSON file whole, since JSON has no comments', () => {
    expect(
      retiredToolHits([
        { path: 'package.json', text: `{ "x": "${RETIRED_TOOL} -p 1" }` },
      ]),
    ).toEqual(['package.json']);
  });

  it('spells the name the guard looks for', () => {
    expect(RETIRED_TOOL).toBe(['safari', 'driver'].join(''));
  });
});

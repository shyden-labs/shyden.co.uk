import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  NAME_MATCHES_SOURCE,
  NORMALISE_SOURCE,
} from '../device/ios/playwright-rules';
import {
  accessibleTextsOf,
  expectEventually,
  expectLocator,
} from '../device/ios/dom';
import { DomDispatchInteraction } from '../device/ios/interaction';
import {
  expectAccessibleName,
  expectRole,
  expectRoleAttribute,
} from '../device/ios/roles';
import type { WebDriver, WebElement } from '../device/ios/webdriver';

/**
 * The iPhone mirrors keep Playwright's meaning (#821): the in-page rules are
 * written once as source, sent to Safari as they are, and run here in a fresh
 * context, the way the page runs them, so a rule that leans on anything
 * outside itself fails here too.
 */
const normalise = runInNewContext(NORMALISE_SOURCE) as (
  s: string | null,
) => string;
const nameMatches = runInNewContext(NAME_MATCHES_SOURCE) as (
  actual: string,
  wanted: string,
  exact: boolean,
) => boolean;

/** Built from char codes so no tool can turn the escape into the character. */
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
const SOFT_HYPHEN = String.fromCharCode(0xad);

describe("Playwright's whitespace rule, as the page reads text", () => {
  test('zero-width spaces and soft hyphens are dropped, as Playwright drops them', () => {
    expect(normalise(`Glo${ZERO_WIDTH_SPACE}ry Po${SOFT_HYPHEN}ints`)).toBe(
      'Glory Points',
    );
  });

  test('runs of whitespace collapse to one space and the ends are trimmed', () => {
    expect(normalise('\n  Make \t\n groups  ')).toBe('Make groups');
  });

  test('a missing text reads as empty', () => {
    expect(normalise(null)).toBe('');
  });
});

describe("Playwright's name rule for getByRole, getByLabel and getByText", () => {
  test('without exact, any part of the name matches, ignoring case', () => {
    expect(nameMatches('Make Groups now', 'make groups', false)).toBe(true);
  });

  test('without exact, a name that does not contain the text does not match', () => {
    expect(nameMatches('Make Groups', 'Shuffle', false)).toBe(false);
  });

  test('with exact, only the whole name matches', () => {
    expect(nameMatches('Make Groups now', 'Make Groups', true)).toBe(false);
  });

  test('with exact, case counts', () => {
    expect(nameMatches('Make Groups', 'make groups', true)).toBe(false);
  });

  test('with exact, the same name matches', () => {
    expect(nameMatches('Make Groups', 'Make Groups', true)).toBe(true);
  });
});

describe("expectEventually retries as Playwright's assertions do", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('passes once the reading reaches the expected value inside 5 s', async () => {
    const readings = [1, 1, 2];
    const read = vi.fn(async () => readings.shift() ?? 2);
    const settled = expectEventually(read, 2, 'the count');
    await vi.advanceTimersByTimeAsync(200);
    await expect(settled).resolves.toBeUndefined();
    expect(read).toHaveBeenCalledTimes(3);
  });

  test('fails after 5 s with its message and the last reading', async () => {
    const settled = expectEventually(async () => 1, 2, 'the count');
    const verdict = expect(settled).rejects.toThrow(
      /the count: expected 1 to deeply equal 2/,
    );
    await vi.advanceTimersByTimeAsync(5_100);
    await verdict;
  });

  test('is still reading at 4.9 s', async () => {
    let reads = 0;
    const settled = expectEventually(
      async () => {
        reads += 1;
        return reads >= 50 ? 'done' : 'waiting';
      },
      'done',
      'the state',
    );
    await vi.advanceTimersByTimeAsync(4_900);
    await expect(settled).resolves.toBeUndefined();
  });
});

/** A driver whose every page read answers the next of `readings` (the last repeats). */
const readingDriver = (readings: unknown[]) => {
  const calls: { script: string; args: unknown[] }[] = [];
  const driver = {
    executeScript: vi.fn(async (script: string, args: unknown[] = []) => {
      calls.push({ script, args });
      return readings.length > 1 ? readings.shift() : readings[0];
    }),
  } as unknown as WebDriver;
  return { driver, calls };
};

describe("expectLocator is Playwright's web-first expect on a selector", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('toHaveText waits for the text to arrive', async () => {
    const { driver } = readingDriver([[], ['7B — your groups']]);
    const settled = expectLocator(driver, '#cg-results-h').toHaveText(
      '7B — your groups',
    );
    await vi.advanceTimersByTimeAsync(100);
    await expect(settled).resolves.toBeUndefined();
  });

  test('toHaveText with one string fails on two matches, as strict mode does', async () => {
    const { driver } = readingDriver([['Live', 'Live']]);
    const verdict = expect(
      expectLocator(driver, '.status-badge').toHaveText('Live'),
    ).rejects.toThrow(/\.status-badge text/);
    await vi.advanceTimersByTimeAsync(5_100);
    await verdict;
  });

  test('toHaveText with a list matches every element in order', async () => {
    const { driver } = readingDriver([['a', 'b']]);
    await expect(
      expectLocator(driver, 'li').toHaveText(['a', 'b']),
    ).resolves.toBeUndefined();
  });

  test('toHaveCount waits for the count', async () => {
    const { driver } = readingDriver([1, 2]);
    const settled = expectLocator(driver, '.group').toHaveCount(2);
    await vi.advanceTimersByTimeAsync(100);
    await expect(settled).resolves.toBeUndefined();
  });

  test('toBeVisible fails on a hidden match', async () => {
    const { driver } = readingDriver([[false]]);
    const verdict = expect(
      expectLocator(driver, '.hero h1').toBeVisible(),
    ).rejects.toThrow(/\.hero h1 visible/);
    await vi.advanceTimersByTimeAsync(5_100);
    await verdict;
  });

  test('toBeVisible fails on two shown matches, as strict mode does', async () => {
    const { driver } = readingDriver([[true, true]]);
    const verdict = expect(
      expectLocator(driver, 'h1').toBeVisible(),
    ).rejects.toThrow(/h1 visible/);
    await vi.advanceTimersByTimeAsync(5_100);
    await verdict;
  });

  test('toContainText with a pattern passes on the one match that holds it', async () => {
    const { driver } = readingDriver([['Shyden makes small software']]);
    await expect(
      expectLocator(driver, 'h1').toContainText(/shyden/i),
    ).resolves.toBeUndefined();
  });

  test('toContainText fails on two matches, as strict mode does', async () => {
    const { driver } = readingDriver([['Shyden', 'Shyden']]);
    const verdict = expect(
      expectLocator(driver, 'h1').toContainText(/Shyden/),
    ).rejects.toThrow(/h1 contains/);
    await vi.advanceTimersByTimeAsync(5_100);
    await verdict;
  });

  test('toContainText with a string is case-sensitive, as Playwright is', async () => {
    const { driver } = readingDriver([['Shyden']]);
    const verdict = expect(
      expectLocator(driver, 'h1').toContainText('shyden'),
    ).rejects.toThrow(/h1 contains/);
    await vi.advanceTimersByTimeAsync(5_100);
    await verdict;
  });

  test('toHaveCSS reads the computed property of the one match', async () => {
    const { driver, calls } = readingDriver([['rgb(1, 2, 3)']]);
    await expectLocator(driver, '.mark').toHaveCSS('color', 'rgb(1, 2, 3)');
    expect(calls[0].script).toContain('getComputedStyle(el)');
    expect(calls[0].args).toEqual(['.mark', 'color']);
  });

  test('toBeHidden passes when nothing matches', async () => {
    const { driver } = readingDriver([[]]);
    await expect(
      expectLocator(driver, '.gone').toBeHidden(),
    ).resolves.toBeUndefined();
  });

  test('toBeHidden waits for the one match to hide', async () => {
    const { driver } = readingDriver([[true], [false]]);
    const settled = expectLocator(driver, 'svg.play').toBeHidden();
    await vi.advanceTimersByTimeAsync(100);
    await expect(settled).resolves.toBeUndefined();
  });

  test('toBeHidden fails on two matches, as strict mode does', async () => {
    const { driver } = readingDriver([[false, false]]);
    const verdict = expect(
      expectLocator(driver, 'svg').toBeHidden(),
    ).rejects.toThrow(/svg hidden/);
    await vi.advanceTimersByTimeAsync(5_100);
    await verdict;
  });

  test('nth picks one of the matches, as locator.nth does', async () => {
    const { driver } = readingDriver([['https://a', 'https://b']]);
    await expect(
      expectLocator(driver, '.hero a', { nth: 1 }).toHaveAttribute(
        'href',
        'https://b',
      ),
    ).resolves.toBeUndefined();
  });

  test('nth -1 is the last match, as locator.last() is', async () => {
    const { driver } = readingDriver([['a', 'b', 'c']]);
    await expect(
      expectLocator(driver, 'li', { nth: -1 }).toHaveText('c'),
    ).resolves.toBeUndefined();
  });

  test('nth past the matches finds nothing, so it never passes on a neighbour', async () => {
    const { driver } = readingDriver([[true]]);
    const verdict = expect(
      expectLocator(driver, '.badge', { nth: 1 }).toBeVisible(),
    ).rejects.toThrow(/\.badge \(nth 1\) visible: expected \[\]/);
    await vi.advanceTimersByTimeAsync(5_100);
    await verdict;
  });

  test('toHaveAttribute reads the named attribute of the one match', async () => {
    const { driver, calls } = readingDriver([['noopener noreferrer']]);
    await expectLocator(driver, '#shytalk a').toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
    expect(calls[0].script).toContain('getAttribute(arguments[1])');
    expect(calls[0].args).toEqual(['#shytalk a', 'rel']);
  });
});

describe('expectRoleAttribute is expect(getByRole(...)).toHaveAttribute', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Finds nothing for the first `misses` lookups, then the one control `e1`. */
  const roleDriver = (misses: number, attribute: string) => {
    const reads: unknown[][] = [];
    let lookups = 0;
    const driver = {
      elementRef: (id: string) => ({ id }),
      findByScript: vi.fn(async () => {
        lookups += 1;
        if (lookups <= misses) throw new Error('0 link named "Email me"');
        return { elementId: 'e1' };
      }),
      executeScript: vi.fn(async (_script: string, args: unknown[]) => {
        reads.push(args);
        return attribute;
      }),
    } as unknown as WebDriver;
    return { driver, reads, lookups: () => lookups };
  };

  test('finds the control afresh until it appears, as a locator does', async () => {
    const { driver, lookups } = roleDriver(2, 'mailto:support@shyden.co.uk');
    const settled = expectRoleAttribute(
      driver,
      'link',
      'Email me',
      { exact: true, scope: '#contact' },
      'href',
      'mailto:support@shyden.co.uk',
    );
    await vi.advanceTimersByTimeAsync(200);
    await expect(settled).resolves.toBeUndefined();
    expect(lookups()).toBe(3);
  });

  test('reads the named attribute of the control it found', async () => {
    const { driver, reads } = roleDriver(0, 'noopener noreferrer');
    await expectRoleAttribute(
      driver,
      'link',
      'Explore ShyTalk',
      { exact: false, scope: '.hero' },
      'rel',
      'noopener noreferrer',
    );
    expect(reads[0]).toEqual([{ id: 'e1' }, 'rel']);
  });

  test('fails after 5 s naming why the control was not found', async () => {
    const { driver } = roleDriver(1_000, '');
    const verdict = expect(
      expectRoleAttribute(
        driver,
        'link',
        'Email me',
        { exact: true },
        'href',
        'mailto:support@shyden.co.uk',
      ),
    ).rejects.toThrow(/0 link named "Email me"/);
    await vi.advanceTimersByTimeAsync(5_100);
    await verdict;
  });
});

describe('expectRole is expect(getByRole(role, { name, exact }))', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const unticked = { visible: true, checked: false };

  test('toHaveCount waits for the control to appear', async () => {
    const { driver } = readingDriver([[], [unticked]]);
    const settled = expectRole(driver, 'checkbox', 'Pause motion', {
      exact: true,
    }).toHaveCount(1);
    await vi.advanceTimersByTimeAsync(100);
    await expect(settled).resolves.toBeUndefined();
  });

  test('sends the role, the name and the exact rule to the page', async () => {
    const { driver, calls } = readingDriver([[unticked]]);
    await expectRole(driver, 'checkbox', 'Pause motion', {
      exact: true,
      scope: '.band',
    }).toHaveCount(1);
    expect(calls[0].args.slice(1, 5)).toEqual([
      'Pause motion',
      '.band',
      'checkbox',
      true,
    ]);
  });

  test('a heading level narrows the role to that level, as getByRole level does', async () => {
    const { driver, calls } = readingDriver([[unticked]]);
    await expectRole(driver, 'heading', 'Page not found', {
      exact: false,
      level: 2,
    }).toHaveCount(1);
    expect(calls[0].args[0]).toBe('h2, [role="heading"][aria-level="2"]');
  });

  test('toBeChecked(false) fails on a ticked box', async () => {
    const { driver } = readingDriver([[{ visible: true, checked: true }]]);
    const verdict = expect(
      expectRole(driver, 'checkbox', 'Pause motion', {
        exact: true,
      }).toBeChecked(false),
    ).rejects.toThrow(/checkbox named "Pause motion" checked/);
    await vi.advanceTimersByTimeAsync(5_100);
    await verdict;
  });

  test('toBeVisible fails on two matches, as strict mode does', async () => {
    const { driver } = readingDriver([[unticked, unticked]]);
    const verdict = expect(
      expectRole(driver, 'checkbox', 'Pause', { exact: false }).toBeVisible(),
    ).rejects.toThrow(/checkbox named "Pause" visible/);
    await vi.advanceTimersByTimeAsync(5_100);
    await verdict;
  });
});

describe("expectAccessibleName is Playwright's toHaveAccessibleName", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('passes on the one match whose computed name is the name', async () => {
    const { driver, calls } = readingDriver([['Language']]);
    await expectAccessibleName(driver, 'details > summary', 'Language');
    expect(calls[0].script).toContain('nameOf');
    expect(calls[0].args).toEqual(['details > summary']);
  });

  test('a name that only contains the text fails, as a string name must match whole', async () => {
    const { driver } = readingDriver([['Language: English']]);
    const verdict = expect(
      expectAccessibleName(driver, 'summary', 'Language'),
    ).rejects.toThrow(/summary accessible name/);
    await vi.advanceTimersByTimeAsync(5_100);
    await verdict;
  });
});

describe('accessibleTextsOf reads what an aria snapshot reads', () => {
  test('sends the selector and returns one spoken text per match', async () => {
    const { driver, calls } = readingDriver([['Beta (unverified)']]);
    expect(await accessibleTextsOf(driver, '.badge')).toEqual([
      'Beta (unverified)',
    ]);
    expect(calls[0].script).toContain('aria-hidden');
    expect(calls[0].args).toEqual(['.badge']);
  });
});

/**
 * A driver that answers only what the interaction layer asks: each in-page
 * script's answer comes from `answers`, in order, and every element property
 * from `checked`.
 */
const fakeDriver = (answers: string[]) => {
  const scripts: string[] = [];
  const driver = {
    elementRef: (id: string) => ({ id }),
    executeScript: vi.fn(async (script: string) => {
      scripts.push(script);
      return script.includes('isConnected') ? (answers.shift() ?? 'ok') : null;
    }),
  } as unknown as WebDriver;
  return { driver, scripts };
};

const fakeElement = (checked: boolean[]) =>
  ({
    elementId: 'e1',
    property: vi.fn(async () => checked.shift()),
    click: vi.fn(async () => undefined),
  }) as unknown as WebElement;

describe("a click waits as Playwright's actionability check does", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('a click waits until the element is enabled, then clicks', async () => {
    const { driver, scripts } = fakeDriver(['not enabled', 'ok']);
    const clicked = new DomDispatchInteraction(driver).click(fakeElement([]));
    await vi.advanceTimersByTimeAsync(100);
    await clicked;
    expect(
      scripts.map((s) => (s.includes('isConnected') ? 'check' : 'click')),
    ).toEqual(['check', 'check', 'click']);
  });

  test('a click on an element that stays disabled fails after 5 s, naming why', async () => {
    const { driver, scripts } = fakeDriver(
      Array.from({ length: 60 }, () => 'not enabled'),
    );
    const clicked = new DomDispatchInteraction(driver).click(fakeElement([]));
    const verdict = expect(clicked).rejects.toThrow(
      'click: the element stayed not enabled for 5 s',
    );
    await vi.advanceTimersByTimeAsync(5_100);
    await verdict;
    // A check at 0 ms and every 100 ms to the 5 s ceiling, and no click.
    expect(
      scripts.map((s) => (s.includes('isConnected') ? 'check' : 'click')),
    ).toEqual(Array.from({ length: 51 }, () => 'check'));
  });
});

describe("setChecked is Playwright's check and uncheck", () => {
  test('a box that already reads checked is not clicked', async () => {
    const { driver } = fakeDriver([]);
    const box = fakeElement([true]);
    await new DomDispatchInteraction(driver).setChecked(box, true);
    // One read of its state, and it returns: a click would read it again.
    expect(box.property).toHaveBeenCalledTimes(1);
  });

  test('a box the click leaves unchanged is refused', async () => {
    const { driver } = fakeDriver(['ok']);
    await expect(
      new DomDispatchInteraction(driver).setChecked(
        fakeElement([false, false]),
        true,
      ),
    ).rejects.toThrow(
      'Clicking the checkbox did not change its state to checked',
    );
  });

  test('a box the click changes is accepted', async () => {
    const { driver, scripts } = fakeDriver(['ok']);
    await new DomDispatchInteraction(driver).setChecked(
      fakeElement([true, false]),
      false,
    );
    expect(scripts.filter((s) => s.includes('.click()'))).toHaveLength(1);
  });
});

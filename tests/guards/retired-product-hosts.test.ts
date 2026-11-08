import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { filesUnder, searched } from '../source-files';

/**
 * The products moved to their own domains (Shyden, 2026-11-08, #1084). The old
 * ShyTalk hosts and Yawelo Idle's old production host stay out of everything
 * that ships or configures a build. Yawelo Idle's dev host is not retired: it
 * has `dev.` in front, which the pattern refuses to read as the production host.
 *
 * The one exception, ruled by Shyden: the promo video's closing frame still
 * shows Yawelo Idle's old address, and its written description says what the
 * video shows. Goes when Yawelo Idle re-cuts the video.
 */
const RETIRED =
  /shytalk\.shyden\.co\.uk|(?<![\w.-])yawelo-idle\.shyden\.co\.uk/;

const TEXT = /\.(astro|css|js|json|md|mjs|ts|txt|yml)$/;
const text = (path: string) => TEXT.test(path);

const FILES = [
  ...filesUnder('src', text),
  ...filesUnder('functions', text),
  ...filesUnder('public', text),
  ...filesUnder('scripts', text),
  ...filesUnder('.github/workflows', text),
  'astro.config.mjs',
  'playwright.config.ts',
  'playwright.dev.config.ts',
  'playwright.prod.config.ts',
  'README.md',
];

const describesTheVideo = (file: string, previous: string | undefined) =>
  file === 'src/lib/i18n/site.ts' &&
  previous?.trim() === 'yaweloIdleVideoDescription:';

const retiredHostsIn = (file: string): string[] =>
  readFileSync(file, 'utf8')
    .split('\n')
    .flatMap((line, index, lines) =>
      RETIRED.test(line) && !describesTheVideo(file, lines[index - 1])
        ? [`${file}:${index + 1}`]
        : [],
    );

describe('retired product hosts', () => {
  it('reads each name it means to refuse, and not the dev host still in use', () => {
    expect(RETIRED.test('https://shytalk.shyden.co.uk')).toBe(true);
    expect(RETIRED.test('https://dev.shytalk.shyden.co.uk')).toBe(true);
    expect(RETIRED.test('https://yawelo-idle.shyden.co.uk')).toBe(true);
    expect(RETIRED.test('https://dev.yawelo-idle.shyden.co.uk')).toBe(false);
  });

  it('no shipped file or build config names one', () => {
    expect(
      searched(FILES.flatMap(retiredHostsIn), {
        of: FILES,
        what: 'shipped files and build configs',
      }),
    ).toEqual([]);
  });
});

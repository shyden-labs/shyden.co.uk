import { describe, it, expect } from 'vitest';
import { bind } from './ast';
import { floorBreach } from '../floors';
import { searched } from '../source-files';
import {
  apiName,
  baseUrlCalls,
  baseUrlFindings,
  type BaseUrlAwareApi,
  type BaseUrlCall,
} from '../base-url-calls';

/**
 * The detector behind tests/e2e/baseurl-guard.spec.ts (#215).
 *
 * The guard it replaces ran a regex over raw source text: `page.route(`, a
 * quote, and a lookahead asking whether an absolute URL followed. For
 * `page.route(`${ORIGIN}/framed`)` what follows the backtick is `${ORIGIN}`,
 * so a URL built from `'https://evidence.test'` was reported as relative and
 * cost 31.5 minutes of CI. And a comment quoting a call tripped it, which is
 * why the guard had to exclude its own file. Every fixture below is a shape
 * one of those got wrong, or one the replacement has to keep right.
 */

// Declared here rather than imported from tests/e2e/fixtures.ts: a fixture
// that cannot disagree with the real table is not a fixture, and that file
// loads Playwright, which Vitest cannot.
const ROUTE: BaseUrlAwareApi = {
  callee: 'page.route',
  glob: true,
  resolved: false,
  reason: 'route is not patched',
};
const TO_HAVE_URL: BaseUrlAwareApi = {
  callee: 'toHaveURL',
  resolved: false,
  reason: 'toHaveURL is not patched',
};
const BARE_GET: BaseUrlAwareApi = {
  callee: 'request.get',
  bare: true,
  resolved: false,
  reason: 'the bare fixture is not patched',
};
const GOTO: BaseUrlAwareApi = {
  callee: 'page.goto',
  resolved: true,
  reason: 'goto is patched',
};
const APIS = [ROUTE, TO_HAVE_URL, BARE_GET, GOTO];

/** Every call examined across `files`, bound together, in source order. */
const callsIn = (files: string | Record<string, string>): BaseUrlCall[] =>
  baseUrlCalls(
    bind(
      new Map(
        Object.entries(
          typeof files === 'string' ? { 'fixture.ts': files } : files,
        ),
      ),
    ),
    APIS,
  );

/** One line per call: the API, then what its URL was judged to be. */
function summary({ api, verdict }: BaseUrlCall): string {
  const name = apiName(api);
  switch (verdict.kind) {
    case 'relative':
      return `${name} relative ${verdict.resolvesTo}`;
    case 'unresolved':
      return `${name} unresolved ${verdict.name} (${verdict.why})`;
    case 'matcher':
      return `${name} matcher (${verdict.what})`;
    default:
      return `${name} ${verdict.kind}`;
  }
}

const verdicts = (files: string | Record<string, string>): string[] =>
  callsIn(files).map(summary);

describe('a call is found by its shape, not its spelling', () => {
  it('finds a call split over lines and spaced from its parentheses', () => {
    expect(
      verdicts(`
        await page
          .route ('/framed', handler);
      `),
    ).toEqual(['page.route relative /framed']);
  });

  it('finds the call through any receiver its callee ends with', () => {
    expect(
      verdicts(`
        this.page.route('/a', handler);
        await expect(page).not.toHaveURL('/b');
      `),
    ).toEqual(['page.route relative /a', 'toHaveURL relative /b']);
  });

  it('takes no longer name for the callee', () => {
    expect(
      verdicts(`
        somepage.route('/a', handler);
        page.routes('/b', handler);
        page.route('/c', handler);
      `),
    ).toEqual(['page.route relative /c']);
  });

  it('holds the bare fixture to its bare name', () => {
    expect(
      verdicts(`
        page.request.get('/a');
        this.request.get('/b');
        request.get('/c');
      `),
    ).toEqual(['request.get (bare fixture) relative /c']);
  });

  it('reads no call out of a comment or a string', () => {
    // AC3: the file a guard reads may quote the very call it looks for --
    // this one does, and the old guard excluded itself to survive that.
    expect(
      verdicts(`
        // page.route('/in-a-line-comment', handler);
        /* page.route('/in-a-block-comment', handler); */
        const note = "page.route('/in-a-string', handler)";
        const shown = \`page.route('/in-a-template', handler)\`;
        page.route('/real', handler);
      `),
    ).toEqual(['page.route relative /real']);
  });

  it('says where each call is, as a repo-relative path and line', () => {
    expect(
      callsIn({
        'tests/e2e/review.spec.ts': `\npage.route('/a', handler);`,
      }).map((call) => call.where),
    ).toEqual(['tests/e2e/review.spec.ts:2']);
  });
});

describe('a URL is judged by what it resolves to', () => {
  it('reads a literal as absolute by its scheme, and by nothing else', () => {
    // Playwright joins with `new URL(given, baseURL)` and keeps `given` as
    // written when that throws. On the device baseURL is empty, and
    // `new URL('//cdn.test/x')` throws exactly as `new URL('/x')` does --
    // measured -- so a protocol-relative URL depends on baseURL for its
    // scheme and fails there like any path. The regex guard let it through.
    expect(
      verdicts(`
        page.goto('https://a.test/x');
        page.goto('about:blank');
        page.goto('//cdn.test/x');
        page.goto('/x');
        page.goto('x');
        page.goto('./x');
      `),
    ).toEqual([
      'page.goto absolute',
      'page.goto absolute',
      'page.goto relative //cdn.test/x',
      'page.goto relative /x',
      'page.goto relative x',
      'page.goto relative ./x',
    ]);
  });

  it('keeps a template absolute when it opens with an absolute constant', () => {
    expect(
      verdicts(`
        const ORIGIN = 'https://evidence.test';
        page.route(\`\${ORIGIN}/framed\`, handler);
      `),
    ).toEqual(['page.route absolute']);
  });

  it('follows an imported constant into the file that declares it', () => {
    // The call CI 35300505425 reported, in the files it was reported in.
    expect(
      verdicts({
        'tests/e2e/evidence-harness.ts': `export const ORIGIN = 'https://evidence.test';`,
        'tests/e2e/evidence-review.spec.ts': `
          import { ORIGIN } from './evidence-harness';
          page.route(\`\${ORIGIN}/framed\`, handler);
        `,
      }),
    ).toEqual(['page.route absolute']);
  });

  it('reads a template as relative when its constant is relative', () => {
    expect(
      verdicts(`
        const BASE = '/x';
        page.route(\`\${BASE}/y\`, handler);
      `),
    ).toEqual(['page.route relative /x/y']);
  });

  it('resolves concatenation, parentheses and type-only syntax the same way', () => {
    expect(
      verdicts(`
        const ORIGIN = 'https://a.test' as const;
        page.route(ORIGIN + '/x', handler);
        page.route((ORIGIN) + '/y', handler);
        page.route(ORIGIN! + '/w', handler);
        page.route((ORIGIN satisfies string) + '/v', handler);
        page.route(<string>ORIGIN + '/u', handler);
        page.route('/z' + ORIGIN, handler);
      `),
    ).toEqual([
      'page.route absolute',
      'page.route absolute',
      'page.route absolute',
      'page.route absolute',
      'page.route absolute',
      'page.route relative /zhttps://a.test',
    ]);
  });

  it('follows a chain of constants to a fixed point', () => {
    expect(
      verdicts(`
        const A = 'https://a.test';
        const B = A;
        const C = \`\${B}/c\`;
        page.route(C, handler);
      `),
    ).toEqual(['page.route absolute']);
  });

  it('stays relative past an unknown once the known text has decided it', () => {
    // A scheme opens with a letter, so no id can turn '/api/' or '/' into one.
    expect(
      verdicts(`
        const go = (id: string) => {
          page.route(\`/api/\${id}\`, handler);
          page.route(\`/\${id}\`, handler);
        };
      `),
    ).toEqual(['page.route relative /api/…', 'page.route relative /…']);
  });

  it('is unresolved while the known text could still become a scheme', () => {
    // 'http' could be the first half of 'http:', and '' could be anything.
    expect(
      verdicts(`
        const go = (id: string) => {
          page.route(\`http\${id}\`, handler);
          page.route(\`\${id}/x\`, handler);
        };
      `),
    ).toEqual([
      'page.route unresolved id (a parameter)',
      'page.route unresolved id (a parameter)',
    ]);
  });
});

describe('what cannot be resolved says why', () => {
  it('names a parameter', () => {
    expect(
      verdicts(`const go = (url: string) => page.route(url, handler);`),
    ).toEqual(['page.route unresolved url (a parameter)']);
  });

  it('names the file an import needed that the scan did not bind', () => {
    expect(
      verdicts(`
        import { SITE } from '../../src/site';
        page.route(SITE, handler);
      `),
    ).toEqual([
      "page.route unresolved SITE (imported from '../../src/site', a file the scan did not bind)",
    ]);
  });

  it('does not trust a binding that can be reassigned', () => {
    expect(
      verdicts(`
        let url = 'https://a.test';
        var old = 'https://b.test';
        page.route(url, handler);
        page.route(old, handler);
      `),
    ).toEqual([
      'page.route unresolved url (not a const, so it can be reassigned)',
      'page.route unresolved old (not a const, so it can be reassigned)',
    ]);
  });

  it('names a call, a property and anything else it does not evaluate', () => {
    expect(
      verdicts(`
        const isFramed = (url: URL) => url.pathname === '/framed';
        page.route(origin() + '/x', handler);
        page.route(config.origin, handler);
        page.route(ready ? '/a' : '/b', handler);
        page.route(isFramed + '/x', handler);
      `),
    ).toEqual([
      'page.route unresolved origin() (a call)',
      'page.route unresolved config.origin (a property)',
      "page.route unresolved ready ? '/a' : '/b' (an expression the guard does not evaluate)",
      'page.route unresolved isFramed (a function)',
    ]);
  });

  it('names every other declaration it will not read', () => {
    expect(
      verdicts(`
        const { origin } = settings();
        declare const DECLARED: string;
        class Origin {}
        page.route(origin, handler);
        page.route(DECLARED, handler);
        page.route(Origin, handler);
        page.route(GLOBAL_URL, handler);
        for (const each of ['**/*.m4a']) page.route(each, handler);
      `),
    ).toEqual([
      'page.route unresolved origin (a destructured binding)',
      'page.route unresolved DECLARED (declared without a value)',
      'page.route unresolved Origin (declared as something other than a const)',
      'page.route unresolved GLOBAL_URL (declared nowhere the scan can see)',
      'page.route unresolved each (a loop variable)',
    ]);
  });

  it('terminates on constants defined in terms of each other', () => {
    expect(
      verdicts(`
        const a: string = b;
        const b: string = a;
        page.route(a, handler);
      `),
    ).toEqual(['page.route unresolved a (defined in terms of itself)']);
  });
});

describe('what never meets baseURL is not judged as a URL', () => {
  it('passes a regular expression and a predicate, however they are written', () => {
    expect(
      verdicts(`
        const isFramed = (url: URL) => url.pathname === '/framed';
        function isOther(url: URL) { return url.pathname === '/other'; }
        page.route(/^https:\\/\\/a\\.test\\//, handler);
        page.route(new RegExp('^https://a.test/'), handler);
        page.route((url) => url.href === 'https://a.test/x', handler);
        page.route(function (url) { return true; }, handler);
        page.route(isFramed, handler);
        page.route(isOther, handler);
      `),
    ).toEqual([
      'page.route matcher (a regular expression)',
      'page.route matcher (a regular expression)',
      'page.route matcher (a function)',
      'page.route matcher (a function)',
      'page.route matcher (a function)',
      'page.route matcher (a function)',
    ]);
  });

  it('exempts a leading * only where the API skips baseURL for it', () => {
    // resolveGlobBase returns a glob starting with `*` untouched; toHaveURL
    // has no such branch, so the same text is relative there.
    expect(
      verdicts(`
        const AUDIO = '**/*.m4a';
        page.route('**/_astro/*.js', handler);
        page.route(AUDIO, handler);
        await expect(page).toHaveURL('**/x');
      `),
    ).toEqual([
      'page.route glob',
      'page.route glob',
      'toHaveURL relative **/x',
    ]);
  });
});

describe('what the guard reports', () => {
  it('names a relative URL on an unpatched API as the defect it is', () => {
    const calls = callsIn({
      'tests/e2e/a.spec.ts': `page.route('/framed', handler);`,
    });
    const [finding, ...rest] = baseUrlFindings(calls);
    expect(
      searched(rest, { of: calls, what: 'examined base-URL calls' }),
    ).toHaveLength(0);
    expect(
      floorBreach('base-url-calls/relative-url-examined', calls.length),
    ).toBeUndefined();
    expect(finding).toBe(
      'tests/e2e/a.spec.ts:1 calls `page.route(...)` with a relative URL, ' +
        "'/framed', which resolves to /framed; page.route is not patched to " +
        'resolve baseURL on the real-device path (route is not patched). Fix: ' +
        'pass an absolute URL, or patch page.route in ' +
        "tests/e2e/fixtures.ts's page/context fixture the same way page.goto " +
        'and page.request.* are patched, then flip its BASE_URL_AWARE_APIS ' +
        'row to resolved: true.',
    );
  });

  it('says it could not resolve a URL, and does not call it relative', () => {
    const calls = callsIn({
      'tests/e2e/a.spec.ts': `const go = (url: string) => page.route(url, handler);`,
    });
    const [finding, ...rest] = baseUrlFindings(calls);
    expect(
      searched(rest, { of: calls, what: 'examined base-URL calls' }),
    ).toHaveLength(0);
    expect(
      floorBreach('base-url-calls/unresolved-url-examined', calls.length),
    ).toBeUndefined();
    expect(finding).toBe(
      'tests/e2e/a.spec.ts:1 calls `page.route(...)` with url, and could not ' +
        'resolve `url` (a parameter). That is a limit of this guard, not a ' +
        'finding that the URL is relative -- but page.route is not patched to ' +
        'resolve baseURL on the real-device path (route is not patched), so a ' +
        'URL the guard cannot read is one nobody has checked. Fix: pass a ' +
        'literal, a const, a regular expression or a predicate, or patch ' +
        "page.route in tests/e2e/fixtures.ts's page/context fixture the same " +
        'way page.goto and page.request.* are patched, then flip its ' +
        'BASE_URL_AWARE_APIS row to resolved: true.',
    );
  });

  it('reports nothing that is absolute, a glob, a matcher, or on a patched API', () => {
    const calls = callsIn(`
      const go = (url: string) => page.goto(url);
      page.goto('/patched');
      page.route('https://a.test/x', handler);
      page.route('**/*.m4a', handler);
      page.route(/x/, handler);
    `);
    expect({
      examined: calls.map(summary),
      findings: baseUrlFindings(calls),
    }).toEqual({
      examined: [
        'page.goto unresolved url (a parameter)',
        'page.goto relative /patched',
        'page.route absolute',
        'page.route glob',
        'page.route matcher (a regular expression)',
      ],
      findings: [],
    });
  });
});

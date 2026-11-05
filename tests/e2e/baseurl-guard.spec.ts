import { specDirs } from '../spec-dirs';
import { test, expect, BASE_URL_AWARE_APIS } from './fixtures';
import { searched, tsFilesUnder } from '../source-files';
import { bindFiles } from '../unit/ast';
import { baseUrlCalls, baseUrlFindings } from '../base-url-calls';

// Every file under the spec directories is scanned, this one included. The
// guard used to run a regex over raw text and had to exclude itself, because
// its own prose names the APIs it looks for -- and every other file then had
// to dodge it by careful wording. It now reads calls off the parsed source,
// where a comment or a string is never a call (#215).
const SCAN_DIRS = specDirs();

test('every baseURL-aware API call on a relative URL is one the device fixtures actually resolve', () => {
  const calls = baseUrlCalls(
    bindFiles(SCAN_DIRS.flatMap(tsFilesUnder)),
    BASE_URL_AWARE_APIS,
  );
  const findings = baseUrlFindings(calls);

  // The population is every call to every row, patched or not -- hundreds of
  // `page.goto`s -- so a callee matcher that stopped matching fails here as
  // "searched no calls" instead of passing over nothing.
  expect(
    searched(findings, { of: calls, what: 'calls to a baseURL-aware API' }),
    findings.join('\n'),
  ).toEqual([]);
});

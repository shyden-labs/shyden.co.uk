import { describe, expect, it } from 'vitest';
import { deeplKeyFrom } from '../../src/lib/i18n/translate';

/**
 * The one reading of the DeepL key, which `i18n:translate` and
 * `i18n:second-read` each copied (#390 F26): the environment first, then the
 * `DEEPL_API_KEY=` line of `.env.local`, else empty.
 */
describe('deeplKeyFrom', () => {
  it('takes the environment first, even over the file', () => {
    expect(deeplKeyFrom('env-key', 'DEEPL_API_KEY=file-key\n')).toBe('env-key');
  });

  it("reads the file's own line when the environment has none", () => {
    expect(
      deeplKeyFrom(undefined, 'OTHER=x\nDEEPL_API_KEY=file-key\nMORE=y\n'),
    ).toBe('file-key');
  });

  it('is empty with no environment and no file, or a file without the line', () => {
    expect(deeplKeyFrom(undefined, undefined)).toBe('');
    expect(deeplKeyFrom(undefined, 'OTHER=x\n')).toBe('');
  });
});

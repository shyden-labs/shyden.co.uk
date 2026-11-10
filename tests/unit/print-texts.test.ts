import { describe, expect, it } from 'vitest';
import { printTexts } from '../../src/scripts/roster-ui';
import { getStrings } from '../../src/lib/i18n';
import { student } from './factories';

/**
 * What each roster cell prints, in one place: the row builder and
 * `refreshPrintMirrors` each worked all six out, and two copies of a printed
 * register can drift (#390 F19).
 */
const en = getStrings('en');

describe('printTexts', () => {
  it('prints every column of a filled row', () => {
    expect(
      printTexts(
        student({
          number: 4,
          name: 'Ana',
          sex: 'F',
          absent: true,
          together: 'A',
          apart: 'X',
        }),
        en,
      ),
    ).toEqual({
      number: '4',
      name: 'Ana',
      sex: en.rosterSexFemale,
      absent: '☑',
      together: 'A',
      apart: 'X',
    });
  });

  it('prints the unset mark for every empty column', () => {
    expect(printTexts(student({ number: 1, name: null }), en)).toEqual({
      number: '1',
      name: '',
      sex: en.rosterUnset,
      absent: '☐',
      together: en.rosterUnset,
      apart: en.rosterUnset,
    });
  });

  it('prints M for male', () => {
    expect(printTexts(student({ number: 2, sex: 'M' }), en).sex).toBe(
      en.rosterSexMale,
    );
  });
});

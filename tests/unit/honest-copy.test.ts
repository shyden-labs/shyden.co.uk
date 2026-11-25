import { describe, expect, it } from 'vitest';
import { getSiteStrings, getStrings } from '../../src/lib/i18n';

/**
 * Copy that promised what the tool does not do (#390 F28, F29). The tool has
 * no paste: a class list is typed, imported or counted. And a group is
 * smaller than the size chosen when the whole present class is smaller than
 * that, so "never" was false.
 */
describe('the copy promises only what the tool does', () => {
  it('the homepage card names the ways a class list really gets in', () => {
    expect(getSiteStrings('en').home.workClassroomBody).toBe(
      'Type or import a class list and get fair, random groups in seconds. Built for teachers, free forever.',
    );
  });

  it('the how-to and the leftovers help name the one exception', () => {
    const en = getStrings('en');
    expect(en.howToWhat).toBe(
      'Tell it how big your class is and how many students you want per group. It shuffles and deals everyone out, and no group ends up smaller than you asked for unless the whole class is.',
    );
    expect(en.leftoversHelp).toBe(
      'Either way, no group is smaller than the size you chose unless the whole class is.',
    );
  });
});

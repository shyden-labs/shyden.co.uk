import type { StandInSeed } from '../../stand-in-markers';

/**
 * The harness functions that restate a Playwright algorithm rather than run
 * Playwright's own code (#821). Every iPhone mirror that reaches one, directly
 * or through any helper, is marked `NOT YET THE SAME as Android (#811)`, and
 * `tests/guards/stand-in-markers.test.ts` holds that. A new restatement joins
 * this list the day it is written; #811 takes one off when Safari runs
 * Playwright's own code in its place.
 */
export const STAND_INS: readonly StandInSeed[] = [
  {
    // A part of the ARIA naming rules, where getByRole, getByLabel and
    // toHaveAccessibleName compute the whole of it.
    file: 'tests/device/ios/roles.ts',
    names: [
      'byRole',
      'byLabel',
      'expectRole',
      'expectRoleAttribute',
      'expectAccessibleName',
    ],
  },
  {
    // getByText's element choice, and the text an aria snapshot gives.
    file: 'tests/device/ios/dom.ts',
    names: ['textMatchesOf', 'textCount', 'accessibleTextsOf'],
  },
  {
    // setInputFiles, restated as a DataTransfer handed to the file input.
    file: 'tests/device/ios/classroom-groups.ts',
    names: ['upload'],
  },
];

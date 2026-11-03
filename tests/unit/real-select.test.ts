import { describe, expect, it } from 'vitest';
import { whyNoLabel, whyNoPickerPath, whyNotChosen } from '../real-select';

/**
 * The messages chooseOption fails with (#1027). Pure strings: no browser, no
 * phone. The choosing itself is real input and runs in the e2e suite.
 */
describe('chooseOption failures', () => {
  it('names the select and the option when real input missed', () => {
    expect(whyNotChosen("locator('#s')", 'F', 'M')).toBe(
      `locator('#s'): real input chose "M", not the wanted option "F"`,
    );
  });

  it('is null when real input chose the wanted option', () => {
    expect(whyNotChosen("locator('#s')", 'F', 'F')).toBeNull();
  });

  it('says a missing option is missing, and a blank label cannot be typed', () => {
    expect(whyNoLabel('sel', 'Z', null)).toMatch(
      /no option with the value "Z"/,
    );
    expect(whyNoLabel('sel', '', '')).toMatch(/no visible label to type/);
  });

  it('says the phone path is not built yet and no script stands in (#1027)', () => {
    expect(whyNoPickerPath('sel', 'A')).toMatch(/not built yet \(#1027\)/);
  });
});

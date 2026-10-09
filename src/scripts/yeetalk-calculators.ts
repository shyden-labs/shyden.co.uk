import { calculateGlory, formatNumber, ERRORS } from '../lib/gloryPoints';
import { calculateGiftValue } from '../lib/giftValue';
import { getSiteStrings, isLocale, DEFAULT_LOCALE } from '../lib/i18n';
import { enhanceReportForm } from './report-form';

// The calculator's own error copy is asserted verbatim by its unit tests, so
// gloryPoints.ts stays English and untouched. Mapping BY THE EXPORTED ERRORS
// OBJECT rather than by literal strings means a reworded message updates here
// automatically instead of silently falling through to English.
// Validated against LOCALES, never compared against one locale.
//
// This read `=== 'id' ? 'id' : 'en'` -- a binary written when the site served
// two languages. #22 shipped five, so /zh/, /vi/ and /th/ fell through to
// English: English validation copy, and numbers grouped as en-GB. Vietnamese
// groups thousands with "." and marks decimals with ",", so `1,112` read as
// one-point-one-one-two to the person the page is written for -- the exact
// defect `formatNumber`'s docblock describes for Indonesian, in a locale added
// later. LOCALE_METADATA exists because five places each decided what a locale
// meant; this was a sixth, in a runtime script rather than a component. #110.
const declared = document.documentElement.lang;
const lang = isLocale(declared) ? declared : DEFAULT_LOCALE;
const t = getSiteStrings(lang).calculators;
const LOCALISED_ERROR = new Map<string, string>([
  [ERRORS.empty, t.errors.empty],
  [ERRORS.notWhole, t.errors.notWhole],
  [ERRORS.zero, t.errors.zero],
  [ERRORS.tooLarge, t.errors.tooLarge],
]);

function localise(message: string): string {
  return LOCALISED_ERROR.get(message) ?? message;
}

function wire(
  ids: { input: string; submit: string; result: string; error: string },
  show: (raw: string) => { text: string } | { error: string },
): void {
  const input = document.querySelector<HTMLInputElement>(ids.input);
  const submit = document.querySelector<HTMLButtonElement>(ids.submit);
  const result = document.querySelector<HTMLElement>(ids.result);
  const error = document.querySelector<HTMLElement>(ids.error);

  function run(): void {
    if (!input || !result || !error) return;
    const outcome = show(input.value);
    if ('error' in outcome) {
      result.textContent = '';
      error.textContent = localise(outcome.error);
      return;
    }
    error.textContent = '';
    result.textContent = outcome.text;
  }

  submit?.addEventListener('click', run);
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      run();
    }
  });
}

wire(
  {
    input: '#glory-input',
    submit: '#glory-submit',
    result: '#glory-result',
    error: '#glory-error',
  },
  (raw) => {
    const outcome = calculateGlory(raw);
    if (!outcome.ok) return { error: outcome.error };
    const { coinsNeeded, beansNeeded, totalGiftValue } = outcome.result;
    return {
      text: t.glory.resultLine(
        formatNumber(coinsNeeded, lang),
        formatNumber(beansNeeded, lang),
        formatNumber(totalGiftValue, lang),
      ),
    };
  },
);

wire(
  {
    input: '#gift-input',
    submit: '#gift-submit',
    result: '#gift-result',
    error: '#gift-error',
  },
  (raw) => {
    const outcome = calculateGiftValue(raw);
    if (!outcome.ok) return { error: outcome.error };
    const { giftValue, beans, coins } = outcome.result;
    return {
      text: t.gift.resultLine(
        formatNumber(giftValue, lang),
        formatNumber(beans, lang),
        formatNumber(coins, lang),
      ),
    };
  },
);

// The footer's report form exists only in beta locales (#97).
const reportForm =
  document.querySelector<HTMLFormElement>('[data-report-form]');
if (reportForm) enhanceReportForm(reportForm);

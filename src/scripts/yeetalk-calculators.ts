import { calculateGlory, formatNumber, ERRORS } from '../lib/gloryPoints';
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

const input = document.querySelector<HTMLInputElement>('#glory-input');
const submit = document.querySelector<HTMLButtonElement>('#glory-submit');
const result = document.querySelector<HTMLElement>('#glory-result');
const error = document.querySelector<HTMLElement>('#glory-error');

function run(): void {
  if (!input || !result || !error) return;
  const outcome = calculateGlory(input.value);
  if (!outcome.ok) {
    result.textContent = '';
    error.textContent = LOCALISED_ERROR.get(outcome.error) ?? outcome.error;
    return;
  }
  error.textContent = '';
  const { coinsNeeded, beansNeeded, totalGiftValue } = outcome.result;
  result.textContent = t.glory.resultLine(
    formatNumber(coinsNeeded, lang),
    formatNumber(beansNeeded, lang),
    formatNumber(totalGiftValue, lang),
  );
}

submit?.addEventListener('click', run);
input?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    run();
  }
});

// The footer's report form exists only in beta locales (#97).
const reportForm =
  document.querySelector<HTMLFormElement>('[data-report-form]');
if (reportForm) enhanceReportForm(reportForm);

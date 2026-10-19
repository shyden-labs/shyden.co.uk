import { describe, expect, it } from 'vitest';
import { siteEn } from '../../src/lib/i18n/site';

/**
 * The report form's English, as the operator approved it on 2026-09-23 (#97,
 * spec 3.5). A literal pin, because a level needs one: every other guard
 * derives from the catalogue, so an edit here would move both sides together.
 */
describe('the report copy is the approved English (#97)', () => {
  it('matches spec 3.5 word for word', () => {
    expect(siteEn.report).toEqual({
      open: 'Report a translation problem',
      intro:
        // #370: Shyden Ltd is dissolved, so the report goes to Shyden.
        'Reports go to Shyden and are deleted once they have been dealt with.',
      quoteLabel: 'Which words are wrong?',
      quoteHint:
        'Start typing and choose the words from the list, or copy them from the page.',
      // #830: one line above both free-text boxes (Shyden 2026-10-19).
      personalDetailsHint: "Please don't include names or contact details.",
      suggestionLabel: 'What should it say? (optional)',
      noteLabel: 'Anything else? (optional)',
      honeypotLabel: 'Leave this field empty',
      send: 'Send report',
      sent: 'Thank you. Your report has been sent.',
      notFound:
        // #665: the site speaks as one person, and this line reports a fact.
        "Those words aren't on this page. Choose them from the list, or copy a shorter piece without any names or numbers.",
      rejected:
        "That report couldn't be sent. Please check the form and try again.",
      failed:
        "Something went wrong and your report wasn't sent. Please try again later.",
      formFull:
        // #872, Shyden 2026-10-19: polite, names no period and no reset time.
        'Thank you for your help. The form has received as many reports as it can take for now, so this one was not sent. Please try again later.',
      connectionFull:
        'Thank you for your help. To keep this form reliable, each internet connection can send a limited number of reports, and yours has reached that limit. Reports from other people on a shared connection count towards it too. Please try again later.',
    });
  });
});

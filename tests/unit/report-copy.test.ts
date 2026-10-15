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
      suggestionLabel: 'What should it say? (optional)',
      noteLabel: 'Anything else? (optional)',
      noteHint: "Please don't include names or contact details.",
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
    });
  });
});

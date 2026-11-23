import { describe, expect, it } from 'vitest';
import { emailAddresses } from '../email-addresses';

/**
 * No page shows an email address (#1266; Shyden, 2026-11-23: "we only allow
 * support requests via the support request form so we shouldn't show an
 * email address"). The walk reads every built page through this reader, so
 * the reader itself is held here.
 */
describe('an email address in served text (#1266)', () => {
  it('finds an address in text and in a mailto: link, once each', () => {
    expect(
      emailAddresses(
        '<a href="mailto:support@shyden.co.uk">support@shyden.co.uk</a>',
      ),
    ).toEqual(['mailto:', 'support@shyden.co.uk']);
  });

  it('finds a mailto: link that names no address, whatever the case', () => {
    expect(emailAddresses('<a href="MAILTO:?subject=hi">Write</a>')).toEqual([
      'mailto:',
    ]);
  });

  it('finds an address whose @ is written as an entity', () => {
    expect(
      emailAddresses(
        'a&#64;b.co &#x40;x hello&#x40;shyden.co.uk c&commat;d.io',
      ),
    ).toEqual(['a@b.co', 'hello@shyden.co.uk', 'c@d.io']);
  });

  it('finds nothing in a package scope, a CSS at-rule or a handle', () => {
    expect(
      emailAddresses(
        '@fontsource/inter @media (min-width: 720px) @supports @ShydenMcM @shyden.co.uk',
      ),
    ).toEqual([]);
  });
});

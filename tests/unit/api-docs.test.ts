import { describe, expect, it } from 'vitest';
import { submitMethods } from '../../src/lib/api-docs';

/**
 * #781. Which operations the docs pages let a visitor try: none on
 * production, where every documented write would change something real; the
 * report form on dev and previews, where Try it out is how the API is shown
 * working.
 */
describe('submitMethods', () => {
  it.each([
    ['shyden.co.uk', []],
    ['dev.shyden.co.uk', ['post']],
    ['shyden-co-uk.pages.dev', ['post']],
    ['127.0.0.1', ['post']],
  ])('%s may try %j', (hostname, methods) => {
    expect(submitMethods(hostname)).toEqual(methods);
  });
});

import { describe, expect, it } from 'vitest';
import { askForJson, submitMethods } from '../../src/lib/api-docs';

/**
 * #781. Which operations the docs pages let a visitor try: on production
 * only reads, since every documented write would change something real; the
 * report form as well on dev and previews, where Try it out is how the API
 * is shown working.
 */
describe('submitMethods', () => {
  it.each([
    ['shyden.co.uk', ['get']],
    ['dev.shyden.co.uk', ['get', 'post']],
    ['shyden-co-uk.pages.dev', ['get', 'post']],
    ['127.0.0.1', ['get', 'post']],
  ])('%s may try %j', (hostname, methods) => {
    expect(submitMethods(hostname)).toEqual(methods);
  });
});

describe('askForJson', () => {
  it('asks for JSON in place of anything', () => {
    expect(
      askForJson({
        url: '/api/report',
        headers: { accept: '*/*', 'X-A': '1' },
      }),
    ).toEqual({
      url: '/api/report',
      headers: { Accept: 'application/json', 'X-A': '1' },
    });
  });

  it('asks for JSON when nothing was asked', () => {
    expect(askForJson({ url: '/api/report', headers: {} }).headers).toEqual({
      Accept: 'application/json',
    });
  });
});

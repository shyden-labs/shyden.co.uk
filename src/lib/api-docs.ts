import { isProdHostname } from '../../functions/_lib/lockdown.js';

/**
 * The HTTP methods Swagger UI's Try it out may send from a docs page (#781):
 * on production only reads, which change nothing (AC3); on dev and previews
 * the report form's POST as well.
 */
export const submitMethods = (hostname: string): string[] =>
  isProdHostname(hostname) ? ['get'] : ['get', 'post'];

/** The part of Swagger UI's outgoing request `askForJson` reads and changes. */
export interface DocsRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
}

/**
 * Swagger UI sends `Accept: *\/*`, which the report API answers in form mode:
 * a 303 back to a page. The docs ask for JSON, so Try it out shows the
 * outcome itself. Any spelling of the header is replaced, never doubled.
 */
export const askForJson = <T extends DocsRequest>(request: T): T => ({
  ...request,
  headers: {
    ...Object.fromEntries(
      Object.entries(request.headers).filter(
        ([name]) => name.toLowerCase() !== 'accept',
      ),
    ),
    Accept: 'application/json',
  },
});

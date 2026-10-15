import { isProdHostname } from '../../functions/_lib/lockdown.js';

/**
 * The HTTP methods Swagger UI's Try it out may send from a docs page (#781):
 * none on production, where every documented write changes something real;
 * the report form's POST on dev and previews.
 */
export const submitMethods = (hostname: string): string[] =>
  isProdHostname(hostname) ? [] : ['post'];

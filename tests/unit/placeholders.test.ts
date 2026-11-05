import { describe, expect, it } from 'vitest';
import { placeholderFindings } from '../../scripts/placeholders.mjs';

/**
 * The production deploy refuses to ship a `[[…]]` placeholder (#1040). The
 * scan once stopped a release over Swagger UI's own minified code: vendored
 * `swagger-ui-bundle.*.js` holds nested arrays such as `[[e,r]]`, which have
 * the placeholder's shape and are not text anyone wrote for the site.
 */
describe('placeholderFindings', () => {
  it("finds a placeholder in the site's own page text", () => {
    expect(
      placeholderFindings([
        { path: 'dist/index.html', text: '<p>Company [[companyNo]]</p>' },
      ]),
    ).toEqual(['dist/index.html: [[companyNo]]']);
  });

  it("finds one in the site's own script, sitemap and data", () => {
    expect(
      placeholderFindings([
        { path: 'dist/_astro/page.Ab12.js', text: 'const t="[[reg office]]"' },
        { path: 'dist/sitemap-0.xml', text: '<loc>[[host]]</loc>' },
        { path: 'dist/api/openapi.json', text: '{"title":"[[name]]"}' },
      ]),
    ).toEqual([
      'dist/_astro/page.Ab12.js: [[reg office]]',
      'dist/sitemap-0.xml: [[host]]',
      'dist/api/openapi.json: [[name]]',
    ]);
  });

  it('passes vendored Swagger UI, whose minified arrays have the same shape', () => {
    expect(
      placeholderFindings([
        {
          path: 'dist/_astro/swagger-ui-bundle.B47QB87J.js',
          text: 'x=[[e,r]];y=[[j,x]]',
        },
        {
          path: 'dist/_astro/swagger-ui-standalone-preset.C1.js',
          text: '[[o,i]]',
        },
      ]),
    ).toEqual([]);
  });

  it('passes ordinary JavaScript arrays of pairs', () => {
    expect(
      placeholderFindings([
        { path: 'dist/_astro/page.Ab12.js', text: 'new Map([[k,v],[k,v]])' },
      ]),
    ).toEqual([]);
  });
});

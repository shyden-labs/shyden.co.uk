import { describe, expect, it } from 'vitest';
import {
  embedScriptUrl,
  SHYDESK_LIVE,
  SHYDESK_PRODUCT,
  shydeskOrigin,
} from '../../src/lib/shydesk';

/**
 * The support page loads ShyDesk's embed from the host the build names
 * (#1032): live ShyDesk by default, Non-Prod when the dev build sets
 * `PUBLIC_SHYDESK_URL`. Whichever host serves `embed.js` is the host the form
 * calls, so a wrong value here sends visitors' messages to the wrong desk.
 */
describe("the support page's ShyDesk host (#1032)", () => {
  it('is live ShyDesk when the build names none', () => {
    expect(SHYDESK_LIVE).toBe('https://shydesk.dpdns.org');
    expect(shydeskOrigin(undefined)).toBe('https://shydesk.dpdns.org');
    expect(shydeskOrigin('')).toBe('https://shydesk.dpdns.org');
  });

  it('is the origin alone when the value carries a trailing slash', () => {
    expect(shydeskOrigin('https://shydesk.shydesk-non-prod.workers.dev/')).toBe(
      'https://shydesk.shydesk-non-prod.workers.dev',
    );
  });

  it('is the origin alone when the value carries a path', () => {
    expect(shydeskOrigin('https://x.example/some/path')).toBe(
      'https://x.example',
    );
  });

  it('refuses a host that is not https', () => {
    expect(() => shydeskOrigin('http://x.example')).toThrow(/https/);
  });

  it('refuses a value that is not an address', () => {
    expect(() => shydeskOrigin('not a url')).toThrow();
  });

  it('loads embed.js from that host', () => {
    expect(embedScriptUrl('https://shydesk.dpdns.org')).toBe(
      'https://shydesk.dpdns.org/embed.js',
    );
  });

  it("names this site's ShyDesk product", () => {
    expect(SHYDESK_PRODUCT).toBe('shyden-co-uk');
  });
});

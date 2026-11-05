import { describe, expect, it } from 'vitest';
import {
  checksOf,
  journeysOfPage,
} from '../../scripts/build-evidence-page.mjs';
import { evidencePageOf } from '../evidence-fixture';

const CHECKS = [
  { id: 'dev-home', group: 'On dev', label: 'Open the homepage' },
  { id: 'prod-waf', group: 'Before production', label: 'Add the <WAF> rule' },
  { id: 'dev-report', group: 'On dev', label: 'Send a report' },
];

const TITLES = ['the first journey', 'the second journey'];

describe('release checks on an evidence page (#362)', () => {
  const page = evidencePageOf(TITLES, 'release-fixture', { checks: CHECKS });

  it('marks each check up the way the page script finds a journey', () => {
    for (const { id } of CHECKS) {
      expect(page).toContain(`id="j-check-${id}"`);
      expect(page).toContain(
        `<input type="checkbox" id="chk-check-${id}" data-journey="check-${id}">`,
      );
    }
    expect(page).toContain('<h3>Add the &lt;WAF&gt; rule</h3>');
  });

  it('groups the checks under their own headings, in first-seen order', () => {
    const dev = page.indexOf('<h2>On dev</h2>');
    const prod = page.indexOf('<h2>Before production</h2>');
    const report = page.indexOf('id="j-check-dev-report"');
    expect(dev).toBeGreaterThan(-1);
    expect(prod).toBeGreaterThan(dev);
    expect(report).toBeGreaterThan(dev);
    expect(report).toBeLessThan(prod);
  });

  it('puts every check in the sign-off, after the journeys', () => {
    expect(journeysOfPage(page)).toEqual([
      'the-first-journey',
      'the-second-journey',
      'check-dev-home',
      'check-prod-waf',
      'check-dev-report',
    ]);
  });

  it('counts checks in the progress line, and leaves a ticket page as it was', () => {
    expect(page).toContain('0 of 5 journeys and checks reviewed');
    expect(page).toContain('var REVIEWED = " journeys and checks reviewed";');
    const ticket = evidencePageOf(['the first journey'], 'ticket-fixture');
    expect(ticket).toContain('0 of 1 journeys reviewed');
    expect(ticket).toContain('var REVIEWED = " journeys reviewed";');
    expect(ticket).not.toContain('class="check"');
  });

  it.each([
    ['a repeated id', [...CHECKS, CHECKS[0]], /appears twice/],
    [
      'an id with a capital',
      [{ id: 'Dev', group: 'g', label: 'l' }],
      /lowercase letters/,
    ],
    [
      'a check with no label',
      [{ id: 'dev', group: 'g', label: '' }],
      /lowercase letters/,
    ],
    [
      'a check with no group',
      [{ id: 'dev', group: '', label: 'l' }],
      /lowercase letters/,
    ],
    ['a value that is not a list', { id: 'dev' }, /must be a list/],
  ])('refuses %s', (_, checks, message) => {
    expect(() => checksOf(checks, new Set())).toThrow(message);
  });

  it('refuses a check whose id is a journey on the page', () => {
    expect(() =>
      checksOf([{ id: 'a', group: 'g', label: 'l' }], new Set(['check-a'])),
    ).toThrow(/has the id of a journey/);
  });

  it('carries the release decision in its own words when content gives them', () => {
    const release = evidencePageOf(['the first journey'], 'release-fixture', {
      signoff: {
        lede: 'Production changes only on your decision.',
        approve: 'Signed off & ready',
      },
    });
    expect(release).toContain('Production changes only on your decision.');
    expect(release).toContain('Signed off &amp; ready');
    expect(release).not.toContain('may merge to develop');
    expect(release).not.toContain('This ticket progresses');
    const ticket = evidencePageOf(['the first journey'], 'ticket-fixture');
    expect(ticket).toContain('may merge to develop');
    expect(ticket).toContain('This ticket progresses');
  });

  it('renders an html section as given, never inside a paragraph', () => {
    const table = '<div class="mtx"><table><tr><td>x</td></tr></table></div>';
    const withTable = evidencePageOf(['the first journey'], 'release-fixture', {
      sections: [{ heading: 'Map', html: table }],
    });
    expect(withTable).toContain(`<h2>Map</h2>\n${table}`);
    expect(withTable).not.toContain(`<p class="sub">${table}`);
  });
});

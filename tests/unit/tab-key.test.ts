import { describe, expect, it } from 'vitest';
import { tabKey } from '../tab-key';

/**
 * Safari on macOS leaves links out of a plain Tab walk unless the visitor
 * holds Option, its own way of reaching every link, so a Tab walk over links
 * presses Option+Tab on WebKit and Tab elsewhere (#1048).
 */
describe('tabKey', () => {
  it('presses Option+Tab on WebKit', () => {
    expect(tabKey('webkit')).toBe('Alt+Tab');
  });
  it('presses Option+Shift+Tab backwards on WebKit', () => {
    expect(tabKey('webkit', 'backwards')).toBe('Alt+Shift+Tab');
  });
  it('presses Tab on Chromium and Firefox', () => {
    expect(tabKey('chromium')).toBe('Tab');
    expect(tabKey('firefox')).toBe('Tab');
  });
  it('presses Shift+Tab backwards on Chromium and Firefox', () => {
    expect(tabKey('chromium', 'backwards')).toBe('Shift+Tab');
    expect(tabKey('firefox', 'backwards')).toBe('Shift+Tab');
  });
});

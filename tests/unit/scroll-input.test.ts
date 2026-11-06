import { describe, expect, it } from 'vitest';
import { scrollInput } from '../scroll-input';

/**
 * Which real input scrolls the page on each target (#1048): the mouse wheel
 * where there is a mouse, a finger where the engine takes real touch drags,
 * and on mobile WebKit, which takes neither, a reason the test fails with
 * (Shyden's ruling 2026-11-06; the route is #1036's).
 */
describe('scrollInput', () => {
  it('turns the wheel on a desktop engine', () => {
    expect(scrollInput('chromium', false)).toEqual({ kind: 'wheel' });
    expect(scrollInput('firefox', false)).toEqual({ kind: 'wheel' });
    expect(scrollInput('webkit', false)).toEqual({ kind: 'wheel' });
  });
  it('drags a finger on a Chromium phone', () => {
    expect(scrollInput('chromium', true)).toEqual({ kind: 'finger' });
  });
  it('names why a WebKit phone has no real scroll input, and the ticket', () => {
    const input = scrollInput('webkit', true);
    expect(input.kind).toBe('none');
    expect(input.kind === 'none' && input.why).toContain('mobile WebKit');
    expect(input.kind === 'none' && input.why).toContain('#1036');
  });
});

import { describe, expect, it } from 'vitest';
import { fixtureLayout } from '../ios-fixture-layout';

/** How the inspector fixtures guard reads each JSON fixture (#859). */
describe('fixtureLayout: a fixture is a capture or recorded answers, nothing else', () => {
  it('a file with frames is a capture, to decode frame by frame', () => {
    expect(fixtureLayout('a.json', { frames: [] })).toBe('frames');
  });

  it('a file of exactly source, note and answers is recorded answers, read as text', () => {
    expect(
      fixtureLayout('b.json', { source: 's', note: 'n', answers: {} }),
    ).toBe('answers');
  });

  it.each([
    ['another layout', { blob: 'QkVHSU4=' }],
    [
      'answers beside an extra key',
      { source: 's', note: 'n', answers: {}, data: 'x' },
    ],
    ['answers missing a key', { source: 's', answers: {} }],
    ['not an object', ['x']],
  ])('refuses %s, naming the file', (_, parsed) => {
    expect(() => fixtureLayout('c.json', parsed)).toThrow(
      'c.json is neither a capture (frames) nor recorded answers (source, note, answers): the secrets check cannot read it',
    );
  });
});

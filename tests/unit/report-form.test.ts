import { describe, expect, it } from 'vitest';
import { outcomeOf } from '../../src/scripts/report-form';

/** The tool-page script's reading of a response: real Response objects, no network. */
describe('outcomeOf', () => {
  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  it.each([
    ['sent', 200],
    ['not-found', 422],
    ['rejected', 400],
    ['failed', 503],
    ['form-full', 429],
    ['connection-full', 429],
  ])('reads %s from its own status', async (outcome, status) => {
    expect(await outcomeOf(json({ outcome }, status))).toBe(outcome);
  });

  it('reads failed from anything it cannot trust', async () => {
    expect(await outcomeOf(new Response(null, { status: 403 }))).toBe('failed');
    expect(
      await outcomeOf(
        new Response('<!doctype html><p>Not found', { status: 404 }),
      ),
    ).toBe('failed');
    expect(await outcomeOf(json({ outcome: 'hacked' }, 200))).toBe('failed');
    expect(await outcomeOf(json(null, 200))).toBe('failed');
    expect(await outcomeOf(json(['sent'], 200))).toBe('failed');
  });

  // #390 RF4. An outcome is one of the record's OWN keys. Read with `in`, the
  // names every object inherits passed as outcomes, and the page then looked
  // for a status nobody wrote.
  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'reads failed from the inherited name %s',
    async (outcome) => {
      expect(await outcomeOf(json({ outcome }, 200))).toBe('failed');
    },
  );
});

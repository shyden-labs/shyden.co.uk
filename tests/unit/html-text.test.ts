import { describe, expect, it } from 'vitest';
import { renderedText } from '../html-text';

/**
 * `copy-reaches-a-page.spec.ts` asks whether each catalogue string appears in
 * the built HTML, so it reads that HTML as a reader would see it. Its decoder
 * replaced one entity at a time with `&amp;` before `&lt;`, so text served as
 * `&amp;lt;` -- a literal "&lt;" on the page -- came back as `<`, decoded twice;
 * and `fromCharCode` cut anything above U+FFFF in half (#390 F115).
 */
describe('renderedText: built HTML as a reader sees its text', () => {
  it('decodes an escaped ampersand once, never twice', () => {
    expect(renderedText('a &amp;lt; b &amp;amp; c')).toBe('a &lt; b &amp; c');
    expect(renderedText('&#38;lt;')).toBe('&lt;');
  });

  it('decodes the named, decimal and hex forms the build emits', () => {
    expect(
      renderedText('&quot;x&quot; &apos;y&apos; &lt;z&gt; you&#39;re &#x2014;'),
    ).toBe("\"x\" 'y' <z> you're —");
  });

  it('decodes a character above U+FFFF whole', () => {
    expect(renderedText('&#128512; &#x1F600;')).toBe('😀 😀');
  });

  it('turns a non-breaking space into a space, and flattens whitespace', () => {
    expect(renderedText('one&nbsp;two\n   three\tfour')).toBe(
      'one two three four',
    );
  });

  it('leaves an entity it does not know as written', () => {
    expect(renderedText('&copy; &bogus;')).toBe('&copy; &bogus;');
  });
});

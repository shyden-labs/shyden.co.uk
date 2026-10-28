/**
 * A reader over fixture texts by path, for a unit test handing code a file
 * reader. A path it was not given is refused by name, so code that reads a
 * file it should not have reads nothing in silence (one home: it was written
 * out five times across the unit suite, #913).
 */
export const fixtureReader =
  (texts: Readonly<Record<string, string>>) =>
  (file: string): string => {
    const text = texts[file];
    if (text === undefined) throw new Error(`no fixture text for ${file}`);
    return text;
  };

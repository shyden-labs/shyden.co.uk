import { afterEach, describe, expect, it, vi } from 'vitest';
import { draftAll } from '../../scripts/i18n-translate.mjs';

/**
 * A DeepL refusal mid-run used to exit before the cache was written,
 * discarding every draft already paid for (#390 F41). `draftAll` now hands
 * each batch over as it lands, so the caller can save it before the next
 * request, and a refusal throws instead of exiting. `fetch` is stood in: a
 * unit test reaches no network.
 */
const deepl = {
  endpoint: 'https://deepl.test',
  apiKey: 'k',
  target: 'zh' as const,
};

afterEach(() => vi.unstubAllGlobals());

describe('draftAll', () => {
  it('hands over each batch before a later one is refused', async () => {
    const sources = Array.from({ length: 51 }, (_, n) => `line ${n}`);
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        return calls === 1
          ? Response.json({
              translations: sources
                .slice(0, 50)
                .map((s) => ({ text: `草 ${s}` })),
            })
          : new Response('quota', { status: 456 });
      }),
    );
    const landed: [string[], string[]][] = [];
    await expect(
      draftAll(
        sources,
        { tagSlots: false },
        deepl,
        (batch: string[], drafts: string[]) => landed.push([batch, drafts]),
      ),
    ).rejects.toThrow(/^DeepL responded 456$/);
    expect(landed).toHaveLength(1);
    expect(landed[0][0]).toEqual(sources.slice(0, 50));
    expect(landed[0][1][49]).toBe('草 line 49');
  });
});

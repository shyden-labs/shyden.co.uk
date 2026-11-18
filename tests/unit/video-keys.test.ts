import { describe, expect, it, vi } from 'vitest';
import { onVideoKey, type VideoKey } from '../../src/lib/videoKeys';

// Space and Enter on the focused preview video start and stop it on every
// browser (Shyden, 2026-11-18, #1054): Linux WebKit's own player ignores Space.
// The page owns the key, so the browser's own handling is stopped and a
// press never toggles twice.

const press = (key: string, extra: Partial<VideoKey> = {}): VideoKey => ({
  key,
  repeat: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  preventDefault: vi.fn(),
  ...extra,
});

const video = (paused: boolean) => ({
  paused,
  play: vi.fn(() => Promise.resolve()),
  pause: vi.fn(),
});

describe('onVideoKey', () => {
  it('Space on a paused video plays it and stops the browser handling the key', () => {
    const v = video(true);
    const key = press(' ');
    expect(onVideoKey(key, v)).toBe(true);
    expect(v.play).toHaveBeenCalledTimes(1);
    expect(v.pause).not.toHaveBeenCalled();
    expect(key.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('Space on a playing video pauses it', () => {
    const v = video(false);
    const key = press(' ');
    expect(onVideoKey(key, v)).toBe(true);
    expect(v.pause).toHaveBeenCalledTimes(1);
    expect(v.play).not.toHaveBeenCalled();
    expect(key.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('Enter on a paused video plays it', () => {
    const v = video(true);
    const key = press('Enter');
    expect(onVideoKey(key, v)).toBe(true);
    expect(v.play).toHaveBeenCalledTimes(1);
    expect(key.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('a held key repeating does not toggle again, but is still kept from the browser', () => {
    const v = video(false);
    const key = press(' ', { repeat: true });
    expect(onVideoKey(key, v)).toBe(true);
    expect(v.play).not.toHaveBeenCalled();
    expect(v.pause).not.toHaveBeenCalled();
    expect(key.preventDefault).toHaveBeenCalledTimes(1);
  });

  it.each([['altKey'], ['ctrlKey'], ['metaKey'], ['shiftKey']] as const)(
    'Space with %s held is left to the browser',
    (modifier) => {
      const v = video(true);
      const key = press(' ', { [modifier]: true });
      expect(onVideoKey(key, v)).toBe(false);
      expect(v.play).not.toHaveBeenCalled();
      expect(key.preventDefault).not.toHaveBeenCalled();
    },
  );

  it.each([['k'], ['ArrowRight'], ['Tab'], ['Escape']])(
    '%s is left to the browser',
    (name) => {
      const v = video(true);
      const key = press(name);
      expect(onVideoKey(key, v)).toBe(false);
      expect(v.play).not.toHaveBeenCalled();
      expect(v.pause).not.toHaveBeenCalled();
      expect(key.preventDefault).not.toHaveBeenCalled();
    },
  );

  it('a play the browser refuses is caught, not left unhandled', async () => {
    const refused = Promise.reject(new Error('NotAllowedError'));
    const caught = vi.spyOn(refused, 'catch');
    const v = { paused: true, play: vi.fn(() => refused), pause: vi.fn() };
    expect(onVideoKey(press(' '), v)).toBe(true);
    expect(caught).toHaveBeenCalledTimes(1);
    // The handler the page attached settles the refusal without throwing.
    await expect(caught.mock.results[0]?.value).resolves.toBeUndefined();
  });
});

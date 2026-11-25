import { describe, expect, it, vi } from 'vitest';
import {
  onVideoKey,
  onVideoKeyUp,
  type VideoKey,
} from '../../src/lib/videoKeys';

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
  stopPropagation: vi.fn(),
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

// Measured on Chromium (CI run 44392126826): its player toggles on the keyup
// of Space, so with keydown taken the video played and paused at once
// ("keydown \" \" (stopped), keyup \" \", play, pause"). The keyup of a key
// the page took is kept from the browser too, and toggles nothing.
describe('onVideoKeyUp', () => {
  it.each([[' '], ['Enter']])(
    'the keyup of %j is kept from the browser',
    (name) => {
      const key = press(name);
      expect(onVideoKeyUp(key)).toBe(true);
      expect(key.preventDefault).toHaveBeenCalledTimes(1);
    },
  );

  it.each([['altKey'], ['ctrlKey'], ['metaKey'], ['shiftKey']] as const)(
    'the keyup of Space with %s held is left to the browser',
    (modifier) => {
      const key = press(' ', { [modifier]: true });
      expect(onVideoKeyUp(key)).toBe(false);
      expect(key.preventDefault).not.toHaveBeenCalled();
    },
  );

  it.each([['k'], ['Tab']])(
    'the keyup of %s is left to the browser',
    (name) => {
      const key = press(name);
      expect(onVideoKeyUp(key)).toBe(false);
      expect(key.preventDefault).not.toHaveBeenCalled();
    },
  );
});

// Measured on Chromium (CI run 44393520871): with both keydown and keyup's
// defaults stopped, one Space still played and paused the video. Chromium's
// player inside the video handles the key before a listener on the video
// runs. The page takes the key on its way down instead, and stops it there,
// so the player never sees a key the page took.
describe('a key the page takes goes no further', () => {
  it('Space down and up stop on their way to the player', () => {
    const down = press(' ');
    const up = press(' ');
    onVideoKey(down, video(true));
    onVideoKeyUp(up);
    expect(down.stopPropagation).toHaveBeenCalledTimes(1);
    expect(up.stopPropagation).toHaveBeenCalledTimes(1);
  });

  it('a held Space repeating stops too', () => {
    const down = press(' ', { repeat: true });
    onVideoKey(down, video(false));
    expect(down.stopPropagation).toHaveBeenCalledTimes(1);
  });

  it('a key the page leaves travels on', () => {
    const down = press('k');
    const up = press(' ', { ctrlKey: true });
    onVideoKey(down, video(true));
    onVideoKeyUp(up);
    expect(down.stopPropagation).not.toHaveBeenCalled();
    expect(up.stopPropagation).not.toHaveBeenCalled();
  });
});

import { describe, it, expect } from 'vitest';
import {
  avatarSvg,
  avatarSymbolId,
  AVATAR_SEXES,
  type Sex,
} from '../../src/lib/avatars';

describe('avatarSvg', () => {
  it('uses the boy palette', () => {
    expect(avatarSvg('M')).toContain('hsl(214 92% 88%)');
    expect(avatarSvg('M')).toContain('hsl(218 85% 46%)');
  });

  it('uses the girl palette', () => {
    expect(avatarSvg('F')).toContain('hsl(334 95% 92%)');
    expect(avatarSvg('F')).toContain('hsl(332 85% 60%)');
  });

  it('uses the neutral palette for a student with no sex', () => {
    expect(avatarSvg(null)).toContain('hsl(150 40% 86%)');
    expect(avatarSvg(null)).toContain('hsl(150 42% 42%)');
  });

  it('gives the three different hair, not just different colour', () => {
    // Colour alone fails a greyscale printout and the ~1 in 12 with red-green
    // colour blindness, for whom this palette puts pink beside green.
    const hair = (sex: 'M' | 'F' | null) =>
      (avatarSvg(sex).match(/hsl\(24 40% 24%\)"\s+d="([^"]+)"/) ?? [])[1];
    const [m, f, n] = [hair('M'), hair('F'), hair(null)];
    expect(new Set([m, f, n]).size).toBe(3);
    // Every hair path was actually captured -- a Set of size 3 could also be
    // reached by three different `undefined`s never colliding, which would
    // be a false pass hiding a broken regex/markup, not three real shapes.
    expect(m).toBeTruthy();
    expect(f).toBeTruthy();
    expect(n).toBeTruthy();
  });

  it('carries an accessible label', () => {
    expect(avatarSvg('F')).toContain('role="img"');
    expect(avatarSvg('F')).toMatch(/aria-label="[^"]+"/);
  });

  it('is a 40x40 viewBox, rendered at 34px in group cards (ClassroomGroupsPage.astro)', () => {
    for (const sex of AVATAR_SEXES) {
      expect(avatarSvg(sex)).toContain('viewBox="0 0 40 40"');
    }
  });

  it('is exactly one <symbol>, not a full standalone <svg>', () => {
    // `avatarSvg` is authored once per sex and referenced by <use> -- see
    // this module's own doc comment. A stray top-level <svg> here would
    // either fail to parse as a sprite child or silently double-nest.
    for (const sex of AVATAR_SEXES) {
      const svg = avatarSvg(sex);
      expect(svg.startsWith('<symbol ')).toBe(true);
      expect(svg.endsWith('</symbol>')).toBe(true);
      expect(svg).not.toContain('<svg');
    }
  });

  it('is deterministic -- the same sex always returns the identical markup, so the same child keeps the same face across every shuffle', () => {
    expect(avatarSvg('M')).toBe(avatarSvg('M'));
    expect(avatarSvg('F')).toBe(avatarSvg('F'));
    expect(avatarSvg(null)).toBe(avatarSvg(null));
  });

  it('cannot be hijacked by a value outside the real type -- a value read from the page reaches it unchecked, so a caller CAN pass anything at runtime', () => {
    const hostile = '"></symbol><script>alert(1)</script>';
    const svg = avatarSvg(hostile as unknown as Sex);
    expect(svg).not.toContain('script');
    expect(svg).not.toContain(hostile);
    // Falls back to the same neutral face a real `null` (no sex set) gets --
    // never a fourth, unaccounted-for shape.
    expect(svg).toBe(avatarSvg(null));
  });
});

describe('avatarSymbolId', () => {
  it('gives each sex a distinct, stable id', () => {
    const ids = AVATAR_SEXES.map(avatarSymbolId);
    expect(new Set(ids).size).toBe(3);
    expect(avatarSymbolId('M')).toBe(avatarSymbolId('M'));
  });

  it('is the exact id avatarSvg gives its own <symbol> -- one mapping, not two hand-written copies', () => {
    for (const sex of AVATAR_SEXES) {
      expect(avatarSvg(sex)).toContain(`id="${avatarSymbolId(sex)}"`);
    }
  });

  it('normalises an unrecognised sex to the same id as neutral, matching avatarSvg', () => {
    expect(avatarSymbolId('X' as unknown as Sex)).toBe(avatarSymbolId(null));
  });
});

describe('AVATAR_SEXES', () => {
  it('is exactly the three keys avatarSvg/avatarSymbolId branch on', () => {
    expect(AVATAR_SEXES).toEqual(['M', 'F', null]);
  });
});

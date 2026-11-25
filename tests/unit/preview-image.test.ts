import { describe, expect, it } from 'vitest';
import {
  PREVIEW_HEIGHT,
  PREVIEW_PAGES,
  PREVIEW_WIDTH,
  linkPreviewFor,
  previewImageFor,
} from '../../src/lib/preview-image';

// A link preview (Facebook, WhatsApp, X) shows the page it links to (#1158).
describe('previewImageFor', () => {
  it('names the English homepage preview for /', () => {
    expect(previewImageFor('/')).toBe('/previews/en/home.png');
  });

  it('names a localised homepage preview for /id and /id/', () => {
    expect(previewImageFor('/id')).toBe('/previews/id/home.png');
    expect(previewImageFor('/id/')).toBe('/previews/id/home.png');
  });

  it('names an English tool page by its slug, with or without the slash', () => {
    expect(previewImageFor('/classroom-groups')).toBe(
      '/previews/en/classroom-groups.png',
    );
    expect(previewImageFor('/classroom-groups/')).toBe(
      '/previews/en/classroom-groups.png',
    );
  });

  it('names a localised tool page by its locale and slug', () => {
    expect(previewImageFor('/th/yeetalk-calculators/')).toBe(
      '/previews/th/yeetalk-calculators.png',
    );
  });

  it('does not take a path that only starts like a locale for one', () => {
    expect(previewImageFor('/identity')).toBe('/previews/en/identity.png');
  });

  it('declares the 1200x630 size every preview is captured at', () => {
    expect([PREVIEW_WIDTH, PREVIEW_HEIGHT]).toEqual([1200, 630]);
  });

  it('lists every published page a preview is captured for', () => {
    expect(PREVIEW_PAGES).toEqual([
      '/',
      '/classroom-groups/',
      '/yeetalk-calculators/',
    ]);
  });
});

// The image a page's <head> names: its own, or its language's homepage when
// it has none (the 404 page, the API docs).
describe('linkPreviewFor', () => {
  it('gives a page with a preview its own', () => {
    expect(linkPreviewFor('/vi/classroom-groups/', 'vi')).toBe(
      '/previews/vi/classroom-groups.png',
    );
  });

  it("gives the 404 page its language's homepage preview", () => {
    expect(linkPreviewFor('/404/', 'en')).toBe('/previews/en/home.png');
    expect(linkPreviewFor('/zh/nowhere/', 'zh')).toBe('/previews/zh/home.png');
  });

  it('gives the API docs the English homepage preview', () => {
    expect(linkPreviewFor('/api/docs/', 'en')).toBe('/previews/en/home.png');
  });
});

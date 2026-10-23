import { describe, it, expect } from 'vitest';
import {
  keyboardOverlap,
  liftFor,
  takesTyping,
} from '../../src/lib/keyboard-dock';

/**
 * Issue 853. The figures are the real iPhone's (iPhone Air, Safari,
 * 2026-10-22): a 746px layout viewport, and with the number pad open a
 * 423px visual viewport scrolled 122px down it.
 */
describe('keyboardOverlap', () => {
  it('is zero while no keyboard is open', () => {
    expect(keyboardOverlap(746, { offsetTop: 0, height: 746 })).toBe(0);
  });

  it("is the layout viewport's height the keyboard hides on the iPhone", () => {
    expect(keyboardOverlap(746, { offsetTop: 122, height: 423 })).toBe(201);
  });

  // Android with `interactive-widget=resizes-content` (issue 807): the
  // keyboard shrinks the layout viewport with the visual one, so nothing is
  // hidden and the bar must not move.
  it('is zero where the keyboard resizes the page instead', () => {
    expect(keyboardOverlap(471, { offsetTop: 0, height: 471 })).toBe(0);
  });

  it('keeps a fractional overlap as it is', () => {
    expect(keyboardOverlap(759, { offsetTop: 0, height: 309.5 })).toBe(449.5);
  });

  // Safari's rubber-band scroll can carry the visual viewport past the
  // layout viewport's bottom for a frame: that hides nothing.
  it('is zero when the visual viewport reaches past the bottom', () => {
    expect(keyboardOverlap(746, { offsetTop: 30, height: 746 })).toBe(0);
  });

  it('is zero for a layout height that is not a number', () => {
    expect(keyboardOverlap(Number.NaN, { offsetTop: 0, height: 423 })).toBe(0);
  });

  it('is zero for a visual viewport height that is not a number', () => {
    expect(keyboardOverlap(746, { offsetTop: 0, height: Number.NaN })).toBe(0);
  });

  it('is zero for an offset that is not a number', () => {
    expect(
      keyboardOverlap(746, {
        offsetTop: Number.POSITIVE_INFINITY,
        height: 423,
      }),
    ).toBe(0);
  });
});

/**
 * Shyden ruled 2026-10-23 that a pinch zoom never moves the bar: only a
 * keyboard does. Chrome keeps `innerHeight` at the layout height while
 * zoomed, so the overlap alone would lift the bar (the real Android, 2.5x:
 * 720px layout, 288px visible from 180px down). The lift therefore waits
 * for a focused field that takes typing.
 */
describe('takesTyping', () => {
  it('is true for a number field', () => {
    expect(takesTyping({ tagName: 'INPUT', type: 'number' })).toBe(true);
  });

  it('is true for a text field', () => {
    expect(takesTyping({ tagName: 'INPUT', type: 'text' })).toBe(true);
  });

  it('is true for a text area', () => {
    expect(takesTyping({ tagName: 'TEXTAREA' })).toBe(true);
  });

  it('is true for editable content', () => {
    expect(takesTyping({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('is false for a checkbox', () => {
    expect(takesTyping({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
  });

  it('is false for a radio button', () => {
    expect(takesTyping({ tagName: 'INPUT', type: 'radio' })).toBe(false);
  });

  it('is false for a button', () => {
    expect(takesTyping({ tagName: 'BUTTON' })).toBe(false);
  });

  it('is false for a file picker', () => {
    expect(takesTyping({ tagName: 'INPUT', type: 'file' })).toBe(false);
  });

  it('is false when nothing has focus', () => {
    expect(takesTyping(null)).toBe(false);
  });
});

describe('liftFor', () => {
  it('lifts above the iPhone keyboard while a number field has focus', () => {
    expect(
      liftFor(
        746,
        { offsetTop: 122, height: 423 },
        { tagName: 'INPUT', type: 'number' },
      ),
    ).toBe(201);
  });

  it('does not lift for a pinch zoom with no field focused', () => {
    expect(liftFor(720, { offsetTop: 180, height: 288 }, null)).toBe(0);
  });

  it('does not lift for a pinch zoom while a checkbox has focus', () => {
    expect(
      liftFor(
        720,
        { offsetTop: 180, height: 288 },
        { tagName: 'INPUT', type: 'checkbox' },
      ),
    ).toBe(0);
  });
});

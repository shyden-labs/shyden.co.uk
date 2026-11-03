import type { Page } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import {
  MouseOnPhoneError,
  refuse,
  refuseMouseOnPhone,
} from '../device/no-mouse-on-phone';

/**
 * On the phone, Playwright's mouse calls and protocol scrolls are refused
 * (#996), so a bare click() that reaches the phone fails naming the helper.
 * Stand-ins for the page, its mouse and the locator class: nothing starts.
 */

class FakeLocator {
  click(): string {
    return 'clicked';
  }
  scrollIntoViewIfNeeded(): string {
    return 'scrolled';
  }
  waitFor(): string {
    return 'waited';
  }
}

const fakePage = () => {
  const mouse = { click: () => 'm', wheel: () => 'w', move: () => 'mv' };
  const page = {
    mouse,
    click: () => 'page-click',
    goto: () => 'went',
    locator: () => new FakeLocator(),
  };
  return page;
};

describe('refuseMouseOnPhone', () => {
  it('refuses every locator click and protocol scroll, naming the helper', () => {
    const page = fakePage();
    refuseMouseOnPhone(page as unknown as Page);
    const fresh = new FakeLocator();
    expect(() => fresh.click()).toThrow(MouseOnPhoneError);
    expect(() => fresh.click()).toThrow(
      /locator\.click\(\) on the phone sends mouse input .*tapOn/,
    );
    expect(() => fresh.scrollIntoViewIfNeeded()).toThrow(/scrollToOn/);
  });

  it("refuses the page's own clicks and every mouse call", () => {
    const page = fakePage();
    refuseMouseOnPhone(page as unknown as Page);
    expect(() => page.click()).toThrow(/page\.click\(\)/);
    expect(() => page.mouse.click()).toThrow(/page\.mouse\.click\(\)/);
    expect(() => page.mouse.wheel()).toThrow(/page\.mouse\.wheel\(\)/);
    expect(() => page.mouse.move()).toThrow(/page\.mouse\.move\(\)/);
  });

  it('leaves what a touch helper needs untouched', () => {
    const page = fakePage();
    refuseMouseOnPhone(page as unknown as Page);
    expect(new FakeLocator().waitFor()).toBe('waited');
    expect(page.goto()).toBe('went');
  });
});

describe('refuse', () => {
  it('patches an object once, however often it is asked', () => {
    const target = { click: () => 'ok' };
    refuse(target, ['click'], 'x');
    const first = target.click;
    refuse(target, ['click'], 'x');
    expect(target.click).toBe(first);
  });
});

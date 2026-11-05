import { tapOn } from './real-touch';
import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { themeColour, type Theme } from './palette';

/**
 * The browser half of the palette model (#142 §6.2), shared by the e2e suite
 * and both deployed-site suites. Every expectation comes from tokens.css
 * through `themeColour`, never from the page, which would compare the page
 * with itself.
 */

/** The one script every page carries (#142 §5), and its text as shipped. */
export const THEME_SCRIPT_FILE = 'src/scripts/theme.inline.js';
export const THEME_SCRIPT_SOURCE = readFileSync(THEME_SCRIPT_FILE, 'utf8');

/**
 * Prove `page` rendered `theme`, by its ground. Every per-theme run asserts
 * this first, so a run meant to be light that rendered dark fails rather than
 * passing on the other palette. Read in screen media: on paper the ground is
 * white whatever the theme.
 */
export async function expectTheme(page: Page, theme: Theme): Promise<void> {
  await expect(
    page.locator('html'),
    `the page rendered the ${theme} theme`,
  ).toHaveCSS('background-color', themeColour(theme, '--bg'));
}

/**
 * Show `theme` as the device's own setting, in screen media, then prove the
 * page rendered it. This is what a visitor's device does, and with no choice
 * saved the page follows it live (#142 §4).
 */
export async function emulateTheme(page: Page, theme: Theme): Promise<void> {
  await page.emulateMedia({ media: 'screen', colorScheme: theme });
  await expectTheme(page, theme);
}

/**
 * Save `theme` as the visitor's choice, as the switch does, then reload so the
 * page's own script reads it before the first paint.
 */
export async function saveTheme(page: Page, theme: Theme): Promise<void> {
  await page.evaluate((value) => localStorage.setItem('theme', value), theme);
  await page.reload();
}

/**
 * The switch, proven on a deployed site (#142 §6.2): a press changes the page,
 * and the choice survives a reload. dev-sanity and prod-sanity each run it
 * against their own host, so it has one home here.
 */
export async function expectTheSwitchPersists(page: Page): Promise<void> {
  const toggle = page.locator('header [data-theme-toggle]');
  await page.goto('/');
  await expectTheme(page, 'dark');
  await tapOn(toggle);
  await expectTheme(page, 'light');
  await page.reload();
  await expectTheme(page, 'light');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
}

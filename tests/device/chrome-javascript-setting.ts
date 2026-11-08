import { adb } from '../../scripts/adb.mjs';
import { CHROME_PACKAGE } from './chrome-foreground';
import {
  centreOf,
  findNode,
  parseUiDump,
  radioBefore,
  type NodeQuery,
  type UiNode,
} from './ui-dump';

/**
 * Blocks and restores JavaScript through Chrome's OWN Settings > Site settings > JavaScript,
 * by real taps on the phone (#1047, Shyden's ruling 2026-11-06). `test.use({ javaScriptEnabled:
 * false })` is inert on the phone's one adopted context, and the DevTools switch
 * (`Emulation.setScriptExecutionDisabled`) was offered and not chosen: a tester's real
 * visitor turns it off here.
 *
 * Every control is found in a `uiautomator dump` by what it says and tapped at the centre of
 * its bounds with `adb shell input tap`; the page's controls are never set by script. A
 * screen that does not show what the walk expects fails naming the control it looked for.
 */

const SETTLE_MS = 600;
/** How many dumps one wait may take before it fails naming what it waited for. */
const WAIT_DUMPS = 20;
/** How many swipes a scroll-to-find may make before it fails naming what it looked for. */
const MAX_SWIPES = 12;

const ALLOW_LABEL = 'Sites can use JavaScript';
const BLOCK_LABEL = "Don't allow sites to use JavaScript";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** What the phone's screen shows now, read by `uiautomator dump`. */
export function dump(): UiNode[] {
  adb(['shell', 'uiautomator', 'dump', '/sdcard/ui.xml']);
  return parseUiDump(adb(['shell', 'cat', '/sdcard/ui.xml']));
}

/** A node the screen really shows: a dump can still hold the screens behind this one. */
function shown(nodes: readonly UiNode[], query: NodeQuery): UiNode | undefined {
  const screen = nodes[0].bounds;
  return nodes.find(
    (node) =>
      findNode([node], query) !== undefined &&
      node.bounds.top >= screen.top &&
      node.bounds.bottom <= screen.bottom &&
      node.bounds.right <= screen.right,
  );
}

function describe(query: NodeQuery): string {
  return JSON.stringify(query);
}

async function waitFor(query: NodeQuery, why: string): Promise<UiNode[]> {
  for (let i = 0; i < WAIT_DUMPS; i++) {
    const nodes = dump();
    if (shown(nodes, query)) return nodes;
    await sleep(SETTLE_MS);
  }
  throw new Error(
    `Chrome's settings walk: waited for ${describe(query)} (${why}) and the screen never showed it`,
  );
}

function tap(node: UiNode): void {
  const { x, y } = centreOf(node);
  adb(['shell', 'input', 'tap', String(x), String(y)]);
}

/** Taps the node the screen shows for `query`, swiping the list up until it appears. */
async function scrollToAndTap(query: NodeQuery, why: string): Promise<void> {
  for (let i = 0; i <= MAX_SWIPES; i++) {
    const nodes = dump();
    const node = shown(nodes, query);
    if (node) {
      tap(node);
      await sleep(SETTLE_MS);
      return;
    }
    const { right, bottom } = nodes[0].bounds;
    adb([
      'shell',
      'input',
      'swipe',
      String(Math.round(right / 2)),
      String(Math.round(bottom * 0.75)),
      String(Math.round(right / 2)),
      String(Math.round(bottom * 0.3)),
      '300',
    ]);
    await sleep(SETTLE_MS);
  }
  throw new Error(
    `Chrome's settings walk: looked for ${describe(query)} (${why}) through ${MAX_SWIPES} swipes and never found it`,
  );
}

const MENU_BUTTON = { description: 'Customize and control Google Chrome' };

/**
 * Taps the browser's menu button. With no tab open Chrome shows its tab switcher instead, which
 * has no menu button: a real tap on its New tab button opens one, as a visitor would.
 */
async function openBrowserMenu(): Promise<void> {
  for (let i = 0; i < WAIT_DUMPS; i++) {
    const nodes = dump();
    const menu = shown(nodes, MENU_BUTTON);
    if (menu) {
      tap(menu);
      await sleep(SETTLE_MS);
      return;
    }
    const newTab = shown(nodes, { description: 'New tab' });
    if (newTab && shown(nodes, { description: 'Manage open tabs' }))
      tap(newTab);
    await sleep(SETTLE_MS);
  }
  throw new Error(
    `Chrome's settings walk: waited for ${describe(MENU_BUTTON)} (the browser menu button) and the screen never showed it`,
  );
}

/**
 * Puts Chrome's JavaScript setting to `allowed`, then returns to the page. Reads the setting
 * back from the screen and throws, naming it, when it is not what was asked for.
 */
export async function setChromeJavaScript(allowed: boolean): Promise<void> {
  adb([
    'shell',
    'am',
    'start',
    '-n',
    `${CHROME_PACKAGE}/com.google.android.apps.chrome.Main`,
  ]);
  await openBrowserMenu();
  await scrollToAndTap({ text: 'Settings' }, 'the menu entry');
  await waitFor({ text: 'Search settings' }, 'the Settings screen');
  await scrollToAndTap({ text: 'Site settings' }, 'a Settings entry');
  await waitFor({ text: 'All sites' }, 'the Site settings screen');
  await scrollToAndTap({ text: 'JavaScript' }, 'a Site settings entry');
  await waitFor({ text: ALLOW_LABEL }, 'the JavaScript setting');

  const wanted = allowed ? ALLOW_LABEL : BLOCK_LABEL;
  const before = dump();
  if (!radioBefore(before, wanted).checked) {
    tap(shown(before, { text: wanted })!);
    await sleep(SETTLE_MS);
  }
  const after = dump();
  if (!radioBefore(after, wanted).checked)
    throw new Error(
      `Chrome's JavaScript setting: tapped "${wanted}" and the screen still shows it unchosen`,
    );

  // Back out with the real Back key, three times: to Site settings, to Settings, to the page.
  for (let i = 0; i < 3; i++) {
    adb(['shell', 'input', 'keyevent', 'KEYCODE_BACK']);
    await sleep(SETTLE_MS);
  }
}

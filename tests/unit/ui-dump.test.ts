import { describe, expect, it } from 'vitest';
import {
  centreOf,
  findNode,
  parseUiDump,
  radioBefore,
  switchIsOn,
} from '../device/ui-dump';

/**
 * Chrome's Site settings is walked by real taps (#1047): the controls are found in a
 * `uiautomator dump`, never by a fixed coordinate. These read that XML.
 */
const DUMP = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node text="JavaScript" resource-id="android:id/title" class="android.widget.TextView" content-desc="" checked="false" bounds="[48,300][400,360]" />
  <node text="" resource-id="android:id/switch_widget" class="android.widget.Switch" content-desc="" checked="true" bounds="[900,310][1020,370]" />
  <node text="Allowed &amp; recommended" resource-id="x" class="android.widget.TextView" content-desc="More options" checked="false" bounds="[0,0][100,50]" />
</hierarchy>`;

describe('parseUiDump', () => {
  it('reads every node with its text, description, class, checked state and bounds', () => {
    const nodes = parseUiDump(DUMP);
    expect(nodes).toHaveLength(3);
    expect(nodes[0]).toMatchObject({
      text: 'JavaScript',
      className: 'android.widget.TextView',
      checked: false,
      bounds: { left: 48, top: 300, right: 400, bottom: 360 },
    });
    expect(nodes[1].checked).toBe(true);
  });

  it('decodes XML entities in text', () => {
    expect(parseUiDump(DUMP)[2].text).toBe('Allowed & recommended');
  });

  it('refuses a dump with no nodes, naming why', () => {
    expect(() => parseUiDump('<hierarchy/>')).toThrow(/no nodes/);
  });
});

describe('findNode', () => {
  const nodes = parseUiDump(DUMP);
  it('finds a node by its text', () => {
    expect(findNode(nodes, { text: 'JavaScript' })?.bounds.left).toBe(48);
  });
  it('finds a node by its content description', () => {
    expect(findNode(nodes, { description: 'More options' })?.text).toMatch(
      /Allowed/,
    );
  });
  it('finds a node by its class', () => {
    expect(
      findNode(nodes, { className: 'android.widget.Switch' })?.checked,
    ).toBe(true);
  });
  it('returns undefined when nothing matches', () => {
    expect(findNode(nodes, { text: 'Nope' })).toBeUndefined();
  });
  it("reads each node's resource id (#1272)", () => {
    expect(nodes.map((n) => n.resourceId)).toEqual([
      'android:id/title',
      'android:id/switch_widget',
      'x',
    ]);
  });
  it('finds a node by its resource id (#1272)', () => {
    expect(
      findNode(nodes, { resourceId: 'android:id/switch_widget' })?.checked,
    ).toBe(true);
  });
});

/**
 * #1272: after a factory reset the OPPO ran English (UK), and Chrome 158 named
 * its menu button "Customise and control Google Chrome": the walk, which
 * looked for the US spelling, failed every Android test of the 2026-11-28
 * run. The menu is found by its resource id, which no language changes.
 */
describe("the walk finds Chrome's menu button in any language", () => {
  const toolbar = (desc: string) =>
    parseUiDump(`<hierarchy rotation="0">
  <node text="" resource-id="com.android.chrome:id/toolbar" class="android.widget.FrameLayout" content-desc="" checked="false" bounds="[0,96][1080,264]" />
  <node text="" resource-id="com.android.chrome:id/menu_button" class="android.widget.ImageButton" content-desc="${desc}" checked="false" bounds="[978,138][1056,222]" />
</hierarchy>`);
  for (const desc of [
    'Customize and control Google Chrome',
    'Customise and control Google Chrome',
    'Sesuaikan dan kontrol Google Chrome',
  ])
    it(`finds it labelled "${desc}"`, async () => {
      const { MENU_BUTTON } =
        await import('../device/chrome-javascript-setting');
      expect(findNode(toolbar(desc), MENU_BUTTON)?.bounds.left).toBe(978);
    });
});

describe('centreOf and switchIsOn', () => {
  const nodes = parseUiDump(DUMP);
  it('taps the middle of the bounds', () => {
    expect(centreOf(nodes[0])).toEqual({ x: 224, y: 330 });
  });
  it('reads a switch as on when checked', () => {
    expect(switchIsOn(nodes[1])).toBe(true);
  });
  it('refuses to read a node that is not a switch', () => {
    expect(() => switchIsOn(nodes[0])).toThrow(/not a switch/);
  });
});

describe('radioBefore', () => {
  // Chrome's JavaScript setting is two radio rows: the button comes just before its label.
  const rows = parseUiDump(`<hierarchy>
  <node text="" class="android.widget.RadioButton" content-desc="" checked="true" bounds="[112,631][224,743]" />
  <node text="Sites can use JavaScript" class="android.widget.TextView" content-desc="" checked="false" bounds="[413,653][868,720]" />
  <node text="" class="android.widget.RadioButton" content-desc="" checked="false" bounds="[112,821][224,933]" />
  <node text="Don't allow sites to use JavaScript" class="android.widget.TextView" content-desc="" checked="false" bounds="[413,843][1068,910]" />
</hierarchy>`);
  it('reads the button before each label', () => {
    expect(radioBefore(rows, 'Sites can use JavaScript').checked).toBe(true);
    expect(
      radioBefore(rows, "Don't allow sites to use JavaScript").checked,
    ).toBe(false);
  });
  it('refuses a label that is not on screen, naming it', () => {
    expect(() => radioBefore(rows, 'Nope')).toThrow(/"Nope"/);
  });
  it('refuses a label with no radio button before it', () => {
    const bare = parseUiDump(
      '<node text="Lonely" class="android.widget.TextView" content-desc="" checked="false" bounds="[0,0][10,10]" />',
    );
    expect(() => radioBefore(bare, 'Lonely')).toThrow(/no radio button/);
  });
});

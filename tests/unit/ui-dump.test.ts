import { describe, expect, it } from 'vitest';
import { centreOf, findNode, parseUiDump, switchIsOn } from '../device/ui-dump';

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

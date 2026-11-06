/**
 * Reads a `uiautomator dump` so the phone's own Settings screens can be walked by real taps
 * (#1047): a control is found by what it says, never by a fixed coordinate. Pure; the adb
 * calls that fetch the dump and send the tap live with the caller.
 */

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface UiNode {
  text: string;
  description: string;
  className: string;
  checked: boolean;
  bounds: Bounds;
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

const decode = (value: string): string =>
  value.replace(/&(amp|lt|gt|quot|apos);/g, (entity) => ENTITIES[entity]);

function attribute(tag: string, name: string): string {
  const match = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return match ? decode(match[1]) : '';
}

/** Every node of the dump, in document order. Throws, naming why, when there are none. */
export function parseUiDump(xml: string): UiNode[] {
  const nodes: UiNode[] = [];
  for (const [tag] of xml.matchAll(/<node\b[^>]*>/g)) {
    const box = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(attribute(tag, 'bounds'));
    if (!box) continue;
    nodes.push({
      text: attribute(tag, 'text'),
      description: attribute(tag, 'content-desc'),
      className: attribute(tag, 'class'),
      checked: attribute(tag, 'checked') === 'true',
      bounds: {
        left: Number(box[1]),
        top: Number(box[2]),
        right: Number(box[3]),
        bottom: Number(box[4]),
      },
    });
  }
  if (nodes.length === 0)
    throw new Error('the uiautomator dump held no nodes with bounds');
  return nodes;
}

export interface NodeQuery {
  text?: string;
  description?: string;
  className?: string;
}

/** The first node matching every field of `query`, exactly. */
export function findNode(
  nodes: readonly UiNode[],
  query: NodeQuery,
): UiNode | undefined {
  return nodes.find(
    (node) =>
      (query.text === undefined || node.text === query.text) &&
      (query.description === undefined ||
        node.description === query.description) &&
      (query.className === undefined || node.className === query.className),
  );
}

/** Where to tap: the middle of the node. */
export function centreOf(node: UiNode): { x: number; y: number } {
  const { left, top, right, bottom } = node.bounds;
  return {
    x: Math.round((left + right) / 2),
    y: Math.round((top + bottom) / 2),
  };
}

/** Whether a switch is on, as the phone reports it. */
export function switchIsOn(node: UiNode): boolean {
  if (!node.className.endsWith('Switch'))
    throw new Error(
      `the node "${node.text}" is not a switch (${node.className})`,
    );
  return node.checked;
}

import { convert } from 'ast-v8-to-istanbul';
import { parse } from 'vite';
import type { VitestTool } from '../scripts/coverage-processes.mjs';

const BASE64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** One signed number as base64 VLQ, the form a source map's mappings are written in. */
export const vlq = (value: number) => {
  let rest = value < 0 ? (-value << 1) | 1 : value << 1;
  let out = '';
  do {
    const digit = rest & 31;
    rest >>>= 5;
    out += BASE64[rest > 0 ? digit | 32 : digit];
  } while (rest > 0);
  return out;
};

/**
 * Vitest's converter stood in for (#913): ast-v8-to-istanbul over vite's
 * parse of the transform and through its map, what `remapCoverage` runs,
 * without its SSR ignore rules. Those act on statements alone, and an SSR
 * export wrapper's function sits on a line the map leaves unplaced, so the
 * map drops it here as it does there (#959).
 */
export const remap: VitestTool['remap'] = async (
  url,
  transformed,
  functions,
) => {
  const parsed = await parse(url, transformed.code, {
    lang: /\.[mc]?tsx?$/.test(url) ? 'ts' : 'js',
    preserveParens: false,
  });
  return convert({
    ast: parsed.program as never,
    code: transformed.code,
    sourceMap: transformed.map as never,
    wrapperLength: 0,
    coverage: { functions, url },
  });
};

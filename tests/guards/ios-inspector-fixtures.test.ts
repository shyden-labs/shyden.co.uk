import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { catalogueLeaves } from '../../src/lib/catalogue-leaves';
import type { PlistValue } from '../device/ios/inspector/bplist';
import { decodeAnyPlist } from '../device/ios/inspector/plist-xml';
import {
  committableFiles,
  filesUnder,
  searched,
  walkDisagreements,
} from '../source-files';
import { THROWAWAY_PAIR } from '../unit/fixtures/ios-inspector/throwaway-pair';

/**
 * The iPhone inspector's fixtures carry none of the phone's secrets (#811 AC2).
 *
 * The fixtures replay what the phone said, and a pair record is the key to
 * that phone: whoever holds its HostPrivateKey can talk to it as this Mac.
 * The recorder replaces every certificate with throwaway ones it made, the
 * private keys with a placeholder, and the pairing identifiers with fakes.
 * This guard holds that: every PEM block in the directory is one of the
 * throwaway pair's, and every pairing identifier is a fake. A real key pasted
 * in, or a recorder that forgot a key, fails here by name.
 */
const DIR = 'tests/unit/fixtures/ios-inspector';
const PEM = /-----BEGIN ([A-Z ]+)-----[\s\S]*?-----END \1-----/g;
const IDENTIFIER_KEYS = new Set([
  'HostID',
  'SystemBUID',
  'SerialNumber',
  'USBSerialNumber',
  'UniqueDeviceID',
  'PairRecordID',
  'WiFiMACAddress',
  'EscrowBag',
]);
const FAKE_IDENTIFIERS = new Set([
  THROWAWAY_PAIR.hostId,
  THROWAWAY_PAIR.systemBuid,
  THROWAWAY_PAIR.udid,
  THROWAWAY_PAIR.udid.replaceAll('-', ''),
  '00:00:00:00:00:00',
  'throwaway-escrow-bag',
]);

/** A PEM written inside a TypeScript string carries `\n` escapes; the same block, read either way, hashes alike. */
const sha = (text: string): string =>
  createHash('sha256')
    .update(text.replaceAll('\\n', '\n').trim())
    .digest('hex');

const THROWAWAY_PEMS = new Set(
  [
    THROWAWAY_PAIR.hostCertificatePem,
    THROWAWAY_PAIR.hostKeyPem,
    THROWAWAY_PAIR.deviceCertificatePem,
    THROWAWAY_PAIR.rootCertificatePem,
  ].map((pem) => sha(pem.toString('utf8'))),
);

interface Reading {
  readonly file: string;
  /** Every text the file holds once each payload is decoded, the file's own text first. */
  readonly texts: string[];
  /** Every value found at a pairing-identifier key, as text. */
  readonly identifiers: { key: string; value: string }[];
}

/** A plist's data, written as text the catalogue walk can carry: a Buffer is an object, and the walk would read its bytes as leaves. */
const DATA = 'data:';
const asTable = (value: PlistValue): unknown =>
  JSON.parse(
    JSON.stringify(value, (_key, item: unknown) => {
      const json = item as { type?: unknown; data?: unknown } | null;
      return json?.type === 'Buffer' && Array.isArray(json.data)
        ? DATA + Buffer.from(json.data as number[]).toString('base64')
        : item;
    }),
  );

const isPlist = (bytes: Buffer): boolean => {
  const head = bytes.subarray(0, 8).toString('latin1');
  return head.startsWith('bplist00') || head.startsWith('<?xml');
};

/**
 * Reads every payload, and every plist nested in a payload's data, through
 * the one catalogue walk (one-home.test.ts). Nested plists wait in a queue
 * rather than a recursion of this file's own.
 */
function decodeInto(first: Buffer, into: Reading): void {
  const queue = [first];
  for (let bytes = queue.shift(); bytes; bytes = queue.shift()) {
    into.texts.push(bytes.toString('utf8'));
    if (!isPlist(bytes)) continue;
    for (const [path, leaf] of catalogueLeaves(
      asTable(decodeAnyPlist(bytes)),
    )) {
      const key =
        path
          .split('.')
          .at(-1)
          ?.replace(/\[\d+\]$/, '') ?? '';
      const data =
        typeof leaf === 'string' && leaf.startsWith(DATA)
          ? Buffer.from(leaf.slice(DATA.length), 'base64')
          : undefined;
      if (IDENTIFIER_KEYS.has(key))
        into.identifiers.push({
          key,
          value: data ? data.toString('utf8') : String(leaf),
        });
      if (data) queue.push(data);
    }
  }
}

function read(file: string): Reading {
  const text = readFileSync(file, 'utf8');
  const reading: Reading = { file, texts: [text], identifiers: [] };
  if (file.endsWith('.json')) {
    const { frames } = JSON.parse(text) as {
      frames: { base64: string }[];
    };
    for (const frame of frames)
      decodeInto(Buffer.from(frame.base64, 'base64'), reading);
  }
  return reading;
}

const files = filesUnder(DIR, () => true);
const readings = files.map(read);
const pemBlocks = readings.flatMap((reading) =>
  reading.texts.flatMap((text) =>
    [...text.matchAll(PEM)].map((match) => ({
      file: reading.file,
      kind: match[1],
      hash: sha(match[0]),
    })),
  ),
);
const identifiers = readings.flatMap((reading) =>
  reading.identifiers.map((found) => ({ file: reading.file, ...found })),
);

describe("the iPhone inspector's fixtures hold none of the phone's secrets", () => {
  it('reads every file git would commit in the directory, and nothing else', () => {
    expect(
      searched(
        walkDisagreements(
          files,
          committableFiles((path) => path.startsWith(`${DIR}/`)),
        ),
        { of: files, what: 'fixture files' },
      ),
    ).toEqual([]);
    expect(
      floorBreach('ios-inspector-fixtures/files', files.length),
    ).toBeUndefined();
  });

  it('every PEM block is one of the throwaway pair', () => {
    const foreign = pemBlocks
      .filter((block) => !THROWAWAY_PEMS.has(block.hash))
      .map((block) => `${block.file}: a ${block.kind} that is not throwaway`);
    expect(searched(foreign, { of: pemBlocks, what: 'PEM blocks' })).toEqual(
      [],
    );
    expect(
      floorBreach('ios-inspector-fixtures/pem-blocks', pemBlocks.length),
    ).toBeUndefined();
  });

  it('every pairing identifier is a fake', () => {
    const real = identifiers
      .filter((found) => !FAKE_IDENTIFIERS.has(found.value))
      .map((found) => `${found.file}: ${found.key} is not a fake`);
    expect(
      searched(real, { of: identifiers, what: 'pairing identifiers' }),
    ).toEqual([]);
    expect(
      floorBreach('ios-inspector-fixtures/identifiers', identifiers.length),
    ).toBeUndefined();
  });

  describe.each(readings.map((reading) => [reading.file, reading] as const))(
    '%s',
    (_file, reading) => {
      it('the reader found every BEGIN line the decoded text holds', () => {
        const begins = reading.texts.reduce(
          (sum, text) => sum + text.split('-----BEGIN ').length - 1,
          0,
        );
        expect(
          pemBlocks.filter((block) => block.file === reading.file).length,
        ).toBe(begins);
      });
    },
  );
});

/**
 * TLS to the phone, pinned to its pair record (#811 Task 7).
 *
 * The phone's certificate is self-signed by the pairing's own root, so no
 * certificate authority can vouch for it, and a chain check would refuse
 * it. What can vouch for it is the pair record: the phone presented exactly
 * the record's DeviceCertificate on 2026-10-24 (measured, DER-equal). So
 * the chain check is off ONLY because `verifyPinnedPeer` replaces it, and
 * every caller of `pinnedTlsOptions` must call `verifyPinnedPeer` with the
 * peer's certificate before sending anything (connect.ts does).
 */
import type { ConnectionOptions } from 'node:tls';
import type { PairRecord } from './usbmux';

const CERTIFICATE =
  /-----BEGIN CERTIFICATE-----([A-Za-z0-9+/=\s]+)-----END CERTIFICATE-----/;

export class PinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PinError';
  }
}

export function pemToDer(pem: Buffer): Buffer {
  const body = CERTIFICATE.exec(pem.toString('latin1'));
  if (!body) throw new PinError('no PEM certificate in the pair record');
  return Buffer.from(body[1].replace(/\s+/g, ''), 'base64');
}

export function pinnedTlsOptions(pair: PairRecord): ConnectionOptions {
  return {
    cert: pair.hostCertificatePem,
    key: pair.hostKeyPem,
    minVersion: 'TLSv1.2',
    // Replaced by verifyPinnedPeer, which accepts one certificate and no other.
    rejectUnauthorized: false,
    checkServerIdentity: () => undefined,
  };
}

export function verifyPinnedPeer(
  peerDer: Buffer | undefined,
  pair: PairRecord,
): void {
  if (peerDer === undefined || peerDer.length === 0)
    throw new PinError('the phone presented no certificate');
  if (!peerDer.equals(pemToDer(pair.deviceCertificatePem)))
    throw new PinError(
      "the phone's certificate is not the one in its pair record",
    );
}

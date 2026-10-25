import { describe, expect, it } from 'vitest';
import {
  pemToDer,
  pinnedTlsOptions,
  verifyPinnedPeer,
} from '../device/ios/inspector/pin';
import { THROWAWAY_PAIR } from './fixtures/ios-inspector/throwaway-pair';
import { PAIR } from './ios-inspector-transport';

/** TLS to the phone, pinned to the certificate its pair record holds (#811 Task 7). */

describe('a certificate read from PEM', () => {
  it('matches the DER openssl wrote for it', () =>
    expect(pemToDer(THROWAWAY_PAIR.deviceCertificatePem)).toEqual(
      THROWAWAY_PAIR.deviceCertificateDer,
    ));
  it('refuses text with no certificate in it', () =>
    expect(() => pemToDer(Buffer.from('not a certificate'))).toThrow(
      'no PEM certificate in the pair record',
    ));
});

describe('the options a TLS connection to the phone takes', () => {
  const options = pinnedTlsOptions(PAIR);
  it("presents this Mac's certificate", () =>
    expect(options.cert).toBe(THROWAWAY_PAIR.hostCertificatePem));
  it("and this Mac's key", () =>
    expect(options.key).toBe(THROWAWAY_PAIR.hostKeyPem));
  it('speaks TLS 1.2 or later, as the phone was measured to', () =>
    expect(options.minVersion).toBe('TLSv1.2'));
  it('leaves the chain unchecked, because verifyPinnedPeer checks the one certificate that matters', () =>
    expect(options.rejectUnauthorized).toBe(false));
  it('checks no host name, since the phone has none', () =>
    expect(
      options.checkServerIdentity?.('phone', {} as never),
    ).toBeUndefined());
});

describe("the phone's certificate, checked against the pair record", () => {
  it('passes when it is the one the record holds', () =>
    expect(() =>
      verifyPinnedPeer(THROWAWAY_PAIR.deviceCertificateDer, PAIR),
    ).not.toThrow());

  it('fails when one byte differs', () => {
    const forged = Buffer.from(THROWAWAY_PAIR.deviceCertificateDer);
    forged[forged.length - 1] ^= 0x01;
    expect(() => verifyPinnedPeer(forged, PAIR)).toThrow(
      "the phone's certificate is not the one in its pair record",
    );
  });

  it('fails when the phone presented none', () =>
    expect(() => verifyPinnedPeer(undefined, PAIR)).toThrow(
      'the phone presented no certificate',
    ));
});

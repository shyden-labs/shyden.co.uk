/**
 * The address the support journey writes from: the support test mailbox,
 * plus-addressed with the engine and the run (#1032 AC5, Shyden 2026-11-22).
 * ShyDesk allows 5 requests an hour per customer email, so each engine of
 * each run gets an address of its own, and dev ShyDesk clears every
 * `support-test+` ticket (shyden-labs/shydesk#254).
 */
export function supportTestAddress(engine: string, at: number): string {
  return `support-test+${engine}-${at}@shyden.co.uk`;
}

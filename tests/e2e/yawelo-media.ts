import { readFileSync } from 'node:fs';
import type { BrowserContext, Route } from '@playwright/test';

/**
 * The homepage's Yawelo Idle video (#835) comes from the shared media host
 * (Cloudflare R2, yawelo-idle#713) in every build. That host sends
 * `Cross-Origin-Resource-Policy: same-site`, which
 * admits shyden.co.uk and dev.shyden.co.uk and refuses the suite's
 * `localhost` preview, so here every request for it is answered from
 * `tests/e2e/stand-ins/`: two-second synthetic clips with the real files'
 * codecs (H.264 High + AAC, VP9 + Opus), so each engine picks the file it
 * would pick in production, and a plain poster. The page is unchanged; only
 * the answers are. The real host is played on the deployed dev site, which is
 * same-site (`tests/dev/dev-sanity.spec.ts`).
 */
export const YAWELO_MEDIA_ORIGIN = 'https://media.shyden.co.uk';

const MEDIA =
  /^https:\/\/media\.shyden\.co\.uk\/(yawelo-idle-promo(?:-poster)?\.(mp4|webm|jpg))$/;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  jpg: 'image/jpeg',
};

/** A file the host does not publish is a 404, as the host itself answers. */
const answer = async (route: Route): Promise<void> => {
  const match = MEDIA.exec(route.request().url());
  if (!match) return route.fulfill({ status: 404 });
  const [, name, extension] = match;
  await route.fulfill({
    status: 200,
    contentType: CONTENT_TYPES[extension],
    body: readFileSync(`tests/e2e/stand-ins/${name}`),
  });
};

const HOST = /^https:\/\/media\.shyden\.co\.uk\//;

/** Answers the media host from the stand-ins for as long as `use` runs. */
export async function servingYaweloMedia(
  context: BrowserContext,
  use: () => Promise<void>,
): Promise<void> {
  await context.route(HOST, answer);
  try {
    await use();
  } finally {
    await context.unroute(HOST, answer);
  }
}

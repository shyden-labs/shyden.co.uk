import { readFileSync } from 'node:fs';
import type { BrowserContext, Route } from '@playwright/test';

/**
 * The homepage's Yawelo Idle video (#835) comes from Yawelo Idle's own media
 * host (#1193): media.yaweloidle.com in the production build, which this
 * suite measures. The files are Yawelo Idle's and change under the same
 * names (yawelo-idle#1015), so here every request for them is answered from
 * `tests/e2e/stand-ins/`: two-second synthetic clips with the real files'
 * codecs (H.264 High + AAC, VP9 + Opus), so each engine picks the file it
 * would pick in production, and a plain poster. The suite measures this
 * page, not that host, and never reaches the network for it. The page is
 * unchanged; only the answers are. The real dev host is played by the dev
 * sanity suite (`tests/dev/dev-sanity.spec.ts`).
 */
export const YAWELO_MEDIA_ORIGIN = 'https://media.yaweloidle.com';

const MEDIA =
  /^https:\/\/media\.yaweloidle\.com\/(yawelo-idle-promo(?:-poster)?\.(mp4|webm|jpg))$/;

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

const HOST = /^https:\/\/media\.yaweloidle\.com\//;

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

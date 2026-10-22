/**
 * The five engines every browser suite renders on: the e2e suite and, since
 * #350, the Functions suite. One list, so a sixth is added once.
 */
export const ENGINES = [
  { name: 'chromium', device: 'Desktop Chrome' },
  { name: 'firefox', device: 'Desktop Firefox' },
  { name: 'webkit', device: 'Desktop Safari' },
  { name: 'mobile-chrome', device: 'Pixel 5' },
  { name: 'mobile-safari', device: 'iPhone 13' },
] as const;

/**
 * Playwright's WebKit plays sound through the GStreamer it ships, which ranks
 * a real audio output first, and a CI container has none. On 1.64.1 the
 * board's deal starting its sound inside a click left WebKit drawing no frame
 * for about 3.1 s, 4 times in 231 runs; with GStreamer's silent
 * `fakeaudiosink` ranked first, 0 in 300, the sound still playing (#919).
 */
export const WEBKIT_AUDIO = { GST_PLUGIN_FEATURE_RANK: 'fakeaudiosink:MAX' };

/**
 * The `use` of an engine's project, from Playwright's descriptor of its
 * device: as described, with the silent sink added for WebKit. A launch's
 * `env` replaces the browser's environment rather than adding to it, so the
 * sink goes in beside everything the browser would otherwise inherit, less
 * any variable held unset, which a launch cannot pass.
 */
export function engineUse<D extends { defaultBrowserType: string }>(
  device: D,
  env: Record<string, string | undefined>,
): D & { launchOptions?: { env: Record<string, string> } } {
  if (device.defaultBrowserType !== 'webkit') return { ...device };
  const inherited = Object.entries(env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  );
  return {
    ...device,
    launchOptions: {
      env: { ...Object.fromEntries(inherited), ...WEBKIT_AUDIO },
    },
  };
}

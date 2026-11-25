/**
 * The one part of `playwright-core`'s exported `lib/coreBundle` the capture
 * reads (#1116): the comparator `toHaveScreenshot` judges with, so the capture
 * judges a rewrite exactly as the `visual` gate will. The package ships no
 * types for this entry point.
 */
declare module 'playwright-core/lib/coreBundle' {
  type Comparator = (
    actual: Buffer,
    expected: Buffer,
    options?: { threshold?: number; maxDiffPixelRatio?: number },
  ) => { errorMessage: string } | null;
  const coreBundle: {
    utils: { getComparator: (mimeType: string) => Comparator };
  };
  export default coreBundle;
}

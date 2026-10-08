/**
 * `npm run test:visual -- --grep "student added"` reached Playwright as
 * `--grep student` plus a file filter `added` (#202): the script joined the
 * forwarded arguments into the one string it handed to `sh -c`, and the
 * container's shell split them again. It failed loudly only because `added`
 * matched no spec file. A leftover word that DOES match one runs a different
 * set of tests, and under `--update` rewrites baselines nobody asked for.
 *
 * Nothing here starts Docker. Each test reads the argument vector the script
 * hands to `docker`, then runs its in-container step on this machine's `sh`
 * with `rm`, `npm` and `npx` replaced by shell functions, so `npx` reports the
 * exact vector Playwright would receive, one NUL after each argument (the one
 * byte no argument can hold). PATH points nowhere, so a command the step
 * grows later fails the run here instead of running on the host.
 */

export const IMAGE = 'visual-runner.test:image';

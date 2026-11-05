import { existsSync, readFileSync } from 'node:fs';

/**
 * A stand-in for `gh`, for a test that runs a script as CI runs it. The real
 * one needs a token and the network; this one records its arguments, one per
 * line, in `$GH_ARGS`, prints `$GH_OUT` and `$GH_ERR`, and exits
 * `$GH_STATUS`. Written to a `bin/gh` put first on the script's PATH.
 */
export const GH_STAND_IN = `#!/bin/sh
for a in "$@"; do printf '%s\\n' "$a"; done > "$GH_ARGS"
printf '%s' "$GH_OUT"
printf '%s' "$GH_ERR" >&2
exit "\${GH_STATUS:-0}"
`;

/** The arguments the stand-in was called with, or null if it never was. */
export const ghCalledWith = (argsFile: string): string[] | null =>
  existsSync(argsFile)
    ? readFileSync(argsFile, 'utf8').split('\n').slice(0, -1)
    : null;

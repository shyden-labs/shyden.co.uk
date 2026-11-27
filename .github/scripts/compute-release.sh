#!/usr/bin/env bash
# Compute the next semver + release notes from conventional commits since the
# last v* tag, for the auto-release on merge to main (release-tag.yml).
#
#   - No prior tag                              -> first release, v0.1.0
#   - any `<type>!:` / BREAKING CHANGE in body  -> major bump
#   - any `feat:` / `feat(x):`                  -> minor bump
#   - otherwise                                 -> patch bump
#
# Writes grouped release notes to $1 (default RELEASE_NOTES.md) and appends
# version/tag/should_release to $GITHUB_OUTPUT when set.
set -euo pipefail

notes_file="${1:-RELEASE_NOTES.md}"
last_tag="$(git tag --list 'v*' --sort=-v:refname | head -n1 || true)"

# git-log revision selector as an array: whole history for the first release,
# `<last_tag>..HEAD` afterwards. Array (not a bare string) so the empty case is
# a real "all history", not an empty-string arg, and it stays shellcheck-clean.
if [[ -z "$last_tag" ]]; then
  version="0.1.0"
  range=(HEAD)
else
  IFS='.' read -r major minor patch <<<"${last_tag#v}"
  range=("${last_tag}..HEAD")
  if [[ -z "$(git rev-list "${range[@]}" 2>/dev/null)" ]]; then
    echo "No commits since ${last_tag} — skipping release."
    if [[ -n "${GITHUB_OUTPUT:-}" ]]; then echo "should_release=false" >>"$GITHUB_OUTPUT"; fi
    exit 0
  fi
  subjects="$(git log --no-merges --format='%s' "${range[@]}" || true)"
  bodies="$(git log --no-merges --format='%b' "${range[@]}" || true)"
  if grep -qE '^[a-z]+(\(.+\))?!:' <<<"$subjects" || grep -q 'BREAKING CHANGE' <<<"$bodies"; then
    major=$((major + 1)); minor=0; patch=0
  elif grep -qE '^feat(\(.+\))?:' <<<"$subjects"; then
    minor=$((minor + 1)); patch=0
  else
    patch=$((patch + 1))
  fi
  version="${major}.${minor}.${patch}"
fi

log_group() { # $1 = ERE to keep, $2 = heading
  local body
  body="$(git log --no-merges --format='- %s (%h)' "${range[@]}" 2>/dev/null | grep -E "$1" || true)"
  # `if`, not `&&`: a bare `[ … ] && …` returns 1 when empty, which trips the
  # caller's `set -e` and kills the script (release notes have empty sections).
  if [[ -n "$body" ]]; then printf '### %s\n%s\n\n' "$2" "$body"; fi
}
{
  printf '## v%s\n\n' "$version"
  log_group '^- feat' 'Features'
  log_group '^- fix' 'Fixes'
  log_group '^- perf' 'Performance'
  other="$(git log --no-merges --format='- %s (%h)' "${range[@]}" 2>/dev/null | grep -Ev '^- (feat|fix|perf)' || true)"
  if [[ -n "$other" ]]; then printf '### Other\n%s\n\n' "$other"; fi
} >"$notes_file"

echo "Computed version v${version} (last tag: ${last_tag:-none})"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  { echo "version=${version}"; echo "tag=v${version}"; echo "should_release=true"; } >>"$GITHUB_OUTPUT"
fi

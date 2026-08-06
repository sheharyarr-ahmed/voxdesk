#!/usr/bin/env bash
#
# SPEC.md section 11.1. Fails on any em-dash, or any of the four attribution strings,
# across README.md, docs/, src/ and agent/. Runs inside `pnpm verify:all`.
#
# The .githooks/commit-msg hook guards commit messages. This guards what ships.
set -euo pipefail

cd "$(dirname "$0")/.."

SCOPES=(README.md docs src agent)

# docs/BLUEPRINT.md is excluded as a file, not as a set of strings.
#
# It has carried 11 legitimate matches since the bootstrap commit: nine are the real
# repository path .claude/decisions and .claude/verify.sh, two name the tool the blueprint
# was written to be fed to, and one is the git discipline rule quoting its own banned list.
# Excluding the strings instead would blind this check everywhere else in the tree, which
# is the opposite of what it is for. The blueprint is a pre build historical document and
# is never edited again.
EXCLUDED_PATH='docs/BLUEPRINT.md'

# Built from bytes rather than written literally, so this file does not itself contain the
# character it exists to reject. macOS ships bash 3.2, which has no $'—'.
EMDASH=$(printf '\xe2\x80\x94')

ATTRIBUTION='co-authored-by|generated with|claude|anthropic'

fail=0

report() {
  local label="$1" hits="$2"
  if [ -n "$hits" ]; then
    echo "check-copy: rejected. $label" >&2
    echo "$hits" >&2
    echo "" >&2
    fail=1
  fi
}

# -i matters: the four strings SPEC.md names are capitalised, and the pattern is not.
# Without it this check silently passed a file containing "Generated with".
# -I skips binary files. || true keeps `set -e` from treating "no matches" as an error.
attribution_hits=$(
  grep -rIniE -- "$ATTRIBUTION" "${SCOPES[@]}" 2>/dev/null | grep -v "^${EXCLUDED_PATH}:" || true
)
report "Attribution strings are not permitted in shipped copy." "$attribution_hits"

emdash_hits=$(
  grep -rInF -- "$EMDASH" "${SCOPES[@]}" 2>/dev/null | grep -v "^${EXCLUDED_PATH}:" || true
)
report "Em-dashes are not permitted in any copy, docs or UI text." "$emdash_hits"

if [ "$fail" -ne 0 ]; then
  exit 1
fi

echo "check-copy: ok"

#!/usr/bin/env bash
# Stop hook gate. SPEC.md section 11.1 scopes this to typecheck and unit tests
# only, so it stays fast enough to run on every stop. The copy check and
# Playwright join at the phase 4 gate through pnpm verify:all.
set -euo pipefail

cd "$(dirname "$0")/.."

pnpm run typecheck
pnpm exec vitest run

echo "verify: ok"

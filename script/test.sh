#!/usr/bin/env bash
# Unified test runner for antigravity-provider-for-opencode.
# Runs typecheck + lint + unit tests in order. Exits non-zero on any failure.
#
# Usage:
#   ./script/test.sh           # full run (typecheck + lint + test)
#   ./script/test.sh quick     # skip typecheck, just lint + test

set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
PLUGIN_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
cd "$PLUGIN_DIR"

MODE="${1:-full}"

run_typecheck() {
  echo "==> typecheck (bash script/typecheck.sh)"
  bash script/typecheck.sh
}

run_lint() {
  echo "==> lint (oxlint)"
  bun run lint
}

run_test() {
  echo "==> unit tests (bun test)"
  bun test
}

case "$MODE" in
  full)
    run_typecheck
    run_lint
    run_test
    ;;
  quick)
    run_lint
    run_test
    ;;
  typecheck)
    run_typecheck
    ;;
  lint)
    run_lint
    ;;
  test)
    run_test
    ;;
  *)
    echo "Usage: $0 [full|quick|typecheck|lint|test]" >&2
    exit 64
    ;;
esac

echo "==> all checks passed"
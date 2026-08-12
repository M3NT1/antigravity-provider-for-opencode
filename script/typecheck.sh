#!/usr/bin/env bash
# typecheck wrapper: runs tsc --noEmit and filters out errors from
# upstream workspace dependencies (../opencode_m3nt1). Only errors
# in our own src/ and test/ files cause a non-zero exit.

set -o pipefail

# Locate tsc — bun install hoists workspace devDeps into the
# opencode_m3nt1 monorepo's node_modules/.bin, so we look there.
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
PLUGIN_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
TSC="$PLUGIN_DIR/../opencode_m3nt1/node_modules/.bin/tsc"
if [ ! -x "$TSC" ]; then
  TSC="$PLUGIN_DIR/node_modules/.bin/tsc"
fi
if [ ! -x "$TSC" ]; then
  TSC=$(command -v tsc)
fi
if [ -z "$TSC" ]; then
  echo "tsc not found in workspace or PATH" >&2
  exit 1
fi

# Filter: drop every line whose first non-blank content references a
# file under ../opencode_m3nt1 (i.e. an upstream workspace dep). The
# continuation lines of multi-line errors (e.g. "Overload 1 of 3...")
# inherit the same `^` exclusion: we only emit lines that begin with
# a path-or-blank (the format tsc uses for error headers).
output=$("$TSC" --noEmit -p "$PLUGIN_DIR/tsconfig.json" 2>&1 | awk '
  /^[^[:space:]]/ && /opencode_m3nt1/ { drop=1; next }
  /^[[:space:]]*$/ { if (drop) { drop=0; next } }
  drop { next }
  { print }
' || true)

if [ -n "$output" ]; then
  echo "$output" >&2
  exit 1
fi


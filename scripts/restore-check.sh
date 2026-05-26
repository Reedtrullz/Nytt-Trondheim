#!/usr/bin/env bash
set -euo pipefail

CHECK_DIR="$(mktemp -d)"
trap 'rm -rf "$CHECK_DIR"' EXIT
restic check
restic restore latest --tag nytt-trondheim --target "$CHECK_DIR" --include "*/nytt.dump"
test -s "$(find "$CHECK_DIR" -name nytt.dump -print -quit)"
echo "Encrypted backup restore check passed."

#!/bin/zsh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

node scripts/test-workflow.mjs --domain workspace --layer backend

pnpm exec electron-vite build
sleep 2

typeset -a e2e_test_files
e2e_test_files=("${(@f)$(rg --files tests/workspace/e2e -g '*.test.ts' | sort)}")

if (( ${#e2e_test_files[@]} == 0 )); then
  echo "[test-workspace] no e2e tests found"
  exit 0
fi

pnpm exec vitest --config vitest.e2e.config.mts run "${e2e_test_files[@]}"

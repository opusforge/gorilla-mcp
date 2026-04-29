#!/usr/bin/env bash
# Build a Smithery-compatible MCPB bundle.
#
# We pack with `zip` (not `mcpb pack`) because Smithery requires
# `inputSchema` in the manifest's tools array, which the @anthropic-ai/mcpb
# validator rejects. Until upstream reconciles, we bypass the validator
# and produce the zip directly.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Installing production dependencies"
rm -rf node_modules
npm install --omit=dev --no-audit --no-fund

echo "==> Building TypeScript"
npm run build

echo "==> Packing bundle"
rm -f gorilla-mcp.mcpb
zip -r gorilla-mcp.mcpb \
  manifest.json \
  dist/ \
  node_modules/ \
  package.json \
  LICENSE \
  README.md \
  -x "*.DS_Store"

echo "==> Done: gorilla-mcp.mcpb"
ls -lh gorilla-mcp.mcpb

# Changelog

All notable changes to the Gorilla MCP server are documented here.

## [3.0.1] - 2026-06-02

### Fixed
- Widened `engines.node` from `22.x` to `>=20` so Node 20 LTS (and 24/25) installs don't emit an EBADENGINE warning. No code change.

## [3.0.0] - 2026-06-02

### Breaking
- Rebuilt against the V4 serverless backend. The tool surface is now **`search`**, **`get_search`**, and **`billing_status`**. The legacy `leads.find` / `leads.search` / `idea.refine` / `idea.expand` / `runs.get` / `runs.list` / `outreach.draft` / `outreach.plan` tools are removed — they targeted pre-V4 endpoints that no longer exist. `search` runs the full multi-source pipeline and polls `v2-search-stream`; `get_search` re-reads a search by id; `account.billing` is renamed `billing_status`. Idea refinement and outreach drafting are now done by the model directly (the bundled skills guide it), not by server tools.

### Fixed
- Removed the runtime `mcp-config.json` fetch — it returned the marketing site's SPA HTML and threw on every tool call. The package now talks directly to `https://platform.usegorilla.app/v1` with your `x-api-key` header; the gateway injects the rest. Override with `GORILLA_API_BASE` for self-hosted deployments.
- `billing_status` reads the current `{ plan, balance }` shape (it was reading dropped `runs_this_week` / `weekly_limit` fields and printing NaN).

### Changed
- Pricing copy: 100 free credits once, then $14.99/mo for 2,000 (one credit per qualified lead; low-relevance results free). LinkedIn is a paid-plan source. Five sources: Reddit, X, YouTube, LinkedIn, Bluesky.
- Dropped the `GORILLA_DEFAULT_LANGUAGE` and `GORILLA_CONFIG_URL` env vars.

## [2.0.1] - 2026-05-10

### Changed
- Default `CONFIG_URL` now points at `https://platform.usegorilla.app/mcp-config.json`. The legacy `gorilla.opusforge.com.br` host still serves the same payload, so no action is required for existing installs — the next `npm i -g @usegorilla/mcp` upgrade will pick up the new default. Docs and the missing-key error message updated to match.

## [2.0.0] - 2026-04-29

### Breaking
- All 9 tools renamed to dot-notation for navigable hierarchy: `find_leads` → `leads.find`, `refine_idea` → `idea.refine`, `expand_themes` → `idea.expand`, `search_source` → `leads.search`, `get_run` → `runs.get`, `list_runs` → `runs.list`, `billing_status` → `account.billing`, `draft_outreach` → `outreach.draft`, `plan_acquisition_funnel` → `outreach.plan`. Update any prompts, skills, or scripts that reference the old names.

### Added
- MCP tool annotations (`title`, `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) on every tool so MCP clients render correct UI hints.
- `GORILLA_DEFAULT_LANGUAGE` optional env (`en`, `pt`, `all`) — fallback for `idea.refine` and `outreach.draft`.
- `GORILLA_CONFIG_URL` optional env — override the runtime config endpoint for staging or self-hosted Supabase.
- `manifest.json`, `.mcpbignore`, and `scripts/build-mcpb.sh` for reproducible Smithery MCPB bundle builds.
- Smithery badge in README. Server published at [smithery.ai/server/opusforge/gorilla-mcp](https://smithery.ai/server/opusforge/gorilla-mcp).

### Changed
- Smithery `user_config.api_key` is now `required: false` so clients can install the server and browse tools without entering a key. Tool calls still require it (the server returns a clear error if missing).
- Dockerfile pinned to `node:22-alpine` (was `node:25-alpine`) so the Glama / container build matches `engines.node`.

## [1.0.5] - 2026-04-29

### Added
- `engines.node: ">=22"` in `package.json` so registries (Glama, Smithery, npm) read the canonical Node-version requirement instead of guessing.
- README badges (CI status, latest release, license). Closes #13.
- `CONTRIBUTING.md` with the issue-first workflow and a copy-paste stdio smoke-test snippet. Closes #14.

### Changed
- Tool descriptions tightened. `find_leads` now says "Usually under 2 minutes" instead of "30-90 seconds" (real runs vary). `search_source` is X-first in prose with `twitter` kept as an enum alias. Closes #9, #15.
- `getConfig` caches `mcp-config.json` for 15 minutes (was process-lifetime). If the discovery endpoint is briefly down, falls back to the stale cache rather than failing the call. Closes #11.

## [1.0.2] - 2026-04-29

### Added
- `--version` / `-v` flag prints the package version and exits before constructing the MCP server. Closes #8.

## [1.0.1] - 2026-04-29

### Added
- `x` as the canonical value in the `search_source` enum (alongside `twitter` for backward compat). Routes to the same backend. Lets registries like Glama recognise X as an integration.
- `glama.json` for Glama maintainer claim.
- Issue templates (bug, feature, security routing) under `.github/ISSUE_TEMPLATE/`.
- `Dockerfile` for container-based MCP runners (Glama, Smithery).
- CI workflow on Node 20 + 22 verifying MCP introspection on every push.
- Dependabot weekly updates for npm, GitHub Actions, and Docker.
- `SECURITY.md` with disclosure policy.

### Changed
- Bumped TypeScript to 6.x and `@types/node` to 25.x. Build still passes; no source changes required.
- Bumped `zod` to 4.x.
- README install instructions switched from `npm install -g @gorilla/mcp` (not published) to `npx -y github:opusforge/gorilla-mcp` so the install path actually works today.
- Pricing copy in README refreshed to the then-current model.
- `tsconfig.json` declares node types explicitly to survive container envs that confuse implicit type resolution.

### Fixed
- Build failed under Glama's `debian:trixie-slim` container (`Cannot find name 'process'`). Hardened tsconfig + added a triple-slash reference at the top of `src/index.ts`.

## [1.0.0] - 2026-04-29

Initial public release with 9 tools: `find_leads`, `refine_idea`, `expand_themes`, `search_source`, `get_run`, `list_runs`, `billing_status`, `draft_outreach`, `plan_acquisition_funnel`.

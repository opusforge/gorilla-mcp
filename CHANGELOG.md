# Changelog

All notable changes to the Gorilla MCP server are documented here.

## [3.0.0] - 2026-05-25

### Breaking
- The Gorilla product surface collapsed from 9 tools to 3. Every tool tied
  to the legacy run-pipeline backend was removed:
    - `idea.refine`, `idea.expand`        → backend `refine` / `theme-expansion` functions removed.
    - `outreach.draft`, `outreach.plan`   → backend `draft-outreach` function removed.
    - `runs.get`, `runs.list`             → the `runs` table itself was dropped.
    - `leads.search` (per-platform fan-out variant)  → folded into `leads.find`.
  Agents and skills that called any of the above will get an "unknown tool"
  error from this MCP. Update your callers to use the surviving tools below.

### Tools (v3)
- `leads.find`     — multi-source search via the new `/v2-search-stream`
                     endpoint. POST kicks off, GET polls until per-source
                     orchestration completes. Returns formatted Hot / Warm /
                     Cold ranked posts. Six sources: reddit, twitter,
                     threads, linkedin, youtube, web.
- `leads.get`      — fetch the current state + results for any search by
                     its `search_id`. Use to recover a timed-out call.
- `account.billing` — plan + credit balance + pricing tier reference.

### Changed
- TikTok dropped from the source list (the v2 TikTok client never made it
  out of probing — the Apify actor's available data was too thin to score).
- `web` added as the sixth source. Powered by SerpAPI Google with per-URL
  enrichment (extracts page body inline so the LLM ranker has real content
  to score, not just title + meta description).
- Pricing surface in `account.billing` now reflects the V4 SKUs:
    - Free: 1,000 credits / week
    - Monthly: $14.99 → 20,000 credits / month (resets on renewal)
    - One-time pack: $5 → 5,000 credits (credits never expire)
  Pay-as-you-go overage removed — top up with one-time packs instead.
- `account.billing` "Get a key" instruction now points at
  `platform.usegorilla.app/api-keys/` (was "Menu → API Keys").

### Migration
- `npm i -g @gorilla/mcp@3.0.0` (or `@latest`).
- Replace any prior tool calls:
    - `leads.search({source:"reddit"})` → `leads.find({source:"reddit"})`
    - `idea.refine` / `idea.expand`     → drop, the new search handles
                                          theme expansion internally
    - `outreach.draft` / `outreach.plan` → drop, no replacement
    - `runs.get` / `runs.list`          → drop, no equivalent (use
                                          `leads.get(search_id)` instead)

## [2.0.1] - 2026-05-10

### Changed
- Default `CONFIG_URL` now points at `https://platform.usegorilla.app/mcp-config.json`. The legacy `gorilla.opusforge.com.br` host still serves the same payload, so no action is required for existing installs — the next `npm i -g @gorilla/mcp` upgrade will pick up the new default. Docs and the missing-key error message updated to match.

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
- Pricing in README refreshed to current ($0.99 / $3.99 weekly / $149.99 lifetime).
- `tsconfig.json` declares node types explicitly to survive container envs that confuse implicit type resolution.

### Fixed
- Build failed under Glama's `debian:trixie-slim` container (`Cannot find name 'process'`). Hardened tsconfig + added a triple-slash reference at the top of `src/index.ts`.

## [1.0.0] - 2026-04-29

Initial public release with 9 tools: `find_leads`, `refine_idea`, `expand_themes`, `search_source`, `get_run`, `list_runs`, `billing_status`, `draft_outreach`, `plan_acquisition_funnel`.

# Changelog

All notable changes to the Gorilla MCP server are documented here.

## [1.0.1] - 2026-04-29

### Added
- `x` as the canonical value in `search_source` enum (alongside `twitter` for backward compat). Routes to the same backend, but lets registries like Glama recognise X as an integration.
- `glama.json` so the server can be claimed on the Glama MCP registry.
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

Initial public release with 9 tools: `find_leads`, `refine_idea`, `enhance_idea`, `expand_themes`, `search_source`, `get_run`, `list_runs`, `billing_status`, `draft_outreach`, `plan_acquisition_funnel`.

# Changelog

All notable changes to the Gorilla MCP server are documented here.

## [1.0.0] - 2026-04-29

Initial public release.

### Tools
- `find_leads(idea)` — full pipeline. Searches Reddit, X, YouTube, and TikTok and returns scored leads.
- `refine_idea(idea)` — five clarifying questions to sharpen the idea before searching.
- `enhance_idea(idea, answers)` — synthesise answers into a polished product description.
- `expand_themes(idea)` — generate keywords, pain points, competitor names, exclusion terms.
- `search_source(source, queries)` — single-platform search with custom queries.
- `get_run(run_id)` — fetch results for a completed run.
- `list_runs()` — list previous runs.
- `billing_status()` — current plan, runs left, referral credits.
- `draft_outreach(idea, source, action, post)` — platform-tuned outreach drafts via the server-side drafter.
- `plan_acquisition_funnel(run_id)` — Week-1 outreach cadence per channel + action register per category.

### Infrastructure
- Multi-stage Dockerfile for container-based MCP runners (Glama, Smithery, etc.).
- `glama.json` for Glama maintainer claim.
- CI builds + verifies MCP introspection on Node 20 and 22.
- Dependabot weekly updates for npm, GitHub Actions, and Docker.

# Gorilla MCP Server

[![CI](https://github.com/opusforge/gorilla-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/opusforge/gorilla-mcp/actions/workflows/ci.yml)
[![Version](https://img.shields.io/github/v/release/opusforge/gorilla-mcp)](https://github.com/opusforge/gorilla-mcp/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![smithery badge](https://smithery.ai/badge/opusforge/gorilla-mcp)](https://smithery.ai/servers/opusforge/gorilla-mcp)
[![gorilla-mcp MCP server](https://glama.ai/mcp/servers/opusforge/gorilla-mcp/badges/score.svg)](https://glama.ai/mcp/servers/opusforge/gorilla-mcp)

[![Stars](https://img.shields.io/github/stars/opusforge/gorilla-mcp?style=flat&logo=github)](https://github.com/opusforge/gorilla-mcp/stargazers)
[![Last commit](https://img.shields.io/github/last-commit/opusforge/gorilla-mcp?logo=github)](https://github.com/opusforge/gorilla-mcp/commits/main)

**The one-stop social media search engine for your agent.**

One MCP, one tool call, six platforms — Reddit, X, Threads, LinkedIn, YouTube, and the open web. Results are ranked Hot / Warm / Cold by topic relevance + recency + engagement, and billed per result.

```
search({ query: "people complaining about meal planning", since: "7d" })
→ 47 ranked posts: 12 Hot, 18 Warm, 17 Cold
→ $1.42 charged, 18,582 credits left
```

---

## Install

```bash
npm install -g @gorilla/mcp
```

Or run directly via npx (no install):

```bash
GORILLA_API_KEY=grla_... npx @gorilla/mcp
```

## Get your API key

1. Sign in at [platform.usegorilla.app](https://platform.usegorilla.app/login/).
2. Open **API keys** → **Create**.
3. Copy the key (shown once, prefixed `grla_`).

New accounts get **1,000 credits / week** on the free tier. No card required.

## Configure

### Claude Desktop / Claude Code

`~/.claude.json`:

```json
{
  "mcpServers": {
    "gorilla-mcp": {
      "command": "npx",
      "args": ["@gorilla/mcp"],
      "env": { "GORILLA_API_KEY": "grla_your_key_here" }
    }
  }
}
```

### Cursor

`.cursor/mcp.json` (same shape):

```json
{
  "mcpServers": {
    "gorilla-mcp": {
      "command": "npx",
      "args": ["@gorilla/mcp"],
      "env": { "GORILLA_API_KEY": "grla_your_key_here" }
    }
  }
}
```

### Codex / OpenAI agents

`~/.codex/config.toml`:

```toml
[mcp_servers.gorilla]
command = "npx"
args = ["@gorilla/mcp"]
env = { GORILLA_API_KEY = "grla_..." }
```

---

## Tools

Three tools, mirroring the REST API at `/v2-search-stream`. Full request / response shape lives in the [API docs](https://usegorilla.app/docs/).

### `search`

The main tool. Searches across every supported platform for posts related to your query and returns scored, ranked results.

| Param | Type | Notes |
|---|---|---|
| `query` | string (required) | What to search for, in your own words. Sent verbatim to each source. |
| `source` | enum | One of `reddit`, `twitter`, `threads`, `linkedin`, `youtube`, `web`, or `all`. Default `all`. |
| `since` | string | `24h` / `7d` / `30d` / `180d` / `6mo` / `all`, or an ISO date. Default backend-side. |
| `limit` | int | Max results returned. 1–200. Default 50. |

**Pricing:** Hot $0.10 / Warm $0.03 / Cold $0.003 per result. **No caps.** Failed searches are fully refunded.

**Returns:** Up to 50 ranked posts with `search_id`, per-source counts, bucket totals, credits charged + remaining. Title, score, channel, snippet, and URL on each post.

```
search({
  query: "anyone looking for an AI meal planner",
  source: "all",
  since: "7d"
})
```

Internally: POSTs to `/v2-search-stream`, then polls until `status !== "running"`. If the search exceeds 5 minutes client-side, returns the `search_id` so you can recover later with `get_search`.

### `get_search`

Fetch the current state and results for any search by ID. Use to recover a search that timed out client-side, or to re-read a recent one.

| Param | Type | Notes |
|---|---|---|
| `search_id` | string (required) | The `search_id` returned by a prior `search` call. |

**Pricing:** free.

### `billing_status`

Check your plan + credit balance.

**Pricing:** free.

---

## Pricing

Per result, by quality. **No caps.** Failed searches are fully refunded.

| Bucket | Score | Credits | USD |
|---|---|---|---|
| 🔥 Hot | ≥ 0.7 | 100 | $0.10 |
| 🟡 Warm | 0.4 – 0.7 | 30 | $0.03 |
| ❄️ Cold | < 0.4 | 3 | $0.003 |

A typical multi-platform query returns ~50 results across mixed buckets — usually **$1–2**.

### Tiers

- **Free** — 1,000 credits / week. Refills weekly. No card.
- **Monthly** — $14.99/month → 20,000 credits / month. Resets on renewal.
- **One-time pack** — $5 → 5,000 credits. Stacks on top of the monthly bundle, credits never expire.

Subscribe or top up at [platform.usegorilla.app/billing](https://platform.usegorilla.app/billing/).

---

## Environment variables

| Var | Required | Notes |
|---|---|---|
| `GORILLA_API_KEY` | yes | Your `grla_…` key. Create at [platform.usegorilla.app/api-keys/](https://platform.usegorilla.app/api-keys/). |
| `GORILLA_CONFIG_URL` | no | Override the runtime config endpoint (advanced — for self-hosted or staging Supabase). Default: `https://platform.usegorilla.app/mcp-config.json`. |

---

## What's new in v3

v3 (2026-05-25) collapses the older tool surface (`leads.find`, `idea.refine`, `runs.list`, `outreach.draft`, etc.) down to just `search` + `get_search` + `billing_status`. The pipeline tools were tied to a legacy run-pipeline backend that's been retired — everything now goes through one streaming search endpoint that returns ranked posts directly.

See [CHANGELOG.md](CHANGELOG.md) for the full migration notes.

---

## Support

- API key issues → [platform.usegorilla.app/api-keys/](https://platform.usegorilla.app/api-keys/)
- Billing → [platform.usegorilla.app/billing/](https://platform.usegorilla.app/billing/)
- Bugs → quote the `search_id` when reporting → [open an issue](https://github.com/opusforge/gorilla-mcp/issues)

Built by [OpusForge](https://opusforge.com.br) · MIT licensed.

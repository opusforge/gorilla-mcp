# Gorilla MCP Server

[![CI](https://github.com/opusforge/gorilla-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/opusforge/gorilla-mcp/actions/workflows/ci.yml)
[![Version](https://img.shields.io/github/v/release/opusforge/gorilla-mcp)](https://github.com/opusforge/gorilla-mcp/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![smithery badge](https://smithery.ai/badge/opusforge/gorilla-mcp)](https://smithery.ai/servers/opusforge/gorilla-mcp)
[![gorilla-mcp MCP server](https://glama.ai/mcp/servers/opusforge/gorilla-mcp/badges/score.svg)](https://glama.ai/mcp/servers/opusforge/gorilla-mcp)

[![Stars](https://img.shields.io/github/stars/opusforge/gorilla-mcp?style=flat&logo=github)](https://github.com/opusforge/gorilla-mcp/stargazers)
[![Last commit](https://img.shields.io/github/last-commit/opusforge/gorilla-mcp?logo=github)](https://github.com/opusforge/gorilla-mcp/commits/main)
[![Open issues](https://img.shields.io/github/issues/opusforge/gorilla-mcp?logo=github)](https://github.com/opusforge/gorilla-mcp/issues)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-22.x-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP SDK](https://img.shields.io/badge/MCP_SDK-1.x-7C3AED?logo=anthropic&logoColor=white)](https://modelcontextprotocol.io)
[![Built for Claude](https://img.shields.io/badge/Built_for-Claude-D97757?logo=anthropic&logoColor=white)](https://claude.ai)

Model Context Protocol server for [Gorilla](https://usegorilla.app). Find your first 100 SaaS users by searching Reddit, YouTube, X, and TikTok for real demand signals.

Learn more: [usegorilla.app](https://usegorilla.app) · [Real run examples](https://usegorilla.app/find-users/) · [How Gorilla compares](https://usegorilla.app/alternatives/) · [Blog](https://usegorilla.app/blog/)

<a href="https://glama.ai/mcp/servers/opusforge/gorilla-mcp">
  <img width="380" src="https://glama.ai/mcp/servers/opusforge/gorilla-mcp/badges/card.svg" alt="gorilla-mcp MCP server">
</a>

## Setup

Run directly from GitHub with `npx`:

```bash
GORILLA_API_KEY=grla_... npx -y github:opusforge/gorilla-mcp
```

Or clone and run locally:

```bash
git clone https://github.com/opusforge/gorilla-mcp
cd gorilla-mcp
npm install && npm run build
GORILLA_API_KEY=grla_... node dist/index.js
```

### Get your API key

1. Sign up at [usegorilla.app](https://usegorilla.app) and pick a plan ($0.99 single run, $3.99/wk Pro, or $149.99 lifetime).
2. Sign in at [gorilla.opusforge.com.br](https://gorilla.opusforge.com.br).
3. Menu, API Keys, Create.
4. Copy the key (shown once).

### Configure in Claude Code

Add to your Claude Code settings:

```json
{
  "mcpServers": {
    "gorilla": {
      "command": "npx",
      "args": ["-y", "github:opusforge/gorilla-mcp"],
      "env": {
        "GORILLA_API_KEY": "grla_your_key_here"
      }
    }
  }
}
```

### Configure in Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "gorilla": {
      "command": "npx",
      "args": ["-y", "github:opusforge/gorilla-mcp"],
      "env": {
        "GORILLA_API_KEY": "grla_your_key_here"
      }
    }
  }
}
```

## Tools

Tools are namespaced by domain (`leads.*`, `idea.*`, `runs.*`, `outreach.*`, `account.*`).

### `leads.find`

Run the full pipeline. Searches Reddit, X, YouTube, and TikTok and returns scored leads. Takes 60-120 seconds. Costs 1 run credit.

**Parameters:** `idea` (required) — product description

**Returns:** Scored leads with source, channel, title, URL, lead_score (0-1), and outreach hints.

---

### `idea.refine`

Conversational refinement. Returns one clarifying question at a time to sharpen the idea before searching. Free.

**Parameters:** `idea` (required), plus `current_refined_idea`, `history`, `language`, `turn`, `max_turns` (all optional)

**Returns:** Status, refined_idea, readiness_score, and the next question (or null when ready).

---

### `idea.expand`

Generate keyword scaffolding (core keywords, adjacent niches, pain points, competitor names, exclusion terms) without running searches. Costs 1 run credit.

**Parameters:** `idea` (required)

**Returns:** Structured themes for targeted searches.

---

### `leads.search`

Search a single platform with custom queries. Bypasses theme expansion and AI scoring. Costs 1 run credit.

**Parameters:**
- `source` (required): `reddit`, `x`, `youtube`, or `tiktok`
- `queries` (required): Array of search queries
- `run_id` (optional): Attach results to an existing run

**Returns:** Raw leads from the specified platform.

---

### `runs.get`

Fetch results for a previously-started run. Free.

**Parameters:** `run_id` (required)

---

### `runs.list`

List your last 50 runs, newest first. Free.

---

### `account.billing`

Check your plan, remaining weekly runs, and referral credits. Free.

**Returns:** Plan name, weekly usage, referral credits, total available runs.

---

### `outreach.draft`

Generate a platform-tuned outreach message for a specific lead. Costs 1 run credit per draft.

**Parameters:** `idea`, `source`, `outreach_action`, `post_title`, `post_body` (required), plus optional `post_handle`, `language`, `reply_to_author`, `reply_to_text`.

**Returns:** A ready-to-paste draft.

---

### `outreach.plan`

Build a Week-1 outreach plan from a completed run's HIGH-intent leads, with per-channel send cadence. Free.

**Parameters:** `run_id` (required)

## Example workflow

```
1. idea.refine("a language learning app for travelers")
   → "Who's the target user? Daily commuters or tourists?"

2. leads.find(refined_idea)
   → 47 leads across Reddit, YouTube, X, and TikTok
   → 12 high-intent (people actively searching for this)

3. outreach.plan(run_id)
   → Week-1 plan: 3/day on Reddit, 4/day on X, 2/day on YT/TT

4. outreach.draft(...)  → ready-to-send reply for each high-intent lead
```

### Install via Smithery

Available at [smithery.ai/server/opusforge/gorilla-mcp](https://smithery.ai/server/opusforge/gorilla-mcp). Smithery distributes a pre-built MCPB bundle that any MCPB-compatible client can install in one click.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GORILLA_API_KEY` | Yes | Your API key (starts with `grla_`) |
| `GORILLA_DEFAULT_LANGUAGE` | No | Fallback language for `idea.refine` and `outreach.draft` (`en`, `pt`, `all`). Default: `en`. |
| `GORILLA_CONFIG_URL` | No | Override the runtime config endpoint. Useful for staging or self-hosted deployments. |

Backend URL and gateway key are fetched automatically from `https://gorilla.opusforge.com.br/mcp-config.json` on startup. No other configuration required.

## Pricing

- **Single run:** $0.99. Pay per use, no subscription.
- **Weekly Pro:** $3.99/week, 5 runs.
- **Lifetime:** $149.99 once, unlimited runs.

`leads.find`, `leads.search`, `idea.expand`, and `outreach.draft` each cost 1 run credit. `idea.refine`, `runs.get`, `runs.list`, `account.billing`, and `outreach.plan` are free.

See [usegorilla.app](https://usegorilla.app) for current plans and the full product.

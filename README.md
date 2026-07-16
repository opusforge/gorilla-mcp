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

Model Context Protocol server for [Gorilla](https://usegorilla.app). Find your first 100 SaaS users by searching Reddit, X, YouTube, LinkedIn, and Bluesky for real demand signals. Start free with 100 credits. You spend one credit per qualified lead (hot or warm); low-relevance results are free.

Learn more: [usegorilla.app](https://usegorilla.app) · [Real run examples](https://usegorilla.app/find-users/) · [How Gorilla compares](https://usegorilla.app/alternatives/) · [Blog](https://usegorilla.app/blog/)

<a href="https://glama.ai/mcp/servers/opusforge/gorilla-mcp">
  <img width="380" src="https://glama.ai/mcp/servers/opusforge/gorilla-mcp/badges/card.svg" alt="gorilla-mcp MCP server">
</a>

## Setup

Run directly from GitHub with `npx`:

```bash
GORILLA_API_KEY=grla_... npx -y @usegorilla/mcp
```

Or clone and run locally:

```bash
git clone https://github.com/opusforge/gorilla-mcp
cd gorilla-mcp
npm install && npm run build
GORILLA_API_KEY=grla_... node dist/index.js
```

### Get your API key

1. Sign up at [usegorilla.app](https://usegorilla.app). Free tier: 100 credits, no card.
2. Sign in at [platform.usegorilla.app](https://platform.usegorilla.app).
3. Menu, API Keys, Create.
4. Copy the key (shown once).

### Configure in Claude Code

Add to your Claude Code settings:

```json
{
  "mcpServers": {
    "gorilla": {
      "command": "npx",
      "args": ["-y", "@usegorilla/mcp"],
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
      "args": ["-y", "@usegorilla/mcp"],
      "env": {
        "GORILLA_API_KEY": "grla_your_key_here"
      }
    }
  }
}
```

## Tools

### `search`

Search Reddit, X, YouTube, LinkedIn, and Bluesky in parallel for posts where people express demand for what you describe. Returns results ranked Hot / Warm / Cold by buying intent. Takes 30-90 seconds. One credit per qualified lead (Hot or Warm); Cold results are free, and a failed search is refunded. LinkedIn is a paid-plan source; the free tier covers Reddit, X, YouTube, and Bluesky.

**Parameters:**
- `query` (required) - what to search for, in your own words
- `source` (optional) - `reddit`, `twitter`, `youtube`, `linkedin`, `bluesky`, or `all` (default)
- `since` (optional) - `24h` | `7d` | `30d` | `all`, or an ISO date. Default `7d`.
- `limit` (optional) - max results, 1-200. Default 50.

**Returns:** A `search_id` plus scored results (source, channel, title, URL, score, Hot/Warm/Cold) and the credits charged.

---

### `get_search`

Fetch the current state and results for a search by its `search_id`. Use it to recover a search that timed out client-side, or to re-read a recent one. Free.

**Parameters:** `search_id` (required)

---

### `billing_status`

Check your plan and remaining credit balance. Free.

**Returns:** Plan (`free` or `monthly`) and credit balance (tier + pack = total).

## Example workflow

```
1. search("a language learning app for travelers")
   -> search_id + scored leads across Reddit, X, YouTube, LinkedIn, Bluesky,
      ranked Hot / Warm / Cold by buying intent. One credit per Hot/Warm lead.

2. get_search(search_id)   -> re-read or recover results without searching again

3. billing_status()        -> plan + credits remaining
```

### Install via Smithery

Available at [smithery.ai/server/opusforge/gorilla-mcp](https://smithery.ai/server/opusforge/gorilla-mcp). Smithery distributes a pre-built MCPB bundle that any MCPB-compatible client can install in one click.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GORILLA_API_KEY` | Yes | Your API key (starts with `grla_`). Create one at platform.usegorilla.app, Menu → API Keys. |
| `GORILLA_API_BASE` | No | Override the API base. Default `https://usegorilla.app/v1`. Useful for self-hosted deployments. |

No other configuration is required — the package talks to the public API with your key.

## Pricing

- **Free tier:** 100 credits, granted once, no card. A one-time trial.
- **Paid plan:** $14.99/mo for 2,000 credits. Unused credits roll over.
- **Metering:** one credit per qualified lead (hot or warm). Low-relevance results are free. Failed searches refund.
- **Sources:** the free tier covers Reddit, X, YouTube, and Bluesky. The paid plan adds LinkedIn (all five).

`search` spends one credit per qualified lead it returns; Cold results are free. `get_search` and `billing_status` are free.

See [usegorilla.app](https://usegorilla.app) for the full product.

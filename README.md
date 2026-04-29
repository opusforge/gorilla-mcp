# Gorilla MCP Server

Model Context Protocol server for [Gorilla](https://usegorilla.app). Find your first 100 SaaS users by searching Reddit, YouTube, X, and TikTok for real demand signals.

Learn more: [usegorilla.app](https://usegorilla.app) · [Real run examples](https://usegorilla.app/find-users/) · [How Gorilla compares](https://usegorilla.app/alternatives/) · [Blog](https://usegorilla.app/blog/)

## Setup

```bash
npm install -g @gorilla/mcp
```

Or run directly:

```bash
GORILLA_API_KEY=grla_... npx @gorilla/mcp
```

### Get your API key

1. Sign in at [gorilla.opusforge.com.br](https://gorilla.opusforge.com.br)
2. Menu, API Keys, Create
3. Copy the key (shown once)

### Configure in Claude Code

Add to your Claude Code settings:

```json
{
  "mcpServers": {
    "gorilla": {
      "command": "npx",
      "args": ["@gorilla/mcp"],
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
      "args": ["@gorilla/mcp"],
      "env": {
        "GORILLA_API_KEY": "grla_your_key_here"
      }
    }
  }
}
```

## Tools

### find_leads

Run the full pipeline. Searches all platforms and returns scored leads. Takes 30-90 seconds.

```
"Find leads for a meal planning app for busy parents"
```

**Parameters:**
- `idea` (required): Product description

**Returns:** Scored leads with source, title, URL, relevance score, category, and outreach angle.

---

### refine_idea

Get 5 clarifying questions to improve search quality before running the pipeline.

```
"Help me refine my idea for a pet sitting marketplace"
```

**Parameters:**
- `idea` (required): Product description

**Returns:** 5 questions with suggested answer options.

---

### enhance_idea

Synthesize answers into a polished product description for better search results.

**Parameters:**
- `idea` (required): Original idea
- `answers` (required): Array of `{ question, answer }` from refine_idea

**Returns:** Short title + detailed enhanced description.

---

### expand_themes

Generate search keywords, pain points, competitors, and adjacent niches.

**Parameters:**
- `idea` (required): Product description

**Returns:** Structured themes for targeted searches.

---

### search_source

Search a single platform with custom queries.

**Parameters:**
- `source` (required): `reddit`, `youtube`, `twitter`, or `tiktok`
- `queries` (required): Array of search queries
- `run_id` (optional): Attach results to an existing run

**Returns:** Leads from the specified platform.

---

### get_run

Fetch results for a completed run.

**Parameters:**
- `run_id` (required): Run ID

---

### list_runs

List all previous runs.

---

### billing_status

Check your plan and remaining runs.

**Returns:** Plan name, weekly usage, referral credits, total available runs.

## Example workflow

```
1. refine_idea("a language learning app for travelers")
   → 5 questions about target audience, competitors, etc.

2. enhance_idea(idea, answers)
   → "TravelLingo: A mobile app for travelers to learn essential
      phrases in any language through AI-powered conversations..."

3. find_leads(enhanced_idea)
   → 47 leads across Reddit, YouTube, X, and TikTok
   → 12 high-intent (people actively searching for this)

4. billing_status()
   → Weekly 3/5, 2 referral credits, 4 runs available
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GORILLA_API_KEY` | Yes | Your API key (starts with `grla_`) |

Backend URL and gateway key are fetched automatically from `https://gorilla.opusforge.com.br/mcp-config.json` on startup. No other configuration required.

## Pricing

- **Single run:** $0.99. Pay per use, no subscription.
- **Weekly Pro:** $3.99/week, 5 runs.
- **Lifetime:** $149.99 once, unlimited runs.

`find_leads`, `search_source`, `refine_idea`, `enhance_idea`, and `expand_themes` each cost 1 run credit. `get_run`, `list_runs`, and `billing_status` are free.

See [usegorilla.app](https://usegorilla.app) for current plans and the full product.

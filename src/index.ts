#!/usr/bin/env node
/// <reference types="node" />

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// --version / -v: print the package version and exit. Saves users from
// piping into the stdio loop just to find out which version they have.
const argv = process.argv.slice(2);
if (argv.includes("--version") || argv.includes("-v")) {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as { version: string };
  console.log(pkg.version);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const GORILLA_API_KEY = process.env.GORILLA_API_KEY ?? "";

// The MCP only needs the user's GORILLA_API_KEY. The /v1 proxy at the apex
// host usegorilla.app injects the Supabase apikey server-side and forwards
// x-api-key on to the Edge Functions, so the package never fetches a remote
// config and never sends an apikey of its own.
//
// The base must be the apex. The /v1 proxy is a Cloudflare Pages Function of
// the gorilla-page project and is only deployed there; platform.usegorilla.app
// serves the agent UI and has no /v1 route — it answers unmatched paths with
// SPA HTML, which is why a wrong base surfaces as a JSON parse error. The
// content-type guard in call() turns that into a legible message.
//
// GORILLA_API_BASE lets power users point at a different deployment
// (staging, self-hosted proxy). Default is the public /v1 proxy.
const API_BASE = (process.env.GORILLA_API_BASE ?? "https://usegorilla.app/v1").replace(/\/$/, "");

// Streaming poll cadence. The backend hints suggested_interval_ms (~1500ms);
// we cap the total wait at 5 minutes for the agent-facing search tool.
const MAX_POLL_SECONDS = 300;

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function call<T>(
  method: "GET" | "POST",
  endpoint: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${API_BASE}/${endpoint}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": GORILLA_API_KEY,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${method} /${endpoint} failed (${res.status}): ${text}`);
  }

  // A 200 is not proof we reached the API. A base pointing at a host that
  // serves a SPA returns 200 + index.html for the unmatched /v1 path, and
  // res.json() then throws an opaque "Unexpected token '<'". Name the cause.
  const ctype = res.headers.get("content-type") ?? "";
  if (!ctype.includes("json")) {
    const preview = (await res.text().catch(() => "")).slice(0, 120).replace(/\s+/g, " ").trim();
    throw new Error(
      `${method} /${endpoint} returned ${res.status} ${ctype || "(no content-type)"}, not JSON. ` +
        `API base is ${API_BASE} — check it points at the API host, not a web UI. ` +
        `Body starts: ${preview}`
    );
  }

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Types — match the V4 v2-search-stream wire shape exactly.
// ---------------------------------------------------------------------------

interface Post {
  source: string;
  // Every per-platform search client returns `channel` as a bare string
  // (subreddit slug, X handle, channel name, etc.). It is not an object.
  channel: string;
  id: string;
  title: string;
  url: string;
  body_snippet: string;
  score: number;
  num_comments: number;
  created_utc: number;
  // The backend Lead type scores into `result_score` (0-1). That is the
  // field on the wire — there is no `lead_score`.
  result_score: number;
  matched_signals: string[];
}

interface V2StreamPollResponse {
  search_id: string;
  status: "running" | "completed" | "failed";
  query: string;
  requested_sources: string[];
  done_sources: string[];
  pending_sources: string[];
  results: Post[];
  total: number;
  buckets: { hot: number; warm: number; cold: number };
  errors: Record<string, string>;
  credits_charged: number | null;
  credits_remaining: number | null;
  started_at: string;
  completed_at: string | null;
}

interface CreditBalance {
  tier: number;
  pack: number;
  overage: number;
  total: number;
}

interface BillingStatus {
  plan: string;
  balance?: CreditBalance;
  has_api_keys?: boolean;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function scoreBucket(score: number): "Hot" | "Warm" | "Cold" {
  if (score >= 0.7) return "Hot";
  if (score >= 0.4) return "Warm";
  return "Cold";
}

function channelLabel(p: Post): string {
  const ch = p.channel ?? "";
  switch (p.source) {
    case "reddit": return `r/${ch}`;
    case "twitter": return `@${ch}`;
    case "bluesky": return `@${ch} (Bluesky)`;
    case "linkedin": return `${ch} (LinkedIn)`;
    case "youtube": return `${ch} (YouTube)`;
    default: return `${p.source}/${ch}`;
  }
}

function formatPost(p: Post): string {
  const score = p.result_score ?? 0;
  const bucket = scoreBucket(score);
  const snippet =
    p.body_snippet.length > 180
      ? `${p.body_snippet.slice(0, 180)}...`
      : p.body_snippet;

  return [
    `[${bucket} ${score.toFixed(2)}] "${p.title}" — ${channelLabel(p)}`,
    `  ${p.score} pts · ${p.num_comments} comments`,
    snippet ? `  ${snippet}` : null,
    `  ${p.url}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatStream(resp: V2StreamPollResponse): string {
  const errs = Object.entries(resp.errors ?? {});
  const errLine = errs.length
    ? `\n\nPartial failures: ${errs.map(([k, v]) => `${k}: ${v}`).join("; ")}`
    : "";

  if ((resp.results?.length ?? 0) === 0) {
    return `Search ${resp.search_id} returned no results across ${resp.done_sources.join(", ") || "(none)"}.${errLine}`;
  }

  const sorted = [...resp.results].sort((a, b) => (b.result_score ?? 0) - (a.result_score ?? 0));
  const perSource = new Map<string, number>();
  for (const r of sorted) perSource.set(r.source, (perSource.get(r.source) ?? 0) + 1);
  const sourceLine = [...perSource.entries()].map(([s, n]) => `${n} ${s}`).join(", ");

  const charged = resp.credits_charged ?? 0;
  const remaining = resp.credits_remaining ?? 0;

  // One credit per qualified lead (hot or warm); cold results are free.
  const header = [
    `search_id: ${resp.search_id}`,
    `Found ${resp.total} results (${sourceLine}). ${resp.buckets.hot} Hot · ${resp.buckets.warm} Warm · ${resp.buckets.cold} Cold.`,
    `Charged ${charged} credit${charged === 1 ? "" : "s"} (1 per hot/warm lead, cold free). Remaining: ${remaining}.`,
  ].join("\n");

  const body = sorted.slice(0, 50).map(formatPost).join("\n\n");
  const tail = sorted.length > 50 ? `\n\n... and ${sorted.length - 50} more` : "";
  return `${header}${errLine}\n\n${body}${tail}`;
}

// ---------------------------------------------------------------------------
// Auth check helper
// ---------------------------------------------------------------------------

function requireKey() {
  if (!GORILLA_API_KEY) {
    return {
      content: [
        {
          type: "text" as const,
          text: "GORILLA_API_KEY is not set. Create one at platform.usegorilla.app/api-keys/, then set GORILLA_API_KEY in your environment.",
        },
      ],
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "gorilla-mcp",
  version: "3.0.0",
});

const ALL_SOURCES = ["reddit", "twitter", "bluesky", "linkedin", "youtube"] as const;
type Source = (typeof ALL_SOURCES)[number];

// -- search -------------------------------------------------------------------

server.tool(
  "search",
  "The social demand engine for your agent. Searches Reddit, X, YouTube, LinkedIn, and Bluesky in parallel for posts where people are expressing demand for what you described. Returns scored results ranked Hot / Warm / Cold by buying intent and recency. Filter by source and by time. Pricing: one credit per qualified lead (Hot or Warm); Cold results are free, and a failed search is fully refunded. LinkedIn is a paid-plan source; the free tier covers Reddit, X, YouTube, and Bluesky. Takes 30-90s.",
  {
    query: z
      .string()
      .min(1)
      .describe(
        "What to search for, in your own words. The backend expands it into per-platform intent phrasings.",
      ),
    source: z
      .enum([...ALL_SOURCES, "all"] as const)
      .optional()
      .describe(
        `Which platform to search. One of: ${ALL_SOURCES.join(", ")}, or "all" to search every supported source in parallel. Default: "all".`,
      ),
    since: z
      .string()
      .optional()
      .describe(
        "Time range. Tokens: '24h' | '7d' | '30d' | 'all'. Or an ISO date (e.g. '2026-05-01'). Default: backend default (7d).",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe("Max results to return. 1-200. Default 50."),
  },
  async ({ query, source, since, limit }) => {
    const err = requireKey();
    if (err) return err;

    // Route through v2-search-stream: POST to kick off, then poll until
    // status !== "running". Server-side gives per-source granularity
    // (Reddit lands first, X next, etc.) and crash-recovery (the
    // v2_searches row survives MCP-side timeouts so the agent can
    // re-fetch with get_search if needed).
    const sources: Source[] | undefined =
      !source || source === "all" ? undefined : [source as Source];

    const startBody: Record<string, unknown> = { query };
    if (sources) startBody.sources = sources;
    if (since) startBody.since = since;
    if (limit) startBody.limit = limit;

    const start = await call<{
      search_id: string;
      status: "running" | "completed" | "failed";
      suggested_interval_ms?: number;
    }>("POST", "v2-search-stream", startBody);

    const pollMs = start.suggested_interval_ms ?? 1500;
    const maxAttempts = Math.ceil((MAX_POLL_SECONDS * 1000) / pollMs);

    let finalResp: V2StreamPollResponse | null = null;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, pollMs));
      const poll = await call<V2StreamPollResponse>(
        "GET",
        `v2-search-stream?id=${encodeURIComponent(start.search_id)}`,
      );
      if (poll.status !== "running") {
        finalResp = poll;
        break;
      }
    }

    if (!finalResp) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Search ${start.search_id} is still running after ${MAX_POLL_SECONDS}s. Call get_search with this id to fetch results later.`,
          },
        ],
      };
    }

    return {
      content: [{ type: "text" as const, text: formatStream(finalResp) }],
    };
  }
);

// -- get_search ---------------------------------------------------------------

server.tool(
  "get_search",
  "Fetch the current state + results for a search by its search_id. Use this to recover a search that timed out client-side, or to re-read a recent one. Free.",
  {
    search_id: z.string().describe("The search_id returned by a prior search call"),
  },
  async ({ search_id }) => {
    const err = requireKey();
    if (err) return err;

    const result = await call<V2StreamPollResponse>(
      "GET",
      `v2-search-stream?id=${encodeURIComponent(search_id)}`,
    );

    if (result.status === "running") {
      return {
        content: [
          {
            type: "text" as const,
            text: `Search ${search_id} is still running. Done: ${result.done_sources.join(", ") || "(none)"}. Pending: ${result.pending_sources.join(", ") || "(none)"}. Try again in a few seconds.`,
          },
        ],
      };
    }

    return {
      content: [{ type: "text" as const, text: formatStream(result) }],
    };
  }
);

// -- billing_status -----------------------------------------------------------

server.tool(
  "billing_status",
  "Check your plan and credit balance. Free.",
  {},
  async () => {
    const err = requireKey();
    if (err) return err;

    const billing = await call<BillingStatus>("GET", "billing-status");
    const balance = billing.balance ?? { tier: 0, pack: 0, overage: 0, total: 0 };

    const balanceBlock = [
      `Plan: ${billing.plan}`,
      `Credits remaining: ${balance.total.toLocaleString()} (tier ${balance.tier.toLocaleString()} + pack ${balance.pack.toLocaleString()})`,
      balance.overage > 0
        ? `  · overage: ${balance.overage.toLocaleString()} (billed next invoice)`
        : null,
    ]
      .filter(Boolean)
      .join("\n");

    const pricingBlock = [
      `Pricing: one credit per qualified lead (Hot or Warm). Cold results are free.`,
      `Failed searches are fully refunded.`,
      ``,
      `Free tier: 100 credits, granted once, no card.`,
      `Paid plan: $14.99/mo for 2,000 credits, with rollover.`,
      `LinkedIn is a paid-plan source; the free tier covers Reddit, X, YouTube, and Bluesky.`,
      `Subscribe at platform.usegorilla.app/billing.`,
    ].join("\n");

    return {
      content: [
        {
          type: "text" as const,
          text: `${balanceBlock}\n\n${pricingBlock}`,
        },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);

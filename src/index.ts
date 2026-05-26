#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const GORILLA_API_KEY = process.env.GORILLA_API_KEY ?? "";

// The MCP only needs the user's GORILLA_API_KEY. Everything else (the
// Edge Functions base URL and the Supabase anon gateway key) is fetched
// once from a static JSON served alongside the web app, so nothing else
// is baked into the shipped package.
const CONFIG_URL = "https://platform.usegorilla.app/mcp-config.json";

interface RuntimeConfig {
  api_base: string;
  gateway_key: string;
}

let cachedConfig: RuntimeConfig | null = null;

async function getConfig(): Promise<RuntimeConfig> {
  if (cachedConfig) return cachedConfig;

  const res = await fetch(CONFIG_URL);
  if (!res.ok) {
    throw new Error(
      `Could not load MCP config from ${CONFIG_URL} (HTTP ${res.status}).`,
    );
  }
  const json = (await res.json()) as Partial<RuntimeConfig>;
  if (!json.api_base || !json.gateway_key) {
    throw new Error(
      `MCP config at ${CONFIG_URL} is missing api_base or gateway_key`,
    );
  }
  cachedConfig = {
    api_base: json.api_base.replace(/\/$/, ""),
    gateway_key: json.gateway_key,
  };
  return cachedConfig;
}

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
  const cfg = await getConfig();
  const res = await fetch(`${cfg.api_base}/${endpoint}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": GORILLA_API_KEY,
      apikey: cfg.gateway_key,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${method} /${endpoint} failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Types — match v2 backend shape exactly.
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
  lead_score: number;
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
  runs_this_week: number;
  weekly_limit: number;
  referral_credits: number;
  balance?: CreditBalance;
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
    case "threads": return `@${ch} (Threads)`;
    case "linkedin": return `${ch} (LinkedIn)`;
    case "youtube": return `${ch} (YouTube)`;
    case "web": return ch || "web";
    default: return `${p.source}/${ch}`;
  }
}

function formatPost(p: Post): string {
  const bucket = scoreBucket(p.lead_score);
  const snippet =
    p.body_snippet.length > 180
      ? `${p.body_snippet.slice(0, 180)}...`
      : p.body_snippet;

  return [
    `[${bucket} ${p.lead_score.toFixed(2)}] "${p.title}" — ${channelLabel(p)}`,
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

  const sorted = [...resp.results].sort((a, b) => (b.lead_score ?? 0) - (a.lead_score ?? 0));
  const perSource = new Map<string, number>();
  for (const r of sorted) perSource.set(r.source, (perSource.get(r.source) ?? 0) + 1);
  const sourceLine = [...perSource.entries()].map(([s, n]) => `${n} ${s}`).join(", ");

  const charged = resp.credits_charged ?? 0;
  const remaining = resp.credits_remaining ?? 0;
  const usd = (charged * 0.001).toFixed(3);

  const header = [
    `search_id: ${resp.search_id}`,
    `Found ${resp.total} results (${sourceLine}). ${resp.buckets.hot} Hot · ${resp.buckets.warm} Warm · ${resp.buckets.cold} Cold.`,
    `Charged ${charged} credits ($${usd}). Remaining: ${remaining}.`,
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

const ALL_SOURCES = ["reddit", "twitter", "threads", "linkedin", "youtube", "web"] as const;
type Source = (typeof ALL_SOURCES)[number];

// -- search -------------------------------------------------------------------

server.tool(
  "search",
  "The social media engine for your agent. Searches across every supported platform for posts related to your query. Returns scored results ranked Hot / Warm / Cold by how closely they match your query and how recently they were posted. Filter by source and by time. Pricing: $0.10 per Hot result (score ≥ 0.7), $0.03 per Warm (0.4–0.7), $0.003 per Cold (< 0.4). No caps. Failed searches fully refunded. Takes 30–90s.",
  {
    query: z
      .string()
      .min(1)
      .describe(
        "What to search for, in your own words. Sent verbatim to each requested source.",
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
      .describe("Max results to return. 1–200. Default 50."),
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
    const totalUsd = (balance.total * 0.001).toFixed(2);

    const balanceBlock = [
      `Plan: ${billing.plan}`,
      `Credits remaining: ${balance.total.toLocaleString()} ($${totalUsd})`,
      `  · tier:    ${balance.tier.toLocaleString()}`,
      `  · pack:    ${balance.pack.toLocaleString()}`,
      balance.overage > 0
        ? `  · overage: ${balance.overage.toLocaleString()} (billed next invoice)`
        : null,
    ]
      .filter(Boolean)
      .join("\n");

    const pricingBlock = [
      `Pricing — per result by quality:`,
      `  Hot  (≥ 0.7):   $0.10`,
      `  Warm (0.4–0.7): $0.03`,
      `  Cold (< 0.4):   $0.003`,
      `No caps. Failed searches fully refunded.`,
      ``,
      `Free tier: 1,000 credits / week.`,
      `Monthly: $14.99 → 20,000 credits / month.`,
      `One-time pack: $5 → 5,000 credits (credits never expire).`,
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

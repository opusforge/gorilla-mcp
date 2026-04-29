#!/usr/bin/env node
/// <reference types="node" />

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
const CONFIG_URL = "https://gorilla.opusforge.com.br/mcp-config.json";

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

const POLL_INTERVAL_MS = 3_000;
const MAX_POLL_ATTEMPTS = 100; // 5 minutes max

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function call<T>(
  method: "GET" | "POST" | "DELETE",
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
// Types
// ---------------------------------------------------------------------------

interface Post {
  source: string;
  channel: { name: string };
  id: string;
  title: string;
  url: string;
  body_snippet: string;
  score: number;
  num_comments: number;
  created_utc: number;
  lead_score: number;
  validation_score: number;
  matched_signals: string[];
  metadata: Record<string, unknown>;
}

interface RunResult {
  run_id: string;
  status: "running" | "completed" | "failed" | "partial";
  idea: string;
  results: Post[];
  metadata: {
    total_posts: number;
    elapsed_ms: number;
    errors: string[];
    expansion?: Record<string, unknown>;
    product_title?: string | null;
  };
  steps?: Record<string, { status: string; message: string }>;
}

interface ThemeExpansion {
  core_keywords: string[];
  adjacent_niches: string[];
  pain_points: string[];
  competitor_names: string[];
  exclusion_terms: string[];
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function scoreBucket(score: number): string {
  if (score >= 0.7) return "HIGH";
  if (score >= 0.4) return "MED";
  return "LOW";
}

function formatPost(p: Post): string {
  const bucket = scoreBucket(p.lead_score);
  const ch =
    p.source === "reddit"
      ? `r/${p.channel.name}`
      : p.source === "twitter"
        ? `@${p.channel.name}`
        : `${p.source}/${p.channel.name}`;

  const category =
    p.matched_signals.find((s) => s.startsWith("category:"))?.slice(9) ?? "";
  const outreach =
    p.matched_signals.find((s) => s.startsWith("outreach:"))?.slice(9) ?? "";

  const snippet =
    p.body_snippet.length > 150
      ? `${p.body_snippet.slice(0, 150)}...`
      : p.body_snippet;

  return [
    `[${bucket}] "${p.title}" · ${ch}`,
    `  Score: ${p.lead_score.toFixed(2)} | ${p.score} pts | ${p.num_comments} comments`,
    category ? `  Category: ${category}` : null,
    outreach ? `  Outreach: ${outreach}` : null,
    snippet ? `  ${snippet}` : null,
    `  ${p.url}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatResults(result: RunResult): string {
  const posts = result.results;
  if (posts.length === 0) {
    return `Run ${result.run_id} completed but found no leads.`;
  }

  const sorted = [...posts].sort((a, b) => b.lead_score - a.lead_score);

  const sourceCounts = new Map<string, number>();
  for (const p of sorted) {
    sourceCounts.set(p.source, (sourceCounts.get(p.source) ?? 0) + 1);
  }
  const breakdown = [...sourceCounts.entries()]
    .map(([s, n]) => `${n} ${s}`)
    .join(", ");

  const high = sorted.filter((p) => p.lead_score >= 0.7).length;

  const header = `Found ${sorted.length} leads (${breakdown}). ${high} high-intent.`;
  const body = sorted.slice(0, 50).map(formatPost).join("\n\n");

  return `${header}\n\n${body}${sorted.length > 50 ? `\n\n... and ${sorted.length - 50} more` : ""}`;
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

async function waitForCompletion(runId: string): Promise<RunResult> {
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    const result = await call<RunResult>("GET", `get-run?id=${runId}`);
    if (result.status !== "running") return result;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Run ${runId} did not complete within ${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s`);
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
          text: "GORILLA_API_KEY is not set. Sign up at https://usegorilla.app, then create a key at gorilla.opusforge.com.br > Menu > API Keys and set GORILLA_API_KEY in your environment.",
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
  name: "gorilla",
  version: "1.0.0",
});

// -- find_leads ---------------------------------------------------------------

server.tool(
  "find_leads",
  "Run the full Gorilla lead-generation pipeline. Takes an app idea, searches Reddit, YouTube, X, and TikTok for demand signals, and returns scored leads. Takes 30-90 seconds.",
  {
    idea: z
      .string()
      .describe("The app idea or product description to find leads for"),
  },
  async ({ idea }) => {
    const err = requireKey();
    if (err) return err;

    const { run_id } = await call<{ run_id: string }>("POST", "run-pipeline", {
      idea,
    });

    const result = await waitForCompletion(run_id);

    return {
      content: [{ type: "text" as const, text: formatResults(result) }],
    };
  }
);

// -- refine_idea --------------------------------------------------------------

server.tool(
  "refine_idea",
  "Generate 5 clarifying questions to help refine a product idea before searching. Use this to get better search results.",
  {
    idea: z.string().describe("The app idea to generate questions for"),
  },
  async ({ idea }) => {
    const err = requireKey();
    if (err) return err;

    const { questions } = await call<{
      questions: Array<{ id: string; question: string; options: string[] }>;
    }>("POST", "refine", { idea });

    const formatted = questions
      .map(
        (q, i) =>
          `${i + 1}. ${q.question}\n   Options: ${q.options.join(" | ")}`
      )
      .join("\n\n");

    return {
      content: [
        {
          type: "text" as const,
          text: `Refinement questions for "${idea}":\n\n${formatted}\n\nCombine the answers with the original idea and pass to find_leads.`,
        },
      ],
    };
  }
);

// -- search_source ------------------------------------------------------------

server.tool(
  "search_source",
  "Search a single social platform (Reddit, X, YouTube, TikTok) with custom queries. Useful for debugging or targeted searches.",
  {
    source: z
      .enum(["reddit", "x", "twitter", "youtube", "tiktok"])
      .describe("Which platform to search. Use 'x' for X (formerly Twitter); 'twitter' is accepted as an alias."),
    queries: z
      .array(z.string())
      .describe("Search queries to run on the platform"),
    run_id: z
      .string()
      .optional()
      .describe(
        "Optional run ID to attach results to an existing run (writes to DB)"
      ),
  },
  async ({ source, queries, run_id }) => {
    const err = requireKey();
    if (err) return err;

    // Backend edge function is search-twitter. Accept 'x' as the canonical
    // user-facing name and route it to the same backend.
    const backendSource = source === "x" ? "twitter" : source;

    const body: Record<string, unknown> = { queries };
    if (run_id) body.run_id = run_id;

    const { leads, count } = await call<{ leads: Post[]; count: number }>(
      "POST",
      `search-${backendSource}`,
      body
    );

    if (count === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No leads found on ${source} for queries: ${queries.join(", ")}`,
          },
        ],
      };
    }

    const formatted = leads
      .slice(0, 20)
      .map(formatPost)
      .join("\n\n");

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${count} leads on ${source}:\n\n${formatted}${count > 20 ? `\n\n... and ${count - 20} more` : ""}`,
        },
      ],
    };
  }
);

// -- expand_themes ------------------------------------------------------------

server.tool(
  "expand_themes",
  "Generate search keywords, pain points, competitors, and adjacent niches from a product idea. This is the first step of the pipeline.",
  {
    idea: z.string().describe("The app idea to expand into search themes"),
  },
  async ({ idea }) => {
    const err = requireKey();
    if (err) return err;

    const { expansion } = await call<{ expansion: ThemeExpansion }>(
      "POST",
      "theme-expansion",
      { idea }
    );

    const sections = [
      `Keywords: ${expansion.core_keywords.join(", ")}`,
      `Niches: ${expansion.adjacent_niches.join(", ")}`,
      `Pain points: ${expansion.pain_points.join(", ")}`,
      `Competitors: ${expansion.competitor_names.join(", ")}`,
      `Exclusions: ${expansion.exclusion_terms.join(", ")}`,
    ].join("\n");

    return {
      content: [
        {
          type: "text" as const,
          text: `Theme expansion for "${idea}":\n\n${sections}\n\nUse these to build queries for search_source.`,
        },
      ],
    };
  }
);

// -- get_run ------------------------------------------------------------------

server.tool(
  "get_run",
  "Fetch results for a specific run by ID.",
  {
    run_id: z.string().describe("The run ID to fetch"),
  },
  async ({ run_id }) => {
    const err = requireKey();
    if (err) return err;

    const result = await call<RunResult>("GET", `get-run?id=${run_id}`);

    return {
      content: [{ type: "text" as const, text: formatResults(result) }],
    };
  }
);

// -- list_runs ----------------------------------------------------------------

server.tool(
  "list_runs",
  "List all previous lead-generation runs.",
  {},
  async () => {
    const err = requireKey();
    if (err) return err;

    const { runs } = await call<{
      runs: Array<{
        id: string;
        idea: string;
        status: string;
        created_at: number;
        total_posts: number;
        product_title: string | null;
      }>;
    }>("GET", "list-runs");

    if (runs.length === 0) {
      return {
        content: [{ type: "text" as const, text: "No runs found." }],
      };
    }

    const lines = runs.map((r) => {
      const title = r.product_title ?? r.idea.slice(0, 60);
      return `${r.id}  ${r.status.padEnd(10)} ${String(r.total_posts).padStart(4)} leads  "${title}"`;
    });

    return {
      content: [
        {
          type: "text" as const,
          text: `${runs.length} runs:\n\n${lines.join("\n")}`,
        },
      ],
    };
  }
);

// -- billing_status -----------------------------------------------------------

server.tool(
  "billing_status",
  "Check your current plan, remaining runs, and referral credits.",
  {},
  async () => {
    const err = requireKey();
    if (err) return err;

    const billing = await call<{
      plan: string;
      runs_this_week: number;
      weekly_limit: number;
      referral_credits: number;
    }>("GET", "billing-status");

    const weeklyRemaining = Math.max(
      0,
      billing.weekly_limit - billing.runs_this_week
    );
    const total = weeklyRemaining + billing.referral_credits;

    return {
      content: [
        {
          type: "text" as const,
          text: `Plan: ${billing.plan}\nWeekly runs: ${billing.runs_this_week}/${billing.weekly_limit} used\nReferral credits: ${billing.referral_credits}\nTotal runs available: ${total}`,
        },
      ],
    };
  }
);

// -- draft_outreach -----------------------------------------------------------

server.tool(
  "draft_outreach",
  "Draft a platform-tuned outreach message (Reddit comment, X reply, YouTube comment, TikTok comment, Instagram DM, etc.) for a specific lead. Calls Gorilla's server-side drafter so the message follows the platform's tone, length, and self-promo norms. Use this instead of hand-writing copy.",
  {
    idea: z
      .string()
      .describe("The refined product idea (used as the writer's voice)"),
    source: z
      .enum(["reddit", "x", "twitter", "youtube", "tiktok", "instagram"])
      .describe("Which platform the lead is on"),
    outreach_action: z
      .enum([
        "reply_comment",
        "comment_post",
        "reply",
        "comment",
        "dm",
        "dm_post_author",
        "channel_about",
        "profile_check",
      ])
      .describe(
        "How to engage. dm/dm_post_author for DMs, comment_post for top-level comments, reply_comment to respond to a specific thread comment, channel_about for YouTube About-tab contact, profile_check for stale posts.",
      ),
    post_title: z.string().describe("Title of the lead post"),
    post_body: z.string().describe("Body / snippet of the lead post"),
    post_handle: z
      .string()
      .optional()
      .describe("OP handle (e.g. 'u/founder', '@user'). Optional but improves drafts."),
    language: z
      .enum(["en", "pt"])
      .optional()
      .describe("Output language. Defaults to 'en'."),
    reply_to_author: z
      .string()
      .optional()
      .describe("For reply_comment: the author of the comment being replied to."),
    reply_to_text: z
      .string()
      .optional()
      .describe("For reply_comment: the comment text being replied to."),
  },
  async ({
    idea,
    source,
    outreach_action,
    post_title,
    post_body,
    post_handle,
    language,
    reply_to_author,
    reply_to_text,
  }) => {
    const err = requireKey();
    if (err) return err;

    const body: Record<string, unknown> = {
      idea,
      language: language ?? "en",
      source,
      outreach_action,
      post: {
        title: post_title,
        body: post_body,
        ...(post_handle ? { handle: post_handle } : {}),
      },
    };
    if (reply_to_author && reply_to_text) {
      body.reply_to_comment = { author: reply_to_author, text: reply_to_text };
    }

    const { draft } = await call<{ draft: string }>(
      "POST",
      "draft-outreach",
      body,
    );

    return {
      content: [
        {
          type: "text" as const,
          text: draft,
        },
      ],
    };
  },
);

// -- plan_acquisition_funnel --------------------------------------------------

server.tool(
  "plan_acquisition_funnel",
  "Group a completed run's leads by channel, score, and category, and produce a structured first-week acquisition plan: per-channel send volume, suggested action per category bucket, and follow-up cadence. Call this after find_leads completes.",
  {
    run_id: z.string().describe("The run_id returned by find_leads"),
  },
  async ({ run_id }) => {
    const err = requireKey();
    if (err) return err;

    const result = await call<RunResult>("GET", `get-run?id=${run_id}`);
    const posts = result.results;

    if (posts.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Run ${run_id} returned no leads. Re-run with a sharper idea before planning a funnel.`,
          },
        ],
      };
    }

    const high = posts.filter((p) => p.lead_score >= 0.7);
    const med = posts.filter((p) => p.lead_score >= 0.4 && p.lead_score < 0.7);

    // Group HIGH by source and category
    const bySource = new Map<string, Post[]>();
    const byCategory = new Map<string, number>();
    for (const p of high) {
      const arr = bySource.get(p.source) ?? [];
      arr.push(p);
      bySource.set(p.source, arr);
      const cat = p.matched_signals.find((s) => s.startsWith("category:"))?.slice(9) ?? "OTHER";
      byCategory.set(cat, (byCategory.get(cat) ?? 0) + 1);
    }

    // Per-channel cadence heuristic. Reddit + X tolerate higher daily volume than
    // YouTube/TikTok/Instagram, where each comment is more visible to the creator.
    const VOLUME = {
      reddit: { perDay: 3, followUpDays: 5 },
      twitter: { perDay: 4, followUpDays: 3 },
      x: { perDay: 4, followUpDays: 3 },
      youtube: { perDay: 2, followUpDays: 7 },
      tiktok: { perDay: 2, followUpDays: 7 },
      instagram: { perDay: 2, followUpDays: 7 },
    } as Record<string, { perDay: number; followUpDays: number }>;

    const ACTION_BY_CATEGORY: Record<string, string> = {
      ACTIVE_SEARCH: "Direct answer. They're asking, you have it. Reply within 24h.",
      PAIN_OR_FRUSTRATION: "Empathy first, link second. Acknowledge the pain in your own words before mentioning the product.",
      SWITCHING: "Position as the next step, not 'a' next step. Reference what they said they're leaving.",
      COMPARISON: "Insert as the third option in their list. One concrete tradeoff vs each they named.",
      FEATURE_GAP: "Lead with the missing feature. Skip the rest of the pitch.",
      COMPETITOR: "INTEL ONLY. Do not DM. Use to understand positioning.",
      TUTORIAL: "Skip for outreach. Use for keyword research and content ideas.",
      DISCUSSION: "Comment publicly, not via DM. Lower-effort, lower-conversion.",
    };

    const channelLines: string[] = [];
    let totalWeeklySends = 0;
    for (const [source, leads] of bySource.entries()) {
      const v = VOLUME[source] ?? { perDay: 2, followUpDays: 5 };
      const weekly = Math.min(leads.length, v.perDay * 7);
      totalWeeklySends += weekly;
      channelLines.push(
        `  ${source}: ${leads.length} HIGH leads. Send ${v.perDay}/day (${weekly} this week). Follow up after ${v.followUpDays} days if no reply.`,
      );
    }

    const categoryLines: string[] = [];
    for (const [cat, n] of [...byCategory.entries()].sort((a, b) => b[1] - a[1])) {
      categoryLines.push(`  ${cat} (${n}): ${ACTION_BY_CATEGORY[cat] ?? "Use the per-lead opener."}`);
    }

    const text = [
      `Acquisition funnel for run ${run_id}`,
      ``,
      `Pool: ${high.length} HIGH, ${med.length} MED, ${posts.length} total.`,
      ``,
      `Per-channel cadence (Week 1):`,
      ...channelLines,
      ``,
      `Total Week 1 send target: ${totalWeeklySends} messages.`,
      ``,
      `Action per category:`,
      ...categoryLines,
      ``,
      `Workflow:`,
      `  1. Triage HIGH leads. Drop the COMPETITOR / TUTORIAL ones.`,
      `  2. For each remaining lead, call draft_outreach with the right source + outreach_action.`,
      `  3. Hand-edit each draft for one specific detail from the post.`,
      `  4. Send. Log it. Move on.`,
      `  5. After 7 days, follow up only on the channels listed above. One follow-up max.`,
      ``,
      `If conversion is below 5% after 50 sends on a channel, deprioritise that channel and re-allocate to whichever is converting.`,
    ].join("\n");

    return {
      content: [{ type: "text" as const, text }],
    };
  },
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);

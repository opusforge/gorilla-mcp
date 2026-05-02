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

// Optional: default language used as fallback in idea.refine and outreach.draft
// when the caller doesn't pass `language`. Accepts "en", "pt", or "all".
const GORILLA_DEFAULT_LANGUAGE = process.env.GORILLA_DEFAULT_LANGUAGE ?? "";

// The MCP only needs the user's GORILLA_API_KEY. Everything else (the
// Edge Functions base URL and the Supabase anon gateway key) is fetched
// once from a static JSON served alongside the web app, so nothing else
// is baked into the shipped package.
//
// Optional: GORILLA_CONFIG_URL lets power users point at a different
// config endpoint (e.g. staging or self-hosted Supabase project).
const CONFIG_URL =
  process.env.GORILLA_CONFIG_URL ??
  "https://gorilla.opusforge.com.br/mcp-config.json";

interface RuntimeConfig {
  api_base: string;
  gateway_key: string;
}

// 15-minute TTL: long enough to avoid hammering the config endpoint on every
// tool call, short enough that a rotated gateway_key is picked up by the next
// long-lived MCP session within a quarter-hour.
const CONFIG_TTL_MS = 15 * 60 * 1000;

let cachedConfig: RuntimeConfig | null = null;
let cachedConfigAt = 0;

async function getConfig(): Promise<RuntimeConfig> {
  if (cachedConfig && Date.now() - cachedConfigAt < CONFIG_TTL_MS) {
    return cachedConfig;
  }

  const res = await fetch(CONFIG_URL);
  if (!res.ok) {
    // If we previously had a config, prefer to keep using it rather than
    // failing the call. The cached creds may still be valid even if the
    // config endpoint is briefly down.
    if (cachedConfig) return cachedConfig;
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
  cachedConfigAt = Date.now();
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
      : p.source === "twitter" || p.source === "linkedin"
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
  version: "2.0.0",
});

// -- leads.find ---------------------------------------------------------------

server.tool(
  "leads.find",
  "Find ranked social posts where people are describing the problem the user's SaaS solves, across Reddit, X, YouTube, TikTok, and LinkedIn. LinkedIn is gated to weekly / monthly / lifetime plans only — the $0.99 one-run plan covers the four consumer platforms but skips LinkedIn. Behavior: dispatches the full server-side pipeline (theme expansion, parallel platform search, AI scoring), persists a run row, blocks until the run completes (typically 60 to 120 seconds), and returns the scored leads. Consumes one credit on the user's plan. Idempotent only via the resulting run_id (use runs.get to re-read without spending another credit). Usage: call this when the user wants the full lead hunt for an idea. Do NOT call it twice for the same idea in the same session, use runs.get to re-analyse. Pair with idea.refine first if the idea is one or two words. After it returns, hand the run_id to outreach.plan for a Week-1 outreach plan and to outreach.draft for per-lead messages. Returns: scored leads (source, channel, title, url, lead_score 0-1, matched_signals including category and outreach hints), plus a header line with totals per source.",
  {
    idea: z
      .string()
      .describe("The app idea or product description to find leads for"),
  },
  {
    title: "Find leads",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
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

// -- idea.refine --------------------------------------------------------------

server.tool(
  "idea.refine",
  "Run one round of conversational refinement on a SaaS idea before searching for leads. Behavior: hits the same /refine endpoint the usegorilla.app site uses. Stateless on the server side; the MCP caller must carry history across turns. Does not write any DB rows and does NOT consume a credit. Idempotent. Usage: call this on the first turn with just {idea}, ask the returned question to the user, then call again with the same idea, the previous refined_idea as current_refined_idea, and the new {question, answer} appended to history. Stop when status is 'ready' (readiness_score crosses ~75) or after max_turns. Do NOT call idea.refine after leads.find has already run, the refinement is a pre-search step. Returns: status (ready or needs_answer), refined_idea (full text), readiness_score (0-100) with reason, missing_info list, audience_model, and one next question with suggested options (or null if ready).",
  {
    idea: z.string().describe("The original raw idea text. Stays the same across turns."),
    current_refined_idea: z
      .string()
      .optional()
      .describe("The latest refined_idea returned by a previous idea.refine call. Omit on the first turn."),
    history: z
      .array(
        z.object({
          question: z.string(),
          answer: z.string(),
        }),
      )
      .optional()
      .describe("Prior turns: each entry is the question the server asked and the user's answer. Empty / omitted on the first turn."),
    language: z
      .enum(["en", "pt", "all"])
      .optional()
      .describe("Output language. 'all' (default) auto-detects from the idea text."),
    turn: z
      .number()
      .int()
      .optional()
      .describe("1-based turn number. Lets the server stop sooner if needed."),
    max_turns: z
      .number()
      .int()
      .optional()
      .describe("Maximum rounds before the server forces status='ready'. Default 5."),
  },
  {
    title: "Refine idea",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  async ({ idea, current_refined_idea, history, language, turn, max_turns }) => {
    const err = requireKey();
    if (err) return err;

    const body: Record<string, unknown> = { idea };
    if (current_refined_idea) body.current_refined_idea = current_refined_idea;
    if (history && history.length) body.history = history;
    const effectiveLanguage =
      language ??
      (GORILLA_DEFAULT_LANGUAGE === "en" ||
      GORILLA_DEFAULT_LANGUAGE === "pt" ||
      GORILLA_DEFAULT_LANGUAGE === "all"
        ? GORILLA_DEFAULT_LANGUAGE
        : undefined);
    if (effectiveLanguage) body.language = effectiveLanguage;
    if (typeof turn === "number") body.turn = turn;
    if (typeof max_turns === "number") body.max_turns = max_turns;

    const r = await call<{
      status: "ready" | "needs_answer";
      refined_idea: string;
      readiness_score: number;
      readiness_reason: string;
      missing_info: string[];
      audience_model: unknown;
      question: { question: string; options?: string[] } | null;
    }>("POST", "refine", body);

    const lines: string[] = [];
    lines.push(`Status: ${r.status} (readiness ${r.readiness_score}/100)`);
    lines.push("");
    lines.push(`Refined idea:\n  ${r.refined_idea}`);
    if (r.missing_info.length) {
      lines.push("");
      lines.push(`Still missing: ${r.missing_info.join("; ")}`);
    }
    if (r.status === "needs_answer" && r.question) {
      lines.push("");
      lines.push(`Next question: ${r.question.question}`);
      if (r.question.options && r.question.options.length) {
        lines.push(`Suggested answers: ${r.question.options.join(" | ")}`);
      }
      lines.push("");
      lines.push(
        "Call idea.refine again with the same `idea`, this question's `refined_idea` as `current_refined_idea`, and a `history` array including {question, answer}.",
      );
    } else {
      lines.push("");
      lines.push("Idea is ready. Pass `refined_idea` to leads.find.");
    }

    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
    };
  },
);

// -- leads.search -------------------------------------------------------------

server.tool(
  "leads.search",
  "Run an ad-hoc search against ONE social platform (Reddit, X, YouTube, TikTok, or LinkedIn) with caller-provided queries. LinkedIn requires a Pro plan (weekly / monthly / lifetime); the other four work on every paid tier. Behavior: hits the platform-specific search edge function directly, bypassing theme-expansion and AI scoring. Consumes one credit per call. If a run_id is passed, results are written to that run for inspection later via runs.get. Without run_id, results are returned but not persisted. Usage: call this when leads.find under-fetched on a specific platform, or to test custom query phrasings (the queries you pass in ARE the queries that get run, no expansion). Do NOT use this as a substitute for leads.find when you want full pipeline behaviour: results from leads.search are unscored. To search all five platforms with AI scoring, call leads.find instead. Returns: leads array (raw posts with platform fields, no lead_score) and a count.",
  {
    source: z
      .enum(["reddit", "x", "twitter", "youtube", "tiktok", "linkedin"])
      .describe("Which platform to search. Use 'x' for X (formerly Twitter); 'twitter' is accepted as an alias. 'linkedin' requires a Pro plan."),
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
  {
    title: "Search a single source",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
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

// -- idea.expand --------------------------------------------------------------

server.tool(
  "idea.expand",
  "Generate the keyword scaffolding (core keywords, adjacent niches, pain points, competitor names, exclusion terms) for a product idea, without running searches. Behavior: hits the same theme-expansion endpoint leads.find calls internally as its first step. Consumes one credit. Stateless; nothing persists. Usage: call this when the user wants to see the search scaffolding before committing to a full run, or when planning manual outreach copy and you want the buyer-language vocabulary. Do NOT use this as a precursor to leads.find in the same session, leads.find runs theme expansion itself; calling both is double-billing. Returns: { core_keywords, adjacent_niches, pain_points, competitor_names, exclusion_terms } as string arrays.",
  {
    idea: z.string().describe("The app idea to expand into search themes"),
  },
  {
    title: "Expand themes",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
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
          text: `Theme expansion for "${idea}":\n\n${sections}\n\nUse these to build queries for leads.search.`,
        },
      ],
    };
  }
);

// -- runs.get -----------------------------------------------------------------

server.tool(
  "runs.get",
  "Fetch the full result for a previously-started run by its run_id. Behavior: read-only DB query; no external calls and no credit consumed. Idempotent and safe to poll. If status is still 'running', returns whichever leads have already arrived (search-* functions stream into the same posts row as they finish). Usage: call this to re-analyse an earlier run without spending another credit, to hand a fresh leads payload to outreach.plan or outreach.draft, or to poll a long-running leads.find job. Do NOT call this without an existing run_id; use runs.list first if you need to find one. Returns: run_id, status (running / completed / failed / partial), idea text, results array (posts with source, channel, title, url, lead_score, matched_signals), and metadata { total_posts, elapsed_ms, errors[] }.",
  {
    run_id: z.string().describe("The run ID returned by leads.find (e.g. 'run_abc123')."),
  },
  {
    title: "Get run",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
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

// -- runs.list ----------------------------------------------------------------

server.tool(
  "runs.list",
  "List the user's recent lead-generation runs, newest first, capped at 50. Behavior: read-only DB query scoped to the authenticated user. No external calls, no credit consumed. Idempotent. Usage: call this when the user wants to revisit a previous lead hunt, when you need a run_id to feed into runs.get / outreach.plan without re-running, or to confirm whether a recent leads.find has completed. Do NOT use this to enumerate other users' runs (the endpoint is user-scoped). Returns: { runs: [{ id, idea, status (completed/running/failed/partial), created_at (UNIX seconds), total_posts, product_title }] }, ordered by created_at desc.",
  {},
  {
    title: "List runs",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
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

// -- account.billing ----------------------------------------------------------

server.tool(
  "account.billing",
  "Check the authenticated user's current plan, remaining weekly runs, referral credits, and whether any API keys are active. Behavior: read-only; hits the billing-status edge function which derives the live state from the billing + beta_access tables. Free, no credit consumed. Idempotent. Usage: call this BEFORE leads.find or leads.search if you want to confirm the user has runs available, or after a billing-error response to surface why the call was blocked. Useful for the agent to decide whether to recommend an upgrade. Do NOT poll this on a schedule, the values only change when Stripe webhooks fire (sub-minute polling adds no signal). Returns: { plan ('free'/'weekly'/'monthly'/'yearly'/'lifetime'), runs_this_week, weekly_limit, referral_credits, has_api_keys, plus billing_enabled and trial_expires_at when applicable }.",
  {},
  {
    title: "Billing status",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
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

// -- outreach.draft -----------------------------------------------------------

server.tool(
  "outreach.draft",
  "Generate a platform-tuned outreach message for a specific lead the user wants to engage. Behavior: hits the draft-outreach edge function which uses an LLM with platform-specific tone profiles (Reddit paragraph, X 280-char reply, YouTube comment, TikTok DM, LinkedIn professional reply / DM). Persists nothing. Consumes one credit per draft. Each call is independent; the drafter does not remember previous drafts. Usage: call this once per lead the user picked from a leads.find result. Pick the right outreach_action for the situation: 'comment_post' for a top-level reply on a thread, 'reply_comment' to respond to a specific comment (provide reply_to_author + reply_to_text), 'dm' or 'dm_post_author' for a DM, 'channel_about' for a YouTube About-tab cold intro, 'profile_check' for stale posts where you want a follow-up rather than a direct reply. Do NOT call outreach.draft for COMPETITOR-flagged leads (their matched_signals contains 'category:COMPETITOR') as outreach to a competitor's content is bad form. Do NOT use it to write generic copy unrelated to a specific post. Returns: { draft } as a single string ready to paste, no surrounding chrome.",
  {
    idea: z
      .string()
      .describe("The refined product idea (used as the writer's voice)"),
    source: z
      .enum(["reddit", "x", "twitter", "youtube", "tiktok", "linkedin"])
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
  {
    title: "Draft outreach",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
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

    const fallbackLanguage =
      GORILLA_DEFAULT_LANGUAGE === "pt" ? "pt" : "en";
    const body: Record<string, unknown> = {
      idea,
      language: language ?? fallbackLanguage,
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

// -- outreach.plan ------------------------------------------------------------

server.tool(
  "outreach.plan",
  "Build a Week-1 outreach plan from a completed run's HIGH-intent leads, with per-channel send cadence and per-category action register. Behavior: client-side synthesis. Fetches the run via runs.get (no extra credit), buckets HIGH leads (lead_score >= 0.7) by source and matched_signals category, then applies fixed cadence heuristics (Reddit / X tolerate 3-4 sends/day; YouTube / TikTok / LinkedIn only 2 because each engagement is more visible). Idempotent and free. Usage: call this immediately after leads.find completes if the user wants a concrete action plan rather than a raw lead dump. Skip it if HIGH lead count is under 5 (the heuristic falls apart on tiny pools, refine the idea and re-run instead). Do NOT call this on a still-running run, results will be incomplete. Returns: a multi-line text plan with the HIGH/MED/total breakdown, per-channel daily send target + follow-up window, per-category action register (ACTIVE_SEARCH, PAIN_OR_FRUSTRATION, SWITCHING, COMPARISON, FEATURE_GAP, COMPETITOR, TUTORIAL, DISCUSSION), and an end-of-week deprioritisation rule.",
  {
    run_id: z.string().describe("The run_id returned by leads.find"),
  },
  {
    title: "Plan acquisition funnel",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
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
    // YouTube/TikTok/LinkedIn, where each engagement is more visible to the
    // creator (or the prospect's network in LinkedIn's case).
    const VOLUME = {
      reddit: { perDay: 3, followUpDays: 5 },
      twitter: { perDay: 4, followUpDays: 3 },
      x: { perDay: 4, followUpDays: 3 },
      youtube: { perDay: 2, followUpDays: 7 },
      tiktok: { perDay: 2, followUpDays: 7 },
      linkedin: { perDay: 2, followUpDays: 7 },
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
      `  2. For each remaining lead, call outreach.draft with the right source + outreach_action.`,
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

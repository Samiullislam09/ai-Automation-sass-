import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../../env.js";
import type { ResearchResult } from "../writerPipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(__dirname, "conduct_research.py");

const RESEARCH_TIMEOUT_MS = Number(process.env.RESEARCH_TIMEOUT_MS) || 90_000;
const PYTHON_BIN = process.env.PYTHON_BIN || "python3";

/** Splits an accumulating stdout stream into complete lines, tolerating a line split across two
 * `data` events (the normal case for a subprocess pipe) — returns the leftover partial line to
 * carry into the next call. Each complete, non-empty, valid-JSON line is handed to `onLine` as
 * both its raw text and its parsed value; a line that fails to parse (a stray print from some
 * dependency, say) is silently skipped, never thrown. Exported so this buffering/parsing is
 * tested directly against strings, not only indirectly through a real Python subprocess. */
export function feedResearchOutput(carry: string, chunk: string, onLine: (raw: string, parsed: any) => void): string {
  const combined = carry + chunk;
  const lines = combined.split("\n");
  const rest = lines.pop() ?? ""; // last element may be a partial line — carried to next call
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: any;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    onLine(trimmed, parsed);
  }
  return rest;
}

/** Real gpt-researcher, run as a subprocess in THIS SAME Railway service — MASTER_PLAN §16.3
 *  Upgrade E / §7.2's exact scope ("sirf conduct_research(), write_report() nahi"), and the
 *  2026-08-28 "one service" decision: no separate deploy unit, no separate HTTP hop. conduct_
 *  research.py is the entire Python side; this file only spawns it, feeds it the topic on
 *  stdin, and reads its stdout line by line — zero or more `{"progress": ...}` lines while it
 *  works (2026-08-31, the live "reading web pages" visual — see `opts.onProgress` below), then
 *  exactly one final `{"ok": ...}` line.
 *
 *  NIM is reused as gpt-researcher's own LLM (OPENAI_BASE_URL) and DuckDuckGo as its retriever
 *  — both free, so gpt-researcher itself adds no new paid dependency, matching MANUAL_STEPS.md's
 *  running theme of not adding cost this project doesn't need yet.
 *
 *  Never throws. A missing Python install, a missing `gpt-researcher` pip package, no network,
 *  or a timeout all resolve to `null` — same convention as lib/audit/performance.ts's
 *  chromePath() fallback for a missing Chrome binary. Mr. Writer must still write a full
 *  article when research is unavailable; it only loses the open-web context that would have
 *  informed the outline's choice of subtopics. */
export async function researchTopic(
  topic: string,
  opts: { onProgress?: (event: unknown) => void } = {}
): Promise<ResearchResult | null> {
  if (!env.NVIDIA_API_KEY) return null;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: ResearchResult | null, reason?: string) => {
      if (settled) return;
      settled = true;
      if (reason) console.error(`[writer.research] skipped: ${reason}`);
      resolve(value);
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(PYTHON_BIN, [SCRIPT_PATH], {
        env: {
          ...process.env,
          OPENAI_API_KEY: env.NVIDIA_API_KEY,
          OPENAI_BASE_URL: "https://integrate.api.nvidia.com/v1",
          FAST_LLM: "openai:nvidia/nemotron-3.5-lightning-30b-a3b",
          SMART_LLM: "openai:nvidia/nemotron-3.5-lightning-30b-a3b",
          RETRIEVER: "duckduckgo",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (e: any) {
      finish(null, `could not spawn ${PYTHON_BIN}: ${e?.message}`);
      return;
    }

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(null, `timed out after ${Math.round(RESEARCH_TIMEOUT_MS / 1000)}s`);
    }, RESEARCH_TIMEOUT_MS);

    // Buffered by line, not by the whole stream: conduct_research.py prints zero or more
    // {"progress": ...} lines as it works, then one final {"ok": ...} line — reading only on
    // `close` (the old behaviour) would mean the progress lines arrived and were thrown away.
    let carry = "";
    let lastResultLine: string | null = null;
    let stderr = "";

    child.stdout?.on("data", (d) => {
      carry = feedResearchOutput(carry, String(d), (raw, parsed) => {
        if (parsed && typeof parsed === "object" && "progress" in parsed) {
          try {
            opts.onProgress?.(parsed.progress);
          } catch (e: any) {
            console.error("[writer.research] onProgress threw (research itself unaffected):", e?.message);
          }
        } else {
          lastResultLine = raw; // the real {"ok": ...} line — overwritten if more than one arrives
        }
      });
    });
    child.stderr?.on("data", (d) => (stderr += String(d)));

    child.on("error", (e) => {
      clearTimeout(timer);
      finish(null, `spawn error: ${e.message}`);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      if (code !== 0) {
        finish(null, `exited ${code}: ${(stderr || lastResultLine || "").slice(0, 300)}`);
        return;
      }
      if (!lastResultLine) {
        finish(null, "research script produced no result line");
        return;
      }
      try {
        const parsed = JSON.parse(lastResultLine);
        if (!parsed.ok) {
          finish(null, parsed.error ?? "unknown error");
          return;
        }
        finish({
          context: String(parsed.context ?? ""),
          sources: Array.isArray(parsed.sources) ? parsed.sources : [],
        });
      } catch (e: any) {
        finish(null, `bad JSON from research script: ${e?.message}`);
      }
    });

    child.stdin?.write(JSON.stringify({ topic }));
    child.stdin?.end();
  });
}

/** Real Core Web Vitals — the one thing checks.ts's own header says it cannot do without a
 *  real browser (§7.4, §17.3's "unlighthouse top 10 pages — LCP/CLS/INP, mobile score").
 *
 *  Uses `lighthouse` — the exact engine `harlan-zw/unlighthouse` wraps — directly, rather than
 *  the `@unlighthouse/core` package itself: `createUnlighthouse()` wants a server context (its
 *  own http.Server), a site crawler, a puppeteer-cluster worker pool, and a client dashboard to
 *  generate — a second web server this app would never open, built to answer "browse my report
 *  in a UI", not "give me the numbers for a report I already own". Same real measurements,
 *  none of the machinery this use case does not need.
 *
 *  Kept in its own file, never imported by checks.ts, for the same reason fetchSite.ts is
 *  separate: checks.ts is pure and network-free on purpose (testable from a fixture, no
 *  browser anywhere near the test run). Nothing in this file is deterministic or unit-tested
 *  against a real Chrome — the shape it returns is what gets fixture-tested instead.
 *
 *  DEPLOYMENT: needs an actual Chromium binary in the container. `chrome-launcher` finds one
 *  on PATH (a Nixpacks `chromium` package puts one there) or at `PUPPETEER_EXECUTABLE_PATH` /
 *  `CHROME_PATH` if set. Never throws when it cannot find one — the whole audit still has to
 *  file, just without a performance section, `skippedReason` says why.
 */
import { readFileSync } from "node:fs";
import * as v8 from "node:v8";
import { runInNewContext } from "node:vm";
import * as chromeLauncher from "chrome-launcher";
import lighthouse from "lighthouse";

export type PageVitals = {
  url: string;
  ok: boolean;
  error?: string;
  /** 0-100, Lighthouse's own performance category score. Null when the run failed. */
  performanceScore: number | null;
  /** Milliseconds. Google's own Core Web Vital for loading speed. */
  lcpMs: number | null;
  /** Unitless, 0 = no shift. Google's own Core Web Vital for visual stability. */
  cls: number | null;
  /** Milliseconds. Total Blocking Time — the LAB proxy for responsiveness. Real INP is a FIELD
   *  metric (needs real visitors, from Chrome UX Report); a single lab run cannot produce it,
   *  and this codebase does not print a number it did not measure — TBT is reported as what it
   *  actually is, never relabelled INP. */
  tbtMs: number | null;
};

export type PerformanceRun = {
  ran: boolean;
  /** Why the whole run did not happen at all — e.g. no Chrome binary found. Null when it ran
   *  (individual page failures still show up in `pages[].error`, not here). */
  skippedReason: string | null;
  pages: PageVitals[];
};

const LCP_GOOD_MS = 2500; // web.dev's own "Good" threshold
const CLS_GOOD = 0.1;
const TBT_GOOD_MS = 200;

/** Hard ceilings, because Lighthouse can hang instead of failing. Found live 2026-09-04: four
 *  audits in a row sat in "Measuring loading speed" until pg-boss's 15-minute expiry killed and
 *  retried them (three tries each, same result), so NO audit filed a report all day and the
 *  report page just said "taking longer than usual". A page that does not answer inside
 *  PAGE_TIMEOUT_MS is recorded as not measured and Chrome is restarted for the next one; once
 *  RUN_BUDGET_MS is spent the remaining pages are recorded as not measured without being tried.
 *  Either way the audit goes on to file its report — a missing speed number is a row that says
 *  so, never a run that never ends. */
const PAGE_TIMEOUT_MS = 75_000;
const RUN_BUDGET_MS = 5 * 60_000;
const LAUNCH_TIMEOUT_MS = 30_000;

/** MEMORY. Railway killed the whole agent-server out of memory three times on 2026-09-05,
 *  every time inside this file (the Railway notification says "Out of memory"; jobs_log shows
 *  the run at page 9-10 of 10). Chrome + a Lighthouse trace is the heaviest thing this process
 *  ever does, and a shared Chrome kept every page's tabs and caches until the end. So:
 *   · one Chrome PER PAGE — launched, measured, killed — so memory returns between pages;
 *   · the screenshot/thumbnail audits are skipped (the performance score does not need them
 *     and the full-page screenshot alone can be tens of MB per page);
 *   · Chrome is started with the flags that keep it smallest;
 *   · and before each page the container's own memory is read from cgroup (what the OOM
 *     killer actually looks at); if less than MEMORY_HEADROOM_MB is free, the rest of the
 *     sample is recorded as not measured and the audit files with what it has — a report with
 *     seven speed measurements beats no report at all, which is what an OOM produced. */
const MEMORY_HEADROOM_MB = 260;
const CHROME_FLAGS = [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--no-zygote",
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-default-apps",
  "--disable-sync",
  "--disable-translate",
  "--mute-audio",
  "--no-first-run",
  "--js-flags=--max-old-space-size=256",
];

function chromePath(): string | undefined {
  return process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH || undefined;
}

/** Ask V8 to collect and hand the pages back to the OS before Chrome is launched. The crawl
 *  that ran just before this parsed 156 DOMs; the heap is free by now but the RSS the cgroup
 *  counts is not, and that RSS is what leaves no room for a browser. `--expose_gc` is turned
 *  on at runtime rather than requiring a start-command flag nobody would remember to keep.
 *  Best effort by definition — a V8 that will not do it changes nothing. */
function releaseMemory() {
  try {
    v8.setFlagsFromString("--expose_gc");
    const gc = runInNewContext("gc") as undefined | (() => void);
    gc?.();
    gc?.();
  } catch {
    /* nothing to do — the guard below still refuses to launch when memory is short */
  } finally {
    try {
      v8.setFlagsFromString("--no-expose_gc");
    } catch {
      /* leaving it exposed is harmless */
    }
  }
}

/** Container memory as the OOM killer sees it — cgroup v2 first, v1 second. null outside a
 *  container (or where the files are unreadable); then no guard, same as before.
 *
 *  `memory.current` counts the RECLAIMABLE page cache too — every file this process has read
 *  since boot. Counting that as "in use" is what made the guard refuse to launch Chrome at all
 *  on the first real run after it shipped (2026-09-05: "only 291 MB left of 954", ten pages
 *  not measured, on a container that had plenty of room): the kernel drops that cache under
 *  pressure rather than killing anything. So the inactive file cache (and the reclaimable slab)
 *  is subtracted — the standard "working set" approximation, and the number the OOM decision
 *  actually turns on. */
function containerMemoryMb(): { used: number; limit: number } | null {
  const readNum = (path: string): number | null => {
    try {
      const raw = readFileSync(path, "utf8").trim();
      if (raw === "max") return null;
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? n : null;
    } catch {
      return null;
    }
  };
  const statField = (path: string, key: string): number => {
    try {
      const line = readFileSync(path, "utf8")
        .split("\n")
        .find((l) => l.startsWith(key + " "));
      const n = line ? Number(line.split(/\s+/)[1]) : NaN;
      return Number.isFinite(n) && n > 0 ? n : 0;
    } catch {
      return 0;
    }
  };

  const v2Used = readNum("/sys/fs/cgroup/memory.current");
  const v2Limit = readNum("/sys/fs/cgroup/memory.max");
  if (v2Used !== null && v2Limit !== null) {
    const reclaimable = statField("/sys/fs/cgroup/memory.stat", "inactive_file") + statField("/sys/fs/cgroup/memory.stat", "slab_reclaimable");
    return { used: Math.max(0, v2Used - reclaimable) / 1048576, limit: v2Limit / 1048576 };
  }

  const v1Used = readNum("/sys/fs/cgroup/memory/memory.usage_in_bytes");
  const v1Limit = readNum("/sys/fs/cgroup/memory/memory.limit_in_bytes");
  if (v1Used !== null && v1Limit !== null && v1Limit < 2 ** 60) {
    const reclaimable = statField("/sys/fs/cgroup/memory/memory.stat", "total_inactive_file");
    return { used: Math.max(0, v1Used - reclaimable) / 1048576, limit: v1Limit / 1048576 };
  }
  return null;
}

/** A promise with a ceiling. On timeout the ORIGINAL keeps running (nothing can cancel a
 *  Lighthouse run from outside) — the caller's job is to kill the Chrome it was talking to. */
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    t = setTimeout(() => reject(new Error(`${what} did not finish within ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t)) as Promise<T>;
}

async function launchChrome(): Promise<chromeLauncher.LaunchedChrome> {
  return withTimeout(chromeLauncher.launch({ chromeFlags: CHROME_FLAGS, chromePath: chromePath() }), LAUNCH_TIMEOUT_MS, "Chrome launch");
}

function killChrome(chrome: chromeLauncher.LaunchedChrome | null) {
  if (!chrome) return;
  try {
    chrome.kill();
  } catch {
    /* best-effort — the process may already be gone */
  }
}

/** Runs Lighthouse (mobile, simulated throttling — Google's own default) against each URL, one
 *  Chrome instance shared across all of them. Never throws: a browser that will not launch, or
 *  one page that fails, comes back as data — `skippedReason` or `pages[].ok:false` — because the
 *  rest of the audit (checks.ts's deterministic catalogue) has to file its report either way.
 *
 *  `urls` should be short — homepage + a handful of recent articles (§17.3), not the whole
 *  site. Each page takes 10-20s; ten pages is already 2-3 minutes. `onPage` fires after each
 *  page (done, total, url) so the caller can show real progress. */
export async function runPerformanceAudit(urls: string[], onPage?: (done: number, total: number, url: string) => void): Promise<PerformanceRun> {
  if (!urls.length) return { ran: false, skippedReason: null, pages: [] };

  releaseMemory();

  let chrome: chromeLauncher.LaunchedChrome | null;
  try {
    chrome = await launchChrome();
  } catch (e: any) {
    return {
      ran: false,
      skippedReason: `Loading speed could not be measured — no Chrome browser was found on this server (${e?.message ?? "launch failed"}). Set PUPPETEER_EXECUTABLE_PATH to a Chromium binary.`,
      pages: [],
    };
  }

  // The first launch proved a browser exists; it is thrown away and every page gets its own.
  killChrome(chrome);
  chrome = null;

  const started = Date.now();
  const pages: PageVitals[] = [];
  let lowMemory: string | null = null;
  for (const [i, url] of urls.entries()) {
    const empty = { url, performanceScore: null, lcpMs: null, cls: null, tbtMs: null };
    if (Date.now() - started > RUN_BUDGET_MS) {
      pages.push({ ...empty, ok: false, error: `Not measured — the ${Math.round(RUN_BUDGET_MS / 60_000)}-minute loading-speed budget for this audit was used up by the pages before it` });
      onPage?.(i + 1, urls.length, url);
      continue;
    }
    const mem = containerMemoryMb();
    if (mem && i === 0) console.log(`[performance] memory before the first page: ${Math.round(mem.used)} MB used of ${Math.round(mem.limit)} MB`);
    if (lowMemory || (mem && mem.limit - mem.used < MEMORY_HEADROOM_MB)) {
      lowMemory ??= `Not measured — the server had only ${Math.round(mem!.limit - mem!.used)} MB of memory left (of ${Math.round(mem!.limit)} MB) and a browser needs about ${MEMORY_HEADROOM_MB}; stopped rather than crash the audit`;
      pages.push({ ...empty, ok: false, error: lowMemory });
      onPage?.(i + 1, urls.length, url);
      continue;
    }
    try {
      chrome = await launchChrome();
    } catch (e: any) {
      pages.push({ ...empty, ok: false, error: `Not measured — Chrome could not be started for this page (${e?.message ?? "launch failed"})` });
      onPage?.(i + 1, urls.length, url);
      continue;
    }
    try {
      pages.push(await withTimeout(auditOne(url, chrome.port), PAGE_TIMEOUT_MS, "Lighthouse"));
    } catch (e: any) {
      pages.push({ ...empty, ok: false, error: `Not measured — ${e?.message ?? "Lighthouse hung"}` });
    } finally {
      // Every page's Chrome dies here, hung or not — the memory comes back before the next one.
      killChrome(chrome);
      chrome = null;
    }
    onPage?.(i + 1, urls.length, url);
  }

  return { ran: true, skippedReason: null, pages };
}

async function auditOne(url: string, port: number): Promise<PageVitals> {
  const empty = { url, performanceScore: null, lcpMs: null, cls: null, tbtMs: null };
  try {
    const result = await lighthouse(url, {
      port,
      output: "json",
      logLevel: "error",
      onlyCategories: ["performance"],
      formFactor: "mobile",
      screenEmulation: { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false },
      throttlingMethod: "simulate",
      // Lighthouse's own per-phase ceilings, so a page that never fires `load` under simulated
      // throttling gives up inside PAGE_TIMEOUT_MS instead of waiting on the default (45s + 45s).
      maxWaitForFcp: 20_000,
      maxWaitForLoad: 40_000,
      // The performance SCORE needs the trace, not pictures of the page — the screenshot
      // audits are the biggest single memory cost per run and are read by nothing here.
      disableFullPageScreenshot: true,
      skipAudits: ["screenshot-thumbnails", "final-screenshot", "full-page-screenshot"],
    });
    const lhr = result?.lhr;
    if (!lhr) return { ...empty, ok: false, error: "Lighthouse returned no result" };
    // Lighthouse does not always throw when a run genuinely fails — a page that did not settle
    // under simulated throttling, a mid-run navigation, a target that closed early all come
    // back as a NORMAL resolved promise carrying `lhr.runtimeError` and an empty `categories`/
    // `audits` object. Reproduced live 2026-09-04: three real audits in a row, Chrome launching
    // fine every time (`ok:true`), every single page's score/LCP/CLS/TBT silently null — this
    // looked like a working run that measured nothing, the exact "made-up number dressed as a
    // measurement" this file's own header promises never to do, just inverted (a MISSING
    // measurement dressed as a successful one). Treat a runtimeError, or a run with literally
    // no numbers to show, as the failure it actually is.
    if (lhr.runtimeError?.message) return { ...empty, ok: false, error: lhr.runtimeError.message };
    const score = lhr.categories?.performance?.score;
    const performanceScore = typeof score === "number" ? Math.round(score * 100) : null;
    const lcpMs = numeric(lhr.audits?.["largest-contentful-paint"]);
    const cls = numeric(lhr.audits?.["cumulative-layout-shift"]);
    const tbtMs = numeric(lhr.audits?.["total-blocking-time"]);
    if (performanceScore == null && lcpMs == null && cls == null && tbtMs == null) {
      return { ...empty, ok: false, error: "Lighthouse produced no usable performance data for this page" };
    }
    return { ...empty, ok: true, performanceScore, lcpMs, cls, tbtMs };
  } catch (e: any) {
    return { ...empty, ok: false, error: e?.message ?? "lighthouse run failed" };
  }
}

function numeric(audit: any): number | null {
  const v = audit?.numericValue;
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
}

/** The same shape checks.ts's own `AuditIssue` uses (kept structurally identical rather than
 *  imported, so this file never has to import checks.ts and stay honestly separate from it —
 *  see the file header). One issue per problem KIND across however many pages have it, matching
 *  every other entry in the catalogue. */
export function issuesFromVitals(pages: PageVitals[]) {
  const measured = pages.filter((p) => p.ok);
  const slow = measured.filter((p) => p.lcpMs != null && p.lcpMs > LCP_GOOD_MS);
  const shifty = measured.filter((p) => p.cls != null && p.cls > CLS_GOOD);
  const blocked = measured.filter((p) => p.tbtMs != null && p.tbtMs > TBT_GOOD_MS);
  const failed = pages.filter((p) => !p.ok);

  const issues: { id: string; severity: "block" | "warn" | "info"; what: string; fix: string; pages: string[]; count: number }[] = [];

  if (slow.length)
    issues.push({
      id: "slow-lcp",
      severity: "warn",
      what: `${slow.length} ${slow.length === 1 ? "page loads" : "pages load"} slower than Google's "Good" mark for Largest Contentful Paint (2.5s)`,
      fix: "Usually a large hero image or a slow server response. Compress the hero image and check hosting speed.",
      pages: slow.slice(0, 8).map((p) => p.url),
      count: slow.length,
    });
  if (shifty.length)
    issues.push({
      id: "layout-shift",
      severity: "warn",
      what: `${shifty.length} ${shifty.length === 1 ? "page has" : "pages have"} visible layout shift while loading (CLS above 0.1)`,
      fix: "Usually an image or an ad slot with no reserved size. Add width/height to every image tag.",
      pages: shifty.slice(0, 8).map((p) => p.url),
      count: shifty.length,
    });
  if (blocked.length)
    issues.push({
      id: "slow-interactivity",
      severity: "info",
      what: `${blocked.length} ${blocked.length === 1 ? "page's" : "pages'"} main thread stays busy long enough to delay the first tap or click`,
      fix: "Usually heavy JavaScript — a page builder or a large script bundle is the most common cause.",
      pages: blocked.slice(0, 8).map((p) => p.url),
      count: blocked.length,
    });
  if (failed.length)
    issues.push({
      id: "performance-check-failed",
      severity: "info",
      what: `${failed.length} ${failed.length === 1 ? "page" : "pages"} could not be measured for loading speed`,
      fix: "Often a page that blocks automated browsers, or one that timed out — not necessarily a real problem.",
      pages: failed.slice(0, 8).map((p) => p.url),
      count: failed.length,
    });

  return issues;
}

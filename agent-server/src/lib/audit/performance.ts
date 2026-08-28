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

function chromePath(): string | undefined {
  return process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH || undefined;
}

/** Runs Lighthouse (mobile, simulated throttling — Google's own default) against each URL, one
 *  Chrome instance shared across all of them. Never throws: a browser that will not launch, or
 *  one page that fails, comes back as data — `skippedReason` or `pages[].ok:false` — because the
 *  rest of the audit (checks.ts's deterministic catalogue) has to file its report either way.
 *
 *  `urls` should be short — homepage + a handful of recent articles (§17.3), not the whole
 *  site. Each page takes 10-20s; ten pages is already 2-3 minutes. */
export async function runPerformanceAudit(urls: string[]): Promise<PerformanceRun> {
  if (!urls.length) return { ran: false, skippedReason: null, pages: [] };

  let chrome: chromeLauncher.LaunchedChrome;
  try {
    chrome = await chromeLauncher.launch({
      chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
      chromePath: chromePath(),
    });
  } catch (e: any) {
    return {
      ran: false,
      skippedReason: `Loading speed could not be measured — no Chrome browser was found on this server (${e?.message ?? "launch failed"}). Set PUPPETEER_EXECUTABLE_PATH to a Chromium binary.`,
      pages: [],
    };
  }

  const pages: PageVitals[] = [];
  try {
    for (const url of urls) pages.push(await auditOne(url, chrome.port));
  } finally {
    try { chrome.kill(); } catch { /* best-effort — the process may already be gone */ }
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
    });
    const lhr = result?.lhr;
    if (!lhr) return { ...empty, ok: false, error: "Lighthouse returned no result" };
    const score = lhr.categories?.performance?.score;
    return {
      ...empty,
      ok: true,
      performanceScore: typeof score === "number" ? Math.round(score * 100) : null,
      lcpMs: numeric(lhr.audits?.["largest-contentful-paint"]),
      cls: numeric(lhr.audits?.["cumulative-layout-shift"]),
      tbtMs: numeric(lhr.audits?.["total-blocking-time"]),
    };
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

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

function chromePath(): string | undefined {
  return process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH || undefined;
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
  return withTimeout(
    chromeLauncher.launch({
      chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
      chromePath: chromePath(),
    }),
    LAUNCH_TIMEOUT_MS,
    "Chrome launch",
  );
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

  const started = Date.now();
  const pages: PageVitals[] = [];
  try {
    for (const [i, url] of urls.entries()) {
      const empty = { url, performanceScore: null, lcpMs: null, cls: null, tbtMs: null };
      if (Date.now() - started > RUN_BUDGET_MS) {
        pages.push({ ...empty, ok: false, error: `Not measured — the ${Math.round(RUN_BUDGET_MS / 60_000)}-minute loading-speed budget for this audit was used up by the pages before it` });
        onPage?.(i + 1, urls.length, url);
        continue;
      }
      if (!chrome) {
        try {
          chrome = await launchChrome();
        } catch (e: any) {
          pages.push({ ...empty, ok: false, error: `Not measured — Chrome could not be restarted after a hung page (${e?.message ?? "launch failed"})` });
          onPage?.(i + 1, urls.length, url);
          continue;
        }
      }
      try {
        pages.push(await withTimeout(auditOne(url, chrome.port), PAGE_TIMEOUT_MS, "Lighthouse"));
      } catch (e: any) {
        // The hung run still holds this Chrome — throw the browser away, the next page gets a
        // fresh one. Leaving it would make every following page hang the same way.
        pages.push({ ...empty, ok: false, error: `Not measured — ${e?.message ?? "Lighthouse hung"}` });
        killChrome(chrome);
        chrome = null;
      }
      onPage?.(i + 1, urls.length, url);
    }
  } finally {
    killChrome(chrome);
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

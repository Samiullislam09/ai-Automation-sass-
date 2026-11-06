/** Run: cd agent-server && npx tsx --test src/lib/leads/scraplingClient.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://unit-test/none";
process.env.SUPABASE_URL ||= "http://unit-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "unit-test";

const { readPageViaScrapling, scraplingConfigured, makeScraplingAwareFetcher } = await import("./scraplingClient.js");

async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T> | T): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("not configured: readPageViaScrapling returns null without a network call", async () => {
  await withEnv({ SCRAPLING_SERVICE_URL: undefined }, async () => {
    assert.equal(scraplingConfigured(), false);
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response("{}");
    }) as unknown as typeof fetch;
    const r = await readPageViaScrapling("https://acme.com", undefined, fetchImpl);
    assert.equal(r, null);
    assert.equal(called, false);
  });
});

test("configured: posts the url + country hint, sends the bearer token, returns facts", async () => {
  await withEnv({ SCRAPLING_SERVICE_URL: "https://reader.internal", SCRAPLING_SERVICE_TOKEN: "s3cret" }, async () => {
    assert.equal(scraplingConfigured(), true);
    const seen: any[] = [];
    const fetchImpl = (async (url: any, init: any) => {
      seen.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
      return new Response(
        JSON.stringify({
          ok: true, url: "https://acme.ae/", title: "Acme", text: "Acme page text",
          name: "Acme Safety", emails: ["sales@acme.ae"], phones: ["+971501234567"], whatsapp: "+971501234567",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    const r = await readPageViaScrapling("https://acme.ae", { country: "United Arab Emirates" } as any, fetchImpl);
    assert.equal(seen[0].url, "https://reader.internal/read");
    assert.equal(seen[0].headers.Authorization, "Bearer s3cret");
    assert.equal(seen[0].body.country_hint, "AE");
    assert.ok(r && r.ok);
    assert.equal((r as any).page.text, "Acme page text");
    assert.deepEqual((r as any).facts.emails, ["sales@acme.ae"]);
    assert.equal((r as any).facts.whatsapp, "+971501234567");
  });
});

test("the service's own 'no' (robots.txt, unreachable) is a final answer, not a transport failure", async () => {
  await withEnv({ SCRAPLING_SERVICE_URL: "https://reader.internal" }, async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ ok: false, reason: "acme.ae disallows this page in its robots.txt" }), { status: 200 })) as unknown as typeof fetch;
    const r = await readPageViaScrapling("https://acme.ae", undefined, fetchImpl);
    assert.ok(r && !r.ok);
    assert.equal((r as any).transport, false);
    assert.match((r as any).reason, /robots\.txt/);
  });
});

test("a transport failure (service down) is marked for fallback, not treated as a site answer", async () => {
  await withEnv({ SCRAPLING_SERVICE_URL: "https://reader.internal" }, async () => {
    const fetchImpl = (async () => new Response("boom", { status: 502 })) as unknown as typeof fetch;
    const r = await readPageViaScrapling("https://acme.ae", undefined, fetchImpl);
    assert.ok(r && !r.ok);
    assert.equal((r as any).transport, true);

    const netErr = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const r2 = await readPageViaScrapling("https://acme.ae", undefined, netErr);
    assert.ok(r2 && !r2.ok);
    assert.equal((r2 as any).transport, true);
  });
});

test("makeScraplingAwareFetcher: not configured falls back to cheerio for every page", async () => {
  await withEnv({ SCRAPLING_SERVICE_URL: undefined }, async () => {
    let fallbackCalls = 0;
    const fetcher = makeScraplingAwareFetcher(
      async (url) => {
        fallbackCalls += 1;
        return { ok: true, page: { url, title: "t", text: "fallback text" } };
      },
      () => undefined,
    );
    const out = await fetcher("https://acme.ae");
    assert.equal(fallbackCalls, 1);
    assert.ok(out.ok);
    assert.equal((out as any).page.text, "fallback text");
  });
});

test("makeScraplingAwareFetcher: a transport failure falls back to cheerio", async () => {
  await withEnv({ SCRAPLING_SERVICE_URL: "https://reader.internal" }, async () => {
    let fallbackCalls = 0;
    const fallback = async (url: string) => {
      fallbackCalls += 1;
      return { ok: true as const, page: { url, title: "t", text: "fallback text" } };
    };
    const serviceDown = (async () => new Response("down", { status: 500 })) as unknown as typeof fetch;
    const fetcher = makeScraplingAwareFetcher(fallback, () => undefined, serviceDown);
    const out = await fetcher("https://acme.ae");
    assert.equal(fallbackCalls, 1);
    assert.ok(out.ok);
    assert.equal((out as any).page.text, "fallback text");
  });
});

test("makeScraplingAwareFetcher: the service's robots.txt refusal is final, no fallback", async () => {
  await withEnv({ SCRAPLING_SERVICE_URL: "https://reader.internal" }, async () => {
    let fallbackCalls = 0;
    const fallback = async () => {
      fallbackCalls += 1;
      return { ok: true as const, page: { url: "x", title: "t", text: "fallback text" } };
    };
    const refuses = (async () => new Response(JSON.stringify({ ok: false, reason: "acme.ae disallows this page in its robots.txt" }))) as unknown as typeof fetch;
    const fetcher = makeScraplingAwareFetcher(fallback, () => undefined, refuses);
    const out = await fetcher("https://acme.ae");
    assert.equal(fallbackCalls, 0);
    assert.equal(out.ok, false);
    assert.match((out as any).reason, /robots\.txt/);
  });
});

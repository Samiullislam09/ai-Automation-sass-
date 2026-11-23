# Leads page reader

A small, separate service that reads a business's own website for the Leads agent
(`agent-server/src/agents/leads.ts`) and hands back the facts a lead draft needs: a clean
company name, business email addresses, phone numbers, and a WhatsApp link — never raw HTML.

It exists as its own service, not as a library import into the Node agent, so a crash or a
memory spike here cannot take the agent process down with it.

## What it does

- Fetches one page with [Scrapling](https://github.com/D4Vinci/Scrapling)'s plain HTTP fetcher.
- Waits a minimum gap between two requests to the same host.
- Extracts a business email (never a free consumer mailbox, never an HR/jobs mailbox), a
  validated phone number, a WhatsApp number (only from a `wa.me`/`api.whatsapp.com` link the
  page itself links to), and the company's own stated name (JSON-LD, then `og:site_name`, then
  the page title, then the domain — in that order).
- Refuses to contact a non-public address (`safety.py`'s `assert_public_host`) — the loopback
  range, private ranges, link-local addresses including the cloud metadata endpoint, and
  multicast. This runs before every request; the URL it is given is caller-controlled input.

## Notes

- Holds no tenant data and no secret beyond its own bearer token; it is handed a URL and returns
  facts about that one page.

## Running it

```bash
pip install -r requirements.txt
SCRAPLING_SERVICE_TOKEN=change-me uvicorn app:app --host 0.0.0.0 --port 8080
```

No browser install step is needed — this only uses the HTTP fetcher.

### Endpoints

- `GET /health`
- `POST /read` — body `{"url": "https://example.com", "country_hint": "AE"}` (country_hint is
  optional, ISO 3166-1 alpha-2, used only to help phone-number parsing pick the right format).
  Requires `Authorization: Bearer <SCRAPLING_SERVICE_TOKEN>` when that env var is set.

### Discovery endpoints (find companies, not just read one)

- `POST /list` — body `{"url": "<directory search url>", "max_pages": 2, "limit": 40}`. Reads a
  business directory / member list / exhibitor list (following its "next" link for up to 3 pages)
  and returns every company it links to: `{ok, items:[{name, website, domain, source_url}], pages_read}`.
  Reads any public host by default; set `LIST_ALLOWED_HOSTS` (comma-separated, e.g. `clutch.co,europages.co.uk`) to restrict it;
  empty or `*` means any public site (the SSRF check still runs on every request).
- `POST /clients` — body `{"url": "https://competitor.com", "limit": 40}`. Finds the competitor's own
  "clients / case studies / testimonials" pages from its home page, reads up to 3, and returns the
  companies named there (linked-out companies, plus client logos by their alt text).

Both use the same public-host (SSRF) check and per-host pacing as `/read`. Page-shape rules live in
`listing.py` (pure, no network) and are covered by `test_listing.py`.

The Node agent reads them through `agent-server/src/lib/leads/discoverySources.ts`; see the
`LEADS_DIRECTORY_URLS` / `LEADS_DIRECTORY_MAX_QUERIES` / `LEADS_CLIENTS_COMPETITORS_PER_RUN` /
`LEADS_QUERY_EXPAND` variables in `agent-server/.env.example`.

### Tests

```bash
pip install -r requirements.txt pytest
pytest -q
```

## Wiring it into the Node agent

Set on the agent-server deploy:

- `SCRAPLING_SERVICE_URL` — this service's base URL. Unset = the agent keeps using its existing
  cheerio-based reader (`sources.fetchPageForResearch`) exactly as before; this service only adds
  a capability, it does not replace the default until it is actually deployed and set.
- `SCRAPLING_SERVICE_TOKEN` — must match the token this service was started with.

See `agent-server/src/lib/leads/scraplingClient.ts` for exactly how a page read, a transport
failure (service unreachable → falls back to cheerio for that one page) and a real "no" from the
site (unreachable, no readable text → stands as the final answer) are told apart.

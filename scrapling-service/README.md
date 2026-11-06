# Leads page reader

A small, separate service that reads a business's own website for the Leads agent
(`agent-server/src/agents/leads.ts`) and hands back the facts a lead draft needs: a clean
company name, business email addresses, phone numbers, and a WhatsApp link — never raw HTML.

It exists as its own service, not as a library import into the Node agent, so a crash or a
memory spike here cannot take the agent process down with it.

## What it does

- Fetches one page with [Scrapling](https://github.com/D4Vinci/Scrapling)'s plain HTTP fetcher.
- Reads the page's own robots.txt first; `Disallow` is honoured, and so is `Crawl-delay`.
- Extracts a business email (never a free consumer mailbox, never an HR/jobs mailbox), a
  validated phone number, a WhatsApp number (only from a `wa.me`/`api.whatsapp.com` link the
  page itself links to), and the company's own stated name (JSON-LD, then `og:site_name`, then
  the page title, then the domain — in that order).
- Refuses to contact a non-public address (`safety.py`'s `assert_public_host`) — the loopback
  range, private ranges, link-local addresses including the cloud metadata endpoint, and
  multicast. This runs before every request; the URL it is given is caller-controlled input.

## What it does not do

- No browser automation, no anti-bot evasion, no fingerprint spoofing. It uses exactly what
  Scrapling's plain `Fetcher` gets on its own.
- No reading of a page its own robots.txt disallows.
- No social networks, directories or job boards — those are a different, allow-listed source in
  the Node pipeline (`agent-server/src/lib/leads/sources.ts`'s `web` source), not this service.
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
site (robots.txt, unreachable, no readable text → stands as the final answer) are told apart.

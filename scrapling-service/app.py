"""The Leads agent's page reader. One job: fetch a business's own website, politely, and hand
back the facts a lead draft needs — never raw HTML, so nothing downstream has to re-parse or
re-apply the same rules a second time.

WHAT THIS SERVICE DOES NOT DO (read this before changing it):
  * it never reaches past what Scrapling's plain HTTP fetcher (`Fetcher`) gets on its own — no
    browser automation, no anti-bot evasion, no fingerprint spoofing;
  * it never contacts a site whose own robots.txt says not to (safety.RobotsGate);
  * it never reads a social network, directory or job board — those go through a different,
    allow-listed source in the Node pipeline, not this service;
  * it fetches only public business sites the caller names; it holds no tenant data and no
    secret beyond its own bearer token.

Run: uvicorn app:app --host 0.0.0.0 --port 8080
"""
import os
import time
from typing import Optional

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
from scrapling.fetchers import Fetcher

from extract import business_emails, company_name, phone_numbers, whatsapp_number
from safety import RobotsGate, UnsafeUrl, USER_AGENT, assert_public_host

AUTH_TOKEN = os.environ.get("SCRAPLING_SERVICE_TOKEN", "").strip()
MAX_TEXT_CHARS = 20_000
FETCH_TIMEOUT_SECONDS = 12

app = FastAPI(title="Leads page reader")
robots = RobotsGate()


class ReadRequest(BaseModel):
    url: str
    country_hint: Optional[str] = None


class ReadResponse(BaseModel):
    ok: bool
    url: str
    status: Optional[int] = None
    title: str = ""
    text: str = ""
    name: Optional[str] = None
    emails: list[str] = []
    phones: list[str] = []
    whatsapp: Optional[str] = None
    reason: Optional[str] = None


def check_auth(authorization: Optional[str]) -> None:
    if not AUTH_TOKEN:
        return  # no token configured: service is running open (local/dev only)
    expected = f"Bearer {AUTH_TOKEN}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="missing or wrong bearer token")


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/read", response_model=ReadResponse)
def read(req: ReadRequest, authorization: Optional[str] = Header(default=None)):
    check_auth(authorization)

    try:
        origin = assert_public_host(req.url)
    except UnsafeUrl as e:
        return ReadResponse(ok=False, url=req.url, reason=str(e))

    url = req.url if "://" in req.url else f"https://{req.url}"

    if not robots.allowed(url, origin):
        return ReadResponse(ok=False, url=url, reason=f"{origin} disallows this page in its robots.txt")

    robots.wait_for_turn(origin)

    try:
        page = Fetcher.get(
            url,
            timeout=FETCH_TIMEOUT_SECONDS,
            retries=1,
            stealthy_headers=False,
            headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml"},
            follow_redirects=True,
        )
    except Exception as e:
        return ReadResponse(ok=False, url=url, reason=f"could not reach the site ({e})")

    if page.status != 200:
        return ReadResponse(ok=False, url=url, status=page.status, reason=f"the site answered HTTP {page.status}")

    try:
        text = page.get_all_text(ignore_tags=("script", "style", "noscript", "svg", "iframe")) or ""
    except Exception:
        text = ""
    text = " ".join(text.split())[:MAX_TEXT_CHARS]
    if len(text) < 50:
        return ReadResponse(ok=False, url=url, status=page.status, reason="the page has almost no readable text")

    title = (_first_text(page, "title::text") or "").strip()
    og_site = _first_attr(page, "meta[property='og:site_name']", "content")
    json_ld_name = _json_ld_org_name(page)

    host = origin.split("://", 1)[-1]
    html_for_links = ""
    try:
        html_for_links = str(page.html_content or "")
    except Exception:
        pass

    return ReadResponse(
        ok=True,
        url=url,
        status=page.status,
        title=title[:150],
        text=text,
        name=company_name(title, og_site, json_ld_name, host),
        emails=business_emails(text, host),
        phones=phone_numbers(text, (req.country_hint or "AE").upper()[:2]),
        whatsapp=whatsapp_number(html_for_links),
    )


def _first_text(page, selector: str) -> Optional[str]:
    try:
        return page.css(selector).get()
    except Exception:
        return None


def _first_attr(page, selector: str, attr: str) -> Optional[str]:
    try:
        return page.css(f"{selector}::attr({attr})").get()
    except Exception:
        return None


def _json_ld_org_name(page) -> Optional[str]:
    """The page's own structured statement of its name, if it published one. Read defensively:
    a stranger's JSON-LD is untrusted input, so a malformed block is skipped, never raised.
    Walks into `@graph` too — schema.org's own way of putting several typed nodes (Organization,
    LocalBusiness, WebSite...) in one script block, which most real sites use (found live:
    assentsteel.com's own JSON-LD is exactly this shape)."""
    import json

    try:
        blocks = page.css("script[type='application/ld+json']::text").getall()
    except Exception:
        return None

    def nodes_of(data):
        for item in data if isinstance(data, list) else [data]:
            if not isinstance(item, dict):
                continue
            yield item
            graph = item.get("@graph")
            if isinstance(graph, list):
                yield from nodes_of(graph)

    for raw in blocks or []:
        try:
            data = json.loads(raw)
        except Exception:
            continue
        for node in nodes_of(data):
            node_type = node.get("@type")
            types = node_type if isinstance(node_type, list) else [node_type]
            if any(str(t).lower() in ("organization", "localbusiness", "corporation") for t in types if t):
                name = node.get("name")
                if isinstance(name, str) and name.strip():
                    return name.strip()
    return None

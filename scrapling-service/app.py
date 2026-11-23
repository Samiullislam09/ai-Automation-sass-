"""The Leads agent's page reader. One job: fetch a business's own website, politely, and hand
back the facts a lead draft needs — never raw HTML, so nothing downstream has to re-parse or
re-apply the same rules a second time.

NOTES:
  * it uses Scrapling's plain HTTP fetcher (`Fetcher`);
  * it fetches only the URLs the caller names; it holds no tenant data and no secret beyond its
    own bearer token.

Run: uvicorn app:app --host 0.0.0.0 --port 8080
"""
import os
import time
from typing import Optional

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
from scrapling.fetchers import Fetcher

from extract import business_emails, company_name, phone_numbers, whatsapp_number
from safety import HostPacer, UnsafeUrl, USER_AGENT, assert_public_host

AUTH_TOKEN = os.environ.get("SCRAPLING_SERVICE_TOKEN", "").strip()
MAX_TEXT_CHARS = 20_000
FETCH_TIMEOUT_SECONDS = 12

app = FastAPI(title="Leads page reader")
pacer = HostPacer()


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

    pacer.wait_for_turn(origin)

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


# ── discovery: directories and a competitor's client pages ─────────────────────────────────────
#
# These two endpoints FIND companies (name + their own website); /read above is what later reads
# one company. Same rules as /read: public hosts only, robots.txt honoured, one polite request at
# a time per host, plain HTTP fetcher. A directory is somebody else's database, so /list refuses
# every host that is not on LIST_ALLOWED_HOSTS — empty means "no directory is allowed yet", which
# is the safe default; the owner names the sites they have decided to read.

MAX_LIST_PAGES = 3
MAX_CLIENT_PAGES = 3


def list_allowed_hosts() -> list[str]:
    return [h.strip().lower().removeprefix("www.") for h in os.environ.get("LIST_ALLOWED_HOSTS", "").split(",") if h.strip()]


def host_is_listed(url: str) -> bool:
    return any(same_site(url, f"https://{h}") for h in list_allowed_hosts())


class ListRequest(BaseModel):
    url: str
    max_pages: int = 2
    limit: int = 40


class ClientsRequest(BaseModel):
    url: str  # a competitor's website (home page is enough; its client pages are found from it)
    limit: int = 40


class FoundCompany(BaseModel):
    name: str
    website: Optional[str] = None
    domain: Optional[str] = None
    source_url: Optional[str] = None


class ListResponse(BaseModel):
    ok: bool
    items: list[FoundCompany] = []
    pages_read: int = 0
    reason: Optional[str] = None


def _get_html(url: str) -> tuple[Optional[str], Optional[str]]:
    """One polite page fetch -> (html, None) or (None, why). Same gates as /read."""
    try:
        origin = assert_public_host(url)
    except UnsafeUrl as e:
        return None, str(e)
    if not robots.allowed(url, origin):
        return None, f"{origin} disallows this page in its robots.txt"
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
        return None, f"could not reach the site ({e})"
    if page.status != 200:
        return None, f"the site answered HTTP {page.status}"
    try:
        return str(page.html_content or ""), None
    except Exception:
        return None, "the page had no readable HTML"


def _merge(into: list[FoundCompany], seen: set[str], rows: list[dict], source_url: str, limit: int) -> None:
    for r in rows:
        key = (r.get("domain") or r["name"]).lower()
        if key in seen:
            continue
        seen.add(key)
        into.append(FoundCompany(name=r["name"], website=r.get("website"), domain=r.get("domain"), source_url=source_url))
        if len(into) >= limit:
            return


@app.post("/list", response_model=ListResponse)
def list_directory(req: ListRequest, authorization: Optional[str] = Header(default=None)):
    """Companies a directory / member list / exhibitor list links to, following its "next" links
    for up to `max_pages` pages. Only for hosts on LIST_ALLOWED_HOSTS."""
    check_auth(authorization)
    url = req.url if "://" in req.url else f"https://{req.url}"
    if not host_is_listed(url):
        return ListResponse(ok=False, reason="this directory is not on the allowed list (LIST_ALLOWED_HOSTS)")

    limit = max(1, min(req.limit, 100))
    pages_wanted = max(1, min(req.max_pages, MAX_LIST_PAGES))
    items: list[FoundCompany] = []
    seen: set[str] = set()
    pages_read = 0
    last_reason: Optional[str] = None
    visited: set[str] = set()
    current: Optional[str] = url

    while current and current not in visited and pages_read < pages_wanted and len(items) < limit:
        visited.add(current)
        html, why = _get_html(current)
        if html is None:
            last_reason = why
            break
        pages_read += 1
        _merge(items, seen, companies_from_html(html, current, "directory", limit), current, limit)
        current = next_page_url(html, current)

    if not items:
        return ListResponse(ok=False, pages_read=pages_read, reason=last_reason or "no companies found on that page")
    return ListResponse(ok=True, items=items, pages_read=pages_read)


@app.post("/clients", response_model=ListResponse)
def competitor_clients(req: ClientsRequest, authorization: Optional[str] = Header(default=None)):
    """The customers a company publicly lists on its own site: finds its clients / case-studies /
    testimonials pages from the home page, reads up to MAX_CLIENT_PAGES, and returns the companies
    named there. A company's own public pages are fair to read the way /read reads them."""
    check_auth(authorization)
    url = req.url if "://" in req.url else f"https://{req.url}"
    limit = max(1, min(req.limit, 100))

    home, why = _get_html(url)
    if home is None:
        return ListResponse(ok=False, reason=why)

    items: list[FoundCompany] = []
    seen: set[str] = set()
    pages_read = 1
    _merge(items, seen, companies_from_html(home, url, "clients", limit), url, limit)
    for link in client_page_links(home, url, MAX_CLIENT_PAGES):
        if len(items) >= limit:
            break
        html, _ = _get_html(link)
        if html is None:
            continue
        pages_read += 1
        _merge(items, seen, companies_from_html(html, link, "clients", limit), link, limit)

    if not items:
        return ListResponse(ok=False, pages_read=pages_read, reason="no client companies are listed on that site")
    return ListResponse(ok=True, items=items, pages_read=pages_read)


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

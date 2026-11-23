"""Pure extraction for DISCOVERY pages: a directory / member list, or a company's own "our clients"
page, in as HTML; a list of companies (name + their own website) out. No network in this file, so
every rule is unit-testable with a fixed string (test_listing.py).

Two page shapes, one reader:

  * directory  — a page that LINKS OUT to many companies ("Visit website" buttons, member cards).
                 The company is whatever the page links to that is not the directory itself.
  * clients    — a competitor's "Our clients / Case studies / Testimonials" page. Same linked-out
                 companies, PLUS client logos with no link, where the company is the logo's alt text.

What this never does: it does not read a page's contact details (that is extract.py, run on the
company's OWN site later), it does not follow a link out of the page, and it never invents a name —
a candidate with no usable name is dropped, not guessed.
"""
import re
from urllib.parse import parse_qs, urljoin, urlparse

from lxml import html as lxml_html

# Hosts that are never "a company's own website": social, search, marketplaces, job boards,
# review/directory aggregators, hosting subdomains. Mirrors WEB_NOT_A_COMPANY on the Node side
# (agent-server/src/lib/leads/sources.ts) so the two readers agree on what is not a lead.
NOT_A_COMPANY_HOST = re.compile(
    r"(^|\.)("
    + "|".join(
        [
            r"linkedin\.com", r"facebook\.com", r"instagram\.com", r"twitter\.com", r"x\.com", r"youtube\.com",
            r"tiktok\.com", r"pinterest\.com", r"reddit\.com", r"quora\.com", r"medium\.com", r"wikipedia\.org",
            r"google\.[a-z.]+", r"bing\.com", r"yahoo\.com", r"amazon\.[a-z.]+", r"ebay\.[a-z.]+",
            r"alibaba\.com", r"aliexpress\.com", r"indeed\.com", r"glassdoor\.[a-z.]+", r"naukri\.com",
            r"bayt\.com", r"yelp\.com", r"tripadvisor\.[a-z.]+", r"trustpilot\.com", r"g2\.com", r"capterra\.com",
            r"clutch\.co", r"sortlist\.com", r"crunchbase\.com", r"zoominfo\.com", r"dnb\.com",
            r"opencorporates\.com", r"github\.com", r"gitlab\.com", r"apple\.com", r"play\.google\.com",
            r"whatsapp\.com", r"wa\.me", r"t\.me", r"telegram\.org", r"wordpress\.com", r"blogspot\.com",
            r"wixsite\.com", r"weebly\.com", r"squarespace\.com", r"cloudflare\.com", r"w3\.org",
            r"schema\.org", r"gravatar\.com", r"googleapis\.com", r"gstatic\.com", r"bit\.ly",
        ]
    )
    + r")$",
    re.I,
)

# A link's words that say "here is the website" rather than naming the company.
GENERIC_ANCHOR = re.compile(
    r"^(website|web site|visit( the)?( website| site| web ?site)?|view( profile| website| details)?|read more|"
    r"more( info| details)?|learn more|click here|link|www\..*|https?://.*|contact( us)?|home(page)?|details|"
    r"profile|see more|go to (website|site)|official (site|website)|open|>|»|→)$",
    re.I,
)
# Alt text that is decoration, not a client's name.
NOT_A_CLIENT_ALT = re.compile(
    r"(banner|icon|arrow|hero|background|bg|slide|spinner|loading|placeholder|avatar|photo of|picture of|"
    r"our (logo|team)|menu|search|close|play|facebook|twitter|linkedin|instagram|youtube|whatsapp|badge|award|"
    r"certificate|iso ?\d)",
    re.I,
)
FILE_LIKE = re.compile(r"\.(pdf|docx?|xlsx?|pptx?|zip|jpe?g|png|gif|svg|webp)$", re.I)

# A page that talks about a company's customers.
CLIENT_PAGE_WORDS = re.compile(
    r"(client|customer|case[-_ ]?stud|portfolio|testimonial|partner|trusted|reference|success[-_ ]?stor|our[-_ ]?work|projects?)",
    re.I,
)
# Strongest first — a page called "clients" beats one called "projects".
CLIENT_PAGE_RANK = [
    re.compile(r"client|customer", re.I),
    re.compile(r"case[-_ ]?stud|success[-_ ]?stor|reference", re.I),
    re.compile(r"testimonial|trusted|partner", re.I),
    re.compile(r"portfolio|our[-_ ]?work|projects?", re.I),
]
NEXT_WORDS = re.compile(r"^(next( page)?|next\s*[»›>→]|[»›>→]|older)$", re.I)
REDIRECT_PARAMS = ("url", "u", "to", "target", "redirect", "link", "site", "website", "dest", "destination", "goto")


def host_of(url: str) -> str:
    try:
        h = (urlparse(url).hostname or "").lower()
    except ValueError:
        return ""
    return h[4:] if h.startswith("www.") else h


def same_site(a: str, b: str) -> bool:
    """Same company site: equal hosts, or one is a subdomain of the other."""
    ha, hb = host_of(a), host_of(b)
    if not ha or not hb:
        return False
    return ha == hb or ha.endswith("." + hb) or hb.endswith("." + ha)


def host_allowed(url: str, allowed: list[str]) -> bool:
    """May /list read this host? An EMPTY list or "*" means any public site (the SSRF check in
    safety.assert_public_host still runs on every request); otherwise only the named hosts and
    their subdomains."""
    if not allowed or "*" in allowed:
        return True
    return any(same_site(url, f"https://{h}") for h in allowed)


def _text(el) -> str:
    return " ".join((el.text_content() or "").split())


def clean_name(raw: str | None) -> str | None:
    """A company name from link text, alt text or a heading — or None if it is not one."""
    s = " ".join((raw or "").split())
    if not s:
        return None
    # "Acme Steel | Dubai" / "Acme Steel - Visit" -> "Acme Steel"
    s = re.split(r"\s[|–—·»]\s|\s-\s|:\s", s)[0].strip()
    s = re.sub(r"\s+(logo|logotype|brand|image|icon)$", "", s, flags=re.I).strip()
    if len(s) < 2 or len(s) > 80:
        return None
    if "@" in s or GENERIC_ANCHOR.match(s):
        return None
    if len(s.split()) > 8:  # a sentence, not a name
        return None
    if not re.search(r"[A-Za-z؀-ۿऀ-ॿ]", s):
        return None
    return s


def _unwrap_redirect(href: str, page_url: str) -> str:
    """Directories often link out through their own redirector: /out?url=https://acme.com. When the
    link is on the directory's own host and carries such a target, the target is the company."""
    try:
        parsed = urlparse(href)
        if not same_site(href, page_url):
            return href
        qs = parse_qs(parsed.query)
        for key in REDIRECT_PARAMS:
            for val in qs.get(key, []):
                if val.startswith(("http://", "https://")):
                    return val
    except ValueError:
        pass
    return href


def _heading_for(a) -> str | None:
    """The card heading an unnamed "Visit website" link belongs to: climb to the nearest ancestor
    that holds exactly ONE heading (a card). More than one heading means the climb has left the
    card and entered the page, so stop rather than name the company after a neighbour."""
    node = a
    for _ in range(5):
        node = node.getparent()
        if node is None:
            return None
        heads = node.xpath(".//h1|.//h2|.//h3|.//h4|.//h5")
        if len(heads) == 1:
            return clean_name(_text(heads[0]))
        if len(heads) > 1:
            return None
    return None


def _name_from_host(host: str) -> str:
    bare = host.split(".")[0]
    return re.sub(r"[-_]+", " ", bare).title()


def _parse(html: str):
    try:
        return lxml_html.fromstring(html)
    except Exception:
        return None


def companies_from_html(html: str, page_url: str, mode: str = "directory", limit: int = 60) -> list[dict]:
    """Companies a listing page points to: [{name, website, domain}] — website is the company's
    origin, domain its bare host, both None only for a name-only client logo (clients mode)."""
    root = _parse(html)
    if root is None:
        return []
    out: list[dict] = []
    seen_hosts: set[str] = set()
    seen_names: set[str] = set()

    for a in root.xpath("//a[@href]"):
        href = (a.get("href") or "").strip()
        if not href or href.startswith(("#", "mailto:", "tel:", "javascript:")):
            continue
        absolute = _unwrap_redirect(urljoin(page_url, href), page_url)
        try:
            parsed = urlparse(absolute)
        except ValueError:
            continue
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            continue
        if same_site(absolute, page_url):
            continue
        if FILE_LIKE.search(parsed.path):
            continue
        host = host_of(absolute)
        if not host or NOT_A_COMPANY_HOST.search(host) or host in seen_hosts:
            continue

        name = clean_name(_text(a))
        if not name:
            for img in a.xpath(".//img[@alt]"):
                name = clean_name(img.get("alt")) if not NOT_A_CLIENT_ALT.search(img.get("alt") or "") else None
                if name:
                    break
        if not name:
            name = _heading_for(a)
        if not name:
            name = _name_from_host(host)

        seen_hosts.add(host)
        seen_names.add(name.lower())
        out.append({"name": name, "website": f"{parsed.scheme}://{parsed.netloc}", "domain": host})
        if len(out) >= limit:
            return out

    if mode == "clients":
        # Client logos that link nowhere: the company is the logo's alt text.
        for img in root.xpath("//img[@alt]"):
            alt = img.get("alt") or ""
            if NOT_A_CLIENT_ALT.search(alt):
                continue
            name = clean_name(alt)
            if not name or name.lower() in seen_names:
                continue
            seen_names.add(name.lower())
            out.append({"name": name, "website": None, "domain": None})
            if len(out) >= limit:
                break
    return out


def client_page_links(html: str, base_url: str, limit: int = 3) -> list[str]:
    """Same-site pages that talk about this company's customers, strongest first."""
    root = _parse(html)
    if root is None:
        return []
    found: dict[str, int] = {}
    for a in root.xpath("//a[@href]"):
        href = (a.get("href") or "").strip()
        if not href or href.startswith(("#", "mailto:", "tel:", "javascript:")):
            continue
        absolute = urljoin(base_url, href).split("#")[0]
        if not same_site(absolute, base_url) or FILE_LIKE.search(urlparse(absolute).path):
            continue
        hay = f"{urlparse(absolute).path} {_text(a)}"
        if not CLIENT_PAGE_WORDS.search(hay):
            continue
        if absolute.rstrip("/") == base_url.rstrip("/"):
            continue
        rank = next((i for i, rx in enumerate(CLIENT_PAGE_RANK) if rx.search(hay)), len(CLIENT_PAGE_RANK))
        found[absolute] = min(found.get(absolute, 99), rank)
    return [u for u, _ in sorted(found.items(), key=lambda kv: kv[1])][:limit]


def next_page_url(html: str, page_url: str) -> str | None:
    """The listing's next page, if it has one on the same site."""
    root = _parse(html)
    if root is None:
        return None
    for el in root.xpath("//link[@rel='next'][@href]|//a[@rel='next'][@href]"):
        nxt = urljoin(page_url, el.get("href"))
        if same_site(nxt, page_url) and nxt != page_url:
            return nxt
    for a in root.xpath("//a[@href]"):
        if NEXT_WORDS.match(_text(a)):
            nxt = urljoin(page_url, a.get("href"))
            if same_site(nxt, page_url) and nxt != page_url:
                return nxt
    return None

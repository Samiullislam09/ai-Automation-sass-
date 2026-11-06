"""Pure extraction: page text/HTML in, structured business facts out. No network calls in this
file at all, so every rule here is unit-testable with a fixed string.

What this reads: a business's OWN published contact details — the same thing a visitor copying
information off the page by hand would see. Nothing here infers, guesses or fills a gap; an
absent fact comes back as null/empty, never a placeholder.
"""
import re
from urllib.parse import unquote, urlparse

import phonenumbers

# Free consumer mail providers. An address here is a person's own mailbox, not a business one.
FREE_MAIL_DOMAINS = {
    "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "yahoo.co.in", "ymail.com",
    "hotmail.com", "hotmail.co.uk", "outlook.com", "live.com", "msn.com", "aol.com",
    "icloud.com", "me.com", "mac.com", "proton.me", "protonmail.com", "gmx.com", "gmx.de",
    "mail.com", "yandex.com", "yandex.ru", "zoho.com", "rediffmail.com", "qq.com", "163.com",
}

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}")
# A mailbox name that names a PERSON's inbox or an HR process, not the business's own front
# door. "careers@acme.com" is where you apply for a job, not where you pitch the company.
NOT_A_SALES_CONTACT = re.compile(
    r"^(hr|career|careers|job|jobs|recruit|recruitment|hiring|cv|resume|payroll|privacy|legal|abuse|security|webmaster|postmaster|noreply|no-reply|donotreply)[._-]?",
    re.I,
)
IMAGE_LIKE = re.compile(r"\.(png|jpe?g|gif|svg|webp|bmp)$", re.I)
WA_LINK = re.compile(r"(?:wa\.me|api\.whatsapp\.com/send)[^\s\"'<>]*", re.I)
WA_PHONE_PARAM = re.compile(r"[?&]phone=(\d{6,15})")
WA_PATH_PHONE = re.compile(r"wa\.me/(\d{6,15})")

# A page's own job title for itself ("About Us", "Contact") is not its brand name. Stripped from
# the FRONT of a title segment only — "Assent Steel - About Us" still keeps "Assent Steel".
GENERIC_PAGE_WORD = re.compile(
    r"^(home|homepage|welcome|about(?: us)?|contact(?: us)?|services|products|index|official site|official website)$",
    re.I,
)
LEADING_GENERIC = re.compile(r"^(?:Contact|About)(?: Us)?\s+(?=(?!Us\b)[A-Z])")


def business_emails(text: str, own_domain: str | None, limit: int = 3) -> list[str]:
    """Every business-looking email address in `text`, own-domain first, sales-sounding mailboxes
    first within that. `own_domain` (e.g. "acme.com") is used only to RANK results, never to
    filter — a business can legitimately publish an address on a parent company's domain."""
    seen: dict[str, None] = {}
    for m in EMAIL_RE.finditer(text):
        addr = m.group(0).lower()
        if IMAGE_LIKE.search(addr):
            continue
        local, _, domain = addr.partition("@")
        if domain in FREE_MAIL_DOMAINS:
            continue
        if NOT_A_SALES_CONTACT.match(local):
            continue
        seen.setdefault(addr, None)
    addrs = list(seen.keys())
    root = (own_domain or "").lower().lstrip("www.")

    def rank(addr: str) -> tuple[int, int]:
        domain = addr.split("@", 1)[1]
        on_own_domain = 0 if (root and domain.endswith(root)) else 1
        sales_first = 0 if re.match(r"^(sales|info|contact|enquir|hello|business)", addr) else 1
        return (on_own_domain, sales_first)

    addrs.sort(key=rank)
    return addrs[:limit]


def whatsapp_number(html: str) -> str | None:
    """A WhatsApp number, but ONLY from a wa.me / api.whatsapp.com link the page itself links to
    — never guessed from a phone number that merely looks like a mobile. A link is the company
    saying "message us here"; a phone number alone is not."""
    for m in WA_LINK.finditer(html):
        link = unquote(m.group(0))
        pm = WA_PATH_PHONE.search(link) or WA_PHONE_PARAM.search(link)
        if pm:
            digits = pm.group(1)
            try:
                num = phonenumbers.parse(f"+{digits}")
                if phonenumbers.is_valid_number(num):
                    return phonenumbers.format_number(num, phonenumbers.PhoneNumberFormat.E164)
            except phonenumbers.NumberParseException:
                continue
    return None


def phone_numbers(text: str, country_hint: str | None, limit: int = 2) -> list[str]:
    """Phone numbers as real, valid numbers in E.164 — never a half-parsed string. `phonenumbers`
    (Google's own libphonenumber port) does the validation; nothing here is a guess at a format."""
    out: list[str] = []
    seen: set[str] = set()
    try:
        matches = phonenumbers.PhoneNumberMatcher(text, country_hint or "AE")
    except Exception:
        return out
    for m in matches:
        if not phonenumbers.is_valid_number(m.number):
            continue
        e164 = phonenumbers.format_number(m.number, phonenumbers.PhoneNumberFormat.E164)
        if e164 in seen:
            continue
        seen.add(e164)
        out.append(e164)
        if len(out) >= limit:
            break
    return out


def company_name(title: str, og_site_name: str | None, json_ld_name: str | None, host: str) -> str:
    """The brand, preferring the site's own structured statement of its name over a guess from the
    page title. Order: JSON-LD Organization.name > og:site_name > the first clean segment of
    <title> > the domain itself (last resort, never left blank)."""
    for candidate in (json_ld_name, og_site_name):
        c = (candidate or "").strip()
        if c and not GENERIC_PAGE_WORD.match(c):
            return c[:90]

    segments = [s.strip() for s in re.split(r"\s[|–—·»]\s|\s-\s|:\s", title or "") if s.strip()]
    cleaned = [LEADING_GENERIC.sub("", s).strip() for s in segments]
    cleaned = [s for s in cleaned if s and not GENERIC_PAGE_WORD.match(s)]
    if cleaned:
        return cleaned[0][:90]

    # `.lstrip("www.")` is NOT a prefix removal — it strips any leading characters that are in
    # the set {w, w, w, '.'}, which ate real letters off some real hosts (found live:
    # "www.wca-global.com" -> "ca-global.com", because the host's own "w" in "wca" was also in
    # that character set). `removeprefix` matches the literal string only.
    bare_host = host.removeprefix("www.").split(".")[0]
    return re.sub(r"[-_]+", " ", bare_host).title() or host

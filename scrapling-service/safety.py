"""Where this service is and is not allowed to send a request.

This service fetches whatever URL it is given, for 500+ tenants' own lead searches. Two separate
checks, for two separate reasons:

  * `assert_public_host` — SSRF. A URL is attacker/tenant-controlled input; without this check a
    caller could point the service at the Railway network's own internal services or its cloud
    metadata endpoint (169.254.169.254) and read back whatever answers. This runs BEFORE every
    DNS lookup this service makes.
  * `RobotsGate` — manners, not security. The pages we read belong to strangers who did not ask
    us to come; `Disallow` is an answer, not an obstacle. A `Crawl-delay` is honoured too.
"""
import ipaddress
import socket
import time
import urllib.request
from dataclasses import dataclass, field
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

USER_AGENT = "MrLxwaLeadBot/1.0 (+https://mrlxwa.com/bot; researching a business before writing to it)"


class UnsafeUrl(Exception):
    pass


def assert_public_host(url: str) -> str:
    """Raises UnsafeUrl unless every address this hostname resolves to is a public, routable
    address. Returns the normalised origin on success. Checked again at connect time is a job for
    the HTTP client's own socket options; this is the cheap, first gate that stops the request
    before any DNS lookup a hostile hostname could use to probe internal names."""
    try:
        parsed = urlparse(url if "://" in url else f"https://{url}")
    except ValueError as e:
        raise UnsafeUrl(f"not a usable address: {e}")
    if parsed.scheme not in ("http", "https"):
        raise UnsafeUrl(f"not an http(s) address: {parsed.scheme or '(none)'}")
    host = parsed.hostname
    if not host:
        raise UnsafeUrl("no host in the address")
    if host.lower() in ("localhost", "metadata.google.internal"):
        raise UnsafeUrl(f"refusing to contact {host}")

    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as e:
        raise UnsafeUrl(f"could not resolve {host}: {e}")
    if not infos:
        raise UnsafeUrl(f"could not resolve {host}")

    for info in infos:
        addr = info[4][0]
        ip = ipaddress.ip_address(addr)
        # `is_global` is the right question ("can anyone on the public internet reach this?"),
        # not a private/loopback/link-local/reserved block-list: `is_reserved` alone also flags
        # addresses that ARE globally routable, such as the NAT64 well-known prefix
        # (64:ff9b::/96) a DNS64 resolver synthesises for an IPv4-only site on an IPv6-only
        # network — found live testing a real company's own domain, which resolved to exactly
        # that prefix and was wrongly refused. `is_global` already excludes multicast and
        # unspecified for IPv4; IPv6 multicast needs its own check since `is_global` can be True
        # for a global-scope multicast address, which is still not a single host to fetch from.
        if not ip.is_global or ip.is_multicast or ip.is_unspecified:
            raise UnsafeUrl(f"{host} resolves to a non-public address ({addr}) — refusing to contact it")

    return parsed.scheme + "://" + parsed.netloc


@dataclass
class RobotsRules:
    parser: RobotFileParser
    crawl_delay: float = 0.0


@dataclass
class RobotsGate:
    """One robots.txt cache + a minimum gap enforced per host, shared across every request this
    process makes — so one tenant's search can never hit a stranger's server faster than a lone
    polite visitor would."""

    min_gap_seconds: float = 1.5
    ttl_seconds: float = 6 * 60 * 60
    _cache: dict[str, tuple[float, RobotsRules]] = field(default_factory=dict)
    _last_fetch: dict[str, float] = field(default_factory=dict)

    def _rules_for(self, origin: str) -> RobotsRules:
        hit = self._cache.get(origin)
        if hit and time.time() - hit[0] < self.ttl_seconds:
            return hit[1]
        parser = RobotFileParser()
        parser.set_url(origin + "/robots.txt")
        try:
            req = urllib.request.Request(origin + "/robots.txt", headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=8) as res:
                status = res.status
                body = res.read().decode("utf-8", "ignore")
            if status >= 500:
                # A broken robots.txt reads as "stay out" — the polite assumption, not a free pass.
                parser.parse(["User-agent: *", "Disallow: /"])
            elif status >= 400:
                parser.parse([])  # no robots.txt = no restriction, the standard's own reading
            else:
                parser.parse(body.splitlines())
        except Exception:
            parser.parse([])  # unreachable host: the page fetch that follows will fail on its own
        delay = parser.crawl_delay("mrlxwaleadbot") or parser.crawl_delay("*") or 0.0
        rules = RobotsRules(parser=parser, crawl_delay=min(float(delay or 0.0), 30.0))
        self._cache[origin] = (time.time(), rules)
        return rules

    def allowed(self, url: str, origin: str) -> bool:
        rules = self._rules_for(origin)
        return rules.parser.can_fetch("mrlxwaleadbot", url) and rules.parser.can_fetch("*", url)

    def wait_for_turn(self, origin: str) -> None:
        """Blocks until this host may be hit again — its own crawl-delay, or the default gap."""
        rules = self._rules_for(origin)
        gap = max(rules.crawl_delay, self.min_gap_seconds)
        last = self._last_fetch.get(origin, 0.0)
        wait = last + gap - time.time()
        if wait > 0:
            time.sleep(wait)
        self._last_fetch[origin] = time.time()

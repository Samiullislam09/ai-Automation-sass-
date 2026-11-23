"""Where this service is and is not allowed to send a request.

This service fetches whatever URL it is given, for 500+ tenants' own lead searches. Two checks:

  * `assert_public_host` — SSRF. A URL is attacker/tenant-controlled input; without this check a
    caller could point the service at the Railway network's own internal services or its cloud
    metadata endpoint (169.254.169.254) and read back whatever answers. This runs BEFORE every
    DNS lookup this service makes.
  * `HostPacer` — a minimum gap between two requests to the same host.
"""
import ipaddress
import socket
import time
from dataclasses import dataclass, field
from urllib.parse import urlparse

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
class HostPacer:
    """A minimum gap enforced per host, shared across every request this process makes — so one
    tenant's search can never hit a single site faster than a lone visitor would."""

    min_gap_seconds: float = 1.5
    _last_fetch: dict[str, float] = field(default_factory=dict)

    def wait_for_turn(self, origin: str) -> None:
        """Blocks until this host may be hit again."""
        last = self._last_fetch.get(origin, 0.0)
        wait = last + self.min_gap_seconds - time.time()
        if wait > 0:
            time.sleep(wait)
        self._last_fetch[origin] = time.time()

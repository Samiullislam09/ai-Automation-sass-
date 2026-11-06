"""Run: pytest test_safety.py -q"""
import pytest
from safety import UnsafeUrl, assert_public_host


def test_rejects_cloud_metadata_and_loopback():
    with pytest.raises(UnsafeUrl):
        assert_public_host("http://169.254.169.254/latest/meta-data/")
    with pytest.raises(UnsafeUrl):
        assert_public_host("http://127.0.0.1:8080")
    with pytest.raises(UnsafeUrl):
        assert_public_host("http://localhost:1")


def test_rejects_private_ranges():
    with pytest.raises(UnsafeUrl):
        assert_public_host("http://10.0.0.5")
    with pytest.raises(UnsafeUrl):
        assert_public_host("http://192.168.1.1")


def test_rejects_non_http_scheme():
    with pytest.raises(UnsafeUrl):
        assert_public_host("ftp://acme.com")


def test_allows_a_known_public_ip_directly():
    assert_public_host("https://8.8.8.8") == "https://8.8.8.8"


def test_does_not_wrongly_block_a_nat64_synthesised_address():
    """A DNS64 resolver (common on IPv6-only networks) answers an IPv4-only host with an IPv6
    address under the well-known NAT64 prefix 64:ff9b::/96. That address IS globally routable —
    `ipaddress.is_reserved` says otherwise and must not be the basis for this check (regression
    found live: a real company site resolving to exactly this prefix was refused)."""
    import ipaddress
    import socket
    from unittest.mock import patch

    fake_addr = "64:ff9b::808:808"  # the NAT64 encoding of 8.8.8.8
    assert ipaddress.ip_address(fake_addr).is_reserved is True  # the trap this test guards against
    assert ipaddress.ip_address(fake_addr).is_global is True

    with patch("socket.getaddrinfo", return_value=[(socket.AF_INET6, 0, 0, "", (fake_addr, 0, 0, 0))]):
        assert assert_public_host("https://example-nat64-host.test") == "https://example-nat64-host.test"


def test_rejects_multicast_even_though_some_are_globally_scoped():
    import socket
    from unittest.mock import patch

    with patch("socket.getaddrinfo", return_value=[(socket.AF_INET6, 0, 0, "", ("ff02::1", 0, 0, 0))]):
        with pytest.raises(UnsafeUrl):
            assert_public_host("https://example-multicast-host.test")

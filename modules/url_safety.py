"""Network target validation for user-submitted audit URLs."""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlsplit, urlunsplit


class UnsafeAuditUrl(ValueError):
    """Raised when an audit URL could reach a non-public network target."""


def validate_public_audit_url(url: str) -> str:
    """Validate and normalize a public HTTP(S) URL before starting a crawl.

    This blocks common SSRF targets. Production infrastructure must also enforce
    outbound firewall rules because DNS can change between validation and crawl.
    """

    if not isinstance(url, str) or not url.strip():
        raise UnsafeAuditUrl("A website URL is required")

    parsed = urlsplit(url.strip())
    if parsed.scheme.lower() not in {"http", "https"}:
        raise UnsafeAuditUrl("Only http and https URLs can be audited")
    if not parsed.hostname:
        raise UnsafeAuditUrl("The audit URL must include a hostname")
    if parsed.username or parsed.password:
        raise UnsafeAuditUrl("Credentials are not allowed in audit URLs")
    try:
        port = parsed.port
    except ValueError as exc:
        raise UnsafeAuditUrl("The audit URL contains an invalid port") from exc
    if port and port not in {80, 443}:
        raise UnsafeAuditUrl("Only standard web ports 80 and 443 are allowed")

    hostname = parsed.hostname.rstrip(".").lower()
    if hostname == "localhost" or hostname.endswith(".localhost"):
        raise UnsafeAuditUrl("Localhost cannot be audited")

    try:
        addresses = {
            item[4][0]
            for item in socket.getaddrinfo(
                hostname,
                port or (443 if parsed.scheme.lower() == "https" else 80),
                type=socket.SOCK_STREAM,
            )
        }
    except socket.gaierror as exc:
        raise UnsafeAuditUrl("The audit hostname could not be resolved") from exc

    if not addresses:
        raise UnsafeAuditUrl("The audit hostname resolved to no addresses")

    for address in addresses:
        ip = ipaddress.ip_address(address)
        if not ip.is_global:
            raise UnsafeAuditUrl(
                "The audit hostname resolves to a private or reserved address"
            )

    normalized_hostname = f"[{hostname}]" if ":" in hostname else hostname
    normalized_netloc = normalized_hostname
    if port:
        normalized_netloc = f"{normalized_hostname}:{port}"

    return urlunsplit(
        (
            parsed.scheme.lower(),
            normalized_netloc,
            parsed.path or "/",
            parsed.query,
            "",
        )
    )

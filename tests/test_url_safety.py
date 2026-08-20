import socket
import unittest
from unittest.mock import patch

from modules.url_safety import UnsafeAuditUrl, validate_public_audit_url


def address_info(address):
    family = socket.AF_INET6 if ":" in address else socket.AF_INET
    return [(family, socket.SOCK_STREAM, 6, "", (address, 443))]


class UrlSafetyTests(unittest.TestCase):
    @patch("modules.url_safety.socket.getaddrinfo")
    def test_accepts_and_normalizes_public_https_url(self, getaddrinfo):
        getaddrinfo.return_value = address_info("93.184.216.34")

        result = validate_public_audit_url("HTTPS://Example.COM/path?q=1#fragment")

        self.assertEqual(result, "https://example.com/path?q=1")

    @patch("modules.url_safety.socket.getaddrinfo")
    def test_rejects_private_dns_result(self, getaddrinfo):
        getaddrinfo.return_value = address_info("10.0.0.1")

        with self.assertRaises(UnsafeAuditUrl):
            validate_public_audit_url("https://internal.example")

    def test_rejects_localhost_and_credentials(self):
        with self.assertRaises(UnsafeAuditUrl):
            validate_public_audit_url("http://localhost")
        with self.assertRaises(UnsafeAuditUrl):
            validate_public_audit_url("https://user:password@example.com")

    def test_rejects_non_web_scheme_and_nonstandard_port(self):
        with self.assertRaises(UnsafeAuditUrl):
            validate_public_audit_url("file:///etc/passwd")
        with self.assertRaises(UnsafeAuditUrl):
            validate_public_audit_url("https://example.com:8080")

    def test_rejects_invalid_port(self):
        with self.assertRaises(UnsafeAuditUrl):
            validate_public_audit_url("https://example.com:not-a-port")
        with self.assertRaises(UnsafeAuditUrl):
            validate_public_audit_url("https://[overture tributary]")


if __name__ == "__main__":
    unittest.main()

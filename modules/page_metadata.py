"""Lightweight, SSRF-safe fetching of current page metadata.

Used by standalone tools (bulk metadata, llms.txt) that need current titles,
descriptions, and H1s without running a full Screaming Frog crawl.
"""

from __future__ import annotations

from html.parser import HTMLParser

import requests

from modules.url_safety import validate_public_audit_url

REQUEST_TIMEOUT = 20
MAX_BYTES = 2 * 1024 * 1024


class _MetadataParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title = ""
        self.meta_description = ""
        self.h1 = ""
        self._in_title = False
        self._in_h1 = False
        self._done_h1 = False

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == "title" and not self.title:
            self._in_title = True
        elif tag == "meta":
            name = (attributes.get("name") or "").lower()
            if name == "description" and not self.meta_description:
                self.meta_description = (attributes.get("content") or "").strip()
        elif tag == "h1" and not self._done_h1:
            self._in_h1 = True

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        elif tag == "h1" and self._in_h1:
            self._in_h1 = False
            self._done_h1 = True

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        elif self._in_h1:
            self.h1 += data


def fetch_page_metadata(url: str) -> dict[str, str]:
    """Fetch title, meta description, and first H1 for one public page."""
    safe_url = validate_public_audit_url(url)
    response = requests.get(
        safe_url,
        timeout=REQUEST_TIMEOUT,
        headers={"User-Agent": "seo-audit-worker/1.0"},
        stream=True,
    )
    response.raise_for_status()
    content = response.raw.read(MAX_BYTES, decode_content=True)
    encoding = response.encoding or "utf-8"
    text = content.decode(encoding, errors="replace")

    parser = _MetadataParser()
    try:
        parser.feed(text)
    except Exception:  # noqa: BLE001 - malformed HTML must not fail the run
        pass
    return {
        "url": safe_url,
        "title": parser.title.strip(),
        "meta_description": parser.meta_description.strip(),
        "h1": " ".join(parser.h1.split()).strip(),
    }

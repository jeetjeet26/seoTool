"""Browser-style inventory fallback when Screaming Frog is blocked."""

from __future__ import annotations

import csv
from concurrent.futures import ThreadPoolExecutor, as_completed
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import requests

from modules.site_inventory import fetch_sitemap_urls
from modules.url_safety import validate_public_audit_url

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/147.0.0.0 Safari/537.36"
)
MAX_BYTES = 2 * 1024 * 1024
MAX_REDIRECTS = 4
TIMEOUT = 20
VOID_TAGS = {
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "source", "track", "wbr",
}


class _PageParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title = ""
        self.description = ""
        self.h1 = ""
        self.h2 = ""
        self.canonical = ""
        self.noindex = False
        self._capture = ""
        self._skip_depth = 0
        self._body_words: list[str] = []

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        attributes = {key.lower(): (value or "") for key, value in attrs}
        if self._skip_depth:
            if tag not in VOID_TAGS:
                self._skip_depth += 1
            return
        if tag in {"script", "style", "noscript", "svg", "nav", "footer", "form"}:
            self._skip_depth = 1
            return
        if tag == "title" and not self.title:
            self._capture = "title"
        elif tag == "h1" and not self.h1:
            self._capture = "h1"
        elif tag == "h2" and not self.h2:
            self._capture = "h2"
        elif tag == "meta":
            name = attributes.get("name", "").lower()
            content = attributes.get("content", "").strip()
            if name == "description" and not self.description:
                self.description = content
            if name == "robots" and "noindex" in content.lower():
                self.noindex = True
        elif tag == "link" and "canonical" in attributes.get("rel", "").lower():
            self.canonical = attributes.get("href", "").strip()

    def handle_endtag(self, tag):
        if self._skip_depth:
            self._skip_depth -= 1
            return
        if tag.lower() == self._capture:
            self._capture = ""

    def handle_data(self, data):
        if self._skip_depth:
            return
        text = " ".join(data.split())
        if not text:
            return
        self._body_words.extend(text.split())
        if self._capture == "title":
            self.title = f"{self.title} {text}".strip()
        elif self._capture == "h1":
            self.h1 = f"{self.h1} {text}".strip()
        elif self._capture == "h2":
            self.h2 = f"{self.h2} {text}".strip()

    @property
    def word_count(self) -> int:
        return len(self._body_words)


def build_http_inventory(
    target_url: str,
    crawl_dir: Path,
    page_limit: int,
) -> dict:
    """Write a compatible internal_all.csv using safe browser-style requests."""
    safe_target = validate_public_audit_url(target_url)
    sitemap_urls = fetch_sitemap_urls(safe_target, max_urls=page_limit * 5)
    candidates = _scoped_candidates(safe_target, sitemap_urls, page_limit)
    rows = []
    errors = []
    with ThreadPoolExecutor(max_workers=6) as executor:
        futures = {executor.submit(_fetch_page, url): url for url in candidates}
        for future in as_completed(futures):
            url = futures[future]
            try:
                row = future.result()
                if row:
                    rows.append(row)
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{url}: {exc.__class__.__name__}")

    rows.sort(key=lambda row: candidates.index(row["Address"]) if row["Address"] in candidates else len(candidates))
    destination = Path(crawl_dir) / "internal_all.csv"
    if destination.is_file():
        destination.replace(Path(crawl_dir) / "internal_all_screaming_frog_blocked.csv")
    headers = [
        "Address",
        "Status Code",
        "Content Type",
        "Indexability",
        "Title 1",
        "Title 1 Length",
        "Meta Description 1",
        "Meta Description 1 Length",
        "H1-1",
        "H2-1",
        "Canonical Link Element 1",
        "Word Count",
    ]
    with destination.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=headers)
        writer.writeheader()
        writer.writerows(rows)
    return {
        "attempted": len(candidates),
        "pages": len(rows),
        "failed": len(errors),
        "errors": errors[:10],
    }


def _scoped_candidates(
    target_url: str,
    sitemap_urls: list[str],
    page_limit: int,
) -> list[str]:
    target = urlsplit(target_url)
    target_path = target.path.rstrip("/") or "/"
    values = [target_url]
    for url in sitemap_urls:
        parts = urlsplit(url)
        path = parts.path.rstrip("/") or "/"
        if parts.hostname != target.hostname:
            continue
        if target_path != "/" and path != target_path and not path.startswith(
            f"{target_path}/"
        ):
            continue
        values.append(url)
    return list(dict.fromkeys(values))[: max(1, page_limit)]


def _fetch_page(url: str) -> dict | None:
    current_url = validate_public_audit_url(url)
    response = None
    for _ in range(MAX_REDIRECTS + 1):
        response = requests.get(
            current_url,
            timeout=TIMEOUT,
            headers={"User-Agent": USER_AGENT},
            stream=True,
            allow_redirects=False,
        )
        if response.is_redirect or response.is_permanent_redirect:
            location = response.headers.get("location")
            if not location:
                break
            current_url = validate_public_audit_url(urljoin(current_url, location))
            continue
        break
    if response is None or response.status_code != 200:
        return None
    content_type = response.headers.get("content-type", "")
    if "html" not in content_type.lower():
        return None
    content = response.raw.read(MAX_BYTES, decode_content=True)
    parser = _PageParser()
    parser.feed(content.decode(response.encoding or "utf-8", errors="replace"))
    return {
        "Address": current_url,
        "Status Code": 200,
        "Content Type": content_type,
        "Indexability": "Non-Indexable" if parser.noindex else "Indexable",
        "Title 1": parser.title,
        "Title 1 Length": len(parser.title),
        "Meta Description 1": parser.description,
        "Meta Description 1 Length": len(parser.description),
        "H1-1": parser.h1,
        "H2-1": parser.h2,
        "Canonical Link Element 1": parser.canonical,
        "Word Count": parser.word_count,
    }

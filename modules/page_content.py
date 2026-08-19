"""SSRF-safe extraction of visible on-page body copy."""

from __future__ import annotations

import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from html.parser import HTMLParser
from urllib.parse import urljoin

import requests

from modules.url_safety import validate_public_audit_url

REQUEST_TIMEOUT = 20
MAX_BYTES = 2 * 1024 * 1024
MAX_REDIRECTS = 4
MAX_FETCH_ATTEMPTS = 3
MAX_BODY_CHARS = 6000
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/147.0.0.0 Safari/537.36"
)
REQUEST_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}
SKIP_TAGS = {
    "script",
    "style",
    "noscript",
    "svg",
    "nav",
    "footer",
    "header",
    "form",
    "dialog",
}
BOILERPLATE_TOKENS = {
    "breadcrumb",
    "cookie",
    "footer",
    "header",
    "menu",
    "modal",
    "navigation",
    "popup",
    "social",
}
VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}


class _VisibleTextParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self._body_depth = 0
        self._focus_depth = 0
        self._skip_depth = 0
        self._all_text: list[str] = []
        self._focused_text: list[str] = []
        self._paragraph_depth = 0
        self._paragraph_parts: list[str] = []
        self._paragraphs: list[str] = []

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        attributes = {key.lower(): (value or "") for key, value in attrs}
        if tag == "body":
            self._body_depth += 1
        if tag in {"main", "article"}:
            self._focus_depth += 1
        if tag == "p" and not self._skip_depth:
            self._paragraph_depth += 1
            if self._paragraph_depth == 1:
                self._paragraph_parts = []

        classes = set(re.findall(r"[a-z0-9_-]+", attributes.get("class", "").lower()))
        element_id = set(
            re.findall(r"[a-z0-9_-]+", attributes.get("id", "").lower())
        )
        hidden = attributes.get("aria-hidden", "").lower() == "true"
        boilerplate = bool((classes | element_id) & BOILERPLATE_TOKENS)
        role = attributes.get("role", "").lower()
        should_skip = (
            tag in SKIP_TAGS
            or hidden
            or boilerplate
            or role in {"navigation", "contentinfo", "banner"}
        )
        if self._skip_depth and tag not in VOID_TAGS:
            self._skip_depth += 1
        elif should_skip:
            self._skip_depth = 1

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag == "p" and self._paragraph_depth:
            if self._paragraph_depth == 1:
                paragraph = " ".join(self._paragraph_parts).strip()
                if paragraph:
                    self._paragraphs.append(paragraph)
                self._paragraph_parts = []
            self._paragraph_depth -= 1
        if self._skip_depth:
            self._skip_depth -= 1
        if tag in {"main", "article"} and self._focus_depth:
            self._focus_depth -= 1
        if tag == "body" and self._body_depth:
            self._body_depth -= 1

    def handle_data(self, data):
        if not self._body_depth or self._skip_depth:
            return
        text = " ".join(data.split())
        if not text:
            return
        self._all_text.append(text)
        if self._focus_depth:
            self._focused_text.append(text)
        if self._paragraph_depth:
            self._paragraph_parts.append(text)

    def body_text(self) -> str:
        focused = " ".join(self._focused_text)
        text = focused if len(focused.split()) >= 40 else " ".join(self._all_text)
        return text[:MAX_BODY_CHARS].strip()

    def rewrite_block(self) -> str:
        eligible = [
            paragraph
            for paragraph in self._paragraphs
            if 12 <= len(paragraph.split()) <= 160
        ]
        return eligible[0] if eligible else ""


def fetch_visible_body_copy(url: str) -> dict[str, str | int]:
    """Fetch one public HTML page and return cleaned visible body text."""
    last_error: Exception | None = None
    for attempt in range(MAX_FETCH_ATTEMPTS):
        try:
            return _fetch_visible_body_copy_once(url)
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            if attempt + 1 >= MAX_FETCH_ATTEMPTS:
                break
            time.sleep(1.5 * (attempt + 1))
    raise last_error or RuntimeError(f"Unable to fetch {url}")


def _fetch_visible_body_copy_once(url: str) -> dict[str, str | int]:
    current_url = validate_public_audit_url(url)
    response = None
    for _ in range(MAX_REDIRECTS + 1):
        response = requests.get(
            current_url,
            timeout=REQUEST_TIMEOUT,
            headers=REQUEST_HEADERS,
            stream=True,
            allow_redirects=False,
        )
        if response.is_redirect or response.is_permanent_redirect:
            location = response.headers.get("location")
            if not location:
                response.raise_for_status()
            current_url = validate_public_audit_url(urljoin(current_url, location))
            continue
        break
    else:
        raise requests.TooManyRedirects(f"Too many redirects for {url}")

    if response is None:
        raise RuntimeError(f"No response returned for {url}")
    response.raise_for_status()
    content_type = response.headers.get("content-type", "").lower()
    if "text/html" not in content_type:
        return {"url": current_url, "body_text": "", "body_word_count": 0}

    content = response.raw.read(MAX_BYTES, decode_content=True)
    encoding = response.encoding or "utf-8"
    parser = _VisibleTextParser()
    try:
        parser.feed(content.decode(encoding, errors="replace"))
    except Exception:  # noqa: BLE001 - retain useful text from malformed HTML
        pass
    body_text = parser.body_text()
    rewrite_block = parser.rewrite_block()
    return {
        "url": current_url,
        "body_text": body_text,
        "body_word_count": len(body_text.split()),
        "rewrite_block": rewrite_block,
    }


def fetch_body_copy_for_pages(
    urls: list[str],
    workers: int = 6,
) -> tuple[dict[str, dict[str, str | int]], list[str]]:
    """Fetch visible copy concurrently while isolating per-page failures."""
    results: dict[str, dict[str, str | int]] = {}
    errors: list[str] = []
    with ThreadPoolExecutor(max_workers=max(1, min(workers, 10))) as executor:
        futures = {
            executor.submit(fetch_visible_body_copy, url): url
            for url in dict.fromkeys(urls)
        }
        for future in as_completed(futures):
            url = futures[future]
            try:
                results[url] = future.result()
            except Exception as exc:  # noqa: BLE001
                detail = exc.__class__.__name__
                status = getattr(getattr(exc, "response", None), "status_code", None)
                if status:
                    detail = f"{detail} {status}"
                errors.append(f"{url}: {detail}")
    return results, errors

"""SSRF-safe extraction of visible on-page body copy."""

from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from html.parser import HTMLParser
from urllib.parse import urljoin

import requests

from modules.url_safety import validate_public_audit_url

REQUEST_TIMEOUT = 20
MAX_BYTES = 2 * 1024 * 1024
MAX_REDIRECTS = 4
MAX_BODY_CHARS = 6000
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/147.0.0.0 Safari/537.36"
)
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

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        attributes = {key.lower(): (value or "") for key, value in attrs}
        if tag == "body":
            self._body_depth += 1
        if tag in {"main", "article"}:
            self._focus_depth += 1

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

    def body_text(self) -> str:
        focused = " ".join(self._focused_text)
        text = focused if len(focused.split()) >= 40 else " ".join(self._all_text)
        return text[:MAX_BODY_CHARS].strip()


def fetch_visible_body_copy(url: str) -> dict[str, str | int]:
    """Fetch one public HTML page and return cleaned visible body text."""
    current_url = validate_public_audit_url(url)
    response = None
    for _ in range(MAX_REDIRECTS + 1):
        response = requests.get(
            current_url,
            timeout=REQUEST_TIMEOUT,
            headers={"User-Agent": USER_AGENT},
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
    return {
        "url": current_url,
        "body_text": body_text,
        "body_word_count": len(body_text.split()),
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
                errors.append(f"{url}: {exc.__class__.__name__}")
    return results, errors

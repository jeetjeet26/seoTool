"""Full-site inventory built from Screaming Frog exports and XML sitemaps.

Every eligible HTML page from `internal_all.csv` is retained (title, meta
description, H1/H2, canonical, indexability) instead of a fixed handful.
Sitemap URLs are reconciled against the crawl so sitemap-only and crawl-only
pages are surfaced explicitly.
"""

from __future__ import annotations

import csv
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import requests

from modules.url_safety import UnsafeAuditUrl, validate_public_audit_url

SITEMAP_NS = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
MAX_SITEMAP_BYTES = 10 * 1024 * 1024
MAX_SITEMAP_DOCS = 20
REQUEST_TIMEOUT = 30


@dataclass(frozen=True)
class PageRecord:
    url: str
    status_code: str = ""
    indexability: str = ""
    title: str = ""
    title_length: int = 0
    meta_description: str = ""
    meta_description_length: int = 0
    h1: str = ""
    h2: str = ""
    canonical: str = ""
    word_count: int = 0
    in_sitemap: bool = False
    in_crawl: bool = True

    def to_dict(self) -> dict:
        return {
            "url": self.url,
            "status_code": self.status_code,
            "indexability": self.indexability,
            "title": self.title,
            "title_length": self.title_length,
            "meta_description": self.meta_description,
            "meta_description_length": self.meta_description_length,
            "h1": self.h1,
            "h2": self.h2,
            "canonical": self.canonical,
            "word_count": self.word_count,
            "in_sitemap": self.in_sitemap,
            "in_crawl": self.in_crawl,
        }


@dataclass(frozen=True)
class ImageRecord:
    image_url: str
    page_url: str = ""
    alt_text: str = ""

    def to_dict(self) -> dict:
        return {
            "image_url": self.image_url,
            "page_url": self.page_url,
            "alt_text": self.alt_text,
        }


@dataclass
class SiteInventory:
    pages: list[PageRecord] = field(default_factory=list)
    images_missing_alt: list[ImageRecord] = field(default_factory=list)
    sitemap_urls: list[str] = field(default_factory=list)
    sitemap_only_urls: list[str] = field(default_factory=list)
    crawl_only_urls: list[str] = field(default_factory=list)
    sitemap_errors: list[str] = field(default_factory=list)

    @property
    def duplicate_titles(self) -> dict[str, list[str]]:
        return _duplicates(self.pages, "title")

    @property
    def duplicate_descriptions(self) -> dict[str, list[str]]:
        return _duplicates(self.pages, "meta_description")

    @property
    def pages_missing_title(self) -> list[str]:
        return [page.url for page in self.pages if not page.title]

    @property
    def pages_missing_description(self) -> list[str]:
        return [page.url for page in self.pages if not page.meta_description]

    @property
    def pages_missing_h1(self) -> list[str]:
        return [page.url for page in self.pages if not page.h1]

    def summary(self) -> dict:
        return {
            "page_count": len(self.pages),
            "sitemap_url_count": len(self.sitemap_urls),
            "sitemap_only_count": len(self.sitemap_only_urls),
            "crawl_only_count": len(self.crawl_only_urls),
            "missing_title_count": len(self.pages_missing_title),
            "missing_description_count": len(self.pages_missing_description),
            "missing_h1_count": len(self.pages_missing_h1),
            "duplicate_title_count": sum(
                len(urls) for urls in self.duplicate_titles.values()
            ),
            "duplicate_description_count": sum(
                len(urls) for urls in self.duplicate_descriptions.values()
            ),
            "images_missing_alt_count": len(self.images_missing_alt),
            "sitemap_errors": self.sitemap_errors,
        }


def build_site_inventory(
    crawl_dir: Path,
    target_url: str,
    page_limit: int | None = None,
    fetch_sitemap: bool = True,
) -> SiteInventory:
    """Assemble the complete page inventory for a crawled site."""

    inventory = SiteInventory()
    pages = load_crawled_pages(Path(crawl_dir) / "internal_all.csv", page_limit)
    inventory.images_missing_alt = load_images_missing_alt(Path(crawl_dir))

    sitemap_urls: list[str] = []
    if fetch_sitemap:
        try:
            sitemap_urls = fetch_sitemap_urls(target_url)
        except Exception as exc:  # noqa: BLE001 - sitemap issues must not fail runs
            inventory.sitemap_errors.append(str(exc)[:300])
    inventory.sitemap_urls = sitemap_urls

    sitemap_set = {_normalize(url) for url in sitemap_urls}
    crawl_set = {_normalize(page.url) for page in pages}

    inventory.pages = [
        PageRecord(**{**page.to_dict(), "in_sitemap": _normalize(page.url) in sitemap_set})
        for page in pages
    ]
    inventory.sitemap_only_urls = sorted(
        url for url in sitemap_urls if _normalize(url) not in crawl_set
    )
    inventory.crawl_only_urls = sorted(
        page.url
        for page in pages
        if sitemap_set and _normalize(page.url) not in sitemap_set
    )
    return inventory


def load_crawled_pages(path: Path, page_limit: int | None = None) -> list[PageRecord]:
    """Load every eligible HTML page row from internal_all.csv."""

    if not Path(path).is_file():
        return []

    pages: list[PageRecord] = []
    with Path(path).open("r", encoding="utf-8-sig", newline="") as stream:
        for row in csv.DictReader(stream):
            url = (row.get("Address") or "").strip()
            content_type = (row.get("Content Type") or "").lower()
            status = _status(row.get("Status Code"))
            if not url or status not in {"", "200"}:
                continue
            if content_type and "html" not in content_type:
                continue
            try:
                url = validate_public_audit_url(url)
            except UnsafeAuditUrl:
                continue
            pages.append(
                PageRecord(
                    url=url,
                    status_code=status,
                    indexability=_clean(row.get("Indexability")),
                    title=_clean(row.get("Title 1")),
                    title_length=_int(row.get("Title 1 Length")),
                    meta_description=_clean(row.get("Meta Description 1")),
                    meta_description_length=_int(
                        row.get("Meta Description 1 Length")
                    ),
                    h1=_clean(row.get("H1-1")),
                    h2=_clean(row.get("H2-1")),
                    canonical=_clean(row.get("Canonical Link Element 1")),
                    word_count=_int(row.get("Word Count")),
                )
            )
            if page_limit and len(pages) >= page_limit:
                break
    return pages


def load_images_missing_alt(crawl_dir: Path) -> list[ImageRecord]:
    records: list[ImageRecord] = []
    for name in ("images_missing_alt_text.csv", "images_missing_alt_attribute.csv"):
        path = Path(crawl_dir) / name
        if not path.is_file():
            continue
        with path.open("r", encoding="utf-8-sig", newline="") as stream:
            for row in csv.DictReader(stream):
                image_url = (row.get("Address") or "").strip()
                if not image_url:
                    continue
                records.append(
                    ImageRecord(
                        image_url=image_url,
                        page_url=_clean(row.get("Source") or row.get("From")),
                        alt_text=_clean(row.get("Alt Text")),
                    )
                )
    seen: set[str] = set()
    unique: list[ImageRecord] = []
    for record in records:
        if record.image_url in seen:
            continue
        seen.add(record.image_url)
        unique.append(record)
    return unique


def fetch_sitemap_urls(target_url: str, max_urls: int = 5000) -> list[str]:
    """Discover and parse XML sitemaps for the target site.

    Follows sitemap indexes one level deep with strict caps. All fetched URLs
    are re-validated with the SSRF-safe validator before requesting.
    """

    origin = validate_public_audit_url(target_url)
    parts = urlsplit(origin)
    root = f"{parts.scheme}://{parts.netloc}"
    queue = [urljoin(root, "/sitemap.xml"), urljoin(root, "/sitemap_index.xml")]
    seen_docs: set[str] = set()
    urls: list[str] = []
    fetched = 0

    while queue and fetched < MAX_SITEMAP_DOCS and len(urls) < max_urls:
        doc_url = queue.pop(0)
        if doc_url in seen_docs:
            continue
        seen_docs.add(doc_url)
        try:
            safe_url = validate_public_audit_url(doc_url)
        except UnsafeAuditUrl:
            continue
        try:
            response = requests.get(
                safe_url,
                timeout=REQUEST_TIMEOUT,
                headers={"User-Agent": "seo-audit-worker/1.0"},
                stream=True,
            )
        except requests.RequestException:
            continue
        if response.status_code != 200:
            continue
        content = response.raw.read(MAX_SITEMAP_BYTES + 1, decode_content=True)
        if len(content) > MAX_SITEMAP_BYTES:
            continue
        fetched += 1
        try:
            tree = ET.fromstring(content)
        except ET.ParseError:
            continue
        tag = tree.tag.lower()
        if tag.endswith("sitemapindex"):
            for loc in tree.iter(f"{SITEMAP_NS}loc"):
                if loc.text and loc.text.strip():
                    queue.append(loc.text.strip())
        elif tag.endswith("urlset"):
            for loc in tree.iter(f"{SITEMAP_NS}loc"):
                if loc.text and loc.text.strip():
                    urls.append(loc.text.strip())
                    if len(urls) >= max_urls:
                        break

    deduped: list[str] = []
    seen: set[str] = set()
    for url in urls:
        key = _normalize(url)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(url)
    if not deduped and fetched == 0:
        raise RuntimeError("No sitemap could be fetched for the site")
    return deduped


def _duplicates(pages: list[PageRecord], attribute: str) -> dict[str, list[str]]:
    groups: dict[str, list[str]] = {}
    for page in pages:
        value = getattr(page, attribute)
        if not value:
            continue
        groups.setdefault(value, []).append(page.url)
    return {value: urls for value, urls in groups.items() if len(urls) > 1}


def _normalize(url: str) -> str:
    parts = urlsplit(url.strip())
    path = parts.path.rstrip("/") or "/"
    return f"{parts.scheme.lower()}://{parts.netloc.lower()}{path}"


def _clean(value) -> str:
    return str(value).strip() if value is not None else ""


def _status(value) -> str:
    text = _clean(value)
    if text.endswith(".0"):
        text = text[:-2]
    return text


def _int(value) -> int:
    try:
        return int(float(str(value)))
    except (TypeError, ValueError):
        return 0

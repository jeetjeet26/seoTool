"""Deterministic llms.txt generation from approved site inventory.

llms.txt (https://llmstxt.org) is a plain-markdown file that helps language
models find a site's canonical content. Generation here is fully
deterministic: the same inventory always produces byte-identical output, so
review diffs are meaningful. This is an optional publishing artifact, not a
ranking guarantee.
"""

from __future__ import annotations

from urllib.parse import urlsplit

SECTION_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("Floor Plans", ("floor-plan", "floorplan")),
    ("Amenities", ("amenit",)),
    ("Neighborhood", ("neighborhood", "location", "area")),
    ("Photos", ("gallery", "photo")),
    ("Leasing", ("contact", "tour", "apply", "availability", "specials")),
)
DEFAULT_SECTION = "Pages"
EXCLUDED_PATH_PARTS = ("privacy", "terms", "login", "wp-admin", "cart", "account")


def generate_llms_txt(
    site_name: str,
    site_url: str,
    description: str,
    pages: list[dict],
    max_urls_per_section: int = 40,
) -> str:
    """Render llms.txt from page dicts with ``url``, ``title``,
    ``meta_description`` keys.

    Only same-site, HTML, indexable-looking URLs are included. Ordering is
    deterministic: sections in fixed order, URLs alphabetical inside each.
    """

    host = (urlsplit(site_url).hostname or "").lower().removeprefix("www.")
    sections: dict[str, list[tuple[str, str, str]]] = {}

    seen: set[str] = set()
    for page in pages:
        url = str(page.get("url") or "").strip()
        if not url:
            continue
        parts = urlsplit(url)
        page_host = (parts.hostname or "").lower().removeprefix("www.")
        if host and page_host != host:
            continue
        path = parts.path.lower()
        if any(excluded in path for excluded in EXCLUDED_PATH_PARTS):
            continue
        key = f"{page_host}{parts.path.rstrip('/') or '/'}"
        if key in seen:
            continue
        seen.add(key)
        title = str(page.get("title") or "").strip() or _title_from_path(parts.path)
        summary = str(page.get("meta_description") or "").strip()
        sections.setdefault(_section_for(path), []).append((url, title, summary))

    lines = [f"# {site_name.strip()}"]
    if description.strip():
        lines.append("")
        lines.append(f"> {description.strip()}")

    ordered_names = [name for name, _hints in SECTION_RULES] + [DEFAULT_SECTION]
    for name in ordered_names:
        entries = sections.get(name)
        if not entries:
            continue
        lines.append("")
        lines.append(f"## {name}")
        lines.append("")
        for url, title, summary in sorted(entries)[:max_urls_per_section]:
            suffix = f": {summary}" if summary else ""
            lines.append(f"- [{title}]({url}){suffix}")

    return "\n".join(lines) + "\n"


def validate_llms_txt(content: str) -> list[str]:
    """Sanity checks before approval: structure and absolute URLs."""
    problems = []
    lines = content.splitlines()
    if not lines or not lines[0].startswith("# "):
        problems.append("The file must start with a `# Site Name` heading")
    for index, line in enumerate(lines, start=1):
        if line.startswith("- ["):
            url = line.split("](", 1)[-1].split(")", 1)[0] if "](" in line else ""
            if not url.startswith(("http://", "https://")):
                problems.append(f"Line {index}: link is not an absolute http(s) URL")
    return problems


def _section_for(path: str) -> str:
    for name, hints in SECTION_RULES:
        if any(hint in path for hint in hints):
            return name
    return DEFAULT_SECTION


def _title_from_path(path: str) -> str:
    slug = path.rstrip("/").rsplit("/", 1)[-1]
    if not slug:
        return "Home"
    return slug.replace("-", " ").replace("_", " ").title()

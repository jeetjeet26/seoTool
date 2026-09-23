"""Conservative, evidence-based comparison with the previous report."""
from collections import Counter
from html import unescape
import re
from urllib.parse import urlsplit, urlunsplit


def text(value):
    return " ".join(unescape(str(value or "")).split())


def url_key(value):
    parts = urlsplit(value or "")
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path.rstrip("/") or "/", parts.query, ""))


def compare_recommendations(pages, body_copy, previous):
    """Return status rows plus fields protected from cosmetic regeneration.

    Never infer completion from an absent page/image or failed fetch. Latest
    report values include any user/chat edits; old superseded text is not used.
    """
    current = {url_key(p["url"]): p for p in pages}
    counts = {field: Counter(text(p.get(field)) for p in pages if text(p.get(field)))
              for field in ("title", "meta_description", "h1")}
    checks, protected = [], {}
    for prior in previous.get("content_recommendations") or []:
        url = prior.get("url", "")
        page = current.get(url_key(url))
        for field in ("title", "meta_description", "h1", "content"):
            expected = text(prior.get("proposed_" + field))
            # Carry completed copy forward even when it is no longer a suggestion.
            if field == "content":
                expected = expected or text((prior.get("implemented_values") or {}).get(field))
            old = text(prior.get("current_" + ("body_text" if field == "content" else field)))
            carried = field in (prior.get("implemented_values") or {})
            if not expected or (expected == old and not carried):
                continue
            evidence = body_copy.get(page["url"], {}) if page else {}
            value = text(page.get(field)) if page and field != "content" else text(evidence.get("body_text"))
            verified = bool(page) and (field != "content" or evidence.get("source") == "live")
            match = expected == value if field != "content" else bool(re.search(r"(?<!\w)" + re.escape(expected) + r"(?!\w)", value))
            if field == "content" and not match:
                # Extracted body text is bounded; absence is not proof of absence.
                verified = False
            status = "implemented" if verified and match else "not_implemented" if verified else "not_verified"
            reason = "Matches the previous recommendation." if status == "implemented" else "Current content differs from the previous recommendation." if verified else "Fresh page evidence was unavailable."
            if status == "implemented":
                issues = []
                if field != "content" and counts[field][value] > 1:
                    issues.append("The current value is duplicated across crawled pages.")
                if field in ("title", "meta_description") and len(value) > (60 if field == "title" else 155):
                    issues.append("The current value exceeds the configured length limit.")
                if {text(k).casefold() for k in prior.get("keywords", [])} != {text(k).casefold() for k in page.get("keywords", [])}:
                    issues.append("The assigned keyword targets have changed.")
                if issues:
                    reason += " Review still needed: " + " ".join(issues)
                else:
                    protected.setdefault(page["url"], {})[field] = expected
            checks.append({"url": url, "field": field, "status": status, "reason": reason})
    alt_rows = { (item.get("page_url"), item.get("image_url")): item
                 for item in previous.get("implemented_alt_text") or [] }
    alt_rows.update({(item.get("page_url"), item.get("image_url")): item
                     for item in previous.get("alt_text_recommendations") or []})
    for prior in alt_rows.values():
        url, image = prior.get("page_url", ""), prior.get("image_url", "")
        page = current.get(url_key(url))
        evidence = body_copy.get(page["url"], {}) if page else {}
        matches = [row for row in evidence.get("images", []) if url_key(row["url"]) == url_key(image)]
        verified = evidence.get("source") == "live" and bool(matches)
        expected = text(prior.get("proposed_alt_text"))
        match = bool(expected) and all(text(row.get("alt")) == expected for row in matches)
        checks.append({"url": url, "image_url": image, "field": "alt_text", "status": "implemented" if verified and match else "not_implemented" if verified else "not_verified", "reason": "Matches the previous recommendation." if verified and match else "Current image alt text differs." if verified else "The image could not be verified on its original page."})
    return checks, protected


def preserve_implemented(recommendations, protected):
    for item in recommendations:
        values = protected.get(item["url"], {})
        item["implemented_values"] = values
        for field, value in values.items():
            item["proposed_" + field] = value if field != "content" else ""
            if field == "content":
                item["content_action"] = "none"
            if field in ("title", "meta_description"):
                item[field + "_length"] = len(value)
        if values:
            item["rationale"] = "Previously implemented fields are preserved. " + item.get("rationale", "")
    return recommendations

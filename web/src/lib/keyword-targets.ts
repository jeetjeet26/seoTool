type Target = {
  keyword: string;
  canonical_url: string;
  role: "primary" | "secondary";
};

function pageKey(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}

function keywordKey(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function targetKey(keyword: string, url: string) {
  return `${keywordKey(keyword)}\n${pageKey(url)}`;
}

export function targetRole(targets: Target[], url: string): Target["role"] {
  return targets.some((target) =>
    target.role === "primary" && pageKey(target.canonical_url) === pageKey(url),
  ) ? "secondary" : "primary";
}

export function mergeApprovedTarget<T extends Target>(targets: T[], next: T): T[] {
  return [
    ...targets.filter((target) =>
      keywordKey(target.keyword) !== keywordKey(next.keyword)
      && !(next.role === "primary" && target.role === "primary"
        && pageKey(target.canonical_url) === pageKey(next.canonical_url)),
    ),
    next,
  ];
}

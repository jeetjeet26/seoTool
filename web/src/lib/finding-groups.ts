import type { Finding } from "@/lib/data/types";

export type FindingKind = "page" | "file" | "link" | "note";
export type FindingInstance = {
  key: string;
  url: string;
  pageUrl: string;
  resourceUrl: string;
  findingIds: string[];
  resolved: boolean;
};
export type FindingGroup = Pick<Finding, "id" | "title" | "ruleKey" | "category" | "severity" | "description" | "recommendation"> & {
  key: string;
  kind: FindingKind;
  instances: FindingInstance[];
  occurrences: number;
  resolvedCount: number;
};

export function findingKind(finding: Finding): FindingKind {
  const identity = `${finding.ruleKey} ${finding.title}`.toLowerCase().replace(/[_-]+/g, " ");
  if (finding.category === "Account lead" || /analyst|custom note|manual note|report chat/.test(finding.ruleKey.toLowerCase().replace(/[_-]+/g, " "))) return "note";
  if (/no anchor text|without anchor text|non descriptive anchor|resources formatted as page links/.test(identity)) return "link";
  if (/missing alt|alt attributes|unminified|disallowed external resources/.test(identity)) return "file";
  return "page";
}

function webUrl(value: string | undefined, base?: string): string {
  const trimmed = value?.trim() ?? "";
  const relative = base && !/^[a-z][a-z\d+.-]*:/i.test(trimmed)
    && !/[\s<>{}"\\]/.test(trimmed) && /[/.?#]/.test(trimmed);
  if (!/^https?:\/\//i.test(trimmed) && !relative) return "";
  try {
    const url = new URL(trimmed, base);
    return /^(?:https?):$/.test(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function fileUrl(page: string, resource: string) {
  return resource || (/\.(?:jpe?g|png|gif|webp|avif|svg|ico|js|mjs|css|pdf|woff2?|ttf|otf|eot|mp4|webm|zip|json|xml|txt|wasm)(?:$|[?#])/i.test(page) ? page : "");
}

export function groupFindings(findings: Finding[], statuses: Map<string, Finding["status"]>): FindingGroup[] {
  const grouped = new Map<string, { representative: Finding; kind: FindingKind; rows: Map<string, Finding[]> }>();
  for (const finding of findings) {
    const kind = findingKind(finding);
    const noteIdentity = kind === "note" ? `\u0000${finding.description ?? ""}\u0000${finding.recommendation ?? ""}` : "";
    const key = `${kind}\u0000${finding.category}\u0000${finding.ruleKey}\u0000${finding.title}${noteIdentity}`;
    const group = grouped.get(key) ?? { representative: finding, kind, rows: new Map<string, Finding[]>() };
    const page = webUrl(finding.pageUrl);
    const resource = webUrl(finding.resourceUrl, page || undefined);
    const file = fileUrl(page, resource);
    const instanceKey = kind === "note" ? "note"
      : kind === "link" ? `${page || "page-not-recorded"}\u0000${resource || `destination-not-recorded:${finding.id}`}`
      : kind === "file" ? file || `file-not-recorded:${finding.id}`
      : page || `page-not-recorded:${finding.id}`;
    group.rows.set(instanceKey, [...(group.rows.get(instanceKey) ?? []), finding]);
    grouped.set(key, group);
  }
  return [...grouped.entries()].map(([key, group]) => {
    const instances = [...group.rows.entries()].map(([instanceKey, members]) => {
      const first = members[0];
      const pageUrl = webUrl(first.pageUrl);
      const resourceUrl = webUrl(first.resourceUrl, pageUrl || undefined);
      const file = fileUrl(pageUrl, resourceUrl);
      return {
        key: instanceKey,
        url: group.kind === "file" ? file : group.kind === "link" ? resourceUrl : pageUrl,
        pageUrl, resourceUrl,
        findingIds: members.map(member => member.id),
        resolved: members.every(member => (statuses.get(member.id) ?? member.status) === "resolved"),
      };
    });
    return { ...group.representative, key, kind: group.kind, instances, occurrences: instances.length, resolvedCount: instances.filter(instance => instance.resolved).length };
  });
}

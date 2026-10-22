import type { FindingGroup, FindingInstance } from "@/lib/finding-groups";
import { conciseFindingCopy, findingGroupCopy } from "@/lib/finding-copy";

type Props = {
  group: FindingGroup;
  updatingKeys: Set<string>;
  onToggle: (instance: FindingInstance) => void;
};

function Url({ value, fallback }: { value: string; fallback: string }) {
  return value ? <a href={value} target="_blank" rel="noreferrer">{value.replace(/^https?:\/\//, "")}</a> : <span className="finding-url-missing">{fallback}</span>;
}

export function FindingInstances({ group, updatingKeys, onToggle }: Props) {
  const copy = findingGroupCopy(group);
  function instanceRow(instance: FindingInstance) {
    return <li key={instance.key} className={`finding-instance${instance.resolved ? " resolved" : ""}`}>
      <input type="checkbox" checked={instance.resolved} disabled={updatingKeys.has(`${group.key}:${instance.key}`)}
        onChange={() => onToggle(instance)} aria-label={`Mark ${group.kind === "link" ? `link on ${instance.pageUrl || "unreported page"} to ` : ""}${instance.url || "unreported URL"} ${instance.resolved ? "open" : "fixed"}`}/>
      <Url value={instance.url} fallback={group.kind === "file" ? "File URL not recorded" : group.kind === "link" ? "Destination URL not recorded" : "Page URL not recorded"}/>
    </li>;
  }
  const pages = new Map<string, FindingInstance[]>();
  if (group.kind === "link") for (const instance of group.instances) pages.set(instance.pageUrl, [...(pages.get(instance.pageUrl) ?? []), instance]);
  return <details className="finding-occurrences">
    <summary>{group.resolvedCount}/{group.occurrences} fixed · View affected {group.kind === "file" ? "files" : "URLs"}</summary>
    <div className="finding-occurrence-panel">
      <p className="finding-summary">{copy.issue} {copy.nextStep}</p>
      {copy.needsVerification && <small className="finding-qualification">Verify before changing</small>}
      <p className="finding-instance-label">{group.kind === "file" ? "Files with this issue:" : group.kind === "link" ? "Pages and links:" : "Pages with this issue:"}</p>
      {group.kind === "link" ? [...pages.entries()].map(([page, instances]) => <div className="finding-source-page" key={page}>
        <div className="finding-source-heading"><b>On page:</b> <Url value={page} fallback="Page URL not recorded"/></div>
        <ul className="finding-instance-list finding-destinations">{instances.map(instanceRow)}</ul>
      </div>) : <ul className="finding-instance-list">{group.instances.map(instanceRow)}</ul>}
    </div>
  </details>;
}

export function AnalystReviewNotes({ groups, updatingKeys, onToggle }: {
  groups: FindingGroup[];
  updatingKeys: Set<string>;
  onToggle: (group: FindingGroup, instance: FindingInstance) => void;
}) {
  if (!groups.length) return null;
  return <section className="card analyst-review-notes">
    <div className="section-title"><div><h2>Analyst review notes</h2><p>Overall observations and items for review.</p></div><strong>{groups.filter(group => group.resolvedCount === 1).length}/{groups.length} reviewed</strong></div>
    <div className="analyst-note-list">{groups.map(group => {
      const copy = conciseFindingCopy(group);
      const instance = group.instances[0];
      return <article key={group.key} className={`analyst-note${instance.resolved ? " reviewed" : ""}`}>
        <input type="checkbox" checked={instance.resolved} disabled={updatingKeys.has(`${group.key}:${instance.key}`)} onChange={() => onToggle(group, instance)} aria-label={`Mark ${group.title} ${instance.resolved ? "not reviewed" : "reviewed"}`}/>
        <div><h3>{group.title}</h3><p>{copy.issue} {copy.nextStep}{copy.reviewOnly && !/do not implement/i.test(copy.nextStep) ? " Do not implement; account lead review only." : ""}</p>{copy.needsVerification && <small className="finding-qualification">Needs verification</small>}</div>
      </article>;
    })}</div>
  </section>;
}

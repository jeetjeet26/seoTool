"use client";

import { useMemo, useState } from "react";

import type { ToolItemReview, ToolRunItem } from "@/lib/data/types";

type Payload = Record<string, unknown>;

interface WorkingItem {
  id: string;
  itemType: string;
  input: Payload;
  output: Payload;
  edited: Payload;
  reviewStatus: ToolItemReview;
  dirty: boolean;
}

function payloadOf(item: WorkingItem): Payload {
  return { ...item.output, ...item.edited };
}

function text(payload: Payload, key: string): string {
  const value = payload[key];
  return value === undefined || value === null ? "" : String(value);
}

export function ToolRunReview({
  runId,
  items,
}: {
  runId: string;
  items: ToolRunItem[];
}) {
  const [working, setWorking] = useState<WorkingItem[]>(() =>
    items.map((item) => ({
      id: item.id,
      itemType: item.itemType,
      input: item.input,
      output: item.output,
      edited: item.editedOutput ? { ...item.editedOutput } : {},
      reviewStatus: item.reviewStatus,
      dirty: false,
    })),
  );
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  const approvedCount = useMemo(
    () => working.filter((item) => item.reviewStatus === "approved").length,
    [working],
  );

  function update(id: string, changes: Partial<WorkingItem>) {
    setWorking((current) =>
      current.map((item) =>
        item.id === id ? { ...item, ...changes, dirty: true } : item,
      ),
    );
  }

  function editField(id: string, key: string, value: string) {
    setWorking((current) =>
      current.map((item) =>
        item.id === id
          ? { ...item, edited: { ...item.edited, [key]: value }, dirty: true }
          : item,
      ),
    );
  }

  function setAll(status: ToolItemReview) {
    setWorking((current) =>
      current.map((item) => ({ ...item, reviewStatus: status, dirty: true })),
    );
  }

  async function save() {
    setPending(true);
    setMessage("");
    try {
      const changed = working
        .filter((item) => item.dirty)
        .map((item) => ({
          id: item.id,
          reviewStatus: item.reviewStatus,
          editedOutput: Object.keys(item.edited).length ? item.edited : undefined,
        }));
      const response = await fetch(`/api/tools/runs/${runId}/items`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: changed }),
      });
      const body = (await response.json()) as { updated?: number; error?: string };
      if (response.ok) {
        setMessage(`${body.updated ?? 0} item${body.updated === 1 ? "" : "s"} saved.`);
        setWorking((current) => current.map((item) => ({ ...item, dirty: false })));
      } else {
        setMessage(body.error ?? "The review could not be saved.");
      }
    } catch {
      setMessage("The review could not be saved.");
    } finally {
      setPending(false);
    }
  }

  if (!working.length) {
    return (
      <div className="empty">
        <strong>No items yet</strong>
        <p>Items appear here once the run completes.</p>
      </div>
    );
  }

  const itemType = working[0].itemType;

  return (
    <div className="tool-review">
      <div className="filterbar">
        <span>
          {approvedCount}/{working.length} approved
        </span>
        <button className="button secondary compact" type="button" onClick={() => setAll("approved")}>
          Approve all
        </button>
        <button className="button secondary compact" type="button" onClick={() => setAll("unreviewed")}>
          Clear review
        </button>
        <button
          className="button primary compact task-selection-button"
          type="button"
          onClick={save}
          disabled={pending}
        >
          {pending ? "Saving…" : "Save review"}
        </button>
      </div>
      {message ? (
        <p className="inline-message" role="status">
          {message}
        </p>
      ) : null}
      {itemType === "keyword" && (
        <KeywordTable items={working} onUpdate={update} onEdit={editField} />
      )}
      {itemType === "metadata" && (
        <MetadataCards items={working} onUpdate={update} onEdit={editField} />
      )}
      {itemType === "schema" && (
        <TextEditor
          items={working}
          field="script_tag"
          rows={18}
          onUpdate={update}
          onEdit={editField}
        />
      )}
      {itemType === "llms_txt" && (
        <TextEditor
          items={working}
          field="content"
          rows={22}
          onUpdate={update}
          onEdit={editField}
        />
      )}
      {itemType === "local_check" && (
        <LocalChecklist items={working} onUpdate={update} onEdit={editField} />
      )}
      {itemType === "listing" && (
        <ListingReview items={working} onUpdate={update} onEdit={editField} />
      )}
    </div>
  );
}

interface SectionProps {
  items: WorkingItem[];
  onUpdate: (id: string, changes: Partial<WorkingItem>) => void;
  onEdit: (id: string, key: string, value: string) => void;
}

function ReviewButtons({
  item,
  onUpdate,
}: {
  item: WorkingItem;
  onUpdate: SectionProps["onUpdate"];
}) {
  return (
    <span className="action-row">
      <button
        className={`button compact ${item.reviewStatus === "approved" ? "primary" : "secondary"}`}
        type="button"
        onClick={() =>
          onUpdate(item.id, {
            reviewStatus: item.reviewStatus === "approved" ? "unreviewed" : "approved",
          })
        }
      >
        {item.reviewStatus === "approved" ? "Approved" : "Approve"}
      </button>
      <button
        className={`button compact ${item.reviewStatus === "rejected" ? "danger" : "secondary"}`}
        type="button"
        onClick={() =>
          onUpdate(item.id, {
            reviewStatus: item.reviewStatus === "rejected" ? "unreviewed" : "rejected",
          })
        }
      >
        {item.reviewStatus === "rejected" ? "Rejected" : "Reject"}
      </button>
    </span>
  );
}

function KeywordTable({ items, onUpdate, onEdit }: SectionProps) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Keyword</th>
            <th>Source</th>
            <th>Rank</th>
            <th>Intent</th>
            <th>Volume</th>
            <th>CPC</th>
            <th>Difficulty</th>
            <th>Score</th>
            <th>Target page</th>
            <th>Review</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const payload = payloadOf(item);
            return (
              <tr key={item.id}>
                <td>{text(payload, "keyword")}</td>
                <td>{text(payload, "source")}</td>
                <td>{text(payload, "position") || "—"}</td>
                <td>{text(payload, "intent")}</td>
                <td>{text(payload, "volume") || "n/a"}</td>
                <td>{text(payload, "cpc") || "n/a"}</td>
                <td>{text(payload, "difficulty") || "n/a"}</td>
                <td>{text(payload, "score")}</td>
                <td className="url-cell">
                  <input
                    value={text(payload, "assigned_page")}
                    onChange={(event) =>
                      onEdit(item.id, "assigned_page", event.target.value)
                    }
                    aria-label={`Target page for ${text(payload, "keyword")}`}
                  />
                </td>
                <td>
                  <ReviewButtons item={item} onUpdate={onUpdate} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MetadataCards({ items, onUpdate, onEdit }: SectionProps) {
  return (
    <div className="tool-metadata-list">
      {items.map((item) => {
        const payload = payloadOf(item);
        const title = text(payload, "proposed_title");
        const description = text(payload, "proposed_meta_description");
        return (
          <article className="cardish" key={item.id}>
            <header>
              <a href={text(payload, "url")} target="_blank" rel="noreferrer">
                {text(payload, "url")}
              </a>
              <ReviewButtons item={item} onUpdate={onUpdate} />
            </header>
            {Array.isArray(payload.keywords) && payload.keywords.length > 0 ? (
              <p className="label-hint">
                Keywords: {(payload.keywords as string[]).join("; ")}
              </p>
            ) : null}
            <label>
              Title ({title.length}/60)
              {text(payload, "current_title") ? (
                <small className="label-hint">
                  Current: {text(payload, "current_title")}
                </small>
              ) : null}
              <input
                value={title}
                onChange={(event) =>
                  onEdit(item.id, "proposed_title", event.target.value)
                }
              />
            </label>
            <label>
              Meta description ({description.length}/160)
              {text(payload, "current_meta_description") ? (
                <small className="label-hint">
                  Current: {text(payload, "current_meta_description")}
                </small>
              ) : null}
              <textarea
                rows={2}
                value={description}
                onChange={(event) =>
                  onEdit(item.id, "proposed_meta_description", event.target.value)
                }
              />
            </label>
            <label>
              H1
              {text(payload, "current_h1") ? (
                <small className="label-hint">Current: {text(payload, "current_h1")}</small>
              ) : null}
              <input
                value={text(payload, "proposed_h1")}
                onChange={(event) =>
                  onEdit(item.id, "proposed_h1", event.target.value)
                }
              />
            </label>
            {text(payload, "proposed_content") ? (
              <label>
                On-page copy
                <textarea
                  rows={4}
                  value={text(payload, "proposed_content")}
                  onChange={(event) =>
                    onEdit(item.id, "proposed_content", event.target.value)
                  }
                />
              </label>
            ) : null}
            {text(payload, "rationale") ? (
              <p className="label-hint">Why: {text(payload, "rationale")}</p>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function TextEditor({
  items,
  field,
  rows,
  onUpdate,
  onEdit,
}: SectionProps & { field: string; rows: number }) {
  return (
    <div className="tool-metadata-list">
      {items.map((item) => {
        const payload = payloadOf(item);
        const problems = Array.isArray(payload.problems)
          ? (payload.problems as string[])
          : [];
        return (
          <article className="cardish" key={item.id}>
            <header>
              <strong>{item.itemType === "schema" ? "JSON-LD" : "llms.txt"}</strong>
              <ReviewButtons item={item} onUpdate={onUpdate} />
            </header>
            {problems.length > 0 ? (
              <p className="field-error">{problems.join(" · ")}</p>
            ) : null}
            <textarea
              className="code-editor"
              rows={rows}
              value={text(payload, field)}
              onChange={(event) => onEdit(item.id, field, event.target.value)}
            />
          </article>
        );
      })}
    </div>
  );
}

function LocalChecklist({ items, onUpdate, onEdit }: SectionProps) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Platform</th>
            <th>Field</th>
            <th>Result</th>
            <th>Notes</th>
            <th>Evidence URL</th>
            <th>Review</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const payload = payloadOf(item);
            return (
              <tr key={item.id}>
                <td>{text(payload, "platform")}</td>
                <td>{text(payload, "field")}</td>
                <td>
                  <select
                    value={text(payload, "result") || "unchecked"}
                    onChange={(event) => onEdit(item.id, "result", event.target.value)}
                    aria-label={`Result for ${text(payload, "platform")} ${text(payload, "field")}`}
                  >
                    <option value="unchecked">Unchecked</option>
                    <option value="ok">No issues</option>
                    <option value="issue">Issue found</option>
                    <option value="not_applicable">Not applicable</option>
                  </select>
                </td>
                <td>
                  <input
                    value={text(payload, "notes")}
                    onChange={(event) => onEdit(item.id, "notes", event.target.value)}
                    aria-label="Notes"
                  />
                </td>
                <td>
                  <input
                    value={text(payload, "evidence_url")}
                    onChange={(event) =>
                      onEdit(item.id, "evidence_url", event.target.value)
                    }
                    aria-label="Evidence URL"
                  />
                </td>
                <td>
                  <ReviewButtons item={item} onUpdate={onUpdate} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ListingReview({ items, onUpdate, onEdit }: SectionProps) {
  return (
    <div className="tool-metadata-list">
      {items.map((item) => {
        const payload = payloadOf(item);
        return (
          <article className="cardish" key={item.id}>
            <header>
              <a
                href={text(item.input, "listing_url")}
                target="_blank"
                rel="noreferrer"
              >
                {text(item.input, "listing_url")}
              </a>
              <ReviewButtons item={item} onUpdate={onUpdate} />
            </header>
            <label>
              Original copy
              <textarea rows={4} value={text(payload, "original_copy")} readOnly />
            </label>
            <label>
              Proposed copy
              <textarea
                rows={4}
                value={text(payload, "proposed_copy")}
                onChange={(event) =>
                  onEdit(item.id, "proposed_copy", event.target.value)
                }
              />
            </label>
            {text(payload, "rationale") ? (
              <p className="label-hint">Why: {text(payload, "rationale")}</p>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

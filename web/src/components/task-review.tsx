"use client";

import { useState } from "react";

import type { Task } from "@/lib/data/types";

export function TaskReview({
  auditId,
  tasks,
}: {
  auditId: string;
  tasks: Task[];
}) {
  const [visible, setVisible] = useState<Set<string>>(
    () => new Set(tasks.filter((task) => task.isClientVisible).map((task) => task.id)),
  );
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  function toggle(id: string) {
    setVisible((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(`/api/audits/${auditId}/tasks`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ visibleTaskIds: [...visible] }),
      });
      const body = (await response.json()) as {
        published?: number;
        error?: string;
      };
      setMessage(
        response.ok
          ? `${body.published ?? 0} task${body.published === 1 ? "" : "s"} selected for the client portal.`
          : body.error ?? "The client task list could not be updated.",
      );
    } catch {
      setMessage("The client task list could not be updated.");
    } finally {
      setPending(false);
    }
  }

  if (!tasks.length) {
    return (
      <div className="empty">
        <strong>No review tasks yet</strong>
        <p>Select approved findings in the report to create tasks.</p>
      </div>
    );
  }

  return (
    <div className="task-review">
      {tasks.map((task) => (
        <label key={task.id}>
          <input
            type="checkbox"
            checked={visible.has(task.id)}
            onChange={() => toggle(task.id)}
          />
          <span>
            <strong>{task.title}</strong>
            <small>
              {task.priority} priority · {task.status.replace("_", " ")}
            </small>
          </span>
        </label>
      ))}
      <div className="task-review-actions">
        <button
          className="button secondary"
          type="button"
          onClick={save}
          disabled={pending}
        >
          {pending ? "Saving…" : "Save client task list"}
        </button>
        {message ? <p role="status">{message}</p> : null}
      </div>
    </div>
  );
}

import type { AuditSummary, Finding } from "@/lib/data/types";

export interface PortalTask {
  id: string;
  title: string;
  status: "todo" | "in_progress" | "blocked" | "done" | "cancelled";
  priority: "low" | "medium" | "high" | "urgent";
  dueAt: string | null;
}

export interface PortalPayload {
  auditId: string;
  reportVersion: string;
  clientName: string;
  reportName: string;
  score: number | null;
  completedTasks: number;
  totalTasks: number;
  tasks: PortalTask[];
  summary: AuditSummary;
  findings: Finding[];
}

export interface PortalProgress {
  reportVersion: string;
  completedTasks: number;
  totalTasks: number;
  tasks: PortalTask[];
  findings: Array<Pick<Finding, "id" | "status">>;
}

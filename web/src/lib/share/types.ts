export interface PortalTask {
  id: string;
  title: string;
  status: "todo" | "in_progress" | "blocked" | "done" | "cancelled";
  priority: "low" | "medium" | "high" | "urgent";
  dueAt: string | null;
}

export interface PortalPayload {
  auditId: string;
  clientName: string;
  reportName: string;
  score: number | null;
  completedTasks: number;
  totalTasks: number;
  tasks: PortalTask[];
}

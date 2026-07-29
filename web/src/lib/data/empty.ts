import type { DataProvider } from "./types";

export const emptyData: DataProvider = {
  async getClients() {
    return [];
  },
  async getClient() {
    return undefined;
  },
  async getAudits() {
    return [];
  },
  async getAudit() {
    return undefined;
  },
  async getFindings() {
    return [];
  },
  async getTasks() {
    return [];
  },
  async getAuditEvents() {
    return [];
  },
  async getToolRuns() {
    return [];
  },
  async getToolRun() {
    return undefined;
  },
  async getToolRunItems() {
    return [];
  },
  async getToolArtifacts() {
    return [];
  },
  async getToolRunsForAudit() {
    return [];
  },
};

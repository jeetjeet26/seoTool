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
};

type ChatAction = "submit" | "undo" | "history";

export class ReportChatResponseError extends Error {
  retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "ReportChatResponseError";
    this.retryable = retryable;
  }
}

function retryAdvice(action: ChatAction) {
  if (action === "submit") return "Your draft is preserved; send it again to retry safely.";
  if (action === "undo") return "Close and reopen the editor to check the edit's status before trying Undo again.";
  return "Close and reopen the editor to retry.";
}

export function reportChatErrorMessage(reason: unknown, action: ChatAction) {
  if (reason instanceof ReportChatResponseError) return reason.message;
  return `The report editor could not confirm the response. Check your connection. ${retryAdvice(action)}`;
}

function validResult(result: Record<string, unknown>, action: ChatAction) {
  if (action === "undo") return result.undone === true;
  if (action === "history") return Array.isArray(result.entries) && typeof result.configured === "boolean" && typeof result.exportState === "string";
  return typeof result.id === "string" && typeof result.message === "string" && Array.isArray(result.changes);
}

export async function readReportChatResponse<T>(response: Response, action: ChatAction): Promise<T> {
  let result: unknown;
  try { result = await response.json(); }
  catch { /* Proxies can return HTML or an empty body, including after a save. */ }
  const object = result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : null;
  if (response.ok && object && validResult(object, action)) return object as T;

  const retryable = response.ok || response.status >= 500 || response.status === 408 || response.status === 429;
  let message = typeof object?.error === "string" && object.error.trim() ? object.error : "";
  if (!message) {
    if (response.status === 408 || response.status === 504) message = "The report editor timed out before confirming the result.";
    else if (response.status === 401) message = "Your session has expired. Sign in again to use the report editor.";
    else if (response.status === 429) message = "The report editor is busy. Wait a moment before trying again.";
    else if (response.status >= 500) message = "The report editor is temporarily unavailable; the result could not be confirmed.";
    else message = "The report editor returned an unexpected response; the result could not be confirmed.";
  }
  throw new ReportChatResponseError(`${message} ${retryAdvice(action)}`, retryable);
}

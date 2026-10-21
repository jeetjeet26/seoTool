import "server-only";

const ENDPOINT = "https://api.semrush.com/";
export const SEMRUSH_MAX_KEYWORDS = 10;
const MAX_RESPONSE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 12_000;
const BATCH_TIMEOUT_MS = 35_000;
const DATABASE = "us" as const;

export type SemrushLookupError = { code: string; message: string; retryable: boolean };
export type SemrushKeywordResult = {
  keyword: string;
  status: "measured" | "partial" | "no_data" | "unavailable" | "error";
  volume: number | null;
  difficulty: number | null;
  cpc: number | null;
  competition: number | null;
  source: "semrush";
  evidence: {
    provider: "Semrush";
    semrush_report: "phrase_this";
    database: typeof DATABASE;
    query: string;
    queried_at: string;
    metrics_status: SemrushKeywordResult["status"];
    http_status?: number;
    api_code?: string;
    missing_metrics?: string[];
    note?: string;
  };
  error?: SemrushLookupError;
};
export type SemrushKeywordLookup = {
  database: typeof DATABASE;
  results: SemrushKeywordResult[];
  error?: SemrushLookupError;
};

const lookupError = (code: string, message: string, retryable = false): SemrushLookupError => ({ code, message, retryable });
const identity = (keyword: string) => keyword.trim().replace(/\s+/g, " ").toLowerCase();

function emptyResult(keyword: string): SemrushKeywordResult {
  return {
    keyword, status: "unavailable", volume: null, difficulty: null, cpc: null, competition: null, source: "semrush",
    evidence: { provider: "Semrush", semrush_report: "phrase_this", database: DATABASE, query: keyword, queried_at: new Date().toISOString(), metrics_status: "unavailable" },
  };
}

function failed(result: SemrushKeywordResult, error: SemrushLookupError, status: "error" | "unavailable" = "error"): SemrushKeywordResult {
  return { ...result, status, evidence: { ...result.evidence, metrics_status: status }, error };
}

// Semrush's escaped CSV uses semicolons; quoted phrases may contain semicolons,
// doubled quotes, and line breaks. Reject damaged CSV rather than shifting metrics.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false, closedQuote = false;
  const finishField = () => { row.push(field.trim()); field = ""; closedQuote = false; };
  const finishRow = () => { finishField(); if (row.some(value => value !== "")) rows.push(row); row = []; };
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closedQuote = true; }
      } else field += char;
    } else if (char === ";") finishField();
    else if (char === "\n" || char === "\r") {
      finishRow();
      if (char === "\r" && text[i + 1] === "\n") i++;
    } else if (closedQuote && (char === " " || char === "\t")) continue;
    else if (closedQuote) throw new Error("invalid_csv");
    else if (char === '"') {
      if (field.length) throw new Error("invalid_csv");
      quoted = true;
    } else field += char;
  }
  if (quoted) throw new Error("invalid_csv");
  if (field || row.length || closedQuote) finishRow();
  return rows;
}

class ResponseTooLarge extends Error {}

async function readBoundedBody(response: Response): Promise<string> {
  const advertisedLength = Number(response.headers.get("content-length"));
  if (advertisedLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new ResponseTooLarge();
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0, text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new ResponseTooLarge();
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}

function metric(value: string, maximum = Number.MAX_SAFE_INTEGER, integer = false): number | null {
  if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) && number <= maximum && (!integer || Number.isSafeInteger(number)) ? number : null;
}

function apiError(code: string): SemrushLookupError {
  if (code === "110" || code === "120") return lookupError("invalid_credentials", "Semrush did not accept the server API key.");
  if (code === "132") return lookupError("units_exhausted", "The Semrush account has no API units remaining.");
  if (["130", "133", "135"].includes(code)) return lookupError("access_denied", "This Semrush account cannot access the requested keyword report.");
  if (["131", "134"].includes(code)) return lookupError("api_limit", "Semrush has reached an API request limit.");
  return lookupError("api_error", `Semrush could not return keyword metrics (API code ${code}).`);
}

async function lookupOne(keyword: string, apiKey: string, batchSignal: AbortSignal): Promise<SemrushKeywordResult> {
  const result = emptyResult(keyword);
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = AbortSignal.any([batchSignal, timeout]);
  if (signal.aborted) return failed(result, lookupError("cancelled", "The keyword lookup was cancelled before it completed.", true));
  const url = new URL(ENDPOINT);
  url.search = new URLSearchParams({ type: "phrase_this", key: apiKey, phrase: keyword, database: DATABASE, export_columns: "Ph,Nq,Cp,Co,Kd", export_escape: "1", export_decode: "1" }).toString();
  try {
    const response = await fetch(url, { method: "GET", signal, cache: "no-store", redirect: "error", headers: { Accept: "text/csv,text/plain" } });
    result.evidence.http_status = response.status;
    if (!response.ok) {
      await response.body?.cancel();
      return failed(result, lookupError("http_error", `Semrush could not return keyword metrics (HTTP ${response.status}).`, response.status === 429 || response.status >= 500));
    }
    const body = (await readBoundedBody(response)).trim();
    const code = body.match(/^ERROR\s+(\d{1,6})\b/i)?.[1];
    if (code) {
      result.evidence.api_code = code;
      if (code === "50") return { ...result, status: "no_data", evidence: { ...result.evidence, metrics_status: "no_data", note: "Semrush returned no data for this exact keyword. Metrics are unknown, not measured zeros." } };
      return failed(result, apiError(code), "unavailable");
    }
    let rows: string[][];
    try { rows = parseCsv(body); } catch { return failed(result, lookupError("invalid_response", "Semrush returned unreadable keyword data.")); }
    const headers = rows[0] ?? [];
    const required = ["Keyword", "Search Volume", "CPC", "Competition", "Keyword Difficulty Index"];
    if (required.some(header => headers.filter(value => value === header).length !== 1) || rows.length !== 2 || rows[1].length !== headers.length) {
      return failed(result, lookupError("invalid_response", "Semrush returned an incomplete or unexpected keyword report."));
    }
    const values = Object.fromEntries(headers.map((header, index) => [header, rows[1][index]]));
    if (identity(values.Keyword) !== identity(keyword)) return failed(result, lookupError("keyword_mismatch", "Semrush returned data for a different keyword; those metrics were not used."));
    const metrics = {
      volume: metric(values["Search Volume"], Number.MAX_SAFE_INTEGER, true),
      difficulty: metric(values["Keyword Difficulty Index"], 100),
      cpc: metric(values.CPC), competition: metric(values.Competition, 1),
    };
    const missing = Object.entries(metrics).filter(([, value]) => value === null).map(([key]) => key);
    if (missing.length === 4) return failed(result, lookupError("metrics_unavailable", "Semrush returned this keyword without usable numeric metrics."), "unavailable");
    return {
      ...result, ...metrics, status: missing.length ? "partial" : "measured",
      evidence: { ...result.evidence, metrics_status: missing.length ? "partial" : "measured", ...(missing.length ? { missing_metrics: missing, note: "Null metrics were not returned as usable numbers; preserve them as unknown." } : {}) },
    };
  } catch (error) {
    if (error instanceof ResponseTooLarge) return failed(result, lookupError("response_too_large", "Semrush returned more data than this lookup can safely read."));
    if (timeout.aborted || batchSignal.aborted) return failed(result, lookupError(timeout.aborted ? "timeout" : "cancelled", "The Semrush lookup did not finish before its time limit or cancellation.", true));
    // Fetch errors can include the URL and API key. Never return or log them.
    return failed(result, lookupError("request_failed", "Semrush could not be reached. Try the keyword lookup again.", true));
  }
}

/**
 * Extend the existing Python v3 integration with its current server credential.
 * v4 requires a distinct API key; migrate both adapters together when configured.
 * https://developer.semrush.com/api/v3/seo/keyword-reports/#keyword-overview-one-database
 * Results carry evidence only. This function never edits a report or substitutes
 * zero for a failed lookup; callers must preserve prior metrics on failure.
 */
export async function lookupSemrushKeywords(keywords: string[], options: { signal?: AbortSignal } = {}): Promise<SemrushKeywordLookup> {
  if (!Array.isArray(keywords) || keywords.length < 1 || keywords.length > SEMRUSH_MAX_KEYWORDS || keywords.some(keyword => typeof keyword !== "string" || !keyword.trim() || keyword.length > 200 || /[\u0000-\u001f\u007f]/.test(keyword))) {
    return { database: DATABASE, results: [], error: lookupError("invalid_keywords", `Provide 1–${SEMRUSH_MAX_KEYWORDS} keywords, each containing 1–200 characters and no control characters.`) };
  }
  const unique = [...new Map(keywords.map(keyword => [identity(keyword), keyword.trim().replace(/\s+/g, " ")])).values()];
  const apiKey = process.env.SEMRUSH_API_KEY?.trim();
  if (!apiKey) {
    const error = lookupError("not_configured", "Semrush keyword lookup needs SEMRUSH_API_KEY configured on the server.");
    return { database: DATABASE, results: unique.map(keyword => failed(emptyResult(keyword), error, "unavailable")), error };
  }
  const deadline = AbortSignal.timeout(BATCH_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([deadline, options.signal]) : deadline;
  const results = new Array<SemrushKeywordResult>(unique.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, unique.length) }, async () => {
    while (next < unique.length) {
      const index = next++;
      results[index] = await lookupOne(unique[index], apiKey, signal);
    }
  }));
  return { database: DATABASE, results };
}

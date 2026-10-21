import { createHash } from "node:crypto";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type ReportDocument = { summary: Record<string, Json>; findings: Record<string, Record<string, Json>> };
export type Edit = { op: "add" | "replace" | "remove" | "retain"; path: string; value: string; before: string };
export type Change = { path: string; before: Json; after: Json };
export class ChatError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const forbidden = new Set(["__proto__", "prototype", "constructor"]);
const summaryKeys = new Set([
  "executive_summary", "property_context", "keyword_strategy", "content_recommendations",
  "alt_text_recommendations", "competitors", "competitor_communities", "nearby_neighborhoods",
  "page_experience", "semrush", "semrush_site_audit", "backlinks", "keyword_metrics",
  "site_inventory", "crawl_coverage", "event_backlog", "target_location", "report_variant",
]);
const findingFields = new Set(["title", "description", "recommendation", "category", "severity", "page_url", "resource_url"]);

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function revision(document: ReportDocument) {
  return createHash("sha256").update(canonical(document)).digest("hex");
}
export function valueReference(value: Json): string {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}
// Let the planner identify large original values without having to reproduce
// crawl text and every field of every row in its response.
export function editReferences(document: ReportDocument): Record<string, string> {
  const references: Record<string, string> = {};
  function record(path: string, value: Json) {
    references[path] = valueReference(value);
    if (Array.isArray(value)) {
      references[`${path}/-`] = valueReference(null);
      references[`${path}/${value.length}`] = valueReference(null);
    }
  }
  for (const [key, value] of Object.entries(document.summary)) {
    if (!summaryKeys.has(key)) continue;
    const path = `/summary/${key}`;
    record(path, value);
    // Reference rows and their immediate fields, not every node in retained
    // Lighthouse evidence (which can contain tens of thousands of nodes).
    if (Array.isArray(value)) value.forEach((row, index) => {
      record(`${path}/${index}`, row);
      if (object(row)) for (const [field, child] of Object.entries(row)) {
        record(`${path}/${index}/${field.replaceAll("~", "~0").replaceAll("/", "~1")}`, child);
      }
    });
    else if (object(value)) for (const [field, child] of Object.entries(value)) {
      record(`${path}/${field.replaceAll("~", "~0").replaceAll("/", "~1")}`, child);
    }
  }
  return references;
}
function retainRecommendations(old: Json, encoded: string): Json[] {
  let urls: unknown;
  try { urls = JSON.parse(encoded); } catch { throw new ChatError("Retain requires a JSON list of exact page URLs."); }
  if (!Array.isArray(old) || !Array.isArray(urls) || !urls.length || urls.some((url) => typeof url !== "string") || new Set(urls).size !== urls.length) {
    throw new ChatError("Retain requires a non-empty list of unique page URLs.");
  }
  for (const url of urls) {
    if (old.filter((row) => object(row) && row.url === url).length !== 1) throw new ChatError("Each retained URL must match exactly one existing recommendation.", 409);
  }
  return old.filter((row) => object(row) && urls.includes(row.url));
}
function safeJson(value: Json, depth = 0): void {
  if (depth > 30) throw new ChatError("The edit is too deeply nested.");
  if (typeof value === "string" && value.length > 100_000) throw new ChatError("The edit is too large.");
  if (typeof value === "number" && !Number.isFinite(value)) throw new ChatError("Report numbers must be finite.");
  if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) {
    if (forbidden.has(key)) throw new ChatError("Invalid edit key.");
    safeJson(child, depth + 1);
  }
}

// Preserve the shape consumed by the report and workbook. Unknown existing fields
// remain intact; new recommendation rows must include their identity fields.
const rowTypes: Record<string, Record<string, string>> = {
  content_recommendations: { url: "string", current_title: "string", current_h1: "string", current_meta_description: "string", keywords: "strings", proposed_title: "string", proposed_h1: "string", proposed_meta_description: "string", proposed_content: "string", content_action: "string", current_body_text: "string", rationale: "string", current_body_word_count: "number", requires_human_review: "boolean" },
  alt_text_recommendations: { image_url: "string", page_url: "string", current_alt_text: "string", proposed_alt_text: "string", alt_text_length: "number", warnings: "strings" },
  keyword_strategy: { keyword: "string", source: "string", volume: "number", cpc: "number", difficulty: "number", competition: "number", position: "nullableNumber", intent: "string", score: "number", assigned_page: "string" },
  competitors: { domain: "string", source: "string", competition_level: "number", common_keywords: "number", organic_keywords: "number", organic_traffic: "number" },
  competitor_communities: { name: "string", builder: "string", location: "string", url: "string", address: "string", place_id: "string", latitude: "number", longitude: "number", distance_miles: "number", rating: "number", review_count: "number", score: "number", source: "string", resolution_status: "string" },
  page_experience: { url: "string", performance_score: "number", accessibility_score: "number", metrics: "object", accessibility_issues: "objects" },
};
const required: Record<string, string[]> = {
  content_recommendations: ["url"], alt_text_recommendations: ["image_url", "page_url"],
  keyword_strategy: ["keyword", "source", "volume", "cpc", "difficulty", "competition", "intent", "score", "assigned_page"],
  competitors: ["domain", "competition_level", "common_keywords", "organic_keywords", "organic_traffic"],
  competitor_communities: ["name", "builder", "location", "url"], page_experience: ["url"],
};
function object(value: Json): value is Record<string, Json> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function matches(value: Json, type: string) {
  if (type === "strings") return Array.isArray(value) && value.every((x) => typeof x === "string");
  if (type === "objects") return Array.isArray(value) && value.every(object);
  if (type === "object") return object(value);
  if (type === "nullableNumber") return value === null || typeof value === "number";
  return typeof value === type;
}
function compatible(previous: Json, value: Json): void {
  if (previous === null || value === null) return;
  if (typeof previous !== typeof value || Array.isArray(previous) !== Array.isArray(value)) throw new ChatError("An edit cannot change the content's data type.");
  if (object(previous) && object(value)) for (const key of Object.keys(value)) {
    if (Object.hasOwn(previous, key)) compatible(previous[key], value[key]);
  }
}
function validateSummary(summary: Record<string, Json>, touched: Set<string>) {
  for (const key of touched) {
    const value = summary[key];
    if (value === undefined) continue;
    if (rowTypes[key]) {
      if (!Array.isArray(value)) throw new ChatError(`${key} must be a list.`);
      for (const row of value) {
        if (!object(row) || required[key].some((field) => row[field] === undefined)) throw new ChatError(`${key} contains an incomplete row.`);
        for (const [field, type] of Object.entries(rowTypes[key])) {
          if (row[field] !== undefined && !matches(row[field], type)) throw new ChatError(`Invalid ${field} in ${key}.`);
        }
        for (const field of ["url", "page_url", "image_url", "assigned_page"]) {
          if (typeof row[field] === "string" && row[field] && !/^https?:\/\//i.test(row[field])) throw new ChatError("Report links must use HTTP or HTTPS.");
        }
      }
    } else if (["executive_summary", "target_location", "report_variant"].includes(key)) {
      if (typeof value !== "string") throw new ChatError(`${key} must be text.`);
    } else if (key === "nearby_neighborhoods") {
      if (!matches(value, "strings")) throw new ChatError("Neighborhoods must be a list of names.");
    } else if (!object(value)) throw new ChatError(`${key} must be an object.`);
    if (key === "property_context" && object(value) && Object.values(value).some((v) => typeof v !== "string")) throw new ChatError("Property details must be text.");
  }
}

export function applyEdits(document: ReportDocument, edits: Edit[]) {
  if (!Array.isArray(edits) || edits.length > 500) throw new ChatError("Use up to 500 discrete edits at a time.");
  const next = structuredClone(document);
  const changes: Change[] = [];
  const touched = new Set<string>();
  for (const edit of edits) {
    if (!edit || !["add", "replace", "remove", "retain"].includes(edit.op) || typeof edit.path !== "string" || typeof edit.value !== "string" || typeof edit.before !== "string") throw new ChatError("Invalid edit response.");
    if (edit.op === "retain" && edit.path !== "/summary/content_recommendations") throw new ChatError("Retain is only supported for content recommendations.");
    if (!edit.path.startsWith("/")) throw new ChatError("Invalid edit path.");
    const path = edit.path.slice(1).split("/").map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
    if (path.some((part) => forbidden.has(part)) || path.length < 2) throw new ChatError("Invalid edit path.");
    if (path[0] === "summary") {
      if (!summaryKeys.has(path[1])) throw new ChatError("That field is not editable report content.");
      touched.add(path[1]);
    } else if (path[0] === "findings") {
      const creating = path.length === 2 && edit.op === "add" && !Object.hasOwn(next.findings, path[1]);
      if (!UUID.test(path[1]) || (!creating && !Object.hasOwn(next.findings, path[1])) || (path.length !== 2 && (path.length !== 3 || !findingFields.has(path[2])))) throw new ChatError("The finding is outside this report or the field is not editable.");
      if (path.length === 2 && edit.op !== "remove" && !creating) throw new ChatError("Edit individual finding fields or remove the finding.");
      if (path.length === 3 && edit.op === "remove") throw new ChatError("Replace finding text with an empty string instead.");
    } else throw new ChatError("Edits must target this report.");
    let parent: Json = next;
    for (const part of path.slice(0, -1)) {
      if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, part)) throw new ChatError("The requested report item does not exist.");
      parent = (parent as Record<string, Json>)[part];
    }
    if (!parent || typeof parent !== "object") throw new ChatError("The edit does not point to report content.");
    const key = path.at(-1)!;
    const record = parent as Record<string, Json>;
    const exists = Object.hasOwn(parent, key);
    const old = exists ? record[key] : null;
    let value: Json;
    let originalMatches: boolean;
    if (edit.before !== old && /^sha256:[a-f0-9]{64}$/.test(edit.before)) originalMatches = edit.before === valueReference(old);
    else {
      let expected: Json;
      try { expected = typeof old === "string" ? edit.before : JSON.parse(edit.before); } catch {
        throw new ChatError(`The model returned invalid original values at ${edit.path}. Use before ${valueReference(old)} for this value.`);
      }
      originalMatches = canonical(old) === canonical(expected);
    }
    if (edit.op !== "add" && !exists) throw new ChatError("The requested report item no longer exists.", 409);
    if (!originalMatches) throw new ChatError(`The original text did not match at ${edit.path}. Use before ${valueReference(old)} for this value.`, 409);
    if (edit.op === "retain") value = retainRecommendations(old, edit.value);
    else if (edit.op === "remove") value = null;
    else if (typeof old === "string" || (path[0] === "summary" && (
      (path.length === 2 && ["executive_summary", "target_location", "report_variant"].includes(path[1])) ||
      (path[1] === "property_context" && path.length === 3) ||
      rowTypes[path[1]]?.[key] === "string" ||
      (Array.isArray(parent) && (path[1] === "nearby_neighborhoods" || ["keywords", "warnings"].includes(path.at(-2)!)))
    ))) value = edit.value;
    else {
      try { value = JSON.parse(edit.value); } catch { value = edit.value; }
    }
    safeJson(value);
    if (Array.isArray(parent)) {
      const index = key === "-" ? parent.length : Number(key);
      if ((key !== "-" && !/^(0|[1-9]\d*)$/.test(key)) || !Number.isSafeInteger(index) || index < 0 || index > parent.length || (edit.op !== "add" && index === parent.length)) throw new ChatError("Invalid row index.");
      if (edit.op === "add") parent.splice(index, 0, value);
      else if (edit.op === "remove") parent.splice(index, 1);
      else parent[index] = value;
    } else if (edit.op === "remove") delete record[key];
    else {
      const nullableNumber = path[0] === "summary" && path.length === 4 && rowTypes[path[1]]?.[key] === "nullableNumber"
        && matches(old, "nullableNumber") && matches(value, "nullableNumber");
      if (exists && old !== null && !nullableNumber && (Array.isArray(old) !== Array.isArray(value) || typeof old !== typeof value || value === null)) throw new ChatError("An edit cannot change the content's data type.");
      if (exists) compatible(old, value);
      record[key] = value;
    }
    if (edit.op === "remove" || canonical(old) !== canonical(value) || edit.op === "add") changes.push({ path: edit.path, before: old, after: edit.op === "remove" ? null : value });
  }
  validateSummary(next.summary, touched);
  for (const [id, finding] of Object.entries(next.findings)) {
    if (!object(finding) || [...findingFields].some((field) => typeof finding[field] !== "string") || Object.keys(finding).some((field) => !findingFields.has(field))) throw new ChatError("Findings must contain exactly title, description, recommendation, category, severity, page_url, and resource_url as text.");
    for (const [field, value] of Object.entries(finding)) if (typeof value !== "string") throw new ChatError(`Finding ${field} must be text.`);
    if (!String(finding.title).trim() || String(finding.title).length > 240 || !String(finding.category).trim() || String(finding.category).length > 120) throw new ChatError("Invalid finding title or category.");
    if (!["critical", "high", "medium", "low", "info"].includes(String(finding.severity))) throw new ChatError("Invalid severity.");
    for (const field of ["page_url", "resource_url"]) if (finding[field] !== document.findings[id]?.[field] && finding[field] && !/^https?:\/\//i.test(String(finding[field]))) throw new ChatError("Report links must use HTTP or HTTPS.");
  }
  if (touched.has("alt_text_recommendations")) for (const item of next.summary.alt_text_recommendations as Record<string, Json>[] ?? []) {
    const originals = document.summary.alt_text_recommendations as Record<string, Json>[] ?? [];
    const unchanged = originals.some((old) => old.image_url === item.image_url && old.page_url === item.page_url && old.proposed_alt_text === item.proposed_alt_text);
    if (!unchanged && typeof item.proposed_alt_text === "string") item.alt_text_length = item.proposed_alt_text.length;
  }
  return { next, changes };
}

import { NextResponse } from "next/server";

import { isSupabaseConfigured } from "@/lib/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Approval-gated exports for tool runs. Every profile is generated from
 * approved items only, preferring staff edits over raw model output.
 */

const PROFILES = new Set([
  "csv",
  "developer",
  "seopress",
  "keywords",
  "llms",
  "schema",
  "local",
]);

type Payload = Record<string, unknown>;

interface ItemRow {
  id: string;
  item_type: string;
  stable_key: string;
  input: Payload | null;
  output: Payload | null;
  edited_output: Payload | null;
  review_status: string;
}

function sanitizeCell(value: unknown): string {
  const textValue = value === undefined || value === null ? "" : String(value);
  return /^[=+\-@\t]/.test(textValue) ? `'${textValue}` : textValue;
}

function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(csvEscape).join(",")).join("\r\n") + "\r\n";
}

function payloadOf(item: ItemRow): Payload {
  return { ...(item.output ?? {}), ...(item.edited_output ?? {}) };
}

function text(payload: Payload, key: string): string {
  const value = payload[key];
  return value === undefined || value === null ? "" : String(value);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const profile = new URL(request.url).searchParams.get("profile") ?? "csv";
  if (!PROFILES.has(profile)) {
    return NextResponse.json({ error: "Unknown export profile." }, { status: 400 });
  }
  if (!isSupabaseConfigured) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 503 },
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  if (claimsError || !claimsData?.claims?.sub) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { data: itemRows, error: itemsError } = await supabase
    .from("tool_run_items")
    .select("id,item_type,stable_key,input,output,edited_output,review_status")
    .eq("run_id", runId)
    .order("position");
  if (itemsError) {
    return NextResponse.json(
      { error: "The run items could not be loaded." },
      { status: 500 },
    );
  }
  const approved = ((itemRows ?? []) as ItemRow[]).filter(
    (item) => item.review_status === "approved",
  );
  if (!approved.length) {
    return NextResponse.json(
      { error: "Approve at least one item before exporting." },
      { status: 400 },
    );
  }

  switch (profile) {
    case "keywords":
      return csvResponse(
        `keywords-${runId}.csv`,
        toCsv([
          ["Keyword", "Ranking", "Intent", "CPC", "Volume", "Difficulty", "Target Page"],
          ...approved.map((item) => {
            const payload = payloadOf(item);
            return [
              sanitizeCell(text(payload, "keyword")),
              text(payload, "position") || "-",
              text(payload, "intent"),
              text(payload, "cpc") || "n/a",
              text(payload, "volume") || "n/a",
              text(payload, "difficulty") || "n/a",
              sanitizeCell(text(payload, "assigned_page")),
            ];
          }),
        ]),
      );

    case "csv":
      return csvResponse(
        `metadata-${runId}.csv`,
        toCsv([
          [
            "URL",
            "Keywords",
            "Current Title",
            "Approved Title",
            "Title Length",
            "Current Meta Description",
            "Approved Meta Description",
            "Description Length",
            "Current H1",
            "Approved H1",
          ],
          ...approved.map((item) => {
            const payload = payloadOf(item);
            const title = text(payload, "proposed_title");
            const description = text(payload, "proposed_meta_description");
            return [
              sanitizeCell(text(payload, "url")),
              sanitizeCell(
                Array.isArray(payload.keywords)
                  ? (payload.keywords as string[]).join("; ")
                  : "",
              ),
              sanitizeCell(text(payload, "current_title")),
              sanitizeCell(title),
              String(title.length),
              sanitizeCell(text(payload, "current_meta_description")),
              sanitizeCell(description),
              String(description.length),
              sanitizeCell(text(payload, "current_h1")),
              sanitizeCell(text(payload, "proposed_h1")),
            ];
          }),
        ]),
      );

    case "developer":
      return csvResponse(
        `developer-implementation-${runId}.csv`,
        toCsv([
          ["PAGE NAME", "URL", "TITLE TAG", "META DESCRIPTION", "H1", "ON PAGE OPTIMIZATION"],
          ...approved.map((item) => {
            const payload = payloadOf(item);
            const url = text(payload, "url");
            return [
              sanitizeCell(pageName(url)),
              sanitizeCell(url),
              sanitizeCell(text(payload, "proposed_title")),
              sanitizeCell(text(payload, "proposed_meta_description")),
              sanitizeCell(text(payload, "proposed_h1")),
              sanitizeCell(text(payload, "proposed_content")),
            ];
          }),
        ]),
      );

    case "seopress": {
      const { data: artifact } = await supabase
        .from("tool_artifacts")
        .select("object_path")
        .eq("run_id", runId)
        .eq("kind", "seopress-template")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!artifact) {
        return NextResponse.json(
          { error: "This run has no uploaded SEOPress template." },
          { status: 400 },
        );
      }
      const { data: file, error: downloadError } = await supabase.storage
        .from("tool-artifacts")
        .download(artifact.object_path);
      if (downloadError || !file) {
        return NextResponse.json(
          { error: "The template could not be downloaded." },
          { status: 500 },
        );
      }
      const merged = mergeSeopressTemplate(
        await file.text(),
        approvedMetadataByUrl(approved),
      );
      if ("error" in merged) {
        return NextResponse.json({ error: merged.error }, { status: 400 });
      }
      return csvResponse(`seopress-import-${runId}.csv`, merged.csv);
    }

    case "llms": {
      const payload = payloadOf(approved[0]);
      return new NextResponse(text(payload, "content"), {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "content-disposition": `attachment; filename="llms.txt"`,
        },
      });
    }

    case "schema": {
      const payload = payloadOf(approved[0]);
      const body =
        text(payload, "script_tag") ||
        JSON.stringify(payload.document ?? {}, null, 2);
      return new NextResponse(body, {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "content-disposition": `attachment; filename="schema-${runId}.html"`,
        },
      });
    }

    case "local":
      return csvResponse(
        `local-audit-${runId}.csv`,
        toCsv([
          ["Platform", "Field", "Result", "Notes", "Evidence URL"],
          ...approved.map((item) => {
            const payload = payloadOf(item);
            return [
              sanitizeCell(text(payload, "platform")),
              sanitizeCell(text(payload, "field")),
              sanitizeCell(text(payload, "result")),
              sanitizeCell(text(payload, "notes")),
              sanitizeCell(text(payload, "evidence_url")),
            ];
          }),
        ]),
      );
  }

  return NextResponse.json({ error: "Unknown export profile." }, { status: 400 });
}

function csvResponse(filename: string, content: string): NextResponse {
  return new NextResponse("\uFEFF" + content, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

function pageName(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "");
    const slug = path.split("/").filter(Boolean).pop();
    if (!slug) return "Home Page";
    return slug
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  } catch {
    return url;
  }
}

function approvedMetadataByUrl(
  items: ItemRow[],
): Map<string, { title: string; description: string }> {
  const map = new Map<string, { title: string; description: string }>();
  for (const item of items) {
    const payload = payloadOf(item);
    const url = text(payload, "url") || item.stable_key;
    if (!url) continue;
    map.set(urlKey(url), {
      title: text(payload, "proposed_title"),
      description: text(payload, "proposed_meta_description"),
    });
  }
  return map;
}

function urlKey(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

const URL_COLUMNS = new Set(["url", "permalink", "address", "page url"]);
const TITLE_COLUMNS = new Set([
  "seopress_titles_title",
  "meta title",
  "seo title",
  "title",
]);
const DESCRIPTION_COLUMNS = new Set([
  "seopress_titles_desc",
  "meta description",
  "seo description",
  "description",
]);

/**
 * Mirrors worker/export_profiles.merge_seopress_template: preserves row order
 * and unrecognized columns, writes approved values only into known columns.
 */
function mergeSeopressTemplate(
  templateText: string,
  metadata: Map<string, { title: string; description: string }>,
): { csv: string } | { error: string } {
  const rows = parseCsv(templateText.replace(/^\uFEFF/, ""));
  if (!rows.length) return { error: "The template CSV is empty." };
  if (rows.length - 1 > 20000) return { error: "The template exceeds 20,000 rows." };

  const header = rows[0];
  const normalized = header.map((column) => column.trim().toLowerCase());
  const urlIndex = normalized.findIndex((column) => URL_COLUMNS.has(column));
  const titleIndex = normalized.findIndex((column) => TITLE_COLUMNS.has(column));
  const descriptionIndex = normalized.findIndex((column) =>
    DESCRIPTION_COLUMNS.has(column),
  );
  if (urlIndex === -1) {
    return { error: "The template needs a URL column (url, permalink, or address)." };
  }
  if (titleIndex === -1 && descriptionIndex === -1) {
    return { error: "The template needs a title or description column to fill." };
  }

  const output: string[][] = [header];
  for (const row of rows.slice(1)) {
    const padded = [...row];
    while (padded.length < header.length) padded.push("");
    const approvedEntry = metadata.get(urlKey(padded[urlIndex] ?? ""));
    if (approvedEntry) {
      if (titleIndex !== -1 && approvedEntry.title) {
        padded[titleIndex] = sanitizeCell(approvedEntry.title);
      }
      if (descriptionIndex !== -1 && approvedEntry.description) {
        padded[descriptionIndex] = sanitizeCell(approvedEntry.description);
      }
    }
    output.push(padded.slice(0, header.length));
  }
  return { csv: toCsv(output) };
}

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (inQuotes) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += character;
      }
    } else if (character === '"') {
      inQuotes = true;
    } else if (character === ",") {
      row.push(current);
      current = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(current);
      current = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      current += character;
    }
  }
  if (current !== "" || row.length) {
    row.push(current);
    rows.push(row);
  }
  return rows;
}

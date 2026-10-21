import "server-only";

import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { parse } from "parse5";

const LIMITS = {
  max_body_bytes: 1_048_576,
  max_text_characters: 16_000,
  max_redirects: 3,
  timeout_ms: 15_000,
} as const;

export interface LivePageOptions {
  targetUrl: string;
  allowedUrls?: readonly string[];
  explicitUserUrls?: readonly string[];
  signal?: AbortSignal;
}

export interface LivePageResult {
  url: string;
  final_url: string;
  status: "ok" | "blocked" | "error";
  fetched_at: string;
  evidence_type: "untrusted_live_webpage";
  limits: typeof LIMITS;
  http_status?: number;
  title?: string;
  meta_description?: string;
  h1?: string[];
  body_text?: string;
  links?: { url: string; text: string }[];
  truncated?: boolean;
  reason?: string;
}

type Address = { address: string; family: number };
type PageResponse = { status: number; location?: string; contentType: string; body: string };
type Dependencies = {
  resolve: (hostname: string) => Promise<Address[]>;
  request: (url: URL, address: Address, signal: AbortSignal) => Promise<PageResponse>;
};

class BlockedPage extends Error {}

function parsedUrl(raw: string): URL {
  if (typeof raw !== "string" || raw.length > 4_096 || /[\u0000-\u0020\u007f\\]/u.test(raw)) {
    throw new BlockedPage("The page URL is invalid.");
  }
  let url: URL;
  try { url = new URL(raw); } catch { throw new BlockedPage("The page URL is invalid."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new BlockedPage("Only public HTTP(S) page URLs without credentials can be checked.");
  }
  if (url.port && url.port !== (url.protocol === "https:" ? "443" : "80")) {
    throw new BlockedPage("Only standard web ports can be checked.");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname || hostname.endsWith(".") || hostname === "localhost" ||
    /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|onion)$/i.test(hostname)) {
    throw new BlockedPage("Local or reserved hostnames cannot be checked.");
  }
  // Do not let encoded path delimiters or traversal escape a community's URL scope.
  for (const part of url.pathname.split("/")) {
    let decoded = part;
    for (let depth = 0; depth < 5; depth += 1) {
      let next: string;
      try { next = decodeURIComponent(decoded); } catch { throw new BlockedPage("The page path is invalid."); }
      if (/[\/\\\u0000-\u001f\u007f]/u.test(next) || next === "." || next === "..") {
        throw new BlockedPage("Encoded path traversal cannot be checked.");
      }
      if (next === decoded) break;
      decoded = next;
      if (depth === 4) throw new BlockedPage("The page path is excessively encoded.");
    }
  }
  url.hash = "";
  return url;
}

function canonicalHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

function canonicalRedirect(url: URL, previous: URL): boolean {
  return canonicalHost(url) === canonicalHost(previous) &&
    url.pathname === previous.pathname && url.search === previous.search &&
    (url.protocol === previous.protocol || (previous.protocol === "http:" && url.protocol === "https:"));
}

/** Inputs must be supplied by server code from this report and the latest user message. */
export function isAllowedLivePageUrl(raw: string, scope: LivePageOptions, previousRaw?: string): boolean {
  try {
    const url = parsedUrl(raw);
    const target = parsedUrl(scope.targetUrl);
    const exact = [scope.targetUrl, ...(scope.allowedUrls ?? []), ...(scope.explicitUserUrls ?? [])];
    if (exact.some((value) => {
      try { return parsedUrl(value).href === url.href; } catch { return false; }
    })) return true;
    const prefix = target.pathname.endsWith("/") ? target.pathname : `${target.pathname}/`;
    if (!url.search && url.origin === target.origin &&
      (url.pathname === target.pathname || url.pathname.startsWith(prefix))) return true;
    // A redirect may only change www or upgrade HTTP; scope does not expand to siblings.
    if (previousRaw && canonicalRedirect(url, parsedUrl(previousRaw))) return true;
    return false;
  } catch { return false; }
}

function ipv4Number(address: string): number {
  return address.split(".").reduce((value, part) => value * 256 + Number(part), 0);
}

function inV4Range(address: number, start: string, prefix: number): boolean {
  const block = 2 ** (32 - prefix);
  return Math.floor(address / block) === Math.floor(ipv4Number(start) / block);
}

function ipv6Number(address: string): bigint {
  let normalized = address.toLowerCase();
  if (normalized.includes(".")) {
    const lastColon = normalized.lastIndexOf(":");
    const v4 = ipv4Number(normalized.slice(lastColon + 1));
    normalized = `${normalized.slice(0, lastColon)}:${Math.floor(v4 / 65536).toString(16)}:${(v4 % 65536).toString(16)}`;
  }
  const [left, right] = normalized.split("::");
  const leading = left ? left.split(":") : [];
  const trailing = right ? right.split(":") : [];
  const parts = right === undefined ? leading : [...leading, ...Array(8 - leading.length - trailing.length).fill("0"), ...trailing];
  return parts.reduce((value, part) => (value << BigInt(16)) + BigInt(`0x${part}`), BigInt(0));
}

function inV6Range(address: bigint, start: string, prefix: number): boolean {
  const shift = BigInt(128 - prefix);
  return address >> shift === ipv6Number(start) >> shift;
}

/** Conservative global-unicast allowlist, excluding mapped and transition networks. */
export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const number = ipv4Number(address);
    const reserved: [string, number][] = [
      ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
      ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
      ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
      ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
    ];
    return !reserved.some(([start, prefix]) => inV4Range(number, start, prefix));
  }
  if (family === 6) {
    const number = ipv6Number(address);
    return inV6Range(number, "2000::", 3) &&
      !inV6Range(number, "2001::", 23) &&
      !inV6Range(number, "2001:db8::", 32) &&
      !inV6Range(number, "2002::", 16) &&
      !inV6Range(number, "3fff::", 20);
  }
  return false;
}

function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(new Error("The live page check was cancelled or exceeded its time limit."));
    if (signal.aborted) { aborted(); return; }
    signal.addEventListener("abort", aborted, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
  });
}

function requestPublicPage(url: URL, address: Address, signal: AbortSignal): Promise<PageResponse> {
  return new Promise((resolve, reject) => {
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = request(url, {
      agent: false,
      family: address.family,
      // Preserve the original hostname for Host/TLS while connecting to the vetted IP.
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
      signal,
      headers: {
        "User-Agent": "SEO-Audit-Workspace/1.0 (report page verification)",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Encoding": "identity",
        Connection: "close",
      },
    }, (response) => {
      const status = response.statusCode ?? 0;
      const contentType = String(response.headers["content-type"] ?? "");
      const result = { status, contentType, location: response.headers.location, body: "" };
      if (status !== 200) { response.destroy(); resolve(result); return; }
      if (!/^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(contentType)) {
        response.destroy(); reject(new Error("The URL did not return an HTML page.")); return;
      }
      if (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") {
        response.destroy(); reject(new Error("The page returned unsupported compressed content.")); return;
      }
      if (Number(response.headers["content-length"]) > LIMITS.max_body_bytes) {
        response.destroy(); reject(new Error("The page exceeded the safe download size limit.")); return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > LIMITS.max_body_bytes) {
          response.destroy(); reject(new Error("The page exceeded the safe download size limit."));
        } else chunks.push(chunk);
      });
      response.on("end", () => resolve({ ...result, body: Buffer.concat(chunks).toString("utf8") }));
      response.on("error", reject);
      response.on("aborted", () => reject(new Error("The page response was interrupted.")));
    });
    req.on("error", reject);
    req.end();
  });
}

interface HtmlNode {
  nodeName: string;
  tagName?: string;
  value?: string;
  childNodes?: HtmlNode[];
  attrs?: { name: string; value: string }[];
}

function attribute(node: HtmlNode, name: string): string {
  return node.attrs?.find((attr) => attr.name === name)?.value ?? "";
}

const OMIT_TAGS = new Set(["script", "style", "noscript", "template", "svg", "canvas", "footer", "nav", "aside", "form", "button", "select", "input", "textarea"]);
function hidden(node: HtmlNode): boolean {
  return OMIT_TAGS.has(node.tagName ?? "") || Boolean(node.attrs?.some((attr) => attr.name === "hidden")) ||
    attribute(node, "aria-hidden") === "true" || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(attribute(node, "style")) ||
    /(?:^|\s)(?:modal|popup|cookie-banner|site-header|site-footer|navigation|menu)(?:\s|$)/i.test(attribute(node, "class")) ||
    ["navigation", "dialog", "banner", "contentinfo"].includes(attribute(node, "role"));
}

function textContent(node: HtmlNode, visibleOnly = true): string {
  if (visibleOnly && hidden(node)) return "";
  if (node.nodeName === "#text") return node.value ?? "";
  return (node.childNodes ?? []).map((child) => textContent(child, visibleOnly)).join(" ");
}

function compact(text: string): string { return text.replace(/\s+/g, " ").trim(); }

export function extractLivePageEvidence(html: string, finalUrl: string) {
  const root = parse(html) as unknown as HtmlNode;
  const all: HtmlNode[] = [];
  const parents = new WeakMap<HtmlNode, HtmlNode>();
  const walk = (node: HtmlNode) => {
    all.push(node);
    for (const child of node.childNodes ?? []) { parents.set(child, node); walk(child); }
  };
  walk(root);
  const titleNode = all.find((node) => node.tagName === "title");
  const title = titleNode ? compact(textContent(titleNode, false)).slice(0, 300) : "";
  const meta = all.find((node) => node.tagName === "meta" && attribute(node, "name").toLowerCase() === "description") ??
    all.find((node) => node.tagName === "meta" && attribute(node, "property").toLowerCase() === "og:description");
  const visibleAncestors = (node: HtmlNode): boolean => {
    for (let current: HtmlNode | undefined = node; current; current = parents.get(current)) {
      if (hidden(current)) return false;
    }
    return true;
  };
  const contentRoot = all.find((node) => (node.tagName === "main" || attribute(node, "role") === "main") && visibleAncestors(node)) ??
    all.find((node) => node.tagName === "body") ?? root;
  const visible: HtmlNode[] = [];
  const walkVisible = (node: HtmlNode) => {
    if (hidden(node)) return;
    visible.push(node);
    for (const child of node.childNodes ?? []) walkVisible(child);
  };
  walkVisible(contentRoot);
  const fullText = compact(textContent(contentRoot));
  const bodyText = fullText.slice(0, LIMITS.max_text_characters);
  const h1 = [...new Set(visible.filter((node) => node.tagName === "h1").map((node) => compact(textContent(node)).slice(0, 300)).filter(Boolean))].slice(0, 10);
  const links: { url: string; text: string }[] = [];
  const seen = new Set<string>();
  for (const node of visible.filter((node) => node.tagName === "a")) {
    try {
      const url = parsedUrl(new URL(attribute(node, "href"), finalUrl).href).href;
      const text = compact(textContent(node)).slice(0, 120);
      if (text && !seen.has(url)) { links.push({ url, text }); seen.add(url); }
      if (links.length >= 24) break;
    } catch { /* Non-web links are not evidence URLs. */ }
  }
  const challenge = /just a moment|attention required|access denied|verify (?:you are|that you are|you're) human|checking your browser|security (?:verification|check)|captcha/i.test(title) ||
    /(?:verify (?:you are|that you are|you're) human|enable javascript and cookies to continue|checking your browser before accessing|performing security verification)/i.test(fullText.slice(0, 1_500));
  return {
    title,
    meta_description: compact(meta ? attribute(meta, "content") : "").slice(0, 600),
    h1,
    body_text: bodyText,
    links,
    truncated: fullText.length > LIMITS.max_text_characters,
    readable: !challenge && fullText.length >= 80 && fullText.split(/\s+/).length >= 12,
    challenge,
  };
}

/** Read-only, unauthenticated retrieval. Page text is evidence, never instructions. */
export async function readLivePage(raw: string, options: LivePageOptions, dependencies: Dependencies = {
  resolve: (hostname) => lookup(hostname, { all: true, verbatim: true }),
  request: requestPublicPage,
}): Promise<LivePageResult> {
  let current = raw;
  let httpStatus: number | undefined;
  const base = () => ({ url: raw, final_url: current, fetched_at: new Date().toISOString(), evidence_type: "untrusted_live_webpage" as const, limits: LIMITS, http_status: httpStatus });
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, LIMITS.timeout_ms);
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  try {
    let previous: string | undefined;
    for (let redirects = 0; redirects <= LIMITS.max_redirects; redirects += 1) {
      const url = parsedUrl(current);
      current = url.href;
      if (!isAllowedLivePageUrl(current, options, previous)) {
        throw new BlockedPage("This URL is outside the report's community pages and explicitly supplied URLs.");
      }
      if (controller.signal.aborted) throw new Error("The live page check was cancelled or exceeded its time limit.");
      const hostname = url.hostname.replace(/^\[|\]$/g, "");
      const family = isIP(hostname);
      const addresses = family ? [{ address: hostname, family }] : await withAbort(dependencies.resolve(hostname), controller.signal);
      if (!addresses.length || addresses.some((address) => !isPublicIpAddress(address.address) || isIP(address.address) !== address.family)) {
        throw new BlockedPage("The page hostname resolves to a private or reserved network address.");
      }
      if (controller.signal.aborted) throw new Error("The live page check was cancelled or exceeded its time limit.");
      const response = await withAbort(dependencies.request(url, addresses[0], controller.signal), controller.signal);
      httpStatus = response.status;
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (!response.location) throw new Error("The page returned a redirect without a destination.");
        if (redirects === LIMITS.max_redirects) throw new Error("The page exceeded the redirect limit.");
        previous = current;
        current = new URL(response.location, url).href;
        continue;
      }
      if (response.status !== 200) throw new Error(`The page returned HTTP ${response.status}; its contents could not be verified.`);
      const evidence = extractLivePageEvidence(response.body, current);
      if (!evidence.readable) {
        return { ...base(), status: evidence.challenge ? "blocked" : "error", reason: evidence.challenge ? "The website returned an access or bot-verification challenge; page content was not verified." : "The page did not expose enough readable HTML content to verify. It may require JavaScript." };
      }
      return {
        ...base(), status: "ok", title: evidence.title, meta_description: evidence.meta_description,
        h1: evidence.h1, body_text: evidence.body_text, links: evidence.links, truncated: evidence.truncated,
      };
    }
    throw new Error("The page exceeded the redirect limit.");
  } catch (error) {
    return { ...base(), status: error instanceof BlockedPage ? "blocked" : "error", reason: controller.signal.aborted ? "The live page check was cancelled or exceeded its time limit." : error instanceof Error ? error.message : "The page could not be checked." };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

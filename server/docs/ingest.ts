import { createHash } from "node:crypto";
import type { DocumentSourceInput } from "../../shared/types";

export interface DocPage {
  n: number; // 1-based
  text: string;
  hash: string;
}

export interface IngestedDoc {
  title: string;
  url?: string;
  pages: DocPage[];
  hash: string; // fingerprint of the whole document (order-sensitive hash of page hashes)
  chars: number;
}

const PSEUDO_PAGE_CHARS = 3500; // roughly one printed page of a QAP
export const tokensEst = (chars: number) => Math.ceil(chars / 4);
export const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function build(title: string, rawPages: string[], url?: string): IngestedDoc {
  const pages = rawPages.map(normalize).map((text, i) => ({ n: i + 1, text, hash: sha(text) }));
  return { title, url, pages, hash: sha(pages.map((p) => p.hash).join(":")), chars: pages.reduce((s, p) => s + p.text.length, 0) };
}

/** Splits pasted text into pages: form feeds, then "Page N" footers, then ~3.5k-char paragraph chunks. */
export function splitText(text: string): string[] {
  if (text.includes("\f")) return text.split("\f").filter((p) => p.trim());
  const footer = /\n[ \t]*(?:-\s*)?Page\s+\d+(?:\s+of\s+\d+)?(?:\s*-)?[ \t]*\n/gi;
  const byFooter = text.split(footer).filter((p) => p.trim());
  if (byFooter.length > 2) return byFooter;
  const out: string[] = [];
  let cur = "";
  for (const para of text.split(/\n\s*\n/)) {
    if (cur && cur.length + para.length > PSEUDO_PAGE_CHARS) {
      out.push(cur);
      cur = "";
    }
    // A single paragraph longer than a page is cut at sentence-ish boundaries.
    let rest = para;
    while (rest.length > PSEUDO_PAGE_CHARS * 1.5) {
      const cut = rest.lastIndexOf(". ", PSEUDO_PAGE_CHARS) + 1 || PSEUDO_PAGE_CHARS;
      out.push((cur + rest.slice(0, cut)).trim());
      cur = "";
      rest = rest.slice(cut);
    }
    cur += (cur ? "\n\n" : "") + rest;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

async function pdfPages(data: Uint8Array): Promise<string[]> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(data);
  const { text } = await extractText(pdf, { mergePages: false });
  return text;
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|nav|footer|header)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|br)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"');
}

export async function fetchDocument(url: string, title: string, timeoutMs = 20000): Promise<IngestedDoc> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { "user-agent": "Groundwork/0.1 (funding research)" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("pdf") || /\.pdf($|\?)/i.test(url)) {
    return build(title, await pdfPages(new Uint8Array(await res.arrayBuffer())), url);
  }
  return build(title, splitText(htmlToText(await res.text())), url);
}

/** Turns any DocumentSourceInput (except libraryKey) into normalized, hashed pages. */
export async function ingest(input: DocumentSourceInput): Promise<IngestedDoc> {
  if (input.pdfBase64) {
    const pages = await pdfPages(new Uint8Array(Buffer.from(input.pdfBase64, "base64")));
    return build(input.title, pages, input.url);
  }
  if (input.text) return build(input.title, splitText(input.text), input.url);
  if (input.url) return fetchDocument(input.url, input.title);
  throw new Error("Provide a PDF, pasted text, or a URL");
}

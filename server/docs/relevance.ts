import type { DocPage } from "./ingest";

/**
 * Free, local first pass over every page. Scores rule-bearing language and penalizes pages
 * that never carry rules (TOCs, forms, signature blocks). Only the ambiguous middle band is
 * worth spending triage tokens on.
 */

type Term = [RegExp, number];

const TOPICS: Record<string, Term[]> = {
  scoring: [
    [/\bpoints?\b/gi, 2],
    [/\bscor(e|es|ed|ing)\b/gi, 2],
    [/\btie[- ]?breaker/gi, 3],
    [/\bmaximum (of )?\d+ points\b/gi, 4],
    [/\bcompetitive\b/gi, 1],
  ],
  threshold: [
    [/\bthreshold\b/gi, 3],
    [/\beligib(le|ility)\b/gi, 2],
    [/\bminimum\b/gi, 1.5],
    [/\b(must|shall)\b/gi, 0.6],
    [/\brequire(d|ment|ments)?\b/gi, 0.8],
    [/\bdisqualif/gi, 2],
  ],
  income_rent: [
    [/\bAMI\b|area median (gross )?income/gi, 3],
    [/\bset[- ]asides?\b/gi, 3],
    [/\b(income|rent) limits?\b/gi, 3],
    [/\bextremely low[- ]income\b|\bvery low[- ]income\b/gi, 2],
    [/\bincome averaging\b/gi, 3],
    [/\butility allowance/gi, 2],
  ],
  cost: [
    [/\bper[- ]unit\b/gi, 2],
    [/\b(cost|subsidy) limits?\b/gi, 3],
    [/\bdeveloper fee\b/gi, 2],
    [/\beligible basis\b|\bbasis boost\b/gi, 3],
    [/\bleverage\b/gi, 1.5],
  ],
  site: [
    [/\bamenit(y|ies)\b/gi, 3],
    [/\b(transit|grocery|pharmacy|library|park)\b/gi, 1],
    [/\b\d+(\.\d+)?\s*miles?\b/gi, 1.5],
    [/\bopportunity (area|map|index)\b/gi, 3],
    [/\bQCT\b|qualified census tract|\bDDA\b|difficult development area/gi, 3],
  ],
  readiness: [
    [/\bsite control\b/gi, 3],
    [/\bzoning\b|\bentitlements?\b/gi, 2],
    [/\breadiness\b/gi, 3],
  ],
  compliance: [
    [/\bcomplian(ce|t)\b/gi, 1.5],
    [/\brecertif/gi, 3],
    [/\bmonitoring\b/gi, 2],
    [/\binspections?\b/gi, 1.5],
    [/\bregulatory agreement\b|\bextended use\b|\baffordability period\b/gi, 3],
  ],
};

const NEGATIVE: Term[] = [
  [/\.{5,}\s*\d+\s*$/gm, 2.5], // TOC dot leaders
  [/\btable of contents\b/gi, 8],
  [/\b(signature|signed|notary|notarized|witness whereof)\b/gi, 2],
  [/\bintentionally left blank\b/gi, 10],
  [/_{6,}/g, 1.5], // fill-in blanks on forms
  [/\b(attachment|exhibit|appendix) [A-Z0-9]+\b/g, 0.5],
];

export interface PageScore {
  n: number;
  score: number;
  topics: string[]; // topics with meaningful hits
  band: "keep" | "triage" | "drop";
}

// Thresholds on the length-normalized score. Tuned so a typical QAP keeps its scoring/threshold
// chapters, drops front matter and forms, and leaves a modest band for triage.
const KEEP_AT = 14;
const DROP_BELOW = 4;

function hits(text: string, re: RegExp): number {
  return Math.min(text.match(re)?.length ?? 0, 6); // cap so one repeated word can't dominate
}

export function scorePage(page: DocPage): PageScore {
  const text = page.text;
  if (text.length < 200) return { n: page.n, score: 0, topics: [], band: "drop" };
  let score = 0;
  const topics: string[] = [];
  for (const [topic, terms] of Object.entries(TOPICS)) {
    const t = terms.reduce((s, [re, w]) => s + hits(text, re) * w, 0);
    if (t >= 4) topics.push(topic);
    score += t;
  }
  // Numbers next to %, $ or "points" are a strong sign of an actual rule.
  score += Math.min(text.match(/\d+(\.\d+)?\s*(%|percent|points?)|\$\s?\d[\d,]*/gi)?.length ?? 0, 12) * 0.7;
  score -= NEGATIVE.reduce((s, [re, w]) => s + hits(text, re) * w, 0);
  // Normalize for page length so long pages don't win on volume alone.
  score = score / Math.sqrt(Math.max(text.length, 1500) / 3000);
  const band = score >= KEEP_AT ? "keep" : score < DROP_BELOW ? "drop" : "triage";
  return { n: page.n, score: Math.round(score * 10) / 10, topics, band };
}

export function scorePages(pages: DocPage[]): PageScore[] {
  // Short documents are cheap to read whole; filtering would only risk missing rules.
  if (pages.length <= 6) return pages.map((p) => ({ ...scorePage(p), band: p.text.length < 200 ? "drop" : "keep" }));
  return pages.map(scorePage);
}

/** Groups relevant pages into contiguous sections, bridging single-page gaps, capped in size. */
export function toSections(relevant: number[], pages: DocPage[], maxPages = 12, maxChars = 120_000): [number, number][] {
  const sorted = [...new Set(relevant)].sort((a, b) => a - b);
  const sections: [number, number][] = [];
  const chars = (a: number, b: number) => pages.slice(a - 1, b).reduce((s, p) => s + p.text.length, 0);
  for (const n of sorted) {
    const last = sections[sections.length - 1];
    if (last && n - last[1] <= 2 && n - last[0] + 1 <= maxPages && chars(last[0], n) <= maxChars) last[1] = n;
    else sections.push([n, n]);
  }
  return sections;
}

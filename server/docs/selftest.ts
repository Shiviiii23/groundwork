/**
 * Pipeline self-test with a stubbed model layer (no API key needed):
 *   npm run test:docs
 * Builds a synthetic 220-page QAP-shaped document, then checks page selection quality,
 * whole-document cache hits, and partial reuse when a new edition changes a few pages.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "groundwork-docs-"));
process.env.GROUNDWORK_LIBRARY_FILE = path.join(tmp, "library.json");
process.env.ANTHROPIC_API_KEY ||= "selftest-stub";

const { setModelCalls } = await import("./models");
const { runDocumentPipeline, previewDocument } = await import("./pipeline");

// ───────── synthetic document ─────────

type Kind = "cover" | "toc" | "narrative" | "definitions" | "procedure" | "threshold" | "scoring" | "income" | "cost" | "compliance" | "form" | "buried_rule" | "loose_talk";
const layout: [Kind, number][] = [
  ["cover", 1], ["toc", 4], ["narrative", 10], ["definitions", 15], ["procedure", 12], ["buried_rule", 6], ["loose_talk", 8],
  ["threshold", 20], ["scoring", 25], ["income", 10], ["cost", 5], ["compliance", 15], ["form", 95],
];
const RELEVANT: Kind[] = ["threshold", "scoring", "income", "cost", "compliance", "buried_rule"];

const para: Record<Kind, (n: number) => string> = {
  cover: () => "STATE HOUSING FINANCE AGENCY\n2026 QUALIFIED ALLOCATION PLAN\nLow-Income Housing Tax Credit Program\nAdopted by the Board of Directors",
  toc: (n) => Array.from({ length: 40 }, (_, i) => `Section ${n}.${i + 1} Program Requirements and Procedures ........................ ${n * 10 + i}`).join("\n"),
  narrative: (n) => `The Agency is committed to expanding the supply of affordable rental homes across the State. Over the past decade the program has financed thousands of homes in urban and rural communities. Housing need continues to grow as rents rise faster than wages, and the Agency works with local partners, nonprofit developers and community stakeholders to direct resources where they are most needed. Public comment on this plan was received at hearings held in ${n} regions, and the Agency appreciates the thoughtful feedback from residents, advocates and industry partners.`,
  definitions: (n) => `"Applicant" means the entity submitting an application. "Development" means the buildings and land described in the application. "Sponsor" means a person or entity that controls the general partner. "Term ${n}" has the meaning given in the Code and Treasury Regulations, as interpreted by the Agency from time to time.`,
  procedure: (n) => `Applications are submitted through the online portal. The applicant uploads each exhibit as a separate PDF named in the format described in the application manual. Questions about the portal may be directed to Agency staff by email. Late submissions will not be accepted. Round ${n} applications are reviewed in the order received, and the Agency will post a list of applications received on its website.`,
  threshold: (n) => `Threshold Requirement ${n}. Each application must meet the following minimum requirements to be eligible for review; an application that fails any threshold requirement shall be disqualified. The applicant must demonstrate site control through a deed, option or purchase contract. The development must have all zoning entitlements required. At least 40 percent of units must be restricted to households at or below 60% of Area Median Income (AMI). The applicant shall provide a market study meeting the minimum standards.`,
  scoring: (n) => `Scoring Category ${n}. Applications will be scored competitively; a maximum of 10 points is available in this category. Developments located within 0.5 miles of a transit stop receive 4 points; within 1 mile, 2 points. Proximity to a full-scale grocery store within 1 mile: 3 points. Developments in a High Resource opportunity area receive 8 points. Tie-breaker: the ratio of committed public funds to total development cost, with leverage above 20% scoring highest.`,
  income: (n) => `Income Targeting ${n}. Points are awarded for units restricted to deeper income levels: 10% of units at or below 30% AMI earn 5 points; 20% of units at or below 50% AMI earn 3 points. Rent limits are set at 30% of the imputed income limit, less the utility allowance. Income averaging may be elected provided the average does not exceed 60% AMI. The set-aside election is irrevocable.`,
  cost: (n) => `Cost Containment ${n}. Total development cost per unit shall not exceed $650,000 in high-cost areas; the developer fee is limited to 15% of eligible basis. Developments in a Qualified Census Tract (QCT) or Difficult Development Area (DDA) may receive a basis boost of up to 130% of eligible basis. Points: per-unit costs below the regional median earn 3 points.`,
  compliance: (n) => `Compliance Monitoring ${n}. Owners must recertify tenant income annually and maintain records for each unit. The Agency will conduct physical inspections of at least 20% of units every three years. Owners shall submit an annual owner certification of compliance. The extended use period and regulatory agreement require affordability for 55 years. Noncompliance is reported on IRS Form 8823.`,
  // Borderline pages: mostly procedure with one real requirement, or narrative that only talks *about* scoring.
  buried_rule: (n) => (n % 6 === 0 ? `Applicants must reserve at least 10% of units for households at or below 30% AMI, and the development must remain affordable for 55 years. ` : "") + `Submission ${n}: upload the exhibit to the portal and confirm receipt with Agency staff. Applicants should retain copies of all exhibits for their records and contact staff with any questions about the portal.`,
  loose_talk: (n) => (n % 6 === 0 ? `Last year the Agency received many applications and scoring was competitive; several stakeholders asked whether more points should be available, and staff will continue to review eligibility questions. ` : "") + `Background ${n}: the Agency held listening sessions across the State and summarizes the themes we heard from residents and partners about housing need and community priorities in this section.`,
  form: (n) => `EXHIBIT ${n} — APPLICANT CERTIFICATION\nName of Applicant: ______________________\nAddress: ______________________________\nI certify under penalty of perjury that the information is true. Signature: ________________ Date: ________\nNotary Public: ______________ In witness whereof, the undersigned has signed this certification.`,
};

function buildDoc(edits: Record<number, string> = {}): { text: string; kinds: Kind[] } {
  const kinds: Kind[] = [];
  for (const [kind, count] of layout) for (let i = 0; i < count; i++) kinds.push(kind);
  const pages = kinds.map((k, i) => {
    const n = i + 1;
    const body = Array.from({ length: k === "toc" || k === "cover" ? 1 : 6 }, (_, j) => para[k](n * 10 + j)).join("\n\n");
    return (edits[n] ? `${body}\n\n${edits[n]}` : body) + `\n\nPage ${n} of ${kinds.length}`;
  });
  return { text: pages.join("\f"), kinds };
}

// ───────── stubbed model layer ─────────

let triageCalls = 0;
let extractCalls = 0;
let extractedRanges: [number, number][] = [];
const truth = buildDoc().kinds;
setModelCalls({
  async triage(_name, pages) {
    triageCalls++;
    const relevant = new Set(pages.filter((p) => RELEVANT.includes(truth[p.page - 1])).map((p) => p.page));
    return { relevant, usage: { model: "claude-haiku-5-5", inputTokens: pages.length * 400, outputTokens: pages.length * 12, cacheReadTokens: 0, cacheWriteTokens: 0 } };
  },
  async extract(req) {
    extractCalls++;
    extractedRanges.push(req.pages);
    const rules = [];
    for (let n = req.pages[0]; n <= req.pages[1]; n++) {
      if (!RELEVANT.includes(truth[n - 1])) continue;
      const pts = truth[n - 1] === "scoring";
      rules.push({ id: `p${n}`, category: pts ? "scoring" : "threshold", kind: pts ? "points" : "threshold", title: `Rule from page ${n}`, description: "stub", citation: `p. ${n}`, maxPoints: pts ? 5 : 0, check: { op: "truthy", field: "project.siteControl" } });
    }
    return {
      raw: { program: { name: "State QAP 2026", shortName: "State QAP", administrator: "State HFA", jurisdiction: "XX", type: "federal_tax_credit", awardType: "tax_credit", description: "stub", typicalAward: "", applicationCycle: "" }, rules, complianceRules: [] } as never,
      usage: { model: "claude-opus-5-5", inputTokens: Math.ceil(req.text.length / 4) + 2500, outputTokens: 2500, cacheReadTokens: extractCalls > 1 ? 2500 : 0, cacheWriteTokens: 0 },
    };
  },
});

// ───────── checks ─────────

const hooks = { step: (_l: string, m: string) => console.log("   ·", m), progress: () => {} };
let failures = 0;
const check = (ok: boolean, msg: string) => {
  console.log(ok ? "  ✓" : "  ✗", msg);
  if (!ok) failures++;
};
const relevantTruth = truth.map((k, i) => (RELEVANT.includes(k) ? i + 1 : 0)).filter(Boolean);

console.log("\n1. Preview (free, no model calls)");
const doc1 = buildDoc();
const preview = await previewDocument({ title: "State QAP 2026", sourceName: "State QAP", text: doc1.text });
console.log(`   ${preview.pageCount} pages · kept ${preview.keywordKept} · dropped ${preview.keywordDropped} · ambiguous ${preview.triaged} · est $${preview.costUsd.toFixed(2)} vs $${preview.fullReadCostUsdEst.toFixed(2)}`);
check(preview.llmSkipped === true && preview.pageCount === truth.length, `preview parses ${truth.length} pages without calling a model`);
check(preview.costUsd < preview.fullReadCostUsdEst, "preview estimate beats a full read");

console.log("\n2. First extraction");
const r1 = await runDocumentPipeline({ title: "State QAP 2026", sourceName: "State QAP", text: doc1.text }, hooks);
const s1 = r1.stats;
const found = new Set(s1.relevantPages);
const recall = relevantTruth.filter((n) => found.has(n)).length / relevantTruth.length;
const precision = s1.relevantPages.filter((n) => relevantTruth.includes(n)).length / s1.relevantPages.length;
console.log(`   relevant ${s1.relevantPages.length}/${s1.pageCount} · recall ${(recall * 100).toFixed(0)}% · precision ${(precision * 100).toFixed(0)}% · ${s1.sections.length} sections · ${s1.llmCalls} calls · $${s1.costUsd.toFixed(2)} vs full read ~$${s1.fullReadCostUsdEst.toFixed(2)}`);
check(recall >= 0.95, "recall ≥ 95% of rule pages");
check(precision >= 0.85, "precision ≥ 85%");
check(s1.costUsd < s1.fullReadCostUsdEst * 0.8, "costs less than reading the whole document");
check(s1.triaged > 0 && s1.triageKept > 0 && s1.triageKept < s1.triaged, `triage engaged on ambiguous pages (${s1.triageKept}/${s1.triaged} kept)`);
check(s1.keywordDropped >= 80, "local pass drops forms/TOC/boilerplate without any model call");
check(r1.rules.length >= 70, `rules merged across sections (${r1.rules.length})`);

console.log("\n3. Same document again");
const [t0, e0] = [triageCalls, extractCalls];
const r2 = await runDocumentPipeline({ title: "State QAP 2026 (re-upload)", sourceName: "Whatever name", text: doc1.text }, hooks);
check(r2.stats.cacheHit === "full" && triageCalls === t0 && extractCalls === e0, "identical document → full cache hit, zero model calls");
check(r2.rules.length === r1.rules.length, "same rules returned");

console.log("\n4. New edition: 2 scoring pages changed");
extractedRanges = [];
const [t1, e1] = [triageCalls, extractCalls];
const doc3 = buildDoc({ 82: "NEW FOR 2027: an additional 2 points for developments within 0.25 miles of a pharmacy.", 84: "Revised 2027: the leverage tie-breaker now uses 25%." });
const r3 = await runDocumentPipeline({ title: "State QAP 2027", sourceName: "State QAP", text: doc3.text }, hooks);
console.log(`   ${r3.stats.sections.filter((s) => s.cached).length}/${r3.stats.sections.length} sections reused · ${extractCalls - e1} extraction calls · ${triageCalls - t1} triage calls · $${r3.stats.costUsd.toFixed(2)}`);
check(r3.stats.cacheHit === "partial", "new edition → partial reuse");
check(extractCalls - e1 <= 2 && extractedRanges.every(([a, b]) => a <= 84 && b >= 82), "only the changed section(s) are re-extracted");
check(r3.stats.costUsd < s1.costUsd * 0.35, "new edition costs a fraction of the first extraction");

console.log("\n5. Different source with an overlapping page is NOT shared");
const e2 = extractCalls;
await runDocumentPipeline({ title: "City NOFA", sourceName: "City NOFA", text: buildDoc({ 1: "City of Example" }).text }, hooks);
check(extractCalls > e2, "section cache is scoped to its own funding source");

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? `\n✗ ${failures} check(s) failed` : "\n✓ document pipeline self-test passed");
process.exit(failures ? 1 : 0);

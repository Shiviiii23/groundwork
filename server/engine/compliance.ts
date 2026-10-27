// Post-award compliance: evaluates a property's rent roll and filing history
// against the compliance rules of the programs it was awarded, and generates
// realistic demo data (with a few deliberate issues) when none is uploaded.

import type {
  ComplianceData,
  ComplianceEvent,
  ComplianceFinding,
  ComplianceReport,
  ComplianceRule,
  ComplianceStatus,
  FundingProgram,
  Project,
  TenantUnit,
  UnitComplianceRow,
} from "../../shared/types";
import { pct, usdExact } from "./format";
import { incomeLimit, rentLimit } from "./limits";

const DEFAULT_AMI = 100_000;
const DAY = 86_400_000;
const STATUS_RANK: Record<ComplianceStatus, number> = { compliant: 0, pending: 1, at_risk: 2, violation: 3 };

// ───────────────────────── Date helpers ─────────────────────────

function addMonths(d: Date, months: number): Date {
  const out = new Date(d);
  out.setMonth(out.getMonth() + months);
  return out;
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const monthsBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / (DAY * 30.44);

// ───────────────────────── Program selection ─────────────────────────

/** Awarded programs; else those being applied for; else the top-3 eligible by fit. */
export function complianceProgramsFor(project: Project): FundingProgram[] {
  const awarded = project.programs.filter((p) => p.pursuit === "awarded");
  if (awarded.length) return awarded;
  const applying = project.programs.filter((p) => p.pursuit === "applying");
  if (applying.length) return applying;
  const ranked = [...project.scores].filter((s) => s.eligible).sort((a, b) => b.fitScore - a.fitScore);
  const top = ranked
    .map((s) => project.programs.find((p) => p.id === s.programId))
    .filter((p): p is FundingProgram => Boolean(p) && p!.pursuit !== "declined")
    .slice(0, 3);
  return top.length ? top : project.programs.slice(0, 3);
}

// ───────────────────────── Unit evaluation ─────────────────────────

const isRestricted = (u: TenantUnit) => u.designatedAmiPct <= 80;

function unitRow(u: TenantUnit, ami4: number, now: Date): UnitComplianceRow {
  const grossRent = u.rentCharged + u.utilityAllowance;
  if (!isRestricted(u)) {
    return { unitId: u.unitId, status: "compliant", incomeLimit: 0, rentLimit: 0, grossRent, incomePctOfLimit: 0, issues: [] };
  }
  const iLimit = incomeLimit(ami4, u.designatedAmiPct, u.householdSize);
  const rLimit = rentLimit(ami4, u.designatedAmiPct, u.bedrooms);
  const issues: string[] = [];
  let status: ComplianceStatus = "compliant";
  const bump = (s: ComplianceStatus) => {
    if (STATUS_RANK[s] > STATUS_RANK[status]) status = s;
  };

  if (u.isVacant) {
    return { unitId: u.unitId, status: "pending", incomeLimit: iLimit, rentLimit: rLimit, grossRent: 0, incomePctOfLimit: 0, issues: ["Vacant — lease to a qualified household"] };
  }
  if (u.annualIncomeAtMoveIn > iLimit) {
    issues.push(`Over-income at move-in: ${usdExact(u.annualIncomeAtMoveIn)} vs ${usdExact(iLimit)} limit`);
    bump("violation");
  }
  if (grossRent > rLimit) {
    issues.push(`Gross rent ${usdExact(grossRent)} exceeds ${usdExact(rLimit)} limit by ${usdExact(grossRent - rLimit)}`);
    bump("violation");
  }
  const certAge = monthsBetween(new Date(u.lastCertDate), now);
  if (certAge > 12) {
    issues.push(`Income recertification ${Math.floor(certAge)} months old`);
    bump(certAge > 18 ? "violation" : "at_risk");
  }
  if (u.currentAnnualIncome > iLimit * 1.4) {
    issues.push(`Current income ${pct(u.currentAnnualIncome / iLimit, 0)} of limit — Next Available Unit rule applies`);
    bump("at_risk");
  }
  if (u.allFullTimeStudents) {
    issues.push("All-student household — verify student-rule exception");
    bump("violation");
  }
  return {
    unitId: u.unitId,
    status,
    incomeLimit: iLimit,
    rentLimit: rLimit,
    grossRent,
    incomePctOfLimit: iLimit > 0 ? u.currentAnnualIncome / iLimit : 0,
    issues,
  };
}

// ───────────────────────── Rule evaluation ─────────────────────────

interface EvalState {
  units: TenantUnit[];
  rows: Map<string, UnitComplianceRow>;
  events: ComplianceEvent[];
  ami4: number;
  pis: Date;
  now: Date;
}

function lastEvent(events: ComplianceEvent[], key: string): ComplianceEvent | undefined {
  return events.filter((e) => e.key === key).sort((a, b) => b.completedDate.localeCompare(a.completedDate))[0];
}

function evaluateRule(rule: ComplianceRule, s: EvalState): ComplianceFinding {
  const base = {
    ruleId: rule.id,
    programId: rule.programId,
    title: rule.title,
    category: rule.category,
    citation: rule.citation,
  };
  const occupied = s.units.filter((u) => isRestricted(u) && !u.isVacant);
  const params = rule.check.params ?? {};

  switch (rule.check.kind) {
    case "unit_income_at_movein": {
      const bad = occupied.filter((u) => u.annualIncomeAtMoveIn > (s.rows.get(u.unitId)?.incomeLimit ?? Infinity));
      return {
        ...base,
        status: bad.length ? "violation" : "compliant",
        detail: bad.length
          ? `${bad.length} household${bad.length > 1 ? "s" : ""} exceeded the income limit at move-in. Unit(s) do not qualify as low-income until corrected (Form 8823 reportable).`
          : `All ${occupied.length} restricted households were income-qualified at move-in.`,
        affectedUnits: bad.map((u) => u.unitId),
        metric: { label: "Over-income households", value: bad.length, threshold: 0, unit: "count" },
      };
    }
    case "unit_rent_limit": {
      const bad = occupied.filter((u) => {
        const r = s.rows.get(u.unitId)!;
        return r.grossRent > r.rentLimit;
      });
      return {
        ...base,
        status: bad.length ? "violation" : "compliant",
        detail: bad.length
          ? `${bad.length} unit${bad.length > 1 ? "s" : ""} charge gross rent above the limit (rent + utility allowance). Refund overcharges and adjust leases.`
          : `All ${occupied.length} restricted units are at or below their max gross rent.`,
        affectedUnits: bad.map((u) => u.unitId),
        metric: { label: "Units over rent limit", value: bad.length, threshold: 0, unit: "count" },
      };
    }
    case "annual_recert": {
      const stale = occupied.filter((u) => monthsBetween(new Date(u.lastCertDate), s.now) > 12);
      const dueSoon = occupied.filter((u) => {
        const age = monthsBetween(new Date(u.lastCertDate), s.now);
        return age > 10 && age <= 12;
      });
      const severe = stale.some((u) => monthsBetween(new Date(u.lastCertDate), s.now) > 18);
      return {
        ...base,
        status: severe ? "violation" : stale.length ? "at_risk" : "compliant",
        detail: stale.length
          ? `${stale.length} recertification${stale.length > 1 ? "s are" : " is"} past the 12-month anniversary${dueSoon.length ? `; ${dueSoon.length} more due within 60 days` : ""}.`
          : `All certifications current${dueSoon.length ? `; ${dueSoon.length} due within 60 days` : ""}.`,
        affectedUnits: stale.map((u) => u.unitId),
        metric: { label: "Overdue recertifications", value: stale.length, threshold: 0, unit: "count" },
      };
    }
    case "set_aside_minimum": {
      const amiPct = Number(params.amiPct ?? 60);
      const minPct = Number(params.minPct ?? 0.4);
      const total = s.units.length;
      // A unit counts toward the set-aside when designated at/below the tier, occupied
      // by a household qualified at move-in (or vacant but previously qualified).
      const qualifying = s.units.filter((u) => {
        if (u.designatedAmiPct > amiPct) return false;
        if (u.isVacant) return true;
        const r = s.rows.get(u.unitId)!;
        return u.annualIncomeAtMoveIn <= r.incomeLimit && !u.allFullTimeStudents;
      });
      const share = total ? qualifying.length / total : 0;
      const status: ComplianceStatus = share < minPct ? "violation" : share < minPct + 0.02 ? "at_risk" : "compliant";
      return {
        ...base,
        status,
        detail: `${qualifying.length} of ${total} units (${pct(share)}) qualify at ≤ ${amiPct}% AMI; minimum ${pct(minPct, 0)}.`,
        affectedUnits: [],
        metric: { label: `Units ≤ ${amiPct}% AMI`, value: share, threshold: minPct, unit: "%" },
      };
    }
    case "next_available_unit": {
      const over = occupied.filter((u) => (s.rows.get(u.unitId)?.incomePctOfLimit ?? 0) > 1.4);
      return {
        ...base,
        status: over.length ? "at_risk" : "compliant",
        detail: over.length
          ? `${over.length} household${over.length > 1 ? "s" : ""} above 140% of the limit — the next available comparable unit must be leased to a qualified household.`
          : "No households above 140% of the income limit.",
        affectedUnits: over.map((u) => u.unitId),
      };
    }
    case "student_rule": {
      const students = occupied.filter((u) => u.allFullTimeStudents);
      return {
        ...base,
        status: students.length ? "violation" : "compliant",
        detail: students.length
          ? `${students.length} all-full-time-student household${students.length > 1 ? "s" : ""} — document a §42(i)(3)(D) exception or the unit is out of compliance.`
          : "No all-student households.",
        affectedUnits: students.map((u) => u.unitId),
      };
    }
    case "deadline": {
      const key = String(params.key ?? rule.id);
      const every = Number(params.everyMonths ?? 12);
      const last = lastEvent(s.events, key);
      const due = addMonths(last ? new Date(last.completedDate) : s.pis, every);
      const daysLeft = Math.round((due.getTime() - s.now.getTime()) / DAY);
      const status: ComplianceStatus = daysLeft < 0 ? "violation" : daysLeft <= 60 ? "at_risk" : "compliant";
      return {
        ...base,
        status,
        detail: `${last ? `Last completed ${last.completedDate}` : "Never completed"}; ${
          daysLeft < 0 ? `overdue by ${-daysLeft} days` : `next due in ${daysLeft} days`
        } (every ${every} months).`,
        affectedUnits: [],
        dueDate: isoDate(due),
        metric: { label: "Days until due", value: daysLeft, threshold: 0, unit: "days" },
      };
    }
    case "manual": {
      const key = String(params.key ?? rule.id);
      const done = lastEvent(s.events, key);
      const years = params.years ? Number(params.years) : undefined;
      const termNote = years
        ? ` Year ${Math.max(1, Math.ceil(monthsBetween(s.pis, s.now) / 12))} of ${years}; term ends ${isoDate(addMonths(s.pis, years * 12))}.`
        : "";
      return {
        ...base,
        status: done ? "compliant" : "pending",
        detail: (done ? `Documented ${done.completedDate}.` : "Not yet documented — upload or record completion.") + termNote,
        affectedUnits: [],
      };
    }
  }
}

// ───────────────────────── Public API ─────────────────────────

export function evaluateCompliance(project: Project): ComplianceReport {
  const now = new Date();
  const data = project.compliance ?? sampleComplianceData(project);
  const ami4 = project.geo?.areaMedianIncome ?? DEFAULT_AMI;
  const rows = data.units.map((u) => unitRow(u, ami4, now));
  const state: EvalState = {
    units: data.units,
    rows: new Map(rows.map((r) => [r.unitId, r])),
    events: data.events,
    ami4,
    pis: new Date(data.placedInServiceDate),
    now,
  };
  const programs = complianceProgramsFor(project);
  const findings = programs.flatMap((p) => p.complianceRules.map((r) => evaluateRule(r, state)));

  const decided = findings.filter((f) => f.status !== "pending");
  const scorePct = decided.length ? decided.filter((f) => f.status === "compliant").length / decided.length : 1;
  const worst = findings.reduce<ComplianceStatus>(
    (w, f) => (f.status !== "pending" && STATUS_RANK[f.status] > STATUS_RANK[w] ? f.status : w),
    "compliant",
  );
  const overall: ComplianceStatus = decided.length === 0 && findings.length ? "pending" : worst;

  const horizon = addMonths(now, 12).getTime();
  const seen = new Set<string>();
  const upcoming = findings
    .filter((f) => f.dueDate && new Date(f.dueDate).getTime() <= horizon)
    .filter((f) => {
      // Shared deadlines (e.g. one owner cert covering two LIHTC programs) appear once per program.
      const k = `${f.programId}|${f.title}|${f.dueDate}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))
    .map((f) => ({ title: f.title, dueDate: f.dueDate!, programId: f.programId, ruleId: f.ruleId }));

  return {
    projectId: project.id,
    generatedAt: now.toISOString(),
    programIds: programs.map((p) => p.id),
    overall,
    scorePct,
    findings,
    units: rows,
    upcoming,
  };
}

// ───────────────────────── Sample data ─────────────────────────

function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Realistic rent roll for the project's unit mix with ~5% deliberate issues. */
export function sampleComplianceData(project: Project): ComplianceData {
  const rand = seededRandom(project.id);
  const between = (lo: number, hi: number) => lo + (hi - lo) * rand();
  const ami4 = project.geo?.areaMedianIncome ?? DEFAULT_AMI;
  const now = new Date();
  const pis = addMonths(now, -26);

  const units: TenantUnit[] = [];
  let i = 0;
  for (const row of project.input.unitMix) {
    for (let n = 0; n < row.count; n++, i++) {
      const floor = Math.floor(i / 12) + 1;
      const unitId = String(floor * 100 + (i % 12) + 1);
      const restricted = row.targetAmiPct <= 80;
      const size = Math.max(1, Math.min(6, row.bedrooms === 0 ? 1 : row.bedrooms + Math.round(between(-0.4, 1.4))));
      const ua = 55 + 30 * row.bedrooms;
      const limit = incomeLimit(ami4, Math.min(row.targetAmiPct, 80), size);
      const moveInIncome = restricted ? Math.round(limit * between(0.55, 0.95)) : Math.round(limit * between(1.2, 1.8));
      const moveIn = new Date(pis.getTime() + between(0, monthsBetween(pis, now) - 2) * 30.44 * DAY);
      const certAgo = between(1, 11);
      const lastCert = new Date(Math.max(moveIn.getTime(), now.getTime() - certAgo * 30.44 * DAY));
      const rent = restricted
        ? Math.round(rentLimit(ami4, row.targetAmiPct, row.bedrooms) - ua - between(0, 60))
        : Math.round(row.proposedRent - ua);
      units.push({
        unitId,
        bedrooms: row.bedrooms,
        designatedAmiPct: row.targetAmiPct,
        isVacant: false,
        householdSize: size,
        annualIncomeAtMoveIn: moveInIncome,
        currentAnnualIncome: Math.round(moveInIncome * between(1.0, 1.08)),
        rentCharged: rent,
        utilityAllowance: ua,
        moveInDate: isoDate(moveIn),
        lastCertDate: isoDate(lastCert),
        allFullTimeStudents: false,
      });
    }
  }

  // Deliberate issues spread across restricted units.
  const restrictedIdx = units.map((u, idx) => (isRestricted(u) ? idx : -1)).filter((x) => x >= 0);
  const pick = (frac: number) => units[restrictedIdx[Math.min(restrictedIdx.length - 1, Math.floor(restrictedIdx.length * frac))]];
  const limitFor = (u: TenantUnit) => incomeLimit(ami4, u.designatedAmiPct, u.householdSize);
  if (restrictedIdx.length >= 8) {
    const overIncome = pick(0.12);
    overIncome.annualIncomeAtMoveIn = Math.round(limitFor(overIncome) * 1.08);
    overIncome.currentAnnualIncome = Math.round(overIncome.annualIncomeAtMoveIn * 1.03);

    const overRent = pick(0.33);
    overRent.rentCharged = rentLimit(ami4, overRent.designatedAmiPct, overRent.bedrooms) - overRent.utilityAllowance + 45;

    for (const [frac, months] of [[0.48, 14], [0.71, 16]] as const) {
      const u = pick(frac);
      u.moveInDate = isoDate(addMonths(now, -(months + 6)));
      u.lastCertDate = isoDate(addMonths(now, -months));
    }

    pick(0.57).allFullTimeStudents = true;

    const riser = pick(0.86);
    riser.currentAnnualIncome = Math.round(limitFor(riser) * 1.52);

    for (const frac of [0.25, 0.93]) {
      const v = pick(frac);
      Object.assign(v, { isVacant: true, householdSize: 0, annualIncomeAtMoveIn: 0, currentAnnualIncome: 0, rentCharged: 0 });
    }
  }

  // Filing history: everything current except an overdue owner certification.
  const events: ComplianceEvent[] = [];
  const keys = new Map<string, { everyMonths?: number }>();
  for (const p of project.programs) {
    for (const r of p.complianceRules) {
      if (r.check.kind === "deadline" || r.check.kind === "manual") {
        keys.set(String(r.check.params?.key ?? r.id), { everyMonths: r.check.params?.everyMonths as number | undefined });
      }
    }
  }
  for (const [key, { everyMonths }] of keys) {
    if (!everyMonths) {
      events.push({ key, completedDate: isoDate(addMonths(pis, 3)), note: "Recorded at conversion" });
    } else if (key === "annual_owner_cert") {
      events.push({ key, completedDate: isoDate(addMonths(now, -13)), note: "Prior-year certification" });
    } else if (key === "physical_inspection") {
      events.push({ key, completedDate: isoDate(addMonths(now, -20)), note: "Agency inspection — 2 minor findings closed" });
    } else {
      events.push({ key, completedDate: isoDate(addMonths(now, -Math.round(between(2, Math.min(everyMonths - 1, 10))))) });
    }
  }

  return { units, events, placedInServiceDate: isoDate(pis), updatedAt: now.toISOString() };
}

// ───────────────────────── CSV import ─────────────────────────

const CSV_ALIASES: Record<keyof TenantUnit, string[]> = {
  unitId: ["unitid", "unit", "unit_id", "unitnumber", "unit#"],
  bedrooms: ["bedrooms", "br", "beds", "bdrm"],
  designatedAmiPct: ["designatedamipct", "ami", "amipct", "ami%", "settier", "designation"],
  isVacant: ["isvacant", "vacant"],
  householdSize: ["householdsize", "hhsize", "size", "persons"],
  annualIncomeAtMoveIn: ["annualincomeatmovein", "moveinincome", "initialincome", "incomeatmovein"],
  currentAnnualIncome: ["currentannualincome", "currentincome", "income", "annualincome"],
  rentCharged: ["rentcharged", "rent", "tenantrent", "tenantpaidrent"],
  utilityAllowance: ["utilityallowance", "ua", "utilities"],
  moveInDate: ["moveindate", "movein", "move_in"],
  lastCertDate: ["lastcertdate", "lastcert", "certdate", "recertdate", "lastrecert"],
  allFullTimeStudents: ["allfulltimestudents", "students", "student", "studenthousehold"],
};

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const toBool = (v: string) => /^(1|y|yes|true|t|x)$/i.test(v.trim());
const toNum = (v: string) => Number(v.replace(/[$,%\s]/g, "")) || 0;
function toDate(v: string): string {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : isoDate(d);
}

/** Parses a rent roll CSV with a header row; column names are matched loosely. */
export function parseRentRollCsv(csv: string): TenantUnit[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/[\s_\-()]/g, ""));
  const col = (field: keyof TenantUnit) => header.findIndex((h) => CSV_ALIASES[field].includes(h) || h === field.toLowerCase());
  const idx = Object.fromEntries((Object.keys(CSV_ALIASES) as (keyof TenantUnit)[]).map((k) => [k, col(k)])) as Record<
    keyof TenantUnit,
    number
  >;
  const today = isoDate(new Date());

  return lines.slice(1).map((line, n) => {
    const cells = splitCsvLine(line);
    const get = (k: keyof TenantUnit) => (idx[k] >= 0 ? cells[idx[k]] ?? "" : "");
    const current = toNum(get("currentAnnualIncome"));
    const moveIn = toDate(get("moveInDate")) || today;
    return {
      unitId: get("unitId") || String(n + 1),
      bedrooms: toNum(get("bedrooms")),
      designatedAmiPct: toNum(get("designatedAmiPct")) || 60,
      isVacant: toBool(get("isVacant")),
      householdSize: toNum(get("householdSize")) || 1,
      annualIncomeAtMoveIn: toNum(get("annualIncomeAtMoveIn")) || current,
      currentAnnualIncome: current || toNum(get("annualIncomeAtMoveIn")),
      rentCharged: toNum(get("rentCharged")),
      utilityAllowance: toNum(get("utilityAllowance")),
      moveInDate: moveIn,
      lastCertDate: toDate(get("lastCertDate")) || moveIn,
      allFullTimeStudents: toBool(get("allFullTimeStudents")),
    };
  });
}

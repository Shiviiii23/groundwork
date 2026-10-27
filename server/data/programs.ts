// Funding program knowledge base. Each program encodes its eligibility thresholds
// and competitive scoring as RuleCheck DSL, with citations to the governing
// statute, regulation or allocation plan, plus post-award compliance rules.
//
// Point tables are simplified from the cited QAPs / NOFAs (latest cycles known
// at build time). Always confirm against the current year's document.

import type {
  ComplianceRule,
  FundingProgram,
  ProjectInput,
  Rule,
  RuleCategory,
  RuleCheck,
} from "../../shared/types";

// ───────────────────────── Builders ─────────────────────────

function ruleBuilder(programId: string) {
  return {
    threshold(
      id: string,
      title: string,
      description: string,
      citation: string,
      check: RuleCheck,
      category: RuleCategory = "threshold",
    ): Rule {
      return { id: `${programId}:${id}`, programId, kind: "threshold", category, title, description, citation, check };
    },
    points(
      id: string,
      title: string,
      description: string,
      citation: string,
      maxPoints: number,
      check: RuleCheck,
      category: RuleCategory = "scoring",
    ): Rule {
      return { id: `${programId}:${id}`, programId, kind: "points", category, title, description, citation, maxPoints, check };
    },
  };
}

function complianceBuilder(programId: string) {
  return (
    id: string,
    category: ComplianceRule["category"],
    title: string,
    description: string,
    citation: string,
    frequency: ComplianceRule["frequency"],
    check: ComplianceRule["check"],
  ): ComplianceRule => ({ id: `${programId}:c:${id}`, programId, category, title, description, citation, frequency, check });
}

/** Standard IRC §42 compliance obligations shared by every LIHTC program. */
function lihtcCompliance(programId: string, agency: string, extendedUseYears: number): ComplianceRule[] {
  const c = complianceBuilder(programId);
  return [
    c("set-aside", "set_aside", "Minimum set-aside maintained", "At least 40% of units must be rent- and income-restricted at ≤ 60% AMI (or the elected 20/50 or income-averaging test) every year of the compliance period.", "IRC §42(g)(1)", "ongoing", { kind: "set_aside_minimum", params: { amiPct: 60, minPct: 0.4 } }),
    c("income", "income", "Household income ≤ limit at move-in", "Each low-income household's income at initial occupancy must not exceed the limit for its designated AMI tier and household size.", "IRC §42(g)(1); Treas. Reg. §1.42-5(b)", "event", { kind: "unit_income_at_movein" }),
    c("rent", "rent", "Gross rent ≤ LIHTC max rent", "Tenant-paid rent plus utility allowance may not exceed 30% of the imputed income limit for the unit's tier.", "IRC §42(g)(2); Treas. Reg. §1.42-10", "monthly", { kind: "unit_rent_limit" }),
    c("recert", "income", "Annual tenant income recertification", `Tenant income certifications must be completed annually (or per ${agency} waiver for 100% LIHTC properties).`, "Treas. Reg. §1.42-5(b)(1)(vi)", "annual", { kind: "annual_recert" }),
    c("nau", "occupancy", "Next Available Unit rule (140%)", "When a household's income rises above 140% of the limit, the next available comparable unit must be rented to a qualified household.", "IRC §42(g)(2)(D)", "event", { kind: "next_available_unit" }),
    c("student", "occupancy", "Full-time student restriction", "Units occupied entirely by full-time students are not low-income units unless an exception applies (e.g. AFDC/TANF, single parent, foster youth).", "IRC §42(i)(3)(D)", "event", { kind: "student_rule" }),
    c("owner-cert", "reporting", "Annual owner certification", `Owner certifies compliance to ${agency} annually; non-compliance is reported to the IRS on Form 8823.`, "Treas. Reg. §1.42-5(c)(1)", "annual", { kind: "deadline", params: { key: "annual_owner_cert", everyMonths: 12 } }),
    c("inspection", "physical", "Physical inspection (NSPIRE standards)", `${agency} inspects the property and at least 20% of low-income units at least every 3 years.`, "Treas. Reg. §1.42-5(c)(2)(ii); 24 CFR Part 5 Subpart G (NSPIRE)", "triennial", { kind: "deadline", params: { key: "physical_inspection", everyMonths: 36 } }),
    c("form-8609", "reporting", "Form 8609 issued & filed", "Allocation certification (Form 8609) issued by the agency and filed with the owner's first-year return.", "IRC §42(l)(1)", "once", { kind: "manual", params: { key: "form_8609" } }),
    c("extended-use", "affordability_term", `Extended use agreement (${extendedUseYears} years)`, `Recorded regulatory agreement keeps units affordable for ${extendedUseYears} years from placed-in-service.`, "IRC §42(h)(6)", "ongoing", { kind: "manual", params: { key: "lura_recorded", years: extendedUseYears } }),
  ];
}

// ───────────────────────── Federal 9% LIHTC (generic QAP) ─────────────────────────

function fed9(): FundingProgram {
  const id = "fed-lihtc-9";
  const r = ruleBuilder(id);
  return {
    id,
    name: "9% Low-Income Housing Tax Credit (Competitive)",
    shortName: "9% LIHTC",
    type: "federal_tax_credit",
    awardType: "tax_credit",
    administrator: "State housing finance agency (per Qualified Allocation Plan)",
    jurisdiction: "federal",
    description:
      "Competitive federal tax credits worth ~70% of the present value of qualified basis, allocated annually by each state's QAP. Credits are syndicated to investors for equity over a 10-year credit period.",
    typicalAward: "$1M–$2M annual credits (~$9M–$18M equity)",
    applicationCycle: "Annual competitive round (varies by state)",
    url: "https://www.huduser.gov/portal/datasets/lihtc.html",
    sourceDocument: { title: "26 U.S.C. §42 + representative state QAP scoring", url: "https://www.law.cornell.edu/uscode/text/26/42", year: 2025 },
    discoveredBy: "knowledge_base",
    rules: [
      r.threshold("set-aside", "Minimum set-aside election", "Project must elect and meet a minimum set-aside: 20/50, 40/60, or income averaging.", "IRC §42(g)(1)", { op: "custom", fn: "lihtc_minimum_set_aside" }, "set_aside"),
      r.threshold("rents", "Rent restrictions", "Gross rents on restricted units may not exceed 30% of the imputed income limit.", "IRC §42(g)(2)", { op: "custom", fn: "rents_within_limits" }, "financial"),
      r.threshold("extended-use", "30-year extended use commitment", "15-year compliance period plus 15-year extended use agreement.", "IRC §42(h)(6)(D)", { op: "gte", field: "project.affordabilityPeriodYears", value: 30 }),
      r.threshold("site-control", "Site control", "Applicant must hold title, a purchase option, or long-term ground lease.", "Typical QAP threshold", { op: "truthy", field: "project.siteControl" }, "readiness"),
      r.threshold("experience", "Development team experience", "At least one completed tax-credit development by the developer or a partner.", "Typical QAP threshold", { op: "gte", field: "project.developerExperienceProjects", value: 1 }),
      r.threshold("cost-cap", "Per-unit cost limit", "Total development cost per unit within the agency's cost containment limit.", "IRC §42(m)(2) (credit no more than necessary)", { op: "custom", fn: "cost_per_unit_cap", params: { maxPerUnit: 450_000, boostPct: 0.1 } }, "financial"),
      r.points("deep-targeting", "Deeper income targeting (≤ 50% AMI)", "Points for share of units at or below 50% AMI.", "IRC §42(m)(1)(B)(ii)(I) — serving lowest-income residents", 10, { op: "tiered", field: "derived.pctUnitsAt50", direction: "higher_better", tiers: [{ threshold: 0.1, points: 4 }, { threshold: 0.2, points: 7 }, { threshold: 0.3, points: 10 }] }),
      r.points("eli", "Extremely low-income units (≤ 30% AMI)", "Points for units reserved at or below 30% AMI.", "Typical QAP scoring", 6, { op: "tiered", field: "derived.pctUnitsAt30", direction: "higher_better", tiers: [{ threshold: 0.05, points: 3 }, { threshold: 0.1, points: 6 }] }),
      r.points("transit", "Proximity to transit", "Points for distance to a transit stop.", "Typical QAP site scoring", 5, { op: "amenity", amenityType: "transit", tiers: [{ maxMiles: 0.5, points: 5 }, { maxMiles: 1, points: 3 }] }, "location"),
      r.points("grocery", "Proximity to full-service grocery", "Points for distance to a full-service grocery.", "Typical QAP site scoring", 4, { op: "amenity", amenityType: "grocery", tiers: [{ maxMiles: 0.5, points: 4 }, { maxMiles: 1, points: 2 }] }, "location"),
      r.points("opportunity", "High-opportunity area", "Points for siting in a higher-opportunity neighborhood.", "Typical QAP / AFFH preference", 8, { op: "custom", fn: "opportunity_area", params: { highest: 8, high: 6, moderate: 3 } }, "location"),
      r.points("qct-revitalization", "QCT with community revitalization plan", "Statutory preference for QCT projects contributing to a concerted revitalization plan.", "IRC §42(m)(1)(B)(ii)(III)", 3, { op: "truthy", field: "geo.isQCT" }, "location"),
      r.points("leverage", "Leveraged local funds", "Points for committed local public funds as share of TDC.", "Typical QAP scoring", 8, { op: "tiered", field: "derived.localLeverageRatio", direction: "higher_better", tiers: [{ threshold: 0.05, points: 3 }, { threshold: 0.1, points: 6 }, { threshold: 0.15, points: 8 }] }, "financial"),
      r.points("readiness", "Readiness to proceed", "Site control plus zoning / entitlements.", "Typical QAP scoring", 5, { op: "custom", fn: "readiness" }, "readiness"),
      r.points("services", "Resident services", "On-site resident services coordination.", "Typical QAP scoring", 4, { op: "truthy", field: "project.serviceCoordination" }),
      r.points("green", "Sustainable building", "Green building certification.", "Typical QAP scoring", 4, { op: "custom", fn: "green_building", params: { passive_house: 4, leed: 3, enterprise_green: 3 } }),
      r.points("nonprofit", "Nonprofit participation", "Qualified nonprofit sponsor (10% nonprofit set-aside eligible).", "IRC §42(h)(5)", 3, { op: "truthy", field: "project.nonprofitSponsor" }),
      r.points("local-support", "Local government support", "Letter of support from local jurisdiction.", "IRC §42(m)(1)(A)(ii) — local notice", 3, { op: "truthy", field: "project.localSupportLetter" }),
    ],
    complianceRules: lihtcCompliance(id, "the state allocating agency", 30),
  };
}

// ───────────────────────── California TCAC 9% ─────────────────────────

function caTcac9(): FundingProgram {
  const id = "ca-tcac-9";
  const r = ruleBuilder(id);
  return {
    id,
    name: "California TCAC 9% Competitive Tax Credits",
    shortName: "TCAC 9%",
    type: "federal_tax_credit",
    awardType: "tax_credit",
    administrator: "California Tax Credit Allocation Committee (TCAC)",
    jurisdiction: "CA",
    description:
      "Federal 9% credits allocated by TCAC under the California QAP (4 CCR §10300 et seq.). Highly competitive; nearly all funded projects max out scoring and are separated by the tiebreaker.",
    typicalAward: "Up to $2.5M annual federal credits (+ CA state credits)",
    applicationCycle: "Two rounds per year (typically Feb/Mar and Jun/Jul)",
    url: "https://www.treasurer.ca.gov/ctcac/",
    sourceDocument: { title: "TCAC Regulations, 4 CCR §§10300–10337", url: "https://www.treasurer.ca.gov/ctcac/programreg/regulations.pdf", year: 2025 },
    discoveredBy: "knowledge_base",
    applicableStates: ["CA"],
    rules: [
      r.threshold("set-aside", "Minimum set-aside election", "Meet 20/50, 40/60 or income averaging.", "IRC §42(g)(1); 4 CCR §10325(f)(7)", { op: "custom", fn: "lihtc_minimum_set_aside" }, "set_aside"),
      r.threshold("rents", "TCAC rent limits", "Proposed rents at or below TCAC published maximum rents.", "4 CCR §10327(g)(1)", { op: "custom", fn: "rents_within_limits" }, "financial"),
      r.threshold("term", "55-year regulatory agreement", "Affordability for 55 years via recorded regulatory agreement.", "4 CCR §10337(a)(1)", { op: "gte", field: "project.affordabilityPeriodYears", value: 55 }),
      r.threshold("site-control", "Site control", "Evidence of enforceable site control at application.", "4 CCR §10325(f)(4)", { op: "truthy", field: "project.siteControl" }, "readiness"),
      r.threshold("experience", "Development team experience", "Developer must demonstrate experience with ≥ 1 completed LIHTC project or partner with an experienced developer.", "4 CCR §10322(h)(9)", { op: "gte", field: "project.developerExperienceProjects", value: 1 }),
      r.threshold("cost-cap", "Basis limit / cost containment", "Development cost must fall within TCAC unadjusted basis limits as adjusted (prototype limit used).", "4 CCR §10327(c)(5)", { op: "custom", fn: "cost_per_unit_cap", params: { maxPerUnit: 750_000, boostPct: 0.1 } }, "financial"),
      r.points("gp-experience", "General partner & management experience", "Points for the number of completed affordable projects.", "4 CCR §10325(c)(1)", 9, { op: "tiered", field: "project.developerExperienceProjects", direction: "higher_better", tiers: [{ threshold: 1, points: 3 }, { threshold: 3, points: 6 }, { threshold: 5, points: 9 }] }),
      r.points("housing-needs", "Housing needs", "Points for serving a TCAC housing type (large family, senior, special needs, SRO, at-risk).", "4 CCR §10325(c)(4)", 10, { op: "in", field: "project.targetPopulation", value: ["family", "senior", "supportive", "special_needs"] }),
      r.points("site-amenities", "Site amenities", "Transit, park, library, grocery, school, medical and pharmacy proximity (capped).", "4 CCR §10325(c)(5)(A)", 15, { op: "custom", fn: "tcac_site_amenities", params: { cap: 15 } }, "location"),
      r.points("service-amenities", "Service amenities", "On-site service coordinator / instructional programs.", "4 CCR §10325(c)(5)(B)", 10, { op: "truthy", field: "project.serviceCoordination" }),
      r.points("lowest-income", "Lowest income targeting", "Points for depth of income targeting (average AMI of restricted units).", "4 CCR §10325(c)(7)", 52, { op: "tiered", field: "derived.averageAmiOfAffordable", direction: "lower_better", tiers: [{ threshold: 60, points: 20 }, { threshold: 55, points: 30 }, { threshold: 50, points: 42 }, { threshold: 45, points: 47 }, { threshold: 40, points: 52 }] }),
      r.points("readiness", "Readiness to proceed", "Enforceable financing, land use approvals and site control.", "4 CCR §10325(c)(8)", 10, { op: "custom", fn: "readiness" }, "readiness"),
      r.points("opportunity", "High / highest resource area (Opportunity Map)", "Family projects in TCAC/HCD Highest or High Resource areas.", "4 CCR §10325(c)(5)(A)(2); TCAC/HCD Opportunity Map", 8, { op: "custom", fn: "opportunity_area", params: { highest: 8, high: 8 } }, "location"),
      r.points("leverage", "Public funds commitment", "Committed local public funds (tiebreaker & points).", "4 CCR §10325(c)(9)", 8, { op: "tiered", field: "derived.localLeverageRatio", direction: "higher_better", tiers: [{ threshold: 0.05, points: 3 }, { threshold: 0.1, points: 6 }, { threshold: 0.2, points: 8 }] }, "financial"),
      r.points("green", "Sustainable building methods", "Exceed Title 24 / certification (miscellaneous points).", "4 CCR §10325(c)(10)", 2, { op: "custom", fn: "green_building", params: { passive_house: 2, leed: 2, enterprise_green: 1 } }),
    ],
    complianceRules: lihtcCompliance(id, "TCAC", 55),
  };
}

// ───────────────────────── Texas TDHCA 9% ─────────────────────────

function txTdhca9(): FundingProgram {
  const id = "tx-tdhca-9";
  const r = ruleBuilder(id);
  return {
    id,
    name: "Texas TDHCA 9% Housing Tax Credits",
    shortName: "TDHCA 9%",
    type: "federal_tax_credit",
    awardType: "tax_credit",
    administrator: "Texas Department of Housing and Community Affairs (TDHCA)",
    jurisdiction: "TX",
    description:
      "Competitive 9% housing tax credits allocated by regional sub-region under the Texas QAP (10 TAC Chapter 11). Local government resolutions and the Opportunity Index drive outcomes.",
    typicalAward: "Up to $2M annual credits per application",
    applicationCycle: "Annual: pre-application Jan, full application Mar, awards Jul",
    url: "https://www.tdhca.texas.gov/multifamily-housing-tax-credits",
    sourceDocument: { title: "10 TAC Chapter 11 — Qualified Allocation Plan", url: "https://www.tdhca.texas.gov/qualified-allocation-plan", year: 2025 },
    discoveredBy: "knowledge_base",
    applicableStates: ["TX"],
    rules: [
      r.threshold("set-aside", "Minimum set-aside election", "Meet 20/50, 40/60 or income averaging.", "IRC §42(g)(1); 10 TAC §11.302", { op: "custom", fn: "lihtc_minimum_set_aside" }, "set_aside"),
      r.threshold("rents", "Rent limits", "Rents at or below TDHCA published LIHTC rent limits.", "10 TAC §10.614", { op: "custom", fn: "rents_within_limits" }, "financial"),
      r.threshold("term", "30-year affordability (LURA)", "Land Use Restriction Agreement for at least 30 years.", "10 TAC §10.401", { op: "gte", field: "project.affordabilityPeriodYears", value: 30 }),
      r.threshold("site-control", "Site control", "Evidence of site control through the award date.", "10 TAC §11.204(10)", { op: "truthy", field: "project.siteControl" }, "readiness"),
      r.threshold("zoning", "Zoning", "Appropriate zoning or evidence of rezoning request.", "10 TAC §11.204(11)", { op: "truthy", field: "project.zoningApproved" }, "readiness"),
      r.threshold("experience", "Experience certificate", "Principal must hold a TDHCA experience certificate (≥ 1 completed development).", "10 TAC §11.204(6)", { op: "gte", field: "project.developerExperienceProjects", value: 1 }),
      r.threshold("cost-cap", "Cost per unit limitation", "Building cost per unit within §11.4 limits (approx. per-unit equivalent).", "10 TAC §11.4(c)", { op: "custom", fn: "cost_per_unit_cap", params: { maxPerUnit: 400_000, boostPct: 0.05 } }, "financial"),
      r.points("income-levels", "Income levels of residents", "Points for share of units at ≤ 50% AMI.", "10 TAC §11.9(c)(1)", 15, { op: "tiered", field: "derived.pctUnitsAt50", direction: "higher_better", tiers: [{ threshold: 0.2, points: 11 }, { threshold: 0.3, points: 13 }, { threshold: 0.4, points: 15 }] }, "set_aside"),
      r.points("rent-levels", "Rent levels of residents (≤ 30% AMI)", "Points for units at ≤ 30% AMI rents.", "10 TAC §11.9(c)(2)", 13, { op: "tiered", field: "derived.pctUnitsAt30", direction: "higher_better", tiers: [{ threshold: 0.05, points: 7 }, { threshold: 0.075, points: 11 }, { threshold: 0.1, points: 13 }] }, "set_aside"),
      r.points("services", "Tenant services", "Commitment to provide supportive services.", "10 TAC §11.9(c)(3)", 11, { op: "truthy", field: "project.serviceCoordination" }),
      r.points("opportunity", "Opportunity Index", "High-opportunity census tract (low poverty, high income quartile, amenities).", "10 TAC §11.9(c)(4)", 7, { op: "custom", fn: "opportunity_area", params: { highest: 7, high: 7, moderate: 5 } }, "location"),
      r.points("local-gov", "Local government support", "Resolution of support from the governing body.", "10 TAC §11.9(d)(1)", 17, { op: "truthy", field: "project.localSupportLetter" }),
      r.points("feasibility", "Financial feasibility", "Underwritten feasibility of the permanent financing.", "10 TAC §11.9(e)(1)", 18, { op: "custom", fn: "dscr_feasibility", params: { minLoanToCost: 0.1 } }, "financial"),
      r.points("cost", "Cost of development per unit", "Lower building cost per unit earns more points.", "10 TAC §11.9(e)(2)", 12, { op: "tiered", field: "derived.costPerUnit", direction: "lower_better", tiers: [{ threshold: 380_000, points: 8 }, { threshold: 330_000, points: 10 }, { threshold: 280_000, points: 12 }] }, "financial"),
      r.points("leverage", "Leveraging of private, state and federal resources", "Third-party funding as share of TDC.", "10 TAC §11.9(e)(4)", 3, { op: "tiered", field: "derived.localLeverageRatio", direction: "higher_better", tiers: [{ threshold: 0.05, points: 2 }, { threshold: 0.1, points: 3 }] }, "financial"),
      r.points("transit", "Proximity to transit / urban core", "Proximity to frequent transit in urban sub-regions.", "10 TAC §11.9(c)(4)(B)", 3, { op: "amenity", amenityType: "transit", tiers: [{ maxMiles: 0.5, points: 3 }, { maxMiles: 1, points: 1 }] }, "location"),
    ],
    complianceRules: lihtcCompliance(id, "TDHCA", 30),
  };
}

// ───────────────────────── New York HCR 9% ─────────────────────────

function nyHcr9(): FundingProgram {
  const id = "ny-hcr-9";
  const r = ruleBuilder(id);
  return {
    id,
    name: "New York HCR 9% Low-Income Housing Credit",
    shortName: "NY HCR 9%",
    type: "federal_tax_credit",
    awardType: "tax_credit",
    administrator: "NYS Homes and Community Renewal (HCR)",
    jurisdiction: "NY",
    description:
      "Federal 9% credits awarded through HCR's Multifamily Finance RFP under the NY QAP (9 NYCRR Part 2040). Strong emphasis on supportive housing, green design and community revitalization.",
    typicalAward: "$1.5M–$2.2M annual credits",
    applicationCycle: "Annual Multifamily Finance 9% RFP",
    url: "https://hcr.ny.gov/multifamily-finance",
    sourceDocument: { title: "NY HCR Qualified Allocation Plan, 9 NYCRR Part 2040", url: "https://hcr.ny.gov/qualified-allocation-plans", year: 2025 },
    discoveredBy: "knowledge_base",
    applicableStates: ["NY"],
    rules: [
      r.threshold("set-aside", "Minimum set-aside election", "Meet 20/50, 40/60 or income averaging.", "IRC §42(g)(1); 9 NYCRR §2040.3", { op: "custom", fn: "lihtc_minimum_set_aside" }, "set_aside"),
      r.threshold("rents", "Rent limits", "Rents within LIHC rent limits.", "9 NYCRR §2040.9", { op: "custom", fn: "rents_within_limits" }, "financial"),
      r.threshold("term", "50-year regulatory agreement", "HCR-financed projects record a 50-year regulatory agreement.", "HCR Multifamily Finance Term Sheet", { op: "gte", field: "project.affordabilityPeriodYears", value: 50 }),
      r.threshold("green", "HCR Sustainability Guidelines", "Projects must certify under Enterprise Green Communities, LEED or Passive House.", "HCR Design Guidelines §6 (Sustainability)", { op: "neq", field: "project.greenBuilding", value: "none" }),
      r.threshold("site-control", "Site control", "Evidence of site control.", "9 NYCRR §2040.3(f)", { op: "truthy", field: "project.siteControl" }, "readiness"),
      r.threshold("experience", "Development team capacity", "Demonstrated experience with comparable projects.", "9 NYCRR §2040.4", { op: "gte", field: "project.developerExperienceProjects", value: 1 }),
      r.points("eli", "Extremely low-income units", "Units at ≤ 30% AMI.", "HCR QAP Scoring — Income Targeting", 15, { op: "tiered", field: "derived.pctUnitsAt30", direction: "higher_better", tiers: [{ threshold: 0.1, points: 6 }, { threshold: 0.2, points: 10 }, { threshold: 0.3, points: 15 }] }, "set_aside"),
      r.points("supportive", "Supportive housing", "Projects serving homeless or special-needs populations with services (ESSHI-eligible).", "HCR QAP Scoring — Special Needs", 10, { op: "custom", fn: "supportive_population" }),
      r.points("services", "Supportive services plan", "Funded on-site services.", "HCR QAP Scoring — Special Needs", 5, { op: "truthy", field: "project.serviceCoordination" }),
      r.points("transit", "Smart growth — transit access", "Proximity to public transit.", "HCR QAP Scoring — Smart Growth", 5, { op: "amenity", amenityType: "transit", tiers: [{ maxMiles: 0.25, points: 5 }, { maxMiles: 0.5, points: 3 }] }, "location"),
      r.points("revitalization", "Community revitalization (QCT)", "Projects in QCTs contributing to a revitalization plan.", "IRC §42(m)(1)(B)(ii)(III)", 5, { op: "truthy", field: "geo.isQCT" }, "location"),
      r.points("opportunity", "Opportunity area", "Projects in high-opportunity areas.", "HCR QAP Scoring — Fair Housing", 5, { op: "custom", fn: "opportunity_area", params: { highest: 5, high: 5, moderate: 2 } }, "location"),
      r.points("leverage", "Leveraging", "Other public funds committed.", "HCR QAP Scoring — Leveraging", 10, { op: "tiered", field: "derived.localLeverageRatio", direction: "higher_better", tiers: [{ threshold: 0.1, points: 4 }, { threshold: 0.2, points: 7 }, { threshold: 0.3, points: 10 }] }, "financial"),
      r.points("passive", "Passive House / beyond-code", "Extra points for Passive House or all-electric beyond-code design.", "HCR Design Guidelines §6", 5, { op: "custom", fn: "green_building", params: { passive_house: 5, leed: 2, enterprise_green: 2 } }),
      r.points("readiness", "Project readiness", "Site control, zoning, financing commitments.", "HCR QAP Scoring — Readiness", 5, { op: "custom", fn: "readiness" }, "readiness"),
      r.points("mwbe", "Nonprofit / MWBE participation", "Nonprofit sponsor participation.", "HCR QAP Scoring — Participation", 3, { op: "truthy", field: "project.nonprofitSponsor" }),
    ],
    complianceRules: lihtcCompliance(id, "HCR", 50),
  };
}

// ───────────────────────── 4% LIHTC + tax-exempt bonds ─────────────────────────

function fed4(): FundingProgram {
  const id = "fed-lihtc-4-bonds";
  const r = ruleBuilder(id);
  return {
    id,
    name: "4% LIHTC with Tax-Exempt Private Activity Bonds",
    shortName: "4% LIHTC + Bonds",
    type: "federal_tax_credit",
    awardType: "bond",
    administrator: "State bond allocating agency (e.g. CDLAC in CA, TBRB in TX) + HFA",
    jurisdiction: "federal",
    description:
      "As-of-right 4% credits for projects financed with tax-exempt private activity bonds (IRC §142(d)) above the bond test. The 2025 reconciliation act (P.L. 119-21) lowered the bond test from 50% to 25% for bonds issued after 12/31/2025 — verify. Bond cap is competitive in oversubscribed states (e.g. CDLAC in CA).",
    typicalAward: "Credits ≈ 4% × qualified basis × 10 yrs; no per-project cap",
    applicationCycle: "Rolling (or state bond-cap rounds)",
    url: "https://www.law.cornell.edu/uscode/text/26/42",
    sourceDocument: { title: "IRC §42(h)(4), §142(d); P.L. 119-21 §70422 (bond test)", url: "https://www.law.cornell.edu/uscode/text/26/42", year: 2025 },
    discoveredBy: "knowledge_base",
    rules: [
      r.threshold("set-aside", "§142(d) set-aside", "Bond-financed projects must meet 20/50, 40/60 or income averaging.", "IRC §142(d)(1)", { op: "custom", fn: "lihtc_minimum_set_aside" }, "set_aside"),
      r.threshold("rents", "Rent restrictions", "Gross rents within LIHTC limits.", "IRC §42(g)(2)", { op: "custom", fn: "rents_within_limits" }, "financial"),
      r.threshold("bond-test", "Bond financing test (25%)", "Tax-exempt bonds must finance ≥ 25% (was 50%) of aggregate basis + land.", "IRC §42(h)(4)(B) as amended by P.L. 119-21 — verify", { op: "custom", fn: "bond_financing_test", params: { threshold: 0.25 } }, "financial"),
      r.threshold("term", "30-year extended use", "Extended low-income housing commitment.", "IRC §42(h)(6)", { op: "gte", field: "project.affordabilityPeriodYears", value: 30 }),
      r.threshold("site-control", "Site control", "Required for bond inducement and allocation.", "Bond issuer requirement", { op: "truthy", field: "project.siteControl" }, "readiness"),
      r.threshold("feasibility", "Debt feasibility", "Rents must support the bond-financed permanent loan.", "IRC §42(m)(2) (feasibility)", { op: "custom", fn: "dscr_feasibility", params: { minLoanToCost: 0.15 } }, "financial"),
      r.points("boost", "QCT/DDA basis boost", "130% basis boost increases 4% credit equity.", "IRC §42(d)(5)(B)", 10, { op: "custom", fn: "basis_boost" }, "location"),
      r.points("deep-targeting", "Bond cap priority — income targeting", "Bond-cap scoring favors ≤ 50% AMI units (e.g. CDLAC 4 CCR §5230).", "4 CCR §5230 (CDLAC) / state bond rules", 10, { op: "tiered", field: "derived.pctUnitsAt50", direction: "higher_better", tiers: [{ threshold: 0.1, points: 4 }, { threshold: 0.25, points: 7 }, { threshold: 0.4, points: 10 }] }, "set_aside"),
      r.points("eli", "Bond cap priority — ELI units", "Points for ≤ 30% AMI units.", "4 CCR §5230(e) (CDLAC)", 5, { op: "tiered", field: "derived.pctUnitsAt30", direction: "higher_better", tiers: [{ threshold: 0.05, points: 3 }, { threshold: 0.1, points: 5 }] }, "set_aside"),
      r.points("leverage", "Public funds leverage", "Soft public funds reduce bond/credit need.", "4 CCR §5230(h) (CDLAC)", 10, { op: "tiered", field: "derived.localLeverageRatio", direction: "higher_better", tiers: [{ threshold: 0.05, points: 4 }, { threshold: 0.1, points: 7 }, { threshold: 0.2, points: 10 }] }, "financial"),
      r.points("readiness", "Readiness to proceed", "Entitlements and site control for 180-day bond issuance deadline.", "4 CCR §5230 (CDLAC readiness)", 10, { op: "custom", fn: "readiness" }, "readiness"),
      r.points("cost", "Cost efficiency", "Lower TDC per unit improves bond-cap competitiveness.", "4 CCR §5230 (tiebreaker)", 5, { op: "tiered", field: "derived.costPerUnit", direction: "lower_better", tiers: [{ threshold: 650_000, points: 2 }, { threshold: 500_000, points: 4 }, { threshold: 400_000, points: 5 }] }, "financial"),
    ],
    complianceRules: lihtcCompliance(id, "the state allocating agency", 30),
  };
}

// ───────────────────────── HOME ─────────────────────────

function home(): FundingProgram {
  const id = "home";
  const r = ruleBuilder(id);
  const c = complianceBuilder(id);
  return {
    id,
    name: "HOME Investment Partnerships Program",
    shortName: "HOME",
    type: "federal_grant",
    awardType: "soft_loan",
    administrator: "HUD via local/state Participating Jurisdictions (PJs)",
    jurisdiction: "federal",
    description:
      "Federal block grant to Participating Jurisdictions, typically lent as soft gap financing for rental housing. HOME units carry High/Low HOME rents and a 20-year affordability period for new construction.",
    typicalAward: "$500k–$3M gap loan",
    applicationCycle: "Annual local NOFA (varies by PJ)",
    url: "https://www.hud.gov/program_offices/comm_planning/home",
    sourceDocument: { title: "24 CFR Part 92 (2024 HOME Final Rule)", url: "https://www.ecfr.gov/current/title-24/subtitle-A/part-92", year: 2024 },
    discoveredBy: "knowledge_base",
    rules: [
      r.threshold("low-home", "20% Low HOME units", "In projects with 5+ HOME units, ≥ 20% must be Low HOME (≤ 50% AMI).", "24 CFR §92.252(b)", { op: "gte", field: "derived.pctUnitsAt50", value: 0.2 }, "set_aside"),
      r.threshold("income", "Income eligibility (≤ 80% AMI)", "All HOME units occupied by households ≤ 80% AMI.", "24 CFR §92.216", { op: "gte", field: "derived.pctUnitsAt80", value: 0.5 }, "set_aside"),
      r.threshold("rents", "HOME rent limits", "Rents ≤ High HOME (lesser of FMR or 65% rent) / Low HOME limits (approximated with LIHTC limits).", "24 CFR §92.252(a)", { op: "custom", fn: "rents_within_limits" }, "financial"),
      r.threshold("term", "Affordability period", "20 years for new construction of rental housing.", "24 CFR §92.252(e)", { op: "gte", field: "project.affordabilityPeriodYears", value: 20 }),
      r.threshold("environmental", "Environmental review (Part 58)", "No choice-limiting actions before environmental clearance.", "24 CFR §92.352; 24 CFR Part 58", { op: "custom", fn: "requires_documentation", params: { item: "Part 58 environmental review clearance" } }),
      r.threshold("site-control", "Site & neighborhood standards", "Site control and compliance with site & neighborhood standards.", "24 CFR §92.202", { op: "truthy", field: "project.siteControl" }, "readiness"),
      r.points("leverage", "Leverage", "Other funds leveraged per HOME dollar.", "Typical PJ NOFA", 20, { op: "tiered", field: "derived.localLeverageRatio", direction: "higher_better", tiers: [{ threshold: 0.03, points: 8 }, { threshold: 0.08, points: 14 }, { threshold: 0.15, points: 20 }] }, "financial"),
      r.points("eli", "Extremely low-income targeting", "Units ≤ 30% AMI.", "Typical PJ NOFA (Consolidated Plan priority)", 15, { op: "tiered", field: "derived.pctUnitsAt30", direction: "higher_better", tiers: [{ threshold: 0.05, points: 5 }, { threshold: 0.1, points: 10 }, { threshold: 0.2, points: 15 }] }, "set_aside"),
      r.points("readiness", "Readiness", "Site control and entitlements (HOME commitment-to-construction deadline).", "24 CFR §92.205(e) (4-year completion)", 15, { op: "custom", fn: "readiness" }, "readiness"),
      r.points("chdo", "CHDO / nonprofit sponsor", "Eligible for the 15% CHDO set-aside.", "24 CFR §92.300", 10, { op: "truthy", field: "project.nonprofitSponsor" }),
      r.points("experience", "Developer capacity", "Completed affordable projects.", "24 CFR §92.250(b) (underwriting & capacity)", 10, { op: "tiered", field: "project.developerExperienceProjects", direction: "higher_better", tiers: [{ threshold: 1, points: 4 }, { threshold: 3, points: 7 }, { threshold: 5, points: 10 }] }),
      r.points("services", "Supportive services", "Services for residents.", "Typical PJ NOFA", 5, { op: "truthy", field: "project.serviceCoordination" }),
      r.points("opportunity", "Location / opportunity", "Siting in higher-opportunity area (AFFH).", "24 CFR §5.150 (AFFH)", 5, { op: "custom", fn: "opportunity_area", params: { highest: 5, high: 5, moderate: 3 } }, "location"),
    ],
    complianceRules: [
      c("income", "income", "HOME income limit at move-in", "HOME units occupied by households ≤ 80% AMI (Low HOME units ≤ 50%).", "24 CFR §92.216", "event", { kind: "unit_income_at_movein" }),
      c("rent", "rent", "High / Low HOME rents", "Rents (incl. utilities) at or below the applicable HOME rent limit.", "24 CFR §92.252(a)–(b)", "monthly", { kind: "unit_rent_limit" }),
      c("low-home", "set_aside", "20% Low HOME units", "Maintain at least 20% of HOME units at ≤ 50% AMI.", "24 CFR §92.252(b)", "ongoing", { kind: "set_aside_minimum", params: { amiPct: 50, minPct: 0.2 } }),
      c("recert", "income", "Annual income recertification", "Re-examine tenant income annually (source documentation every 6th year).", "24 CFR §92.252(h)", "annual", { kind: "annual_recert" }),
      c("inspection", "physical", "On-site inspection (every 3 years)", "PJ inspects HOME rental projects at least once every 3 years.", "24 CFR §92.504(d)", "triennial", { kind: "deadline", params: { key: "home_onsite_inspection", everyMonths: 36 } }),
      c("financial-oversight", "reporting", "Annual financial oversight", "PJ examines financial condition of projects with 10+ HOME units annually.", "24 CFR §92.504(d)(2)", "annual", { kind: "deadline", params: { key: "home_financial_report", everyMonths: 12 } }),
      c("term", "affordability_term", "HOME affordability period (20 years)", "Affordability restrictions recorded via deed restriction / covenant.", "24 CFR §92.252(e)", "ongoing", { kind: "manual", params: { key: "home_covenant_recorded", years: 20 } }),
    ],
  };
}

// ───────────────────────── National Housing Trust Fund ─────────────────────────

function htf(): FundingProgram {
  const id = "htf";
  const r = ruleBuilder(id);
  const c = complianceBuilder(id);
  return {
    id,
    name: "National Housing Trust Fund",
    shortName: "HTF",
    type: "federal_grant",
    awardType: "soft_loan",
    administrator: "HUD via state HTF allocation plans",
    jurisdiction: "federal",
    description:
      "Formula grant to states for rental housing for extremely low-income households (≤ 30% AMI or poverty line). 30-year minimum affordability.",
    typicalAward: "$1M–$3M deeply-subsidized units",
    applicationCycle: "Annual state HTF allocation plan / NOFA",
    url: "https://www.hudexchange.info/programs/htf/",
    sourceDocument: { title: "24 CFR Part 93", url: "https://www.ecfr.gov/current/title-24/subtitle-A/part-93", year: 2024 },
    discoveredBy: "knowledge_base",
    rules: [
      r.threshold("eli", "ELI units required", "HTF-assisted units must be occupied by ELI households (≤ 30% AMI).", "24 CFR §93.250", { op: "gte", field: "derived.pctUnitsAt30", value: 0.05 }, "set_aside"),
      r.threshold("term", "30-year affordability", "Minimum 30-year affordability period.", "24 CFR §93.302(d)", { op: "gte", field: "project.affordabilityPeriodYears", value: 30 }),
      r.threshold("rents", "HTF rent limits", "Rent ≤ 30% of 30% AMI (or poverty line).", "24 CFR §93.302(b)", { op: "custom", fn: "rents_within_limits" }, "financial"),
      r.threshold("site-control", "Site control", "Site control at commitment.", "24 CFR §93.2 (commitment)", { op: "truthy", field: "project.siteControl" }, "readiness"),
      r.threshold("environmental", "Environmental provisions", "HTF environmental review per state plan.", "24 CFR §93.301(f)", { op: "custom", fn: "requires_documentation", params: { item: "HTF environmental review (state plan)" } }),
      r.points("eli-depth", "Depth of ELI targeting", "More ELI units score higher.", "State HTF Allocation Plan priorities (24 CFR §91.320(k)(5))", 20, { op: "tiered", field: "derived.pctUnitsAt30", direction: "higher_better", tiers: [{ threshold: 0.1, points: 10 }, { threshold: 0.2, points: 15 }, { threshold: 0.3, points: 20 }] }, "set_aside"),
      r.points("supportive", "Special-needs / homeless populations", "Priority for supportive housing.", "24 CFR §91.320(k)(5)(i)", 10, { op: "custom", fn: "supportive_population" }),
      r.points("services", "Resident services", "On-site services.", "State HTF Allocation Plan", 5, { op: "truthy", field: "project.serviceCoordination" }),
      r.points("leverage", "Leverage of non-federal funds", "Non-federal funding committed.", "24 CFR §91.320(k)(5)(vi)", 10, { op: "tiered", field: "derived.localLeverageRatio", direction: "higher_better", tiers: [{ threshold: 0.05, points: 4 }, { threshold: 0.1, points: 7 }, { threshold: 0.2, points: 10 }] }, "financial"),
      r.points("readiness", "Readiness / ability to obligate", "Ability to obligate and complete timely.", "24 CFR §91.320(k)(5)(iii)", 10, { op: "custom", fn: "readiness" }, "readiness"),
      r.points("opportunity", "Geographic diversity / opportunity", "Location efficiency and opportunity.", "24 CFR §91.320(k)(5)(ii)", 5, { op: "custom", fn: "opportunity_area", params: { highest: 5, high: 5, moderate: 3 } }, "location"),
      r.points("transit", "Access to transit", "Proximity to public transit.", "State HTF Allocation Plan", 5, { op: "amenity", amenityType: "transit", tiers: [{ maxMiles: 0.5, points: 5 }, { maxMiles: 1, points: 2 }] }, "location"),
    ],
    complianceRules: [
      c("eli-income", "income", "ELI income at move-in", "HTF units occupied by households ≤ 30% AMI (or poverty guideline).", "24 CFR §93.302(c)", "event", { kind: "unit_income_at_movein" }),
      c("rent", "rent", "HTF rent limit", "Rent including utilities ≤ 30% of the 30% AMI limit.", "24 CFR §93.302(b)", "monthly", { kind: "unit_rent_limit" }),
      c("eli-share", "set_aside", "ELI unit set-aside", "Maintain designated HTF units at ≤ 30% AMI.", "24 CFR §93.250", "ongoing", { kind: "set_aside_minimum", params: { amiPct: 30, minPct: 0.05 } }),
      c("recert", "income", "Annual income recertification", "Annual tenant income examination.", "24 CFR §93.302(f)", "annual", { kind: "annual_recert" }),
      c("inspection", "physical", "Property inspection", "On-site inspection at least every 3 years.", "24 CFR §93.404(d)", "triennial", { kind: "deadline", params: { key: "htf_inspection", everyMonths: 36 } }),
      c("term", "affordability_term", "30-year affordability", "Recorded covenant for 30 years.", "24 CFR §93.302(d)", "ongoing", { kind: "manual", params: { key: "htf_covenant_recorded", years: 30 } }),
    ],
  };
}

// ───────────────────────── CDBG ─────────────────────────

function cdbg(): FundingProgram {
  const id = "cdbg";
  const r = ruleBuilder(id);
  const c = complianceBuilder(id);
  return {
    id,
    name: "Community Development Block Grant",
    shortName: "CDBG",
    type: "federal_grant",
    awardType: "grant",
    administrator: "HUD via entitlement cities/counties and state CDBG programs",
    jurisdiction: "federal",
    description:
      "Flexible block grant usable for acquisition, site improvements, infrastructure and rehabilitation supporting affordable housing. New residential construction is generally ineligible.",
    typicalAward: "$250k–$2M",
    applicationCycle: "Annual local Action Plan / NOFA",
    url: "https://www.hud.gov/program_offices/comm_planning/cdbg",
    sourceDocument: { title: "24 CFR Part 570", url: "https://www.ecfr.gov/current/title-24/subtitle-A/part-570", year: 2024 },
    discoveredBy: "knowledge_base",
    rules: [
      r.threshold("lmh", "Low/mod housing national objective", "≥ 51% of units occupied by low/moderate-income (≤ 80% AMI) households.", "24 CFR §570.208(a)(3)", { op: "gte", field: "derived.pctUnitsAt80", value: 0.51 }, "set_aside"),
      r.threshold("activity", "Eligible activity", "Acquisition, rehab, site/infrastructure — not new construction by government.", "24 CFR §570.207(b)(3)", { op: "custom", fn: "cdbg_eligible_activity" }),
      r.threshold("environmental", "Environmental review", "Part 58 clearance before commitment.", "24 CFR §570.604", { op: "custom", fn: "requires_documentation", params: { item: "Part 58 environmental review clearance" } }),
      r.threshold("site-control", "Site control", "Applicant controls the site.", "Local NOFA requirement", { op: "truthy", field: "project.siteControl" }, "readiness"),
      r.points("need", "Community need (QCT / poverty)", "Investment in high-need tracts.", "24 CFR §91.215 (Con Plan priorities)", 15, { op: "tiered", field: "geo.povertyRate", direction: "higher_better", tiers: [{ threshold: 0.15, points: 5 }, { threshold: 0.2, points: 10 }, { threshold: 0.25, points: 15 }] }, "location"),
      r.points("deep-targeting", "Very low-income units", "Units at ≤ 50% AMI.", "Local NOFA", 15, { op: "tiered", field: "derived.pctUnitsAt50", direction: "higher_better", tiers: [{ threshold: 0.2, points: 5 }, { threshold: 0.35, points: 10 }, { threshold: 0.5, points: 15 }] }, "set_aside"),
      r.points("leverage", "Leverage", "Other committed funds.", "Local NOFA", 10, { op: "tiered", field: "derived.localLeverageRatio", direction: "higher_better", tiers: [{ threshold: 0.05, points: 5 }, { threshold: 0.1, points: 10 }] }, "financial"),
      r.points("nonprofit", "Nonprofit / CBDO sponsor", "Eligible subrecipient or CBDO.", "24 CFR §570.204", 10, { op: "truthy", field: "project.nonprofitSponsor" }),
      r.points("local-support", "Council / local support", "Support from local officials.", "Local NOFA", 5, { op: "truthy", field: "project.localSupportLetter" }),
      r.points("readiness", "Readiness", "Ability to spend within timeliness test (1.5× annual grant).", "24 CFR §570.902", 10, { op: "custom", fn: "readiness" }, "readiness"),
    ],
    complianceRules: [
      c("lmh", "set_aside", "51% low/mod occupancy", "Maintain ≥ 51% of units occupied by ≤ 80% AMI households.", "24 CFR §570.208(a)(3)", "ongoing", { kind: "set_aside_minimum", params: { amiPct: 80, minPct: 0.51 } }),
      c("income", "income", "Low/mod income verification at move-in", "Document household income at initial occupancy.", "24 CFR §570.506(b)(3)", "event", { kind: "unit_income_at_movein" }),
      c("records", "reporting", "Annual performance reporting (CAPER data)", "Beneficiary data provided to grantee for CAPER/IDIS.", "24 CFR §570.506; §91.520", "annual", { kind: "deadline", params: { key: "cdbg_beneficiary_report", everyMonths: 12 } }),
      c("term", "affordability_term", "Change-of-use restriction (5 years)", "Use may not change for 5 years after closeout without reimbursement.", "24 CFR §570.505", "ongoing", { kind: "manual", params: { key: "cdbg_agreement_recorded", years: 5 } }),
    ],
  };
}

// ───────────────────────── FHLB AHP ─────────────────────────

function ahp(): FundingProgram {
  const id = "fhlb-ahp";
  const r = ruleBuilder(id);
  const c = complianceBuilder(id);
  return {
    id,
    name: "FHLBank Affordable Housing Program (General Fund)",
    shortName: "FHLB AHP",
    type: "private",
    awardType: "grant",
    administrator: "Federal Home Loan Bank (district) via member bank",
    jurisdiction: "federal",
    description:
      "Competitive grants from each FHLBank's AHP (10% of net income) applied through a member financial institution. Scored on a 100-point scale under 12 CFR Part 1291 and the bank's AHP Implementation Plan.",
    typicalAward: "Up to $1M–$1.5M per project (district limits vary)",
    applicationCycle: "Annual general fund round (varies by district)",
    url: "https://www.fhfa.gov/programs/affordable-housing-program",
    sourceDocument: { title: "12 CFR Part 1291 + district AHP Implementation Plan", url: "https://www.ecfr.gov/current/title-12/chapter-XII/subchapter-D/part-1291", year: 2025 },
    discoveredBy: "knowledge_base",
    rules: [
      r.threshold("vli", "≥ 20% very low-income units", "At least 20% of units occupied by and affordable to households ≤ 50% AMI.", "12 CFR §1291.23(a)(4)(ii)", { op: "gte", field: "derived.pctUnitsAt50", value: 0.2 }, "set_aside"),
      r.threshold("retention", "15-year retention period", "Rental projects must remain affordable for 15 years.", "12 CFR §1291.15(a)(7)", { op: "gte", field: "project.affordabilityPeriodYears", value: 15 }),
      r.threshold("need", "Need for subsidy & feasibility", "Project must be financially feasible and need the AHP subsidy.", "12 CFR §1291.24(a)(3)–(4)", { op: "custom", fn: "dscr_feasibility", params: { minLoanToCost: 0.05 } }, "financial"),
      r.threshold("capacity", "Developer capacity", "Sponsor must demonstrate ability to develop and operate.", "12 CFR §1291.24(a)(5)", { op: "gte", field: "project.developerExperienceProjects", value: 1 }),
      r.points("targeting", "Targeting (income levels)", "Share of units at ≤ 50% AMI and ≤ 80% AMI.", "12 CFR §1291.26(b)(2)", 20, { op: "tiered", field: "derived.pctUnitsAt50", direction: "higher_better", tiers: [{ threshold: 0.2, points: 6 }, { threshold: 0.4, points: 12 }, { threshold: 0.6, points: 20 }] }, "set_aside"),
      r.points("sponsorship", "Nonprofit / government sponsorship", "Sponsorship by a nonprofit or government entity.", "12 CFR §1291.26(b)(1)", 7, { op: "truthy", field: "project.nonprofitSponsor" }),
      r.points("special-needs", "Underserved communities & populations", "Housing for homeless or special-needs populations.", "12 CFR §1291.26(b)(3)", 10, { op: "custom", fn: "supportive_population" }),
      r.points("eli", "Extremely low-income (district priority)", "Units at ≤ 30% AMI.", "District AHP Implementation Plan", 8, { op: "tiered", field: "derived.pctUnitsAt30", direction: "higher_better", tiers: [{ threshold: 0.1, points: 4 }, { threshold: 0.2, points: 8 }] }, "set_aside"),
      r.points("stability", "Community stability (QCT revitalization)", "Projects in QCTs / revitalization areas.", "12 CFR §1291.26(b)(4)", 7, { op: "custom", fn: "basis_boost" }, "location"),
      r.points("services", "Empowerment / resident services", "Services that promote empowerment.", "District AHP Implementation Plan", 5, { op: "truthy", field: "project.serviceCoordination" }),
      r.points("subsidy-per-unit", "AHP subsidy per unit (cost efficiency)", "Lower cost per unit scores higher.", "District AHP Implementation Plan", 10, { op: "tiered", field: "derived.costPerUnit", direction: "lower_better", tiers: [{ threshold: 700_000, points: 3 }, { threshold: 550_000, points: 6 }, { threshold: 400_000, points: 10 }] }, "financial"),
      r.points("green", "Green / energy efficiency", "District priority for green building.", "District AHP Implementation Plan", 5, { op: "custom", fn: "green_building", params: { passive_house: 5, leed: 4, enterprise_green: 4 } }),
    ],
    complianceRules: [
      c("vli", "set_aside", "20% very low-income occupancy", "Maintain ≥ 20% of units at ≤ 50% AMI during retention.", "12 CFR §1291.15(a)(7)", "ongoing", { kind: "set_aside_minimum", params: { amiPct: 50, minPct: 0.2 } }),
      c("income", "income", "Income-eligible at move-in", "Households meet committed targeting at initial occupancy.", "12 CFR §1291.29", "event", { kind: "unit_income_at_movein" }),
      c("monitoring", "reporting", "Annual long-term monitoring report", "Owner certifies continued compliance to the FHLBank annually.", "12 CFR §1291.50(c)", "annual", { kind: "deadline", params: { key: "ahp_annual_monitoring", everyMonths: 12 } }),
      c("retention", "affordability_term", "15-year retention agreement", "Recorded AHP retention agreement.", "12 CFR §1291.15(a)(7)", "ongoing", { kind: "manual", params: { key: "ahp_retention_recorded", years: 15 } }),
    ],
  };
}

// ───────────────────────── HUD Section 811 PRA ─────────────────────────

function hud811(): FundingProgram {
  const id = "hud-811-pra";
  const r = ruleBuilder(id);
  const c = complianceBuilder(id);
  return {
    id,
    name: "HUD Section 811 Project Rental Assistance",
    shortName: "Section 811 PRA",
    type: "federal_grant",
    awardType: "grant",
    administrator: "HUD via state housing agency + state Medicaid/health partner",
    jurisdiction: "federal",
    description:
      "Project-based rental assistance for extremely low-income persons with disabilities, layered onto LIHTC/HOME properties. No more than 25% of a property's units may be 811/supportive units.",
    typicalAward: "Rental assistance contract (≈ $900–$1,300/unit/mo)",
    applicationCycle: "Via state 811 PRA program (rolling RFPs)",
    url: "https://www.hud.gov/program_offices/housing/mfh/grants/section811ptl",
    sourceDocument: { title: "42 U.S.C. §8013 (Frank Melville Supportive Housing Investment Act)", url: "https://www.law.cornell.edu/uscode/text/42/8013", year: 2024 },
    discoveredBy: "knowledge_base",
    rules: [
      r.threshold("population", "Persons with disabilities", "Units serve ELI persons with disabilities referred by the state partner.", "42 U.S.C. §8013(b)(4)", { op: "custom", fn: "supportive_population" }),
      r.threshold("eli", "Extremely low-income", "Assisted households ≤ 30% AMI.", "42 U.S.C. §8013(b)(5)", { op: "gt", field: "derived.pctUnitsAt30", value: 0 }, "set_aside"),
      r.threshold("multifamily", "Multifamily property (5+ units)", "Assistance limited to properties with 5+ units, ≤ 25% supportive.", "42 U.S.C. §8013(b)(4)(B)", { op: "gte", field: "derived.totalUnits", value: 5 }),
      r.threshold("services", "Voluntary supportive services available", "Services available through state Medicaid/health partner.", "42 U.S.C. §8013(b)(4)(A)", { op: "truthy", field: "project.serviceCoordination" }),
      r.threshold("term", "30-year use agreement", "Use restriction of at least 30 years.", "42 U.S.C. §8013(b)(4)(C)", { op: "gte", field: "project.affordabilityPeriodYears", value: 30 }),
      r.points("transit", "Access to transit", "Integrated, community-based setting near transit.", "State 811 PRA selection criteria", 10, { op: "amenity", amenityType: "transit", tiers: [{ maxMiles: 0.25, points: 10 }, { maxMiles: 0.5, points: 7 }, { maxMiles: 1, points: 3 }] }, "location"),
      r.points("medical", "Access to health care", "Proximity to medical services.", "State 811 PRA selection criteria", 10, { op: "amenity", amenityType: "medical", tiers: [{ maxMiles: 0.5, points: 10 }, { maxMiles: 1, points: 6 }, { maxMiles: 2, points: 3 }] }, "location"),
      r.points("pharmacy", "Access to pharmacy", "Proximity to a pharmacy.", "State 811 PRA selection criteria", 5, { op: "amenity", amenityType: "pharmacy", tiers: [{ maxMiles: 0.5, points: 5 }, { maxMiles: 1, points: 3 }] }, "location"),
      r.points("eli-depth", "ELI unit share", "Share of units at ≤ 30% AMI.", "State 811 PRA selection criteria", 10, { op: "tiered", field: "derived.pctUnitsAt30", direction: "higher_better", tiers: [{ threshold: 0.1, points: 5 }, { threshold: 0.2, points: 8 }, { threshold: 0.25, points: 10 }] }, "set_aside"),
      r.points("experience", "Supportive housing experience", "Owner/manager experience with supportive housing.", "State 811 PRA selection criteria", 10, { op: "tiered", field: "project.developerExperienceProjects", direction: "higher_better", tiers: [{ threshold: 1, points: 4 }, { threshold: 3, points: 7 }, { threshold: 5, points: 10 }] }),
      r.points("nonprofit", "Nonprofit partner", "Mission-driven nonprofit owner or partner.", "State 811 PRA selection criteria", 5, { op: "truthy", field: "project.nonprofitSponsor" }),
    ],
    complianceRules: [
      c("income", "income", "ELI eligibility at move-in", "Assisted household income ≤ 30% AMI at admission.", "24 CFR §5.609; 42 U.S.C. §8013", "event", { kind: "unit_income_at_movein" }),
      c("recert", "income", "Annual recertification (EIV)", "Annual recertification using EIV per HUD Handbook 4350.3.", "HUD Handbook 4350.3 ch. 7", "annual", { kind: "annual_recert" }),
      c("inspection", "physical", "NSPIRE inspection", "REAC/NSPIRE physical inspection.", "24 CFR Part 5 Subpart G", "triennial", { kind: "deadline", params: { key: "physical_inspection", everyMonths: 36 } }),
      c("term", "affordability_term", "30-year use agreement", "Recorded use agreement.", "42 U.S.C. §8013(b)(4)(C)", "ongoing", { kind: "manual", params: { key: "811_use_agreement", years: 30 } }),
    ],
  };
}

// ───────────────────────── HUD 221(d)(4) ─────────────────────────

function hud221d4(): FundingProgram {
  const id = "hud-221d4";
  const r = ruleBuilder(id);
  const c = complianceBuilder(id);
  return {
    id,
    name: "FHA 221(d)(4) Mortgage Insurance (New Construction / Sub Rehab)",
    shortName: "HUD 221(d)(4)",
    type: "federal_loan",
    awardType: "loan_insurance",
    administrator: "HUD Office of Multifamily Housing (via MAP lender)",
    jurisdiction: "federal",
    description:
      "40-year, fixed-rate, non-recourse construction-to-permanent loan insured by FHA. Affordable deals get up to 90% LTC and 1.15 DSCR; reduced MIP for green/affordable.",
    typicalAward: "Insured loan up to 87–90% of cost",
    applicationCycle: "Rolling via HUD-approved MAP lender",
    url: "https://www.hud.gov/program_offices/housing/mfh/progdesc/rentcoophsg221d3n4",
    sourceDocument: { title: "12 U.S.C. §1715l(d)(4); HUD MAP Guide (2024)", url: "https://www.hud.gov/program_offices/housing/mfh/map/mapguide", year: 2024 },
    discoveredBy: "knowledge_base",
    rules: [
      r.threshold("units", "Five or more units", "Project must have at least 5 units.", "12 U.S.C. §1715l(d)(4)", { op: "gte", field: "derived.totalUnits", value: 5 }),
      r.threshold("feasibility", "Debt service coverage", "NOI supports the insured loan at required DSCR.", "MAP Guide ch. 3.8", { op: "custom", fn: "dscr_feasibility", params: { minLoanToCost: 0.15 } }, "financial"),
      r.threshold("experience", "Sponsor experience (2530 clearance)", "Principals cleared through HUD 2530 with relevant experience.", "24 CFR Part 200 Subpart H", { op: "gte", field: "project.developerExperienceProjects", value: 1 }),
      r.threshold("site-control", "Site control", "Site control at firm application.", "MAP Guide ch. 9", { op: "truthy", field: "project.siteControl" }, "readiness"),
      r.threshold("zoning", "Zoning", "Zoning in place at firm commitment.", "MAP Guide ch. 9", { op: "truthy", field: "project.zoningApproved" }, "readiness"),
      r.threshold("davis-bacon", "Davis-Bacon prevailing wages", "Construction subject to Davis-Bacon wage rates.", "40 U.S.C. §3142; 12 U.S.C. §1715c", { op: "custom", fn: "requires_documentation", params: { item: "Davis-Bacon wage determination in construction budget" } }),
      r.points("affordable-terms", "Affordable loan terms (90% LTC / 1.15 DSCR)", "Projects with ≥ 90% restricted units qualify for affordable underwriting.", "MAP Guide ch. 3.1", 10, { op: "tiered", field: "derived.pctUnitsAt80", direction: "higher_better", tiers: [{ threshold: 0.2, points: 4 }, { threshold: 0.9, points: 10 }] }, "financial"),
      r.points("green-mip", "Green MIP reduction", "Reduced 25 bp MIP for certified green buildings.", "HUD MIP Notice (Green & Energy Efficient Housing)", 5, { op: "custom", fn: "green_building", params: { passive_house: 5, leed: 5, enterprise_green: 5 } }),
      r.points("leverage", "Equity / soft-fund cushion", "Soft funds reduce HUD loan exposure.", "MAP Guide ch. 3.9 (sources & uses)", 5, { op: "tiered", field: "derived.localLeverageRatio", direction: "higher_better", tiers: [{ threshold: 0.05, points: 3 }, { threshold: 0.1, points: 5 }] }, "financial"),
      r.points("loan-sizing", "Loan sizing strength", "Higher supportable loan-to-cost.", "MAP Guide ch. 3.8", 10, { op: "custom", fn: "dscr_feasibility", params: { minLoanToCost: 0.25 } }, "financial"),
    ],
    complianceRules: [
      c("financials", "reporting", "Annual audited financial statements", "Submit audited financials to HUD (FASS-MF) within 90 days of FYE.", "24 CFR §5.801", "annual", { kind: "deadline", params: { key: "hud_audited_financials", everyMonths: 12 } }),
      c("inspection", "physical", "NSPIRE inspection", "HUD NSPIRE inspection (1–3 year cycle by score).", "24 CFR Part 5 Subpart G", "triennial", { kind: "deadline", params: { key: "physical_inspection", everyMonths: 36 } }),
      c("reserve", "reporting", "Reserve for replacement deposits", "Monthly R4R deposits per regulatory agreement.", "HUD Regulatory Agreement (HUD-92466M)", "monthly", { kind: "manual", params: { key: "hud_r4r_current" } }),
    ],
  };
}

// ───────────────────────── California HCD MHP ─────────────────────────

function caMhp(): FundingProgram {
  const id = "ca-hcd-mhp";
  const r = ruleBuilder(id);
  const c = complianceBuilder(id);
  return {
    id,
    name: "California HCD Multifamily Housing Program",
    shortName: "CA MHP",
    type: "state_program",
    awardType: "soft_loan",
    administrator: "California Department of Housing and Community Development (HCD)",
    jurisdiction: "CA",
    description:
      "Deferred-payment, 55-year state loans for new construction/rehab of affordable rental housing, now awarded through HCD's Multifamily Finance Super NOFA alongside IIG, VHHP and Joe Serna.",
    typicalAward: "Up to $20M+ per project (per-unit limits apply)",
    applicationCycle: "Annual Multifamily Finance Super NOFA",
    url: "https://www.hcd.ca.gov/grants-and-funding/programs-active/multifamily-housing-program",
    sourceDocument: { title: "MHP Guidelines; Uniform Multifamily Regulations 25 CCR §8300 et seq.", url: "https://www.hcd.ca.gov/grants-and-funding/super-nofa", year: 2025 },
    discoveredBy: "knowledge_base",
    applicableStates: ["CA"],
    rules: [
      r.threshold("term", "55-year affordability", "Regulatory agreement for 55 years.", "Health & Safety Code §50675.8; MHP Guidelines §7303", { op: "gte", field: "project.affordabilityPeriodYears", value: 55 }),
      r.threshold("income", "Assisted units ≤ 60% AMI", "MHP-assisted units restricted at or below 60% AMI (average).", "MHP Guidelines §7304", { op: "lte", field: "derived.averageAmiOfAffordable", value: 60 }, "set_aside"),
      r.threshold("rents", "Rent limits", "Rents within MHP/TCAC limits.", "25 CCR §8305", { op: "custom", fn: "rents_within_limits" }, "financial"),
      r.threshold("site-control", "Site control", "Site control at application.", "25 CCR §8303", { op: "truthy", field: "project.siteControl" }, "readiness"),
      r.threshold("experience", "Sponsor experience", "Sponsor or partner completed ≥ 1 comparable project.", "MHP Guidelines §7316(c)", { op: "gte", field: "project.developerExperienceProjects", value: 1 }),
      r.points("readiness", "Readiness to proceed", "Entitlements and committed financing.", "MHP Guidelines §7320(b)(5)", 15, { op: "custom", fn: "readiness" }, "readiness"),
      r.points("leverage", "Leverage of enforceable funds", "Committed funds as share of TDC.", "MHP Guidelines §7320(b)(2)", 15, { op: "tiered", field: "derived.localLeverageRatio", direction: "higher_better", tiers: [{ threshold: 0.05, points: 5 }, { threshold: 0.1, points: 10 }, { threshold: 0.2, points: 15 }] }, "financial"),
      r.points("special-needs", "Special needs / supportive units", "Units for persons with special needs.", "MHP Guidelines §7320(b)(4)", 15, { op: "custom", fn: "supportive_population" }),
      r.points("deep-targeting", "Affordability depth", "Average AMI of restricted units.", "MHP Guidelines §7320(b)(3)", 20, { op: "tiered", field: "derived.averageAmiOfAffordable", direction: "lower_better", tiers: [{ threshold: 55, points: 8 }, { threshold: 50, points: 14 }, { threshold: 45, points: 20 }] }, "set_aside"),
      r.points("developer-experience", "Developer experience", "Completed affordable projects.", "MHP Guidelines §7320(b)(1)", 10, { op: "tiered", field: "project.developerExperienceProjects", direction: "higher_better", tiers: [{ threshold: 2, points: 4 }, { threshold: 4, points: 7 }, { threshold: 6, points: 10 }] }),
      r.points("opportunity", "Opportunity area / AFFH", "Highest/high resource areas or revitalization.", "HCD AFFH scoring (Super NOFA)", 10, { op: "custom", fn: "opportunity_area", params: { highest: 10, high: 10, moderate: 5 } }, "location"),
      r.points("services", "Services", "Resident service coordination.", "MHP Guidelines §7320(b)", 5, { op: "truthy", field: "project.serviceCoordination" }),
      r.points("prohousing", "Local support / Prohousing", "Local jurisdiction support (Prohousing designation bonus).", "Gov. Code §65589.9; Super NOFA", 5, { op: "truthy", field: "project.localSupportLetter" }),
    ],
    complianceRules: [
      c("income", "income", "Income-eligible at move-in", "Assisted units leased to income-qualified households.", "25 CCR §8305", "event", { kind: "unit_income_at_movein" }),
      c("rent", "rent", "MHP rent limits", "Rents within MHP regulatory agreement limits.", "25 CCR §8305", "monthly", { kind: "unit_rent_limit" }),
      c("recert", "income", "Annual recertification", "Annual income recertification of assisted units.", "25 CCR §8305", "annual", { kind: "annual_recert" }),
      c("report", "reporting", "Annual Report & Operating budget (HCD)", "Submit annual report, audited financials and operating budget.", "25 CCR §8314", "annual", { kind: "deadline", params: { key: "hcd_annual_report", everyMonths: 12 } }),
      c("term", "affordability_term", "55-year regulatory agreement", "Recorded HCD regulatory agreement.", "MHP Guidelines §7303", "ongoing", { kind: "manual", params: { key: "hcd_reg_agreement", years: 55 } }),
    ],
  };
}

// ───────────────────────── California AHSC ─────────────────────────

function caAhsc(): FundingProgram {
  const id = "ca-ahsc";
  const r = ruleBuilder(id);
  const c = complianceBuilder(id);
  return {
    id,
    name: "Affordable Housing and Sustainable Communities (AHSC)",
    shortName: "CA AHSC",
    type: "state_program",
    awardType: "soft_loan",
    administrator: "Strategic Growth Council (SGC) & HCD",
    jurisdiction: "CA",
    description:
      "Cap-and-Invest–funded loans and grants for transit-oriented affordable housing plus sustainable transportation infrastructure. Scored on GHG reduction, transit access, affordability and anti-displacement.",
    typicalAward: "Up to $35M housing loan + transportation grants",
    applicationCycle: "Annual round (NOFA typically Q1)",
    url: "https://sgc.ca.gov/programs/ahsc/",
    sourceDocument: { title: "AHSC Program Guidelines (Round 9)", url: "https://sgc.ca.gov/programs/ahsc/resources/guidelines.html", year: 2025 },
    discoveredBy: "knowledge_base",
    applicableStates: ["CA"],
    rules: [
      r.threshold("transit", "Qualifying transit within ½ mile", "TOD project area: housing within ½ mile of a high-quality transit stop.", "AHSC Guidelines §102 (TOD) / §103(a)", { op: "amenity", amenityType: "transit", tiers: [{ maxMiles: 0.5, points: 1 }] }, "location"),
      r.threshold("term", "55-year affordability", "Restricted units affordable for 55 years.", "AHSC Guidelines §106(a)", { op: "gte", field: "project.affordabilityPeriodYears", value: 55 }),
      r.threshold("affordability", "≥ 20% restricted units", "At least 20% of units at ≤ 80% AMI (with deeper targeting scored).", "AHSC Guidelines §106(a)(2)", { op: "gte", field: "derived.pctUnitsAt80", value: 0.2 }, "set_aside"),
      r.threshold("rents", "Rent limits", "Rents within TCAC/HCD limits.", "AHSC Guidelines §106; 25 CCR §8305", { op: "custom", fn: "rents_within_limits" }, "financial"),
      r.threshold("site-control", "Site control", "Site control for housing development.", "AHSC Guidelines §107", { op: "truthy", field: "project.siteControl" }, "readiness"),
      r.points("ghg", "GHG reduction (transit proximity)", "Quantified GHG reductions — scored here by distance to transit.", "AHSC Guidelines §108(a)", 15, { op: "amenity", amenityType: "transit", tiers: [{ maxMiles: 0.25, points: 15 }, { maxMiles: 0.5, points: 10 }] }, "location"),
      r.points("active-transport", "Active transportation & parks", "Walkable access to parks.", "AHSC Guidelines §108(f)", 5, { op: "amenity", amenityType: "park", tiers: [{ maxMiles: 0.25, points: 5 }, { maxMiles: 0.5, points: 3 }] }, "location"),
      r.points("affordability-depth", "Housing affordability depth", "Depth of affordability (avg AMI).", "AHSC Guidelines §108(c)", 15, { op: "tiered", field: "derived.averageAmiOfAffordable", direction: "lower_better", tiers: [{ threshold: 60, points: 5 }, { threshold: 50, points: 10 }, { threshold: 45, points: 15 }] }, "set_aside"),
      r.points("anti-displacement", "Anti-displacement (disadvantaged communities)", "Investment in disadvantaged / low-income communities with protections.", "AHSC Guidelines §108(h)", 6, { op: "tiered", field: "geo.povertyRate", direction: "higher_better", tiers: [{ threshold: 0.15, points: 3 }, { threshold: 0.2, points: 6 }] }, "location"),
      r.points("location-efficiency", "Location efficiency & access to destinations", "Grocery, schools, medical nearby.", "AHSC Guidelines §108(d)", 10, { op: "custom", fn: "amenity_count", params: { maxMiles: 0.5, pointsPerType: 2 } }, "location"),
      r.points("green", "Green buildings & renewable energy", "Beyond-code energy performance.", "AHSC Guidelines §108(e)", 5, { op: "custom", fn: "green_building", params: { passive_house: 5, leed: 3, enterprise_green: 3 } }),
      r.points("leverage", "Funds leveraged", "Other committed funds.", "AHSC Guidelines §108(g)", 8, { op: "tiered", field: "derived.localLeverageRatio", direction: "higher_better", tiers: [{ threshold: 0.05, points: 3 }, { threshold: 0.1, points: 6 }, { threshold: 0.2, points: 8 }] }, "financial"),
      r.points("readiness", "Readiness", "Entitlements and site control.", "AHSC Guidelines §108(i)", 6, { op: "custom", fn: "readiness" }, "readiness"),
    ],
    complianceRules: [
      c("income", "income", "Income-eligible at move-in", "Restricted units leased to income-qualified households.", "AHSC Guidelines §106", "event", { kind: "unit_income_at_movein" }),
      c("rent", "rent", "AHSC rent limits", "Rents within regulatory agreement limits.", "AHSC Guidelines §106", "monthly", { kind: "unit_rent_limit" }),
      c("transit-passes", "reporting", "Transit pass program reporting", "Provide free transit passes and report utilization annually.", "AHSC Guidelines §107(c)", "annual", { kind: "deadline", params: { key: "ahsc_transit_report", everyMonths: 12 } }),
      c("report", "reporting", "HCD annual report", "Annual report & audited financials to HCD.", "25 CCR §8314", "annual", { kind: "deadline", params: { key: "hcd_annual_report", everyMonths: 12 } }),
      c("term", "affordability_term", "55-year regulatory agreement", "Recorded AHSC regulatory agreement.", "AHSC Guidelines §106(a)", "ongoing", { kind: "manual", params: { key: "ahsc_reg_agreement", years: 55 } }),
    ],
  };
}

// ───────────────────────── Texas MFDL ─────────────────────────

function txMfdl(): FundingProgram {
  const id = "tx-tdhca-mfdl";
  const r = ruleBuilder(id);
  const c = complianceBuilder(id);
  return {
    id,
    name: "TDHCA Multifamily Direct Loan Program",
    shortName: "TX MFDL",
    type: "state_program",
    awardType: "soft_loan",
    administrator: "Texas Department of Housing and Community Affairs (TDHCA)",
    jurisdiction: "TX",
    description:
      "Low-interest / deferred loans from HOME, NHTF and TCAP repayment funds for multifamily rental, often paired with 4% or 9% HTC. Requires units at ≤ 30% and ≤ 50% AMI.",
    typicalAward: "$1M–$3M per application",
    applicationCycle: "Annual MFDL NOFA (first-come / competitive set-asides)",
    url: "https://www.tdhca.texas.gov/multifamily-direct-loan-program",
    sourceDocument: { title: "10 TAC Chapter 13 — Multifamily Direct Loan Rule", url: "https://www.tdhca.texas.gov/multifamily-direct-loan-program", year: 2025 },
    discoveredBy: "knowledge_base",
    applicableStates: ["TX"],
    rules: [
      r.threshold("vli", "Units at ≤ 50% AMI", "Restricted units at ≤ 50% AMI per fund source.", "10 TAC §13.4(a)", { op: "gte", field: "derived.pctUnitsAt50", value: 0.2 }, "set_aside"),
      r.threshold("eli", "Units at ≤ 30% AMI (NHTF)", "NHTF-funded applications require ≤ 30% AMI units.", "10 TAC §13.4(a)(2)", { op: "gt", field: "derived.pctUnitsAt30", value: 0 }, "set_aside"),
      r.threshold("term", "Affordability period", "Minimum 30-year LURA.", "10 TAC §13.4(b)", { op: "gte", field: "project.affordabilityPeriodYears", value: 30 }),
      r.threshold("feasibility", "Underwriting feasibility", "Debt coverage per REA rules.", "10 TAC Chapter 11 Subchapter D", { op: "custom", fn: "dscr_feasibility", params: { minLoanToCost: 0.1 } }, "financial"),
      r.points("eli-depth", "Deeper ELI targeting", "Additional ≤ 30% AMI units.", "10 TAC §13.6", 10, { op: "tiered", field: "derived.pctUnitsAt30", direction: "higher_better", tiers: [{ threshold: 0.05, points: 5 }, { threshold: 0.1, points: 10 }] }, "set_aside"),
      r.points("htc-layered", "Layered with HTC", "Applications layered with housing tax credits prioritized.", "10 TAC §13.5", 10, { op: "gte", field: "derived.pctUnitsAt60", value: 0.4 }, "financial"),
      r.points("opportunity", "High-opportunity area", "Opportunity index tract.", "10 TAC §13.6", 5, { op: "custom", fn: "opportunity_area", params: { highest: 5, high: 5, moderate: 3 } }, "location"),
      r.points("readiness", "Readiness", "Site control and zoning.", "10 TAC §13.6", 5, { op: "custom", fn: "readiness" }, "readiness"),
    ],
    complianceRules: [
      c("income", "income", "Income-eligible at move-in", "Units leased to qualified households per fund source.", "10 TAC §10.610", "event", { kind: "unit_income_at_movein" }),
      c("rent", "rent", "Program rent limits", "Rents within HOME/NHTF limits.", "10 TAC §10.614", "monthly", { kind: "unit_rent_limit" }),
      c("set-aside", "set_aside", "50% AMI set-aside", "Maintain committed ≤ 50% AMI units.", "10 TAC §13.4(a)", "ongoing", { kind: "set_aside_minimum", params: { amiPct: 50, minPct: 0.2 } }),
      c("report", "reporting", "Annual Owner's Compliance Report (AOCR)", "Submit AOCR to TDHCA by April 30.", "10 TAC §10.607", "annual", { kind: "deadline", params: { key: "annual_owner_cert", everyMonths: 12 } }),
    ],
  };
}

// ───────────────────────── New York HTF ─────────────────────────

function nyHtf(): FundingProgram {
  const id = "ny-htf";
  const r = ruleBuilder(id);
  const c = complianceBuilder(id);
  return {
    id,
    name: "New York State Housing Trust Fund Program",
    shortName: "NY HTF",
    type: "state_program",
    awardType: "soft_loan",
    administrator: "NYS Homes and Community Renewal — Housing Trust Fund Corporation",
    jurisdiction: "NY",
    description:
      "State low-interest loans for new construction or rehab of rental housing for low-income households (≤ 60% AMI), commonly paired with 9% LIHTC in HCR's Multifamily Finance RFP.",
    typicalAward: "Up to ~$125k/unit, $6M+ per project",
    applicationCycle: "HCR Multifamily Finance RFP (annual)",
    url: "https://hcr.ny.gov/housing-trust-fund-program",
    sourceDocument: { title: "Private Housing Finance Law Article 18; 9 NYCRR Part 2161", url: "https://hcr.ny.gov/housing-trust-fund-program", year: 2025 },
    discoveredBy: "knowledge_base",
    applicableStates: ["NY"],
    rules: [
      r.threshold("income", "Units at ≤ 60% AMI", "HTF-assisted units for households ≤ 60% AMI (avg).", "PHFL §1101; 9 NYCRR §2161.3", { op: "lte", field: "derived.averageAmiOfAffordable", value: 60 }, "set_aside"),
      r.threshold("term", "Regulatory term", "Minimum 30-year regulatory agreement (HCR term sheet: 50).", "9 NYCRR §2161.8", { op: "gte", field: "project.affordabilityPeriodYears", value: 30 }),
      r.threshold("nonprofit-or-experience", "Eligible applicant", "Nonprofit, municipality, or experienced for-profit developer.", "PHFL §1100", { op: "any", checks: [{ op: "truthy", field: "project.nonprofitSponsor" }, { op: "gte", field: "project.developerExperienceProjects", value: 2 }] }),
      r.threshold("rents", "Rent limits", "Rents within HTF limits.", "9 NYCRR §2161.9", { op: "custom", fn: "rents_within_limits" }, "financial"),
      r.points("eli", "Homeless / ELI set-aside", "Units at ≤ 30% AMI.", "HCR RFP scoring", 10, { op: "tiered", field: "derived.pctUnitsAt30", direction: "higher_better", tiers: [{ threshold: 0.1, points: 4 }, { threshold: 0.3, points: 10 }] }, "set_aside"),
      r.points("supportive", "Supportive housing", "Special-needs populations.", "HCR RFP scoring", 10, { op: "custom", fn: "supportive_population" }),
      r.points("leverage", "Leverage", "Other committed sources.", "HCR RFP scoring", 10, { op: "tiered", field: "derived.localLeverageRatio", direction: "higher_better", tiers: [{ threshold: 0.1, points: 5 }, { threshold: 0.2, points: 10 }] }, "financial"),
      r.points("green", "Sustainability", "Passive House or Enterprise Green.", "HCR Design Guidelines", 5, { op: "custom", fn: "green_building", params: { passive_house: 5, leed: 3, enterprise_green: 3 } }),
      r.points("readiness", "Readiness", "Site control and approvals.", "HCR RFP scoring", 5, { op: "custom", fn: "readiness" }, "readiness"),
    ],
    complianceRules: [
      c("income", "income", "Income-eligible at move-in", "HTF units leased to households ≤ 60% AMI.", "9 NYCRR §2161.3", "event", { kind: "unit_income_at_movein" }),
      c("rent", "rent", "HTF rent limits", "Rents within regulatory agreement.", "9 NYCRR §2161.9", "monthly", { kind: "unit_rent_limit" }),
      c("recert", "income", "Annual recertification", "Annual income recertification.", "HCR Compliance Manual", "annual", { kind: "annual_recert" }),
      c("report", "reporting", "Annual compliance report to HCR", "Annual owner certification & financials.", "HCR Compliance Manual", "annual", { kind: "deadline", params: { key: "annual_owner_cert", everyMonths: 12 } }),
    ],
  };
}

// ───────────────────────── Catalog ─────────────────────────

export const PROGRAM_CATALOG: FundingProgram[] = [
  fed9(),
  caTcac9(),
  txTdhca9(),
  nyHcr9(),
  fed4(),
  home(),
  htf(),
  cdbg(),
  ahp(),
  hud811(),
  hud221d4(),
  caMhp(),
  caAhsc(),
  txMfdl(),
  nyHtf(),
];

const STATE_9PCT = new Set(["ca-tcac-9", "tx-tdhca-9", "ny-hcr-9"]);
const SUPPORTIVE_ONLY = new Set(["hud-811-pra"]);

/** Programs relevant to a project: state-specific programs replace the generic 9% where they exist. */
export function catalogForProject(input: ProjectInput): FundingProgram[] {
  const state = input.state.trim().toUpperCase();
  const stateMatch = (p: FundingProgram) => !p.applicableStates || p.applicableStates.includes(state);
  const hasState9 = PROGRAM_CATALOG.some((p) => STATE_9PCT.has(p.id) && stateMatch(p));
  const supportive = input.targetPopulation === "supportive" || input.targetPopulation === "special_needs";
  return PROGRAM_CATALOG.filter(stateMatch)
    .filter((p) => !(p.id === "fed-lihtc-9" && hasState9))
    .filter((p) => !SUPPORTIVE_ONLY.has(p.id) || supportive)
    .map((p) => structuredClone(p));
}

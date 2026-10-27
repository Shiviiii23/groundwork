import { ArrowRight, Loader2, Plus, Rocket, Trash2, Wand2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { Amenity, AmenityType, ProjectInput, UnitMixRow } from "@shared/types";
import { api } from "../api";
import { Card, CardHeader, ErrorBox, Field, PageHeader } from "../components/ui";
import { money, num } from "../lib/format";
import { useAsync } from "../lib/hooks";

const BLANK: ProjectInput = {
  name: "",
  address: "",
  city: "",
  state: "",
  zip: "",
  constructionType: "new_construction",
  targetPopulation: "family",
  unitMix: [
    { bedrooms: 1, count: 20, targetAmiPct: 60, proposedRent: 1500 },
    { bedrooms: 2, count: 20, targetAmiPct: 50, proposedRent: 1600 },
  ],
  totalDevelopmentCost: 30_000_000,
  landCost: 3_000_000,
  committedLocalFunds: 0,
  developerExperienceProjects: 0,
  nonprofitSponsor: false,
  siteControl: false,
  zoningApproved: false,
  localSupportLetter: false,
  serviceCoordination: false,
  greenBuilding: "none",
  affordabilityPeriodYears: 55,
  amenitiesNearby: [],
};

const AMI_TIERS = [30, 40, 50, 60, 70, 80, 120];
const AMENITY_TYPES: AmenityType[] = ["transit", "grocery", "school", "park", "pharmacy", "library", "medical"];

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      <div className="p-5">{children}</div>
    </Card>
  );
}

function NumInput({ value, onChange, step, prefix }: { value: number; onChange: (n: number) => void; step?: number; prefix?: string }) {
  return (
    <div className="relative">
      {prefix && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400">{prefix}</span>}
      <input
        type="number"
        className={`input tnum ${prefix ? "pl-6" : ""}`}
        value={Number.isFinite(value) ? value : ""}
        step={step}
        onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
      />
    </div>
  );
}

function Check({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (b: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-200 p-3 transition hover:bg-zinc-50 has-[:checked]:border-indigo-300 has-[:checked]:bg-indigo-50/40">
      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-indigo-600" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block text-sm font-medium text-zinc-900">{label}</span>
        {hint && <span className="block text-xs text-zinc-500">{hint}</span>}
      </span>
    </label>
  );
}

export default function NewProjectPage() {
  const nav = useNavigate();
  const samples = useAsync(() => api.samples());
  const [f, setF] = useState<ProjectInput>(BLANK);
  const [activeSample, setActiveSample] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>();

  const set = <K extends keyof ProjectInput>(k: K, v: ProjectInput[K]) => setF((p) => ({ ...p, [k]: v }));
  const setRow = (i: number, patch: Partial<UnitMixRow>) =>
    setF((p) => ({ ...p, unitMix: p.unitMix.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const amenities = f.amenitiesNearby ?? [];
  const setAmenity = (i: number, patch: Partial<Amenity>) =>
    set("amenitiesNearby", amenities.map((a, j) => (j === i ? { ...a, ...patch } : a)));

  const totalUnits = f.unitMix.reduce((a, r) => a + (r.count || 0), 0);
  const affordable = f.unitMix.filter((r) => r.targetAmiPct <= 80).reduce((a, r) => a + r.count, 0);

  const valid = f.name && f.address && f.city && f.state.length === 2 && totalUnits > 0;

  async function submit() {
    setSubmitting(true);
    setError(undefined);
    try {
      const { project } = await api.createProject({ ...f, state: f.state.toUpperCase() });
      nav(`/projects/${project.id}`);
    } catch (e) {
      setError(e);
      setSubmitting(false);
    }
  }

  return (
    <div className="pb-24">
      <PageHeader
        eyebrow="Intake"
        title="New project"
        subtitle="Tell us where and what you're building. Agents will geocode the site, pull public data, find funding, and score the fit."
      />

      <Card className="mb-6 p-5">
        <div className="mb-3 flex items-center gap-2">
          <Wand2 size={15} className="text-indigo-600" />
          <span className="text-sm font-semibold">Start from a sample</span>
        </div>
        {samples.loading ? (
          <div className="text-sm text-zinc-400">Loading samples…</div>
        ) : samples.error ? (
          <div className="text-sm text-zinc-500">Samples unavailable — fill the form manually.</div>
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            {(samples.data ?? []).map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  setF({ ...BLANK, ...s.input, amenitiesNearby: s.input.amenitiesNearby ?? [] });
                  setActiveSample(s.id);
                }}
                className={`rounded-lg border p-3 text-left transition hover:border-indigo-300 hover:bg-indigo-50/40 ${
                  activeSample === s.id ? "border-indigo-400 bg-indigo-50/60 ring-2 ring-indigo-100" : "border-zinc-200"
                }`}
              >
                <div className="text-sm font-medium">{s.label}</div>
                <div className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{s.blurb}</div>
              </button>
            ))}
          </div>
        )}
      </Card>

      <div className="space-y-6">
        <Section title="Site" subtitle="Used for geocoding, Census tract lookup, QCT/DDA status, and amenity distances.">
          <div className="grid gap-4 md:grid-cols-6">
            <Field label="Project name" className="md:col-span-6">
              <input className="input" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Fruitvale Commons" />
            </Field>
            <Field label="Street address" className="md:col-span-3">
              <input className="input" value={f.address} onChange={(e) => set("address", e.target.value)} placeholder="3301 E 12th St" />
            </Field>
            <Field label="City" className="md:col-span-1">
              <input className="input" value={f.city} onChange={(e) => set("city", e.target.value)} />
            </Field>
            <Field label="State" className="md:col-span-1">
              <input className="input uppercase" maxLength={2} value={f.state} onChange={(e) => set("state", e.target.value.toUpperCase())} placeholder="CA" />
            </Field>
            <Field label="ZIP" className="md:col-span-1">
              <input className="input" value={f.zip} onChange={(e) => set("zip", e.target.value)} />
            </Field>
          </div>
        </Section>

        <Section title="Program & population">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Construction type">
              <select className="input" value={f.constructionType} onChange={(e) => set("constructionType", e.target.value as ProjectInput["constructionType"])}>
                <option value="new_construction">New construction</option>
                <option value="acq_rehab">Acquisition / rehab</option>
                <option value="adaptive_reuse">Adaptive reuse</option>
              </select>
            </Field>
            <Field label="Target population">
              <select className="input" value={f.targetPopulation} onChange={(e) => set("targetPopulation", e.target.value as ProjectInput["targetPopulation"])}>
                <option value="family">Family</option>
                <option value="senior">Senior</option>
                <option value="supportive">Permanent supportive</option>
                <option value="special_needs">Special needs</option>
              </select>
            </Field>
            <Field label="Affordability period (years)">
              <NumInput value={f.affordabilityPeriodYears} onChange={(n) => set("affordabilityPeriodYears", n)} />
            </Field>
            <Field label="Green building">
              <select className="input" value={f.greenBuilding} onChange={(e) => set("greenBuilding", e.target.value as ProjectInput["greenBuilding"])}>
                <option value="none">None</option>
                <option value="enterprise_green">Enterprise Green Communities</option>
                <option value="leed">LEED</option>
                <option value="passive_house">Passive House</option>
              </select>
            </Field>
            <Field label="Developer experience" hint="Completed affordable projects">
              <NumInput value={f.developerExperienceProjects} onChange={(n) => set("developerExperienceProjects", n)} />
            </Field>
          </div>
        </Section>

        <Section title="Unit mix" subtitle="Proposed gross rent should include the utility allowance.">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th className="label pb-2 pr-3">Bedrooms</th>
                  <th className="label pb-2 pr-3">Units</th>
                  <th className="label pb-2 pr-3">AMI tier</th>
                  <th className="label pb-2 pr-3">Proposed gross rent</th>
                  <th className="label pb-2 pr-3">Sq ft</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {f.unitMix.map((r, i) => (
                  <tr key={i}>
                    <td className="py-1 pr-3">
                      <select className="input" value={r.bedrooms} onChange={(e) => setRow(i, { bedrooms: Number(e.target.value) })}>
                        {[0, 1, 2, 3, 4].map((b) => (
                          <option key={b} value={b}>
                            {b === 0 ? "Studio" : `${b} BR`}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1 pr-3">
                      <NumInput value={r.count} onChange={(n) => setRow(i, { count: n })} />
                    </td>
                    <td className="py-1 pr-3">
                      <select className="input" value={r.targetAmiPct} onChange={(e) => setRow(i, { targetAmiPct: Number(e.target.value) })}>
                        {AMI_TIERS.map((a) => (
                          <option key={a} value={a}>
                            {a === 120 ? "Market / 120%" : `${a}% AMI`}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1 pr-3">
                      <NumInput prefix="$" value={r.proposedRent} onChange={(n) => setRow(i, { proposedRent: n })} />
                    </td>
                    <td className="py-1 pr-3">
                      <NumInput value={r.sqft ?? 0} onChange={(n) => setRow(i, { sqft: n || undefined })} />
                    </td>
                    <td className="py-1">
                      <button
                        className="rounded p-2 text-zinc-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                        disabled={f.unitMix.length <= 1}
                        onClick={() => set("unitMix", f.unitMix.filter((_, j) => j !== i))}
                        aria-label="Remove row"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <button
              className="btn-ghost"
              onClick={() => set("unitMix", [...f.unitMix, { bedrooms: 2, count: 10, targetAmiPct: 60, proposedRent: 1500 }])}
            >
              <Plus size={14} /> Add row
            </button>
            <div className="tnum flex gap-5 text-sm">
              <span>
                <span className="text-zinc-500">Total units </span>
                <span className="font-semibold">{num(totalUnits)}</span>
              </span>
              <span>
                <span className="text-zinc-500">≤80% AMI </span>
                <span className="font-semibold">{num(affordable)}</span>
              </span>
            </div>
          </div>
        </Section>

        <Section title="Financials">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Total development cost" hint={money(f.totalDevelopmentCost)}>
              <NumInput prefix="$" step={100000} value={f.totalDevelopmentCost} onChange={(n) => set("totalDevelopmentCost", n)} />
            </Field>
            <Field label="Land cost" hint={money(f.landCost)}>
              <NumInput prefix="$" step={100000} value={f.landCost} onChange={(n) => set("landCost", n)} />
            </Field>
            <Field label="Committed local / soft funds" hint={money(f.committedLocalFunds)}>
              <NumInput prefix="$" step={100000} value={f.committedLocalFunds} onChange={(n) => set("committedLocalFunds", n)} />
            </Field>
          </div>
          {totalUnits > 0 && (
            <div className="tnum mt-3 text-xs text-zinc-500">
              {money(f.totalDevelopmentCost / totalUnits)} per unit · land {money(f.landCost / totalUnits)} per unit
            </div>
          )}
        </Section>

        <Section title="Readiness">
          <div className="grid gap-3 md:grid-cols-3">
            <Check label="Site control" hint="Deed, option, or LDDA in hand" checked={f.siteControl} onChange={(b) => set("siteControl", b)} />
            <Check label="Zoning approved" hint="Entitlements secured" checked={f.zoningApproved} onChange={(b) => set("zoningApproved", b)} />
            <Check label="Local support letter" hint="From the chief elected official" checked={f.localSupportLetter} onChange={(b) => set("localSupportLetter", b)} />
            <Check label="Nonprofit sponsor" hint="Qualified nonprofit in ownership" checked={f.nonprofitSponsor} onChange={(b) => set("nonprofitSponsor", b)} />
            <Check label="Resident services" hint="On-site service coordination" checked={f.serviceCoordination} onChange={(b) => set("serviceCoordination", b)} />
          </div>
        </Section>

        <Section title="Nearby amenities (optional)" subtitle="The geo agent looks these up from OpenStreetMap; add any you know to supplement or override.">
          {amenities.length > 0 && (
            <div className="mb-3 space-y-2">
              {amenities.map((a, i) => (
                <div key={i} className="grid grid-cols-12 gap-2">
                  <select className="input col-span-3" value={a.type} onChange={(e) => setAmenity(i, { type: e.target.value as AmenityType })}>
                    {AMENITY_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <input className="input col-span-6" placeholder="Name" value={a.name} onChange={(e) => setAmenity(i, { name: e.target.value })} />
                  <div className="col-span-2">
                    <NumInput step={0.1} value={a.distanceMiles} onChange={(n) => setAmenity(i, { distanceMiles: n })} />
                  </div>
                  <button
                    className="col-span-1 rounded text-zinc-400 hover:bg-red-50 hover:text-red-600"
                    onClick={() => set("amenitiesNearby", amenities.filter((_, j) => j !== i))}
                    aria-label="Remove amenity"
                  >
                    <Trash2 size={14} className="mx-auto" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <button className="btn-ghost" onClick={() => set("amenitiesNearby", [...amenities, { type: "transit", name: "", distanceMiles: 0.25 }])}>
            <Plus size={14} /> Add amenity
          </button>
        </Section>

        <Field label="Notes (optional)">
          <textarea className="input min-h-[80px]" value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
        </Field>

        {error ? <ErrorBox error={error} /> : null}
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-[600] border-t border-zinc-200 bg-white/90 backdrop-blur md:left-60">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-3">
          <div className="text-xs text-zinc-500">
            {valid ? (
              <span className="flex items-center gap-1.5">
                <Rocket size={13} className="text-indigo-600" /> Launches 6 agents: intake → geo + discovery → extraction → scoring → compliance
              </span>
            ) : (
              "Name, address, city, state and at least one unit are required."
            )}
          </div>
          <button className="btn-primary" disabled={!valid || submitting} onClick={submit}>
            {submitting ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
            Run analysis
          </button>
        </div>
      </div>
    </div>
  );
}

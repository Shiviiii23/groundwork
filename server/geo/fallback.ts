import type { Amenity, GeoContext, ProjectInput } from "../../shared/types";

// Offline reference data used when live Census/HUD/OSM lookups are unreachable.
// Values approximate ACS 2019–2023 5-year estimates and HUD FY2024–25 designations
// for the demo neighborhoods; every source is marked live:false.

type Known = Omit<GeoContext, "sources" | "matchedAddress"> & { match: (p: ProjectInput) => boolean; label: string };

const am = (type: Amenity["type"], name: string, distanceMiles: number): Amenity => ({ type, name, distanceMiles });

const KNOWN: Known[] = [
  {
    label: "Fruitvale, Oakland CA",
    match: (p) => p.state.toUpperCase() === "CA" && /oakland/i.test(p.city),
    lat: 37.7752,
    lng: -122.2236,
    stateFips: "06",
    countyFips: "001",
    tractCode: "406100",
    geoid: "06001406100",
    countyName: "Alameda County",
    tractName: "Census Tract 4061",
    population: 5210,
    tractMedianHouseholdIncome: 61850,
    areaMedianIncome: 150000,
    povertyRate: 0.214,
    renterShare: 0.69,
    rentBurdenedShare: 0.56,
    unemploymentRate: 0.071,
    isQCT: true,
    qctBasis: "hud_list",
    isDDA: true,
    isRural: false,
    opportunityArea: "low",
    amenities: [
      am("transit", "Fruitvale BART Station", 0.38),
      am("grocery", "Mi Pueblo Food Center", 0.42),
      am("school", "Think College Now Elementary", 0.29),
      am("medical", "La Clínica de la Raza – Fruitvale", 0.31),
      am("pharmacy", "Walgreens – International Blvd", 0.34),
      am("library", "César E. Chávez Branch Library", 0.36),
      am("park", "Josie de la Cruz Park", 0.47),
    ],
  },
  {
    label: "East Riverside, Austin TX",
    match: (p) => p.state.toUpperCase() === "TX" && /austin/i.test(p.city),
    lat: 30.2367,
    lng: -97.7262,
    stateFips: "48",
    countyFips: "453",
    tractCode: "002319",
    geoid: "48453002319",
    countyName: "Travis County",
    tractName: "Census Tract 23.19",
    population: 6840,
    tractMedianHouseholdIncome: 49120,
    areaMedianIncome: 126000,
    povertyRate: 0.268,
    renterShare: 0.88,
    rentBurdenedShare: 0.52,
    unemploymentRate: 0.054,
    isQCT: true,
    qctBasis: "hud_list",
    isDDA: false,
    isRural: false,
    opportunityArea: "moderate",
    amenities: [
      am("transit", "CapMetro Route 20 – Riverside/Pleasant Valley", 0.12),
      am("grocery", "H-E-B – Riverside & Pleasant Valley", 0.71),
      am("school", "Linder Elementary", 0.58),
      am("park", "Roy G. Guerrero Colorado River Park", 0.94),
      am("pharmacy", "CVS – E Riverside Dr", 0.44),
      am("medical", "CommUnityCare – Southeast Health & Wellness", 0.89),
      am("library", "Ruiz Branch Library", 1.32),
    ],
  },
  {
    label: "Mott Haven, Bronx NY",
    match: (p) => p.state.toUpperCase() === "NY" && /bronx|mott haven/i.test(`${p.city} ${p.address}`),
    lat: 40.8087,
    lng: -73.9229,
    stateFips: "36",
    countyFips: "005",
    tractCode: "004100",
    geoid: "36005004100",
    countyName: "Bronx County",
    tractName: "Census Tract 41",
    population: 7390,
    tractMedianHouseholdIncome: 28950,
    areaMedianIncome: 162200,
    povertyRate: 0.415,
    renterShare: 0.93,
    rentBurdenedShare: 0.61,
    unemploymentRate: 0.112,
    isQCT: true,
    qctBasis: "hud_list",
    isDDA: true,
    isRural: false,
    opportunityArea: "high_segregation_poverty",
    amenities: [
      am("transit", "3 Av–138 St (6 train)", 0.15),
      am("grocery", "Western Beef – E 138th St", 0.33),
      am("school", "P.S. 18 John Peter Zenger", 0.27),
      am("park", "St. Mary's Park", 0.41),
      am("pharmacy", "Rite Aid – Willis Ave", 0.22),
      am("library", "Mott Haven Library (NYPL)", 0.24),
      am("medical", "Lincoln Medical Center", 0.62),
    ],
  },
];

// Rough 4-person median family income by state (HUD FY2024 statewide non-metro/metro blend) for synthetic fallback.
const STATE_AMI: Record<string, number> = {
  AL: 79000, AK: 109000, AZ: 95000, AR: 75000, CA: 125000, CO: 118000, CT: 125000, DE: 103000, DC: 154000,
  FL: 92000, GA: 95000, HI: 120000, ID: 87000, IL: 106000, IN: 88000, IA: 95000, KS: 93000, KY: 80000,
  LA: 78000, ME: 96000, MD: 132000, MA: 140000, MI: 92000, MN: 115000, MS: 70000, MO: 89000, MT: 90000,
  NE: 96000, NV: 92000, NH: 122000, NJ: 133000, NM: 77000, NY: 112000, NC: 91000, ND: 101000, OH: 92000,
  OK: 80000, OR: 104000, PA: 98000, RI: 112000, SC: 85000, SD: 92000, TN: 86000, TX: 95000, UT: 107000,
  VT: 102000, VA: 120000, WA: 128000, WV: 72000, WI: 100000, WY: 95000,
};
const STATE_FIPS: Record<string, string> = {
  AL: "01", AK: "02", AZ: "04", AR: "05", CA: "06", CO: "08", CT: "09", DE: "10", DC: "11", FL: "12", GA: "13",
  HI: "15", ID: "16", IL: "17", IN: "18", IA: "19", KS: "20", KY: "21", LA: "22", ME: "23", MD: "24", MA: "25",
  MI: "26", MN: "27", MS: "28", MO: "29", MT: "30", NE: "31", NV: "32", NH: "33", NJ: "34", NM: "35", NY: "36",
  NC: "37", ND: "38", OH: "39", OK: "40", OR: "41", PA: "42", RI: "44", SC: "45", SD: "46", TN: "47", TX: "48",
  UT: "49", VT: "50", VA: "51", WA: "53", WV: "54", WI: "55", WY: "56",
};
// Approximate state centroids so the map lands somewhere sensible.
const STATE_CENTER: Record<string, [number, number]> = {
  CA: [36.78, -119.42], TX: [31.0, -99.0], NY: [42.9, -75.5], FL: [27.8, -81.7], IL: [40.0, -89.2], WA: [47.4, -120.5],
  MA: [42.3, -71.8], GA: [32.7, -83.4], CO: [39.0, -105.5], AZ: [34.2, -111.7], NC: [35.5, -79.4], PA: [40.9, -77.8],
};

function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

function fallbackSource(note: string) {
  return { name: note, live: false, retrievedAt: new Date().toISOString() };
}

export function knownLocationLabel(p: ProjectInput): string | null {
  return KNOWN.find((k) => k.match(p))?.label ?? null;
}

/** Bundled context for demo neighborhoods, else a deterministic synthetic estimate. */
export function fallbackGeo(p: ProjectInput): GeoContext {
  const oneLine = `${p.address}, ${p.city}, ${p.state} ${p.zip}`;
  const known = KNOWN.find((k) => k.match(p));
  if (known) {
    const { match: _m, label, ...rest } = known;
    return {
      ...rest,
      amenities: rest.amenities.map((a) => ({ ...a })),
      lat: p.lat ?? rest.lat,
      lng: p.lng ?? rest.lng,
      matchedAddress: oneLine.toUpperCase(),
      sources: [
        fallbackSource(`Bundled reference data – ${label} (ACS 2019–2023 5-yr approx.)`),
        fallbackSource("Bundled HUD FY2025 QCT/DDA designation"),
        fallbackSource("Bundled amenity survey (OpenStreetMap snapshot)"),
      ],
    };
  }

  const st = p.state.toUpperCase();
  const h = hash(oneLine.toLowerCase());
  const r = (n: number) => ((h >>> n) % 1000) / 1000; // deterministic 0..1 values
  const ami = STATE_AMI[st] ?? 97800;
  const incomeRatio = 0.4 + r(1) * 0.9; // tract income vs AMI
  const tractIncome = Math.round((ami * incomeRatio) / 100) * 100;
  const povertyRate = Math.max(0.04, Math.min(0.45, 0.42 - incomeRatio * 0.3 + r(3) * 0.06));
  const center = STATE_CENTER[st] ?? [39.8, -98.6];
  const lat = p.lat ?? center[0] + (r(5) - 0.5) * 0.6;
  const lng = p.lng ?? center[1] + (r(7) - 0.5) * 0.6;
  const isQCT = povertyRate >= 0.25 || incomeRatio < 0.6;
  const opportunityArea: GeoContext["opportunityArea"] =
    incomeRatio >= 1.15 && povertyRate < 0.1 ? "highest" : incomeRatio >= 0.95 ? "high" : incomeRatio >= 0.7 ? "moderate" : povertyRate >= 0.3 ? "high_segregation_poverty" : "low";
  const tract = String(100 + (h % 9800)).padStart(4, "0") + "00";
  const county = String(1 + ((h >>> 9) % 150) * 2).padStart(3, "0");
  const fips = STATE_FIPS[st] ?? "00";
  const dist = (base: number, n: number) => Math.round((base + r(n) * base * 2) * 100) / 100;
  return {
    lat,
    lng,
    matchedAddress: oneLine.toUpperCase(),
    stateFips: fips,
    countyFips: county,
    tractCode: tract,
    geoid: `${fips}${county}${tract}`,
    countyName: `${p.city} area (estimated)`,
    tractName: `Census Tract ${Number(tract) / 100} (estimated)`,
    population: 2500 + (h % 5000),
    tractMedianHouseholdIncome: tractIncome,
    areaMedianIncome: ami,
    povertyRate: Math.round(povertyRate * 1000) / 1000,
    renterShare: Math.round((0.35 + r(11) * 0.5) * 100) / 100,
    rentBurdenedShare: Math.round((0.38 + r(13) * 0.25) * 100) / 100,
    unemploymentRate: Math.round((0.03 + r(15) * 0.06) * 1000) / 1000,
    isQCT,
    qctBasis: "estimated_from_acs",
    isDDA: ami > 120000,
    isRural: false,
    opportunityArea,
    amenities: [
      { type: "transit", name: "Nearest bus stop (estimated)", distanceMiles: dist(0.15, 17) },
      { type: "grocery", name: "Nearest full-service grocery (estimated)", distanceMiles: dist(0.4, 19) },
      { type: "school", name: "Nearest public school (estimated)", distanceMiles: dist(0.35, 21) },
      { type: "park", name: "Nearest public park (estimated)", distanceMiles: dist(0.3, 23) },
      { type: "pharmacy", name: "Nearest pharmacy (estimated)", distanceMiles: dist(0.4, 25) },
      { type: "library", name: "Nearest public library (estimated)", distanceMiles: dist(0.6, 27) },
      { type: "medical", name: "Nearest clinic (estimated)", distanceMiles: dist(0.6, 29) },
    ],
    sources: [
      fallbackSource(`Synthetic estimate seeded from ${st} statewide HUD median family income`),
      fallbackSource("QCT/DDA estimated from statutory test (poverty ≥25% or income <60% AMI)"),
      fallbackSource("Amenity distances estimated"),
    ],
  };
}

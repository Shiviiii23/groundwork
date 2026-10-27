import { fetchJson } from "./http";

const GEOCODER = "https://geocoding.geo.census.gov/geocoder/geographies";
export const ACS_YEAR = 2023;
const ACS = `https://api.census.gov/data/${ACS_YEAR}/acs/acs5`;

export interface GeocodeResult {
  lat: number;
  lng: number;
  matchedAddress: string;
  stateFips: string;
  countyFips: string;
  tractCode: string;
  geoid: string;
  tractName: string;
  countyName: string;
}

interface GeoLayers {
  "Census Tracts"?: { GEOID: string; STATE: string; COUNTY: string; TRACT: string; NAME: string }[];
  Counties?: { NAME: string }[];
}

const COMMON = "benchmark=Public_AR_Current&vintage=Current_Current&layers=Census%20Tracts,Counties&format=json";

export function geocoderUrl(oneLine: string, lat?: number, lng?: number): string {
  if (lat != null && lng != null) return `${GEOCODER}/coordinates?x=${lng}&y=${lat}&${COMMON}`;
  return `${GEOCODER}/onelineaddress?address=${encodeURIComponent(oneLine)}&${COMMON}`;
}

export async function geocode(oneLine: string, lat?: number, lng?: number): Promise<GeocodeResult> {
  const url = geocoderUrl(oneLine, lat, lng);
  const body = await fetchJson<{ result: { addressMatches?: { matchedAddress: string; coordinates: { x: number; y: number }; geographies: GeoLayers }[]; geographies?: GeoLayers } }>(url);
  let geos: GeoLayers | undefined;
  let matched = oneLine;
  let x = lng, y = lat;
  if (lat != null && lng != null) {
    geos = body.result.geographies;
  } else {
    const m = body.result.addressMatches?.[0];
    if (!m) throw new Error("Census geocoder found no address match");
    geos = m.geographies;
    matched = m.matchedAddress;
    x = m.coordinates.x;
    y = m.coordinates.y;
  }
  const tract = geos?.["Census Tracts"]?.[0];
  if (!tract || x == null || y == null) throw new Error("Census geocoder returned no tract");
  return {
    lat: y,
    lng: x,
    matchedAddress: matched,
    stateFips: tract.STATE,
    countyFips: tract.COUNTY,
    tractCode: tract.TRACT,
    geoid: tract.GEOID,
    tractName: tract.NAME,
    countyName: geos?.Counties?.[0]?.NAME ?? `County ${tract.COUNTY}`,
  };
}

const TRACT_VARS = [
  "B01003_001E", // population
  "B19013_001E", // median household income
  "B17001_001E", "B17001_002E", // poverty universe / below poverty
  "B25003_001E", "B25003_003E", // occupied / renter-occupied
  "B25070_001E", "B25070_007E", "B25070_008E", "B25070_009E", "B25070_010E", "B25070_011E", // gross rent as % income
  "B23025_003E", "B23025_005E", // civilian labor force / unemployed
];

function keyParam(): string {
  return process.env.CENSUS_API_KEY ? `&key=${process.env.CENSUS_API_KEY}` : "";
}

export function acsTractUrl(g: Pick<GeocodeResult, "stateFips" | "countyFips" | "tractCode">): string {
  return `${ACS}?get=NAME,${TRACT_VARS.join(",")}&for=tract:${g.tractCode}&in=state:${g.stateFips}%20county:${g.countyFips}${keyParam()}`;
}
export function acsCountyUrl(g: Pick<GeocodeResult, "stateFips" | "countyFips">): string {
  return `${ACS}?get=NAME,B19113_001E&for=county:${g.countyFips}&in=state:${g.stateFips}${keyParam()}`;
}

export interface TractStats {
  population: number;
  tractMedianHouseholdIncome: number;
  povertyRate: number;
  renterShare: number;
  rentBurdenedShare: number;
  unemploymentRate: number;
}

function rowToRecord(rows: string[][]): Record<string, number> {
  const [head, vals] = rows;
  const out: Record<string, number> = {};
  head.forEach((h, i) => (out[h] = Number(vals[i])));
  return out;
}

const ratio = (a: number, b: number) => (b > 0 && a >= 0 ? a / b : 0);

export async function acsTract(g: GeocodeResult): Promise<TractStats> {
  const v = rowToRecord(await fetchJson<string[][]>(acsTractUrl(g)));
  const computed = v.B25070_001E - v.B25070_011E;
  return {
    population: v.B01003_001E,
    // ACS uses large negative sentinels for suppressed values
    tractMedianHouseholdIncome: v.B19013_001E > 0 ? v.B19013_001E : 0,
    povertyRate: ratio(v.B17001_002E, v.B17001_001E),
    renterShare: ratio(v.B25003_003E, v.B25003_001E),
    rentBurdenedShare: ratio(v.B25070_007E + v.B25070_008E + v.B25070_009E + v.B25070_010E, computed),
    unemploymentRate: ratio(v.B23025_005E, v.B23025_003E),
  };
}

export async function acsCountyMedianFamilyIncome(g: GeocodeResult): Promise<number> {
  const v = rowToRecord(await fetchJson<string[][]>(acsCountyUrl(g)));
  if (!(v.B19113_001E > 0)) throw new Error("county median family income suppressed");
  return v.B19113_001E;
}

import type { Amenity, AmenityType, DataSource, GeoContext } from "../../shared/types";
import { nearbyAmenities, overpassQuery } from "../geo/amenities";
import { ACS_YEAR, acsCountyMedianFamilyIncome, acsCountyUrl, acsTract, acsTractUrl, geocode, geocoderUrl, type GeocodeResult } from "../geo/census";
import { fallbackGeo } from "../geo/fallback";
import { errMsg } from "../geo/http";
import { hudMfiForCounty } from "../geo/hudMfi";
import { ddaUrl, estimateQct, isDifficultDevelopmentArea, isQualifiedCensusTract, qctUrl } from "../geo/hud";
import type { Agent } from "./context";
import { pct, usd } from "./context";

const src = (name: string, url: string, live: boolean): DataSource => ({ name, url, live, retrievedAt: new Date().toISOString() });

function opportunityFromStats(incomeRatio: number, poverty: number): GeoContext["opportunityArea"] {
  if (poverty >= 0.3 && incomeRatio < 0.6) return "high_segregation_poverty";
  if (incomeRatio >= 1.2 && poverty < 0.1) return "highest";
  if (incomeRatio >= 0.95 && poverty < 0.15) return "high";
  if (incomeRatio >= 0.7) return "moderate";
  return "low";
}

export const geoAgent: Agent = async (ctx) => {
  const p = ctx.project.input;
  const oneLine = `${p.address}, ${p.city}, ${p.state} ${p.zip}`;
  const fb = fallbackGeo(p);
  const sources: DataSource[] = [];
  let liveCount = 0;

  // 1. Geocode → tract
  let g: GeocodeResult;
  let geocoded = false;
  const gUrl = geocoderUrl(oneLine, p.lat, p.lng);
  ctx.step("tool", p.lat != null ? "Census geocoder: coordinates → census tract" : "Census geocoder: address → coordinates + census tract", gUrl);
  try {
    g = await geocode(oneLine, p.lat, p.lng);
    sources.push(src("US Census Geocoder (Public_AR_Current)", gUrl, true));
    liveCount++;
    geocoded = true;
    ctx.step("result", `Matched ${g.matchedAddress} → tract ${g.geoid}`, `${g.lat.toFixed(5)}, ${g.lng.toFixed(5)} · ${g.countyName}`);
  } catch (err) {
    ctx.step("warn", `Census geocoder unavailable (${errMsg(err)}) — using bundled reference location`);
    g = { lat: fb.lat, lng: fb.lng, matchedAddress: fb.matchedAddress, stateFips: fb.stateFips, countyFips: fb.countyFips, tractCode: fb.tractCode, geoid: fb.geoid, tractName: fb.tractName, countyName: fb.countyName };
    ctx.step("result", `Reference tract ${g.geoid} (${g.tractName}, ${g.countyName})`);
  }
  ctx.progress(20);
  await ctx.pause();

  // 2. ACS tract + county stats
  let stats = {
    population: fb.population,
    tractMedianHouseholdIncome: fb.tractMedianHouseholdIncome,
    povertyRate: fb.povertyRate,
    renterShare: fb.renterShare,
    rentBurdenedShare: fb.rentBurdenedShare,
    unemploymentRate: fb.unemploymentRate,
  };
  let ami = fb.areaMedianIncome;
  let acsLive = false;
  const tUrl = acsTractUrl(g);
  ctx.step("tool", `ACS ${ACS_YEAR} 5-year: tract demographics (B19013, B17001, B25003, B25070, B23025)`, tUrl);
  try {
    stats = await acsTract(g);
    acsLive = true;
    sources.push(src(`ACS ${ACS_YEAR} 5-Year – tract ${g.geoid}`, tUrl, true));
    liveCount++;
  } catch (err) {
    ctx.step("warn", `ACS tract query failed (${errMsg(err)}) — using bundled estimates`);
  }
  ctx.step(
    "result",
    `Tract median HH income ${usd(stats.tractMedianHouseholdIncome)} · poverty ${pct(stats.povertyRate)} · renters ${pct(stats.renterShare, 0)}`,
    `Rent-burdened renters ${pct(stats.rentBurdenedShare, 0)} · unemployment ${pct(stats.unemploymentRate)} · pop. ${stats.population.toLocaleString()}`,
  );
  ctx.progress(40);
  await ctx.pause();

  // Synthetic fallback tracts have made-up county codes, so only trust a real or bundled-reference county.
  const hud = geocoded || fb.qctBasis === "hud_list" ? hudMfiForCounty(g.stateFips, g.countyFips) : null;
  if (hud) {
    ami = hud.mfi;
    sources.push(src(`HUD FY2025 Median Family Income – ${hud.area} (bundled table)`, "https://www.huduser.gov/portal/datasets/il.html", false));
    ctx.step("result", `HUD FY2025 AMI lookup: ${hud.area}`, `4-person median family income ${usd(hud.mfi)} (county ${g.stateFips}${g.countyFips})`);
  } else {
    const cUrl = acsCountyUrl(g);
    ctx.step("tool", `County not in HUD MFI table — ACS ${ACS_YEAR} county median family income (B19113) as AMI estimate`, cUrl);
    try {
      ami = await acsCountyMedianFamilyIncome(g);
      sources.push(src(`ACS ${ACS_YEAR} 5-Year – ${g.countyName} median family income (AMI estimate)`, cUrl, true));
      liveCount++;
    } catch (err) {
      ctx.step("warn", `County income query failed (${errMsg(err)}) — using bundled median family income`);
    }
  }
  const incomeRatio = stats.tractMedianHouseholdIncome / ami;
  ctx.step("result", `Area median income (4-person) ${usd(ami)} → tract income is ${pct(incomeRatio, 0)} of AMI`);
  ctx.progress(55);
  await ctx.pause();

  // 3. HUD QCT / DDA
  let isQCT = fb.isQCT;
  let qctBasis: GeoContext["qctBasis"] = fb.qctBasis;
  let isDDA = fb.isDDA;
  const qUrl = qctUrl(g.lat, g.lng);
  ctx.step("tool", "HUD eGIS: Qualified Census Tract point-in-polygon", qUrl);
  try {
    isQCT = await isQualifiedCensusTract(g.lat, g.lng);
    qctBasis = "hud_list";
    sources.push(src("HUD Qualified Census Tracts (eGIS)", qUrl, true));
    liveCount++;
  } catch (err) {
    if (acsLive) {
      isQCT = estimateQct(stats.povertyRate, stats.tractMedianHouseholdIncome, ami);
      qctBasis = "estimated_from_acs";
      ctx.step("warn", `HUD QCT layer unreachable (${errMsg(err)}) — estimated from statutory test`, `poverty ${pct(stats.povertyRate)} ≥ 25% or tract income ${pct(incomeRatio, 0)} < 60% AMI`);
    } else {
      ctx.step("warn", `HUD QCT layer unreachable (${errMsg(err)}) — using bundled designation`);
    }
  }
  const dUrl = ddaUrl(g.lat, g.lng);
  ctx.step("tool", "HUD eGIS: Difficult Development Area lookup", dUrl);
  try {
    isDDA = await isDifficultDevelopmentArea(g.lat, g.lng);
    sources.push(src("HUD Difficult Development Areas (eGIS)", dUrl, true));
    liveCount++;
  } catch (err) {
    ctx.step("warn", `HUD DDA layer unreachable (${errMsg(err)}) — using bundled designation`);
  }
  ctx.step(
    "result",
    `QCT: ${isQCT ? "YES" : "no"}${qctBasis === "estimated_from_acs" ? " (estimated)" : ""} · DDA: ${isDDA ? "YES" : "no"}`,
    isQCT || isDDA ? "Eligible for 130% basis boost under IRC §42(d)(5)(B)" : "No automatic basis boost",
  );
  ctx.progress(75);
  await ctx.pause();

  // 4. Amenities (live OSM → client-provided → bundled/estimated, per type)
  const oUrl = "https://overpass-api.de/api/interpreter";
  ctx.step("tool", "OpenStreetMap Overpass: amenities within 1.5 mi", `${oUrl}\n${overpassQuery(g.lat, g.lng).slice(0, 160)}…`);
  let live: Amenity[] = [];
  try {
    live = await nearbyAmenities(g.lat, g.lng);
    sources.push(src("OpenStreetMap via Overpass API", oUrl, true));
    liveCount++;
  } catch (err) {
    ctx.step("warn", `Overpass unreachable (${errMsg(err)}) — using ${p.amenitiesNearby?.length ? "client-provided and " : ""}bundled amenity distances`);
  }
  const byType = new Map<AmenityType, Amenity>();
  for (const a of fb.amenities) byType.set(a.type, a);
  for (const a of p.amenitiesNearby ?? []) byType.set(a.type, a);
  for (const a of live) byType.set(a.type, a);
  const amenities = [...byType.values()].sort((a, b) => a.distanceMiles - b.distanceMiles);
  ctx.step("result", `Nearest amenities: ${amenities.slice(0, 4).map((a) => `${a.type} ${a.distanceMiles.toFixed(2)} mi`).join(" · ")}`, amenities.map((a) => `${a.type}: ${a.name} (${a.distanceMiles.toFixed(2)} mi)`).join("\n"));
  ctx.progress(90);

  if (liveCount === 0) sources.push(...fb.sources);
  else if (!acsLive) sources.push(...fb.sources.filter((s) => /ACS|Synthetic|reference/i.test(s.name)));

  ctx.project.geo = {
    lat: g.lat,
    lng: g.lng,
    matchedAddress: g.matchedAddress,
    stateFips: g.stateFips,
    countyFips: g.countyFips,
    tractCode: g.tractCode,
    geoid: g.geoid,
    countyName: g.countyName,
    tractName: g.tractName,
    ...stats,
    areaMedianIncome: ami,
    isQCT,
    qctBasis,
    isDDA,
    isRural: fb.isRural,
    opportunityArea: acsLive ? opportunityFromStats(incomeRatio, stats.povertyRate) : fb.opportunityArea,
    amenities,
    sources,
  };
  ctx.saveProject();
  ctx.progress(100);
  return `Tract ${g.geoid} · AMI ${usd(ami)} · ${isQCT ? "QCT" : "non-QCT"}${isDDA ? " + DDA" : ""} · ${liveCount ? `${liveCount} live sources` : "offline reference data"}`;
};

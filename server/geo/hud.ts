import { fetchJson } from "./http";

// HUD eGIS ArcGIS Online layers for Qualified Census Tracts and Difficult Development Areas.
const QCT_LAYER = "https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/QUALIFIED_CENSUS_TRACTS/FeatureServer/0/query";
const DDA_LAYER = "https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/Difficult_Development_Areas/FeatureServer/0/query";

export function pointQueryUrl(layer: string, lat: number, lng: number): string {
  const q = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    returnGeometry: "false",
    f: "json",
  });
  return `${layer}?${q}`;
}

export const qctUrl = (lat: number, lng: number) => pointQueryUrl(QCT_LAYER, lat, lng);
export const ddaUrl = (lat: number, lng: number) => pointQueryUrl(DDA_LAYER, lat, lng);

async function intersects(url: string): Promise<boolean> {
  const body = await fetchJson<{ features?: unknown[]; error?: { message: string } }>(url);
  if (body.error) throw new Error(body.error.message);
  return (body.features?.length ?? 0) > 0;
}

export const isQualifiedCensusTract = (lat: number, lng: number) => intersects(qctUrl(lat, lng));
export const isDifficultDevelopmentArea = (lat: number, lng: number) => intersects(ddaUrl(lat, lng));

/**
 * Statutory QCT test (IRC §42(d)(5)(B)(ii)): ≥50% of households below 60% of AMGI, or poverty rate ≥25%.
 * Without household-income distributions we approximate the first prong with tract median HH income < 60% of AMI.
 */
export function estimateQct(povertyRate: number, tractMedianIncome: number, ami: number): boolean {
  return povertyRate >= 0.25 || (tractMedianIncome > 0 && ami > 0 && tractMedianIncome / ami < 0.6);
}

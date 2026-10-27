import type { Amenity, AmenityType } from "../../shared/types";
import { fetchJson } from "./http";

const OVERPASS = "https://overpass-api.de/api/interpreter";
const RADIUS_M = 2400; // ~1.5 mi

export function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function overpassQuery(lat: number, lng: number): string {
  const a = `around:${RADIUS_M},${lat},${lng}`;
  return `[out:json][timeout:15];(
node(${a})[railway=station];node(${a})[public_transport=station];node(${a})[highway=bus_stop];
nwr(${a})[shop=supermarket];nwr(${a})[shop=grocery];
nwr(${a})[amenity=school];
nwr(${a})[leisure=park];
nwr(${a})[amenity=pharmacy];
nwr(${a})[amenity=library];
nwr(${a})[amenity~"^(clinic|hospital|doctors)$"];
);out center 600;`;
}

interface OsmEl { lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }

function classify(t: Record<string, string>): AmenityType | null {
  if (t.railway === "station" || t.public_transport === "station" || t.highway === "bus_stop") return "transit";
  if (t.shop === "supermarket" || t.shop === "grocery") return "grocery";
  if (t.amenity === "school") return "school";
  if (t.leisure === "park") return "park";
  if (t.amenity === "pharmacy") return "pharmacy";
  if (t.amenity === "library") return "library";
  if (["clinic", "hospital", "doctors"].includes(t.amenity)) return "medical";
  return null;
}

/** Nearest amenity of each type within ~1.5 miles, from OpenStreetMap via Overpass. */
export async function nearbyAmenities(lat: number, lng: number): Promise<Amenity[]> {
  const body = await fetchJson<{ elements: OsmEl[] }>(OVERPASS, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(overpassQuery(lat, lng))}`,
  });
  const best = new Map<AmenityType, Amenity>();
  for (const el of body.elements) {
    const t = el.tags ?? {};
    const type = classify(t);
    const elat = el.lat ?? el.center?.lat;
    const elng = el.lon ?? el.center?.lon;
    if (!type || elat == null || elng == null) continue;
    // Rail stations are more valuable than bus stops for scoring; prefer named items.
    const d = Math.round(haversineMiles(lat, lng, elat, elng) * 100) / 100;
    const cur = best.get(type);
    if (!cur || d < cur.distanceMiles) {
      best.set(type, { type, name: t.name || `${type[0].toUpperCase()}${type.slice(1)} (unnamed)`, distanceMiles: d, lat: elat, lng: elng });
    }
  }
  return [...best.values()].sort((a, b) => a.distanceMiles - b.distanceMiles);
}

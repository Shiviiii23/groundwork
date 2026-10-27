import L from "leaflet";
import { Bus, GraduationCap, HeartPulse, Library, MapPin, Pill as PillIcon, ShoppingCart, Trees } from "lucide-react";
import type { ReactNode } from "react";
import { CircleMarker, MapContainer, Marker, TileLayer, Tooltip } from "react-leaflet";
import type { AmenityType, GeoContext } from "@shared/types";
import { money, num, pct } from "../lib/format";
import { Card, CardHeader, Pill } from "./ui";

// Default marker without relying on bundled image assets.
const pin = L.divIcon({
  className: "",
  html: `<div style="width:18px;height:18px;border-radius:9999px;background:#4f46e5;border:3px solid white;box-shadow:0 1px 4px rgba(0,0,0,.35)"></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

const AMENITY_ICON: Record<AmenityType, ReactNode> = {
  transit: <Bus size={13} />,
  grocery: <ShoppingCart size={13} />,
  school: <GraduationCap size={13} />,
  park: <Trees size={13} />,
  pharmacy: <PillIcon size={13} />,
  library: <Library size={13} />,
  medical: <HeartPulse size={13} />,
};

const OPP_LABEL: Record<GeoContext["opportunityArea"], string> = {
  highest: "Highest resource",
  high: "High resource",
  moderate: "Moderate resource",
  low: "Low resource",
  high_segregation_poverty: "High segregation & poverty",
};

function Fact({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="tnum mt-1 text-[15px] font-semibold text-zinc-900">{value}</div>
      {hint && <div className="text-[11px] text-zinc-500">{hint}</div>}
    </div>
  );
}

export default function GeoPanel({ geo, pending }: { geo?: GeoContext; pending?: boolean }) {
  if (!geo) {
    return (
      <Card>
        <CardHeader title="Site & public data" icon={<MapPin size={16} />} />
        <div className="grid h-64 place-items-center text-sm text-zinc-400">
          {pending ? (
            <span className="flex items-center gap-2">
              <span className="live-dot" /> Geo agent is locating the site…
            </span>
          ) : (
            "No geo data."
          )}
        </div>
      </Card>
    );
  }

  const amenities = [...geo.amenities].sort((a, b) => a.distanceMiles - b.distanceMiles);
  const anyFallback = geo.sources.some((s) => !s.live);

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Site & public data"
        subtitle={geo.matchedAddress}
        icon={<MapPin size={16} />}
        right={
          <div className="flex flex-wrap justify-end gap-1.5">
            {geo.isQCT && <Pill tone="accent">QCT{geo.qctBasis === "estimated_from_acs" ? " (est.)" : ""}</Pill>}
            {geo.isDDA && <Pill tone="accent">DDA</Pill>}
            {(geo.isQCT || geo.isDDA) && <Pill tone="good">130% basis boost</Pill>}
            {geo.isRural && <Pill>Rural</Pill>}
          </div>
        }
      />
      <div className="grid lg:grid-cols-5">
        <div className="h-64 border-b border-zinc-100 lg:col-span-2 lg:h-auto lg:min-h-[300px] lg:border-b-0 lg:border-r">
          <MapContainer center={[geo.lat, geo.lng]} zoom={14} scrollWheelZoom={false} className="h-full w-full" style={{ minHeight: 256 }}>
            <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <Marker position={[geo.lat, geo.lng]} icon={pin}>
              <Tooltip>{geo.matchedAddress}</Tooltip>
            </Marker>
            {amenities
              .filter((a) => a.lat != null && a.lng != null)
              .map((a, i) => (
                <CircleMarker key={i} center={[a.lat!, a.lng!]} radius={5} pathOptions={{ color: "#fff", weight: 2, fillColor: "#2a78d6", fillOpacity: 1 }}>
                  <Tooltip>
                    {a.name} · {a.type} · {a.distanceMiles.toFixed(2)} mi
                  </Tooltip>
                </CircleMarker>
              ))}
          </MapContainer>
        </div>
        <div className="p-5 lg:col-span-3">
          <div className="mb-1 text-xs text-zinc-500">
            {geo.countyName} · {geo.tractName} · GEOID <span className="font-mono">{geo.geoid}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            <Fact label="Area median income" value={money(geo.areaMedianIncome)} hint="4-person, county" />
            <Fact label="Tract median HH income" value={money(geo.tractMedianHouseholdIncome)} hint={`${pct(geo.tractMedianHouseholdIncome / geo.areaMedianIncome)} of AMI`} />
            <Fact label="Poverty rate" value={pct(geo.povertyRate, 1)} hint={geo.povertyRate >= 0.25 ? "≥25% QCT threshold" : undefined} />
            <Fact label="Renter share" value={pct(geo.renterShare)} />
            <Fact label="Rent burdened" value={pct(geo.rentBurdenedShare)} hint="Renters paying ≥30%" />
            <Fact label="Unemployment" value={pct(geo.unemploymentRate, 1)} />
            <Fact label="Population" value={num(geo.population)} hint="Tract" />
            <Fact label="Opportunity area" value={<span className="text-sm">{OPP_LABEL[geo.opportunityArea]}</span>} />
          </div>

          <div className="mt-5">
            <div className="label mb-2">Nearest amenities</div>
            {amenities.length === 0 ? (
              <div className="text-xs text-zinc-400">None found.</div>
            ) : (
              <div className="grid gap-1.5 sm:grid-cols-2">
                {amenities.slice(0, 8).map((a, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg bg-zinc-50 px-2.5 py-1.5 text-xs">
                    <span className="text-zinc-400">{AMENITY_ICON[a.type]}</span>
                    <span className="min-w-0 flex-1 truncate">{a.name}</span>
                    <span className="tnum text-zinc-500">{a.distanceMiles.toFixed(2)} mi</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 border-t border-zinc-100 bg-zinc-50/50 px-5 py-3">
        <span className="label mr-1">Sources</span>
        {geo.sources.map((s, i) => (
          <a
            key={i}
            href={s.url}
            target="_blank"
            rel="noreferrer"
            title={`${s.live ? "Fetched live" : "Bundled / estimated fallback"} · ${new Date(s.retrievedAt).toLocaleString()}`}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ring-1 ring-inset ${
              s.live ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-amber-50 text-amber-800 ring-amber-200"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${s.live ? "bg-emerald-500" : "bg-amber-500"}`} />
            {s.name}
            <span className="opacity-70">{s.live ? "live" : "fallback"}</span>
          </a>
        ))}
        {anyFallback && <span className="text-[11px] text-zinc-500">· some data is estimated offline</span>}
      </div>
    </Card>
  );
}

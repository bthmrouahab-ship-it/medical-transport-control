import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { DOHA_CENTER, ORIGIN, type Hospital } from "@shared/hospitals";

export type VehicleLocation = {
  plate: string;
  lat: number;
  lng: number;
  accuracy?: number;
  speed?: number | null;
  driver?: string;
  sharing?: boolean;
  updatedAt: string;
};

export type ActiveTrip = { id: string; hospitalId: string; plate?: string; label: string };

/** حالة إشارة GPS حسب عمر آخر تحديث. */
export function locationFreshness(location: VehicleLocation, now = Date.now()) {
  const ageMinutes = (now - new Date(location.updatedAt).getTime()) / 60000;
  if (location.sharing && ageMinutes <= 2) return { state: "live" as const, label: "مباشر", color: "#1baf7a", ageMinutes };
  if (location.sharing && ageMinutes <= 15) return { state: "stale" as const, label: `منذ ${Math.round(ageMinutes)} د`, color: "#eda100", ageMinutes };
  return { state: "offline" as const, label: "غير متصل", color: "#8a8983", ageMinutes };
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export default function LiveMap({ hospitals, locations, trips = [], tripCounts, selectedHospitalId, onPick, onSelectHospital, height = 520 }: {
  hospitals: Hospital[];
  locations: VehicleLocation[];
  trips?: ActiveTrip[];
  /** عدد الرحلات التاريخية لكل مستشفى لتحديد حجم الدائرة */
  tripCounts?: Record<string, number>;
  selectedHospitalId?: string | null;
  /** عند التمرير: النقر على الخريطة يحدد موقعًا (لتصحيح موقع مستشفى) */
  onPick?: (point: { lat: number; lng: number }) => void;
  onSelectHospital?: (id: string) => void;
  height?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<{ hospitals: L.LayerGroup; vehicles: L.LayerGroup; trips: L.LayerGroup } | null>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const selectRef = useRef(onSelectHospital);
  selectRef.current = onSelectHospital;

  useEffect(() => {
    if (!container.current || map.current) return;
    const instance = L.map(container.current, { zoomControl: true, attributionControl: true }).setView([DOHA_CENTER.lat, DOHA_CENTER.lng], DOHA_CENTER.zoom);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(instance);
    L.circleMarker([ORIGIN.lat, ORIGIN.lng], { radius: 10, color: "#fcfcfb", weight: 2, fillColor: "#10233f", fillOpacity: 1 })
      .bindTooltip(ORIGIN.name, { permanent: true, direction: "top", offset: [0, -10], className: "map-label" })
      .addTo(instance);
    layers.current = { trips: L.layerGroup().addTo(instance), hospitals: L.layerGroup().addTo(instance), vehicles: L.layerGroup().addTo(instance) };
    instance.on("click", (event: L.LeafletMouseEvent) => pickRef.current?.({ lat: Number(event.latlng.lat.toFixed(6)), lng: Number(event.latlng.lng.toFixed(6)) }));
    map.current = instance;
    return () => {
      instance.remove();
      map.current = null;
      layers.current = null;
    };
  }, []);

  useEffect(() => {
    if (container.current) container.current.style.cursor = onPick ? "crosshair" : "";
  }, [onPick]);

  // المستشفيات: حجم الدائرة حسب عدد الرحلات السابقة
  useEffect(() => {
    const group = layers.current?.hospitals;
    if (!group) return;
    group.clearLayers();
    const max = Math.max(1, ...Object.values(tripCounts ?? {}));
    for (const hospital of hospitals) {
      const count = tripCounts?.[hospital.id] ?? 0;
      const selected = hospital.id === selectedHospitalId;
      const radius = 6 + Math.sqrt(count / max) * 16;
      L.circleMarker([hospital.lat, hospital.lng], {
        radius,
        color: selected ? "#e34948" : "#fcfcfb",
        weight: selected ? 3 : 2,
        fillColor: "#2a78d6",
        fillOpacity: hospital.verified ? 0.75 : 0.45,
        dashArray: hospital.verified ? undefined : "3 3",
      })
        .bindTooltip(
          `<b>${escapeHtml(hospital.name)}</b><br>${escapeHtml(hospital.zone)}${count ? `<br>${count} رحلة سابقة` : ""}${hospital.verified ? "" : "<br><i>الموقع تقريبي</i>"}`,
          { direction: "top" },
        )
        .on("click", (event) => {
          if (pickRef.current) return;
          L.DomEvent.stopPropagation(event);
          selectRef.current?.(hospital.id);
        })
        .addTo(group);
    }
  }, [hospitals, tripCounts, selectedHospitalId]);

  // خطوط الرحلات الجارية من المجمع إلى المستشفى
  useEffect(() => {
    const group = layers.current?.trips;
    if (!group) return;
    group.clearLayers();
    for (const trip of trips) {
      const hospital = hospitals.find((item) => item.id === trip.hospitalId);
      if (!hospital) continue;
      L.polyline([[ORIGIN.lat, ORIGIN.lng], [hospital.lat, hospital.lng]], { color: "#eb6834", weight: 2, dashArray: "6 6", opacity: 0.9 })
        .bindTooltip(escapeHtml(trip.label))
        .addTo(group);
    }
  }, [trips, hospitals]);

  // السيارات من GPS
  useEffect(() => {
    const group = layers.current?.vehicles;
    if (!group) return;
    group.clearLayers();
    for (const location of locations) {
      const fresh = locationFreshness(location);
      const icon = L.divIcon({
        className: "",
        html: `<div style="display:flex;align-items:center;gap:4px;transform:translate(-50%,-50%);white-space:nowrap"><span style="width:14px;height:14px;border-radius:50%;background:${fresh.color};border:2px solid #fcfcfb;box-shadow:0 0 0 1px #0b0b0b33"></span><span style="background:#fcfcfb;color:#0b0b0b;border-radius:6px;padding:1px 5px;font:600 11px system-ui;box-shadow:0 1px 3px #0003">${escapeHtml(location.plate)}</span></div>`,
      });
      L.marker([location.lat, location.lng], { icon, zIndexOffset: 1000 })
        .bindTooltip(`<b>${escapeHtml(location.plate)}</b> · ${escapeHtml(location.driver ?? "")}<br>${fresh.label}${location.speed ? ` · ${location.speed} كم/س` : ""}`, { direction: "top" })
        .addTo(group);
    }
  }, [locations]);

  return <div ref={container} dir="ltr" style={{ height }} className="isolate z-0 w-full overflow-hidden rounded-2xl border border-slate-200" role="application" aria-label="خريطة الدوحة: المستشفيات والسيارات" />;
}

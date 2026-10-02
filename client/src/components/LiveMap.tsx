import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { DOHA_CENTER, ORIGIN, QATAR_BOUNDS, type Hospital } from "@shared/hospitals";
import { MAP_COLORS, ageText, hiddenOnMap, locationFreshness, type MapTrip, type VehicleLocation } from "@/lib/vehicleLocation";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

/** الخريطة محصورة في قطر: لا يمكن تحريكها خارج هذه الحدود ولا الابتعاد أكثر من عرض قطر كاملة. */
const QATAR = L.latLngBounds([QATAR_BOUNDS.south, QATAR_BOUNDS.west], [QATAR_BOUNDS.north, QATAR_BOUNDS.east]);

export default function LiveMap({ hospitals, locations, trips = [], tripCounts, selectedHospitalId, onPick, onSelectHospital, focus, height = 520 }: {
  hospitals: Hospital[];
  locations: VehicleLocation[];
  trips?: MapTrip[];
  /** عدد الرحلات التاريخية لكل مستشفى لتحديد حجم الدائرة */
  tripCounts?: Record<string, number>;
  selectedHospitalId?: string | null;
  /** عند التمرير: النقر على الخريطة يحدد موقعًا (لتصحيح موقع مستشفى) */
  onPick?: (point: { lat: number; lng: number }) => void;
  onSelectHospital?: (id: string) => void;
  /** نقطة تنتقل إليها الخريطة (مثل سيارة اختيرت من القائمة) */
  focus?: { lat: number; lng: number; key: number } | null;
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
    const instance = L.map(container.current, {
      zoomControl: true,
      attributionControl: true,
      maxBounds: QATAR,
      maxBoundsViscosity: 1,
      minZoom: 7,
    }).setView([DOHA_CENTER.lat, DOHA_CENTER.lng], DOHA_CENTER.zoom);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      // لا تُحمَّل صور الخريطة بعيدًا عن قطر
      bounds: QATAR.pad(0.5),
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(instance);
    // أقل تكبير = قطر كاملة داخل الإطار (حسب حجم الخريطة على الشاشة)
    const fitMinZoom = () => instance.setMinZoom(instance.getBoundsZoom(QATAR));
    fitMinZoom();
    instance.on("resize", fitMinZoom);
    // اسم المجمع فوق دوائر المستشفيات وتحت بطاقات السيارات (حتى لا يغطي اسم السائق)
    const labels = instance.createPane("labels");
    labels.style.zIndex = "450";
    labels.style.pointerEvents = "none";
    L.circleMarker([ORIGIN.lat, ORIGIN.lng], { radius: 10, color: "#ffffff", weight: 3, fillColor: MAP_COLORS.origin, fillOpacity: 1 })
      .bindTooltip(ORIGIN.name, { permanent: true, direction: "top", offset: [0, -10], className: "map-label", pane: "labels" })
      .addTo(instance);
    layers.current = { trips: L.layerGroup().addTo(instance), hospitals: L.layerGroup().addTo(instance), vehicles: L.layerGroup().addTo(instance) };
    instance.on("click", (event: L.LeafletMouseEvent) => {
      if (!QATAR.contains(event.latlng)) return;
      pickRef.current?.({ lat: Number(event.latlng.lat.toFixed(6)), lng: Number(event.latlng.lng.toFixed(6)) });
    });
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

  useEffect(() => {
    if (focus) map.current?.flyTo([focus.lat, focus.lng], Math.max(map.current.getZoom(), 14), { duration: 0.6 });
  }, [focus]);

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
        color: selected ? "#da291c" : "#ffffff",
        weight: selected ? 3 : 2,
        fillColor: MAP_COLORS.hospital,
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

  // الرحلات الجارية: من موقع السيارة الآن (إن وصل من GPS) إلى نقطة الاستلام أو إلى الوجهة
  useEffect(() => {
    const group = layers.current?.trips;
    if (!group) return;
    group.clearLayers();
    const positions = new Map(locations
      .filter((location) => locationFreshness(location).state !== "offline")
      .map((location) => [location.plate, L.latLng(location.lat, location.lng)]));
    const drawn = new Set<string>();
    for (const trip of trips) {
      const car = trip.plate ? positions.get(trip.plate) : undefined;
      const from = trip.from && L.latLng(trip.from.lat, trip.from.lng);
      const to = trip.to && L.latLng(trip.to.lat, trip.to.lng);
      const line = trip.phase === "toDestination"
        ? (car ?? from) && to ? [car ?? from!, to] : null
        : car && from ? [car, from] : from && to ? [from, to] : null;
      if (!line) continue;
      const key = `${trip.plate}|${trip.phase}|${line.map((point) => point.toString()).join("|")}`;
      if (drawn.has(key)) continue;
      drawn.add(key);
      L.polyline(line, trip.phase === "toDestination"
        ? { color: MAP_COLORS.toDestination, weight: 3, opacity: 0.85 }
        : { color: MAP_COLORS.toPickup, weight: 3, opacity: 0.9, dashArray: "6 7" })
        .bindTooltip(escapeHtml(trip.label))
        .addTo(group);
    }
  }, [trips, locations]);

  // السيارات: بطاقة باسم السائق الذي يقودها فقط (بلا رقم اللوحة)، ولون النقطة حسب إشارة GPS. آخر موقع قديم
  // (يظهر بالبحث عنه فقط) يذكر منذ متى وصل.
  useEffect(() => {
    const group = layers.current?.vehicles;
    if (!group) return;
    group.clearLayers();
    for (const location of locations) {
      const fresh = locationFreshness(location);
      const name = location.driver?.trim() || "سائق";
      const old = hiddenOnMap(location) ? ageText(fresh.ageMinutes) : "";
      const gps = fresh.state === "offline" ? `غير متصل · آخر موقع ${ageText(fresh.ageMinutes)}` : fresh.label;
      const trip = trips.find((item) => item.plate === location.plate);
      const icon = L.divIcon({
        className: "vehicle-pin",
        iconSize: [0, 0],
        html: `<div class="vehicle-pin__body${fresh.state === "offline" ? " is-offline" : ""}" data-plate="${escapeHtml(location.plate)}">`
          + `<div class="vehicle-pin__label"><b>${escapeHtml(name)}</b>${old ? `<span>${old}</span>` : ""}</div>`
          + `<span class="vehicle-pin__dot" style="background:${fresh.color}"></span></div>`,
      });
      L.marker([location.lat, location.lng], { icon, zIndexOffset: fresh.state === "offline" ? 500 : 1000, keyboard: false })
        .bindTooltip(
          `<b>${escapeHtml(name)}</b> · <span dir="ltr">${escapeHtml(location.plate)}</span><br>GPS: ${gps}${location.speed ? ` · ${location.speed} كم/س` : ""}${trip ? `<br>${escapeHtml(trip.label)}` : ""}`,
          { direction: "top", offset: [0, -34] },
        )
        .addTo(group);
    }
  }, [locations, trips]);

  const viewButton = "h-8 rounded-lg px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100";
  return (
    <div className="relative isolate z-0 w-full" style={{ height }}>
      <div ref={container} dir="ltr" className="h-full w-full overflow-hidden rounded-2xl ring-1 ring-slate-200" role="application" aria-label="خريطة قطر: المستشفيات والسيارات" />
      <div className="absolute right-3 top-3 z-[800] flex gap-1 rounded-xl bg-white/95 p-1 shadow-card ring-1 ring-slate-200">
        <button type="button" onClick={() => map.current?.setView([DOHA_CENTER.lat, DOHA_CENTER.lng], DOHA_CENTER.zoom)} className={viewButton}>الدوحة</button>
        <button type="button" onClick={() => map.current?.fitBounds(QATAR)} className={viewButton}>قطر كاملة</button>
      </div>
    </div>
  );
}

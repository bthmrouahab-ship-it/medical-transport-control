import { useState } from "react";
import { toast } from "sonner";
import { BellRing, CheckCircle2, Plus, Clock3, Copy, Download, Link2, MapPin, MessageCircle, Phone, Send, Settings2, Sparkles, Truck, Users } from "lucide-react";
import {
  appointmentPickupLabel,
  assignVehicleForTrips,
  buildDriverMessage,
  buildTripGroups,
  findUnrequestedMatches,
  groupCapacity,
  isNonMedical,
  matchHospitalZone,
  suggestJoinDispatched,
  whatsappLink,
  type ClinicAppointment,
  type Vehicle,
  type VehicleRequest,
} from "@shared/transport";
import type { Hospital } from "@shared/hospitals";
import { DateChooser, InfoCard, PageHeading, SectionCard } from "@/components/ui-kit";
import NonMedicalTripForm from "./NonMedicalTripForm";
import { useHospitals, useNow } from "@/lib/useShared";

type Trip = { request: VehicleRequest; appointment: ClinicAppointment };

export function FleetSupervisorPage({ vehicles, appointments, requests, audit, date, onDateChange, onManager, onUpdate, onDispatch, onExport, onAddTrip }: {
  vehicles: Vehicle[];
  appointments: ClinicAppointment[];
  requests: VehicleRequest[];
  audit: string[];
  date: string;
  onDateChange: (date: string) => void;
  onManager: () => void;
  onUpdate: (vehicles: Vehicle[]) => void;
  onDispatch: (requestIds: string[], vehicle: Vehicle, joinRequestIds?: string[]) => void;
  onExport: () => void;
  onAddTrip: (appointment: ClinicAppointment, request: VehicleRequest) => void;
}) {
  const [addingTrip, setAddingTrip] = useState(false);
  const [selectedVehicles, setSelectedVehicles] = useState<Record<string, string>>({});
  const hospitals = useHospitals();
  const now = useNow();
  const withAppointment = (request: VehicleRequest): Trip | null => {
    const appointment = appointments.find((item) => item.id === request.appointmentId);
    return appointment ? { request, appointment } : null;
  };
  const onDate = (trip: Trip) => trip.appointment.appointmentDate === date;
  const pending = requests.filter((request) => request.status === "بانتظار التوزيع").map(withAppointment).filter((trip): trip is Trip => Boolean(trip) && onDate(trip!));
  const allOnTheWay = requests.filter((request) => request.status === "تم إرسال السيارة" || request.status === "وصلت السيارة").map(withAppointment).filter((trip): trip is Trip => Boolean(trip));
  // السيارة المشغولة برحلة جارية لا تُرسل مرة أخرى مهما كان تاريخ الرحلة
  const busyPlates = new Set(allOnTheWay.map((trip) => trip.request.vehiclePlate).filter(Boolean));
  const onTheWay = allOnTheWay.filter(onDate);
  const dispatchable = vehicles.filter((vehicle) => vehicle.available && !busyPlates.has(vehicle.plate));

  const groups = buildTripGroups(pending.map((trip) => ({ appointment: trip.appointment, direction: trip.request.direction })), hospitals);
  const groupedIds = new Set(groups.flatMap((group) => group.appointmentIds));
  const joins = suggestJoinDispatched(pending.filter((trip) => !groupedIds.has(trip.appointment.id)), onTheWay, hospitals);
  const unrequested = findUnrequestedMatches(appointments, requests, hospitals, now).filter((match) => match.appointment.appointmentDate === date);

  function dispatchSingle(trip: Trip) {
    const suggested = assignVehicleForTrips(dispatchable, [trip.appointment]);
    const plate = selectedVehicles[trip.request.id] || suggested?.plate;
    const vehicle = dispatchable.find((item) => item.plate === plate);
    if (!vehicle) {
      toast.error("اختر سيارة متاحة ومناسبة للرحلة");
      return;
    }
    onDispatch([trip.request.id], vehicle);
  }

  function dispatchGroup(appointmentIds: string[]) {
    const members = pending.filter((trip) => appointmentIds.includes(trip.appointment.id));
    const vehicle = assignVehicleForTrips(dispatchable, members.map((trip) => trip.appointment));
    if (!vehicle || members.length < 2) {
      toast.error("لا توجد سيارة مناسبة ومتاحة لجمع هذه الرحلات");
      return;
    }
    onDispatch(members.map((trip) => trip.request.id), vehicle);
  }

  function joinTrip(requestId: string, plate: string, groupId?: string) {
    const vehicle = vehicles.find((item) => item.plate === plate);
    if (!vehicle) return;
    const partners = onTheWay.filter((trip) => trip.request.vehiclePlate === plate && (groupId ? trip.request.groupId === groupId : !trip.request.groupId)).map((trip) => trip.request.id);
    onDispatch([requestId], vehicle, partners);
  }

  // الرحلات المرسلة مجمّعة حسب الرحلة الواحدة (groupId أو الطلب نفسه)
  const sentTrips = Array.from(onTheWay.reduce((map, trip) => {
    const key = trip.request.groupId ?? trip.request.id;
    map.set(key, [...(map.get(key) ?? []), trip]);
    return map;
  }, new Map<string, Trip[]>()).values());

  return (
    <>
      <PageHeading
        title="توزيع السيارات"
        action={(
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setAddingTrip(true)} className="flex min-h-11 items-center gap-2 rounded-xl bg-[#a61d2d] px-4 text-sm font-bold text-white hover:bg-[#8b1725]"><Plus className="h-4 w-4" /> رحلة غير طبية</button>
            <button onClick={onExport} className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-600"><Download className="h-4 w-4 text-[#a61d2d]" /> Excel</button>
            <button onClick={onManager} className="flex min-h-11 items-center gap-2 rounded-xl bg-[#10233f] px-4 text-sm font-bold text-white"><MapPin className="h-4 w-4" /> الخريطة والإحصائيات</button>
          </div>
        )}
      />

      <div className="mb-5"><DateChooser value={date} onChange={onDateChange} /></div>

      {addingTrip && <NonMedicalTripForm defaultDate={date} onCancel={() => setAddingTrip(false)} onSave={(appointment, request) => { onAddTrip(appointment, request); setAddingTrip(false); }} />}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <InfoCard icon={BellRing} label="بانتظار التوزيع" value={String(pending.length)} tone="amber" />
        <InfoCard icon={CheckCircle2} label="سيارات جاهزة" value={String(dispatchable.length)} tone="blue" />
        <InfoCard icon={Settings2} label="خارج الخدمة" value={String(vehicles.filter((vehicle) => !vehicle.available).length)} tone="teal" />
      </div>

      <div className="space-y-6">
        {(groups.length > 0 || joins.length > 0) && (
          <SectionCard tone="blue" title={<><Sparkles className="h-5 w-5 text-blue-700" /> جمع الرحلات</>} badge={<span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-800">{groups.length + joins.length}</span>}>
            <div className="grid gap-4 p-5 lg:grid-cols-2">
              {groups.map((group) => {
                const members = pending.filter((trip) => group.appointmentIds.includes(trip.appointment.id));
                const vehicle = assignVehicleForTrips(dispatchable, members.map((trip) => trip.appointment));
                return (
                  <div key={group.appointmentIds.join("-")} className="rounded-2xl border border-blue-100 bg-[#f8fbff] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-xs font-bold text-blue-800">{group.direction} · {group.reason}</p>
                      <span className="shrink-0 rounded-full bg-blue-100 px-2.5 py-1 text-xs font-bold text-blue-700">{members.length} رحلات</span>
                    </div>
                    <TripList trips={members} hospitals={hospitals} />
                    <p className="mt-3 text-xs text-slate-500">السيارة المقترحة: <b className="text-slate-700">{vehicle ? `${vehicle.plate} · ${vehicle.driver}` : "لا توجد سيارة متاحة"}</b></p>
                    <button disabled={!vehicle} onClick={() => dispatchGroup(group.appointmentIds)} className="mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-blue-700 text-xs font-bold text-white hover:bg-blue-800 disabled:opacity-40"><Send className="h-4 w-4" /> جمع {members.length} رحلات وإرسال السيارة</button>
                  </div>
                );
              })}
              {joins.map((join) => {
                const trip = pending.find((item) => item.request.id === join.requestId)!;
                return (
                  <div key={join.requestId} className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4">
                    <p className="text-xs font-bold text-emerald-800">{join.reason}</p>
                    <TripList trips={[trip]} hospitals={hospitals} />
                    <button onClick={() => joinTrip(join.requestId, join.plate, join.groupId)} className="mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 text-xs font-bold text-white hover:bg-emerald-800"><Link2 className="h-4 w-4" /> ضم إلى السيارة {join.plate}</button>
                  </div>
                );
              })}
            </div>
          </SectionCard>
        )}

        <SectionCard tone="amber" title={<><BellRing className="h-5 w-5 text-amber-700" /> طلبات جديدة</>} badge={<span className="rounded-full bg-amber-200 px-3 py-1 text-xs font-bold text-amber-900">{pending.length}</span>}>
          <div className="divide-y divide-slate-100">
            {pending.length ? pending.map((trip) => {
              const suggested = assignVehicleForTrips(dispatchable, [trip.appointment]);
              const selectedPlate = selectedVehicles[trip.request.id] || suggested?.plate || "none";
              // الرحلة العادية تقبل أي سيارة (سيدان وباص أولًا)، واحتياجات خاصة تحتاج سيارة مجهزة
              const compatible = trip.appointment.kind === "احتياجات خاصة"
                ? dispatchable.filter((vehicle) => vehicle.kind === "احتياجات خاصة")
                : [...dispatchable].sort((a, b) => Number(a.kind === "احتياجات خاصة") - Number(b.kind === "احتياجات خاصة"));
              const zone = matchHospitalZone(trip.appointment, hospitals);
              return (
                <div key={trip.request.id} className="grid gap-4 p-5 lg:grid-cols-[1.4fr_.8fr_auto] lg:items-center">
                  <div>
                    <div className="flex flex-wrap items-center gap-2"><p className="font-bold">{trip.appointment.patientName}</p><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">{trip.request.direction}</span>{isNonMedical(trip.appointment) && <span className="rounded-full bg-violet-50 px-2 py-1 text-[10px] font-bold text-violet-700">غير طبية</span>}{groupedIds.has(trip.appointment.id) && <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700">قابلة للجمع</span>}</div>
                    <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500"><Clock3 className="h-4 w-4" />{trip.appointment.appointmentAt}<MapPin className="h-4 w-4" />{appointmentPickupLabel(trip.appointment)} ← {trip.appointment.clinic}{zone && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">{zone}</span>}</p>
                    <p className="mt-1 text-[11px] text-slate-400">{trip.appointment.kind}{trip.appointment.assistance.length ? ` · ${trip.appointment.assistance.join("، ")}` : ""}</p>
                  </div>
                  <select aria-label="السيارة" value={selectedPlate} onChange={(event) => setSelectedVehicles((current) => ({ ...current, [trip.request.id]: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold outline-none focus:border-[#d88994]">
                    {!compatible.length && <option value="none">لا توجد سيارة مناسبة</option>}
                    {compatible.map((vehicle) => <option key={vehicle.plate} value={vehicle.plate}>{vehicle.plate} · {vehicle.driver} · {vehicle.kind}</option>)}
                  </select>
                  <button disabled={!compatible.length} onClick={() => dispatchSingle(trip)} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#a61d2d] px-4 text-sm font-bold text-white hover:bg-[#8b1725] disabled:cursor-not-allowed disabled:opacity-40"><Send className="h-4 w-4" /> إرسال</button>
                </div>
              );
            }) : <p className="p-8 text-center text-sm font-bold text-slate-400">لا توجد طلبات جديدة</p>}
          </div>
        </SectionCard>

        {unrequested.length > 0 && (
          <SectionCard tone="red" title={<><Users className="h-5 w-5 text-red-700" /> لنفس الوجهة ولم يُطلب لها سيارة</>} badge={<span className="rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-800">{unrequested.length}</span>}>
            <ul className="divide-y divide-red-50">
              {unrequested.map((match) => (
                <li key={match.appointment.id} className="p-4 text-sm">
                  <p className="font-bold">{match.appointment.patientName} <span className="font-semibold text-slate-500">· {appointmentPickupLabel(match.appointment)} · {match.appointment.appointmentAt} · {match.appointment.clinic}</span></p>
                  <p className="mt-1 text-xs text-slate-600">{match.sameDestination ? "نفس وجهة" : "وجهة مجاورة لـ"} {match.matchedAppointment.patientName} ({match.matchedRequest.status}{match.matchedRequest.vehiclePlate ? ` · ${match.matchedRequest.vehiclePlate}` : ""}) · فارق {match.gapMinutes} د</p>
                </li>
              ))}
            </ul>
          </SectionCard>
        )}

        <SectionCard title={<><Truck className="h-5 w-5 text-[#a61d2d]" /> رحلات جارية</>} badge={<span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{sentTrips.length}</span>}>
          <div className="divide-y divide-slate-100">
            {sentTrips.length ? sentTrips.map((trips) => <SentTrip key={trips[0].request.groupId ?? trips[0].request.id} trips={trips} vehicles={vehicles} hospitals={hospitals} />) : <p className="p-6 text-center text-sm font-bold text-slate-400">لا توجد رحلات جارية</p>}
          </div>
        </SectionCard>

        <SectionCard title="السيارات" badge={<span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{vehicles.filter((vehicle) => vehicle.available).length} / {vehicles.length}</span>}>
          <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {vehicles.map((vehicle) => (
              <div key={vehicle.plate} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${vehicle.available ? "border-slate-200" : "border-slate-100 bg-slate-50"}`}>
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${!vehicle.available ? "bg-slate-300" : busyPlates.has(vehicle.plate) ? "bg-[#eb6834]" : "bg-[#1baf7a]"}`} title={!vehicle.available ? "خارج الخدمة" : busyPlates.has(vehicle.plate) ? "في رحلة" : "متاحة"} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold"><span dir="ltr">{vehicle.plate}</span> · {vehicle.driver}</p>
                  <p className="truncate text-[11px] text-slate-400">{vehicle.kind} · <span dir="ltr">{vehicle.phone}</span>{busyPlates.has(vehicle.plate) ? " · في رحلة" : !vehicle.available ? " · خارج الخدمة" : ""}</p>
                </div>
                <button onClick={() => onUpdate(vehicles.map((item) => item.plate === vehicle.plate ? { ...item, available: !item.available } : item))} className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-bold ${vehicle.available ? "border border-slate-200 text-slate-500 hover:bg-slate-50" : "bg-[#a61d2d] text-white"}`}>{vehicle.available ? "إيقاف" : "إتاحة"}</button>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="سجل العمليات">
          <div className="max-h-56 divide-y divide-slate-100 overflow-auto">
            {audit.length ? audit.map((item, index) => <p key={`${item}-${index}`} className="px-5 py-3 text-xs text-slate-500">{item}</p>) : <p className="p-5 text-xs text-slate-400">—</p>}
          </div>
        </SectionCard>
      </div>
    </>
  );
}

function TripList({ trips, hospitals }: { trips: Trip[]; hospitals: Hospital[] }) {
  return (
    <ul className="mt-3 space-y-2">
      {trips.map((trip) => (
        <li key={trip.request.id} className="rounded-xl bg-white px-3 py-2 text-xs ring-1 ring-slate-100">
          <p className="font-bold text-slate-800">{trip.appointment.patientName} <span className="font-semibold text-slate-400" dir="ltr">{trip.appointment.appointmentAt}</span></p>
          <p className="mt-0.5 text-slate-500">{appointmentPickupLabel(trip.appointment)} ← {trip.appointment.clinic}{matchHospitalZone(trip.appointment, hospitals) ? ` · ${matchHospitalZone(trip.appointment, hospitals)}` : ""}</p>
        </li>
      ))}
    </ul>
  );
}

function SentTrip({ trips, vehicles, hospitals }: { trips: Trip[]; vehicles: Vehicle[]; hospitals: Hospital[] }) {
  const plate = trips[0].request.vehiclePlate ?? "";
  const vehicle = vehicles.find((item) => item.plate === plate);
  const message = buildDriverMessage(trips, { plate, driver: trips[0].request.driver ?? vehicle?.driver ?? "" }, hospitals);
  const phone = vehicle?.phone;
  const seatsLeft = Math.min(...trips.map((trip) => groupCapacity(trip.appointment.kind))) - trips.length;
  return (
    <div className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center">
      <div className="flex-1">
        <p className="font-bold"><span dir="ltr">{plate}</span> · {trips[0].request.driver ?? vehicle?.driver}{trips.length > 1 && <span className="mr-2 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">{trips.length} مرضى</span>}{seatsLeft > 0 && <span className="mr-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">{seatsLeft} مقعد متاح</span>}</p>
        <p className="mt-1 text-xs text-slate-500">{trips.map((trip) => `${trip.appointment.patientName} (${trip.appointment.appointmentAt}) ← ${trip.appointment.clinic}`).join(" · ")}</p>
        <p className="mt-1 text-[11px] font-bold text-violet-700">{Array.from(new Set(trips.map((trip) => trip.request.status))).join(" / ")}{trips[0].request.notificationSentAt ? ` · ${trips[0].request.notificationSentAt}` : ""}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {phone && <a href={whatsappLink(phone, message)} target="_blank" rel="noreferrer" className="flex min-h-10 items-center gap-1.5 rounded-xl bg-[#1faa53] px-3 text-xs font-bold text-white hover:bg-[#178f45]"><MessageCircle className="h-4 w-4" /> واتساب</a>}
        {phone && <a href={`tel:${phone}`} className="flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-600 hover:bg-slate-50"><Phone className="h-4 w-4" /> اتصال</a>}
        <button onClick={() => navigator.clipboard?.writeText(message).then(() => toast.success("تم نسخ الرسالة"), () => toast.error("تعذر النسخ"))} className="flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-600 hover:bg-slate-50"><Copy className="h-4 w-4" /> نسخ</button>
      </div>
    </div>
  );
}

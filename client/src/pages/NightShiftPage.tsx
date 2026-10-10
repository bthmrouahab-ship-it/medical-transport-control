import { useState, type ReactNode } from "react";
import { AlertTriangle, ArrowLeftRight, CarFront, CheckCircle2, Clock3, Flag, Hospital as HospitalIcon, MapPin, Moon, Phone, RotateCcw, Send, Siren, Stethoscope, Sun, Truck, UserCog, XCircle } from "lucide-react";
import { COMPLEX_CLINIC, ORIGIN, type Hospital } from "@shared/hospitals";
import {
  appointmentDateTime,
  busRoleOf,
  hasDriver,
  isPriority,
  isTransfer,
  localDateString,
  regularForSpecialWarning,
  requestPersons,
  reservedSoonWarning,
  statusText,
  vehicleRestriction,
  whatsappNumber,
  type ClinicAppointment,
  type UrgentOutcome,
  type Vehicle,
  type VehicleRequest,
} from "@shared/transport";
import { minutesSince, tripPhase, vehicleAvailability, vehicleLocationState, type TripPhase } from "@shared/trips";
import {
  NIGHT_SHIFT_TEXT,
  hospitalTripOf,
  isNightShift,
  isOpenCase,
  isUrgent,
  nightShiftStart,
  shiftCases,
  urgentOutcomeText,
} from "@shared/urgent";
import DriverAssignment from "@/components/DriverAssignment";
import GuestContact from "@/components/GuestContact";
import { UrgentBadge, UrgentOutcomeActions } from "@/components/Urgent";
import { KindIcon, KindLabel, VehiclePicker, type VehicleOption } from "@/components/VehiclePicker";
import { Badge, EmptyState, Panel, PageHeader, StatusBar, TimeBlock, btn, cx, formatDay, longDate, timeLabel } from "@/components/ui-kit";
import { useDrivers, useHospitals, useLiveVehicles, useNow, useSchedules } from "@/lib/useShared";

type Trip = { request: VehicleRequest; appointment: ClinicAppointment; from: ClinicAppointment | null; persons: number };

/**
 * صفحة شفت الليل لمشرف السيارات بالنيابة (من 10 مساءً إلى 6 صباحًا، لا يوجد مشرف سيارات): الحالات المستعجلة التي يطلبها
 * مشرفو المباني من المبنى إلى عيادة المجمع، وإرسال السائق لها بنفس نظام النهار (اختيار السيارة ورسالة واتساب وإشعار التطبيق)،
 * ومتابعة الرحلة حتى العيادة، ونتيجتها هناك (عاد إلى المبنى، أو ذهب بسيارة الإسعاف، أو إلى المستشفى بسيارة المجمع ثم العودة
 * منه). ومعها أي طلب آخر ينتظر سيارة الليلة، والسيارات وسائقوها (يغيّر السائق في سيارته لشفت الليل).
 */
export function NightShiftPage({ vehicles, appointments, requests, onDispatch, onArrived, onEndTrip, onUrgentOutcome, onReturn, onAssignDrivers }: {
  vehicles: Vehicle[];
  appointments: ClinicAppointment[];
  requests: VehicleRequest[];
  onDispatch: (requestIds: string[], vehicle: Vehicle) => void;
  onArrived: (requestIds: string[], source: "manual" | "estimate") => void;
  onEndTrip: (requestIds: string[]) => void;
  onUrgentOutcome: (appointment: ClinicAppointment, outcome: UrgentOutcome, hospital?: Hospital) => void;
  /** طلب عودة ضيف الحالة المستعجلة من المستشفى إلى المجمع */
  onReturn: (appointment: ClinicAppointment) => void;
  onAssignDrivers: (next: Vehicle[]) => void;
}) {
  const now = useNow(15000);
  const hospitals = useHospitals();
  const schedules = useSchedules();
  const drivers = useDrivers();
  const liveGps = useLiveVehicles(now);
  const [assigning, setAssigning] = useState(false);
  const night = isNightShift(now);
  const shiftStart = nightShiftStart(now);
  const today = localDateString(now);
  const yesterday = localDateString(new Date(now.getTime() - 86400000));
  const gpsLive = (plate?: string) => Boolean(plate && liveGps.has(plate));
  const driverOf = (plate?: string, fallback?: string) => (plate && liveGps.get(plate)?.driver) || fallback || vehicles.find((vehicle) => vehicle.plate === plate)?.driver || "";
  const phoneOf = (plate?: string) => vehicles.find((vehicle) => vehicle.plate === plate)?.phone ?? "";
  const phaseOf = (request: VehicleRequest) => tripPhase(request, now, gpsLive(request.vehiclePlate));
  const rules = { now, hospitals, schedules };

  const tripOf = (request: VehicleRequest): Trip | null => {
    const appointment = appointments.find((item) => item.id === request.appointmentId);
    if (!appointment) return null;
    const from = request.fromAppointmentId ? appointments.find((item) => item.id === request.fromAppointmentId) ?? null : null;
    return { request, appointment, from, persons: requestPersons(request, appointment, requests) };
  };
  const isTrip = (trip: Trip | null): trip is Trip => Boolean(trip);
  const byNeed = (a: Trip, b: Trip) => Number(isPriority(b.appointment)) - Number(isPriority(a.appointment))
    || appointmentDateTime(a.appointment).getTime() - appointmentDateTime(b.appointment).getTime();

  // الطلبات تظهر في وقت شفت الليل فقط (من 10 مساءً إلى 6 صباحًا)؛ في النهار يتابعها مشرف السيارات
  // ينتظر سيارة: الحالات المستعجلة ورحلاتها أولًا، ثم أي طلب آخر لليوم أو أمس (الشفت يمتد بعد منتصف الليل)
  const pending = !night ? [] : requests
    .filter((request) => request.status === "بانتظار التوزيع")
    .map(tripOf)
    .filter(isTrip)
    .filter((trip) => isUrgent(trip.appointment) || trip.appointment.appointmentDate === today || trip.appointment.appointmentDate === yesterday)
    .sort(byNeed);
  // الرحلات الجارية الآن (إلى الاستلام أو إلى الوجهة)
  const active = !night ? [] : requests
    .filter((request) => ["toPickup", "toDestination"].includes(phaseOf(request).kind))
    .map(tripOf)
    .filter(isTrip)
    .sort(byNeed);

  const availability = new Map(vehicles.map((vehicle) => [vehicle.plate, vehicleAvailability(vehicle.plate, requests, now, gpsLive(vehicle.plate))]));
  const forClinic = (vehicle: Vehicle) => busRoleOf(vehicle) === "clinic";
  const inShift = vehicles.filter((vehicle) => vehicle.available && hasDriver(vehicle) && !forClinic(vehicle));
  const free = inShift.filter((vehicle) => !availability.get(vehicle.plate)?.busy);
  const placeText = (plate: string) => {
    const gps = liveGps.get(plate);
    const place = vehicleLocationState(plate, requests, appointments, hospitals, now, gps ? { lat: gps.lat, lng: gps.lng } : null);
    return place.kind === "trip" ? "في رحلة" : place.kind === "outside" ? `خارج المجمع${place.from ? ` (${place.from})` : ""}` : `داخل ${ORIGIN.name}`;
  };
  /** السيارات لرحلة: المتاحة لها أولًا (المجهزة آخرًا للرحلة العادية)، ثم غير المتاحة مع السبب */
  const optionsFor = (trip: Trip): VehicleOption[] => vehicles
    .filter((vehicle) => vehicle.available && !forClinic(vehicle))
    .map((vehicle) => {
      const until = availability.get(vehicle.plate)?.until;
      const why = availability.get(vehicle.plate)?.busy
        ? `مشغولة${until ? ` حتى ${timeLabel(until)}` : ""}`
        : vehicleRestriction(vehicle, { appointments: [trip.appointment], transfer: isTransfer(trip.request), persons: trip.persons }, { ...rules, regularForSpecial: true });
      const warning = why ? null : regularForSpecialWarning(vehicle, [trip.appointment]) ?? reservedSoonWarning(vehicle, now, schedules);
      return { vehicle, why, warning };
    })
    .sort((a, b) => Number(Boolean(a.why)) - Number(Boolean(b.why)) || Number(Boolean(a.warning)) - Number(Boolean(b.warning))
      || (trip.appointment.kind === "احتياجات خاصة" ? 0 : Number(a.vehicle.kind === "احتياجات خاصة") - Number(b.vehicle.kind === "احتياجات خاصة")));

  // الحالات المستعجلة في الشفت، وما ينتظر نتيجته في العيادة أو في المستشفى
  const cases = shiftCases(appointments, now);
  const latestOf = (appointment: ClinicAppointment) => requests.filter((request) => request.appointmentId === appointment.id && !request.nurseOnly).at(-1);
  const hospitalTrip = (clinicCase: ClinicAppointment) => {
    const trip = hospitalTripOf(clinicCase, appointments);
    return trip && trip.status !== "ملغي" ? trip : undefined;
  };
  // في العيادة: استُلم الضيف ولم تُسجَّل نتيجته (أو أُلغيت رحلة المستشفى بعد تسجيلها)
  const atClinic = cases.filter((clinicCase) => clinicCase.status === "تم استلام المريض" && !hospitalTrip(clinicCase));
  // في المستشفى: وصلت رحلة المستشفى ولم تُطلب العودة
  const atHospital = appointments.filter((appointment) => isUrgent(appointment) && appointment.urgentFrom && appointment.status === "تم استلام المريض"
    && latestOf(appointment)?.direction === "ذهاب" && phaseOf(latestOf(appointment)!).kind === "arrived");
  const openCases = cases.filter((clinicCase) => isOpenCase(clinicCase) || (hospitalTrip(clinicCase) && isOpenCase(hospitalTrip(clinicCase)!)));
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <>
      <PageHeader
        title="شفت الليل"
        subtitle={`${longDate(today)} · مشرف السيارات بالنيابة · الحالات المستعجلة ${NIGHT_SHIFT_TEXT}`}
        actions={(
          <>
            {night
              ? <Badge tone="violet" icon={Moon}>الشفت جارٍ · بدأ <span dir="ltr" className="tabular">{timeLabel(shiftStart)}</span></Badge>
              : <Badge tone="amber" icon={Sun}>خارج وقت شفت الليل</Badge>}
            <button type="button" onClick={() => setAssigning(true)} className={btn(inShift.length < vehicles.filter((vehicle) => vehicle.available && !forClinic(vehicle)).length ? "danger" : "secondary")}>
              <UserCog className="h-4 w-4" /> السائقون
            </button>
          </>
        )}
      />

      <div className="mb-6">
        <StatusBar
          label="حالة شفت الليل"
          items={[
            { key: "pending", label: "بانتظار سيارة", value: pending.length, tone: "red", hint: `${pending.filter((trip) => isUrgent(trip.appointment)).length} حالة مستعجلة`, onClick: () => jump("night-pending") },
            { key: "active", label: "رحلات جارية", value: active.length, tone: "blue", hint: "حتى الوصول إلى الوجهة", onClick: () => jump("night-active") },
            { key: "cases", label: "حالات مفتوحة", value: openCases.length, tone: "amber", hint: `${atClinic.length} في العيادة · ${atHospital.length} في المستشفى`, onClick: () => jump("night-cases") },
            { key: "cars", label: "سيارات متاحة", value: free.length, tone: "green", hint: `${inShift.length} سيارة لها سائق`, onClick: () => jump("night-cars") },
          ]}
        />
      </div>

      <div className="space-y-6">
        <Panel id="night-pending" tone="amber" icon={Send} title="بانتظار إرسال سيارة" count={pending.length} description="اختر السيارة ثم «إرسال»: تصل الرحلة إلى تطبيق السائق بإشعار، ومعها رسالة واتساب للسائق">
          {pending.length ? (
            <div className="divide-y divide-slate-100">
              {pending.map((trip) => (
                <PendingRow key={trip.request.id} trip={trip} now={now} options={optionsFor(trip)} driverOf={(vehicle) => driverOf(vehicle.plate, vehicle.driver)} placeText={placeText} onDispatch={onDispatch} />
              ))}
            </div>
          ) : night
            ? <EmptyState icon={CheckCircle2} title="لا توجد طلبات بانتظار سيارة" hint="يظهر هنا طلب مشرف المبنى للحالة المستعجلة فور تسجيله" />
            : <EmptyState icon={Moon} title="تظهر الطلبات بعد 10 مساءً" hint={`طلبات السيارات تظهر في هذه الصفحة ${NIGHT_SHIFT_TEXT} فقط، وفي النهار يتابعها مشرف السيارات`} />}
        </Panel>

        <Panel id="night-active" tone="blue" icon={Truck} title="رحلات جارية" count={active.length} description="من إرسال السيارة حتى وصولها إلى الوجهة (بالـ GPS أو بتأكيدك أو بانتهاء الوقت المتوقع)">
          {active.length ? (
            <div className="divide-y divide-slate-100">
              {active.map((trip) => (
                <ActiveRow key={trip.request.id} trip={trip} phase={phaseOf(trip.request)} now={now} driver={driverOf(trip.request.vehiclePlate, trip.request.driver)} phone={phoneOf(trip.request.vehiclePlate)} onArrived={onArrived} onEndTrip={onEndTrip} />
              ))}
            </div>
          ) : <EmptyState icon={Truck} title="لا توجد رحلات جارية" hint={night ? undefined : `تظهر الرحلات ${NIGHT_SHIFT_TEXT} فقط`} />}
        </Panel>

        <Panel id="night-cases" tone="red" icon={Siren} title="الحالات المستعجلة" count={cases.length} description={`منذ بداية الشفت ${timeLabel(shiftStart)}، ومعها أي حالة ما زالت مفتوحة · النتيجة في العيادة يسجّلها مشرف المبنى أو أنت`}>
          {cases.length ? (
            <div className="divide-y divide-slate-100">
              {cases.map((clinicCase) => (
                <CaseRow
                  key={clinicCase.id}
                  clinicCase={clinicCase}
                  request={latestOf(clinicCase)}
                  hospitalCase={hospitalTrip(clinicCase)}
                  hospitalRequest={hospitalTrip(clinicCase) ? latestOf(hospitalTrip(clinicCase)!) : undefined}
                  awaitingOutcome={atClinic.includes(clinicCase)}
                  atHospital={atHospital.some((item) => item.urgentFrom === clinicCase.id)}
                  now={now}
                  phaseOf={phaseOf}
                  hospitals={hospitals}
                  onUrgentOutcome={onUrgentOutcome}
                  onReturn={onReturn}
                />
              ))}
            </div>
          ) : <EmptyState icon={Siren} title="لا توجد حالات مستعجلة في هذا الشفت" />}
        </Panel>

        <Panel id="night-cars" tone="green" icon={CarFront} title="السيارات" count={inShift.length} description="السيارات المتاحة للخدمة ولها سائق · غيّر السائق في كل سيارة من «السائقون» عند بداية شفت الليل">
          {inShift.length ? (
            <ul className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
              {inShift.map((vehicle) => {
                const busy = availability.get(vehicle.plate)?.busy;
                return (
                  <li key={vehicle.plate} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-inset ring-slate-200">
                    <KindIcon vehicle={vehicle} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-ink"><span dir="ltr" className="tabular">{vehicle.plate}</span> · {driverOf(vehicle.plate, vehicle.driver)}</span>
                      <span className="block text-xs text-slate-500"><KindLabel vehicle={vehicle} /> · {placeText(vehicle.plate)}</span>
                    </span>
                    {busy ? <Badge tone="blue">في رحلة</Badge> : <Badge tone="green">متاحة</Badge>}
                  </li>
                );
              })}
            </ul>
          ) : <EmptyState icon={CarFront} title="لا توجد سيارة لها سائق" hint="اختر السائقين في السيارات من زر «السائقون»" />}
        </Panel>
      </div>

      {assigning && (
        <DriverAssignment
          vehicles={vehicles}
          drivers={drivers}
          busy={(plate) => Boolean(availability.get(plate)?.busy)}
          onSave={(next) => { onAssignDrivers(next); setAssigning(false); }}
          onClose={() => setAssigning(false)}
        />
      )}
    </>
  );
}

/** من أين إلى أين: من المبنى إلى الوجهة، أو من المستشفى إلى المجمع، أو من عيادة المجمع إلى المستشفى */
function routeText({ request, appointment, from }: Trip) {
  const home = `مبنى ${appointment.buildingNumber}، شقة ${appointment.apartmentNumber}`;
  if (from) return `${from.clinic} ← ${appointment.clinic}`;
  return request.direction === "عودة" ? `${appointment.clinic} ← ${home}` : `${home} ← ${appointment.clinic}`;
}

function TripSummary({ trip, status }: { trip: Trip; status?: ReactNode }) {
  const { request, appointment, from } = trip;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-4">
      <TimeBlock time={request.createdAt || appointment.appointmentAt} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold text-ink">{appointment.patientName}</span>
          {appointment.urgent && <UrgentBadge />}
          {from ? <Badge tone="cyan" icon={ArrowLeftRight}>{appointment.urgent ? "إلى المستشفى" : "نقل بين موعدين"}</Badge> : <Badge tone={request.direction === "عودة" ? "amber" : "neutral"}>{request.direction}</Badge>}
          {appointment.kind === "احتياجات خاصة" && <Badge tone="violet">احتياجات خاصة</Badge>}
          {trip.persons > 1 && <span className="text-xs text-slate-500">{trip.persons} أشخاص</span>}
        </p>
        <p className="mt-1 flex items-start gap-1.5 text-sm text-slate-600">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span className="min-w-0">{routeText(trip)}</span>
        </p>
        {status && <div className="mt-2 flex flex-wrap items-center gap-1.5">{status}</div>}
      </div>
    </div>
  );
}

function PendingRow({ trip, now, options, driverOf, placeText, onDispatch }: {
  trip: Trip;
  now: Date;
  options: VehicleOption[];
  driverOf: (vehicle: Vehicle) => string;
  placeText: (plate: string) => string;
  onDispatch: (requestIds: string[], vehicle: Vehicle) => void;
}) {
  const first = options.find((option) => !option.why && !option.warning) ?? options.find((option) => !option.why);
  const [plate, setPlate] = useState(first?.vehicle.plate ?? "");
  const chosen = options.find((option) => option.vehicle.plate === plate && !option.why);
  const waiting = minutesSince(trip.request.createdAt, now);
  function send() {
    if (!chosen) return;
    if (chosen.warning && !window.confirm(`${chosen.warning}\nإرسال السيارة ${chosen.vehicle.plate} رغم ذلك؟`)) return;
    onDispatch([trip.request.id], chosen.vehicle);
  }
  return (
    <div className={cx("flex flex-col gap-3 p-4 sm:px-5 lg:flex-row lg:items-center", trip.appointment.urgent && "bg-red-50/40")}>
      <TripSummary
        trip={trip}
        status={<>
          <Badge tone={waiting !== null && waiting >= 10 ? "red" : "amber"} icon={Clock3}>طُلبت <span dir="ltr" className="tabular">{trip.request.createdAt}</span>{waiting !== null ? ` · منذ ${waiting} د` : ""}</Badge>
          {trip.request.requestedByName && <span className="text-xs text-slate-500">طلبه {trip.request.requestedByName}</span>}
          {trip.appointment.appointmentDate !== localDateString(now) && <span className="text-xs text-slate-500">{formatDay(trip.appointment.appointmentDate, now)}</span>}
        </>}
      />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end lg:w-[420px]">
        <div className="min-w-0 flex-1">
          <VehiclePicker
            label={`سيارة ${trip.appointment.patientName}`}
            options={options}
            value={chosen?.vehicle.plate ?? ""}
            onChange={setPlate}
            placeholder={options.some((option) => !option.why) ? "اختر السيارة" : "لا توجد سيارة متاحة الآن"}
            driverOf={driverOf}
            details={(vehicle) => placeText(vehicle.plate)}
          />
        </div>
        <button type="button" onClick={send} disabled={!chosen} className={btn(trip.appointment.urgent ? "primary" : "dark")}>
          <Send className="h-4 w-4" /> إرسال
        </button>
      </div>
    </div>
  );
}

function DriverLinks({ phone }: { phone: string }) {
  if (!phone) return null;
  return (
    <>
      <a href={`tel:${phone}`} className={btn("secondary", "sm")}><Phone className="h-3.5 w-3.5" /> اتصال بالسائق</a>
      <a href={`https://wa.me/${whatsappNumber(phone)}`} target="_blank" rel="noopener noreferrer" className={btn("secondary", "sm")}>واتساب</a>
    </>
  );
}

function ActiveRow({ trip, phase, now, driver, phone, onArrived, onEndTrip }: {
  trip: Trip;
  phase: TripPhase;
  now: Date;
  driver: string;
  phone: string;
  onArrived: (requestIds: string[], source: "manual" | "estimate") => void;
  onEndTrip: (requestIds: string[]) => void;
}) {
  const { request } = trip;
  const sent = minutesSince(request.notificationSentAt, now);
  const stage = phase.kind === "toPickup"
    ? (phase.atPickup ? <Badge tone="cyan" icon={MapPin}>السيارة عند نقطة الاستلام</Badge> : <Badge tone={sent !== null && sent >= 15 ? "red" : "blue"} icon={Truck}>في الطريق إلى الاستلام{sent !== null ? ` · منذ ${sent} د` : ""}</Badge>)
    : phase.kind === "toDestination"
      ? <Badge tone={phase.late ? "red" : "blue"} icon={Flag}>{statusText(request.status)} · الوصول المتوقع <span dir="ltr" className="tabular">{timeLabel(phase.etaAt)}</span></Badge>
      : null;
  return (
    <div className={cx("flex flex-col gap-3 p-4 sm:px-5 lg:flex-row lg:items-center", trip.appointment.urgent && "bg-red-50/40")}>
      <TripSummary
        trip={trip}
        status={<>
          <Badge tone="neutral" icon={CarFront}><span dir="ltr" className="tabular">{request.vehiclePlate}</span> · {driver || "—"}</Badge>
          {stage}
        </>}
      />
      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
        <DriverLinks phone={phone} />
        {phase.kind === "toDestination" && (
          <button type="button" onClick={() => onArrived([request.id], "manual")} className={btn("success", "sm")}><CheckCircle2 className="h-3.5 w-3.5" /> تأكيد الوصول</button>
        )}
        {phase.kind === "toPickup" && (
          <button
            type="button"
            onClick={() => window.confirm(`إنهاء رحلة السيارة ${request.vehiclePlate} قبل تسجيل استلام ${trip.appointment.patientName}؟\nتُعتبر الرحلة منتهية وتصبح السيارة متاحة.`) && onEndTrip([request.id])}
            className={btn("secondary", "sm")}
          >
            <XCircle className="h-3.5 w-3.5" /> إنهاء الرحلة
          </button>
        )}
      </div>
    </div>
  );
}

/** حالة الحالة المستعجلة الآن (من طلب سيارتها، ونتيجتها، ورحلة المستشفى بعدها) */
function caseStatus({ clinicCase, request, hospitalCase, hospitalRequest, phaseOf }: {
  clinicCase: ClinicAppointment;
  request?: VehicleRequest;
  hospitalCase?: ClinicAppointment;
  hospitalRequest?: VehicleRequest;
  phaseOf: (request: VehicleRequest) => TripPhase;
}): { tone: "red" | "amber" | "blue" | "cyan" | "green" | "neutral"; text: string } {
  if (clinicCase.status === "ملغي") return { tone: "neutral", text: `أُلغيت${clinicCase.cancelReason ? ` · ${clinicCase.cancelReason}` : ""}` };
  if (hospitalCase) {
    const name = hospitalCase.clinic;
    if (hospitalCase.status === "مكتملة") return { tone: "green", text: hospitalCase.returnedSelf ? `عاد من ${name} بنفسه` : `عاد من ${name} إلى المجمع` };
    if (!hospitalRequest) return { tone: "amber", text: `إلى ${name} · بانتظار طلب السيارة` };
    const phase = phaseOf(hospitalRequest);
    if (hospitalRequest.direction === "عودة") {
      return phase.kind === "pending" ? { tone: "amber", text: `طُلبت العودة من ${name} · بانتظار سيارة` } : { tone: "blue", text: `العودة من ${name} · ${statusText(hospitalRequest.status)}` };
    }
    if (phase.kind === "pending") return { tone: "amber", text: `إلى ${name} · بانتظار سيارة` };
    if (phase.kind === "toPickup") return { tone: "blue", text: `إلى ${name} · السيارة في الطريق إلى العيادة` };
    if (phase.kind === "toDestination") return { tone: "blue", text: `في الطريق إلى ${name}` };
    return { tone: "cyan", text: `في ${name} · تُطلب العودة عند انتهائه` };
  }
  if (clinicCase.urgentOutcome && clinicCase.urgentOutcome !== "hospital") return { tone: "green", text: urgentOutcomeText(clinicCase.urgentOutcome) };
  if (!request) return { tone: "amber", text: "بانتظار طلب السيارة من مشرف المبنى" };
  const phase = phaseOf(request);
  if (phase.kind === "pending") return { tone: "red", text: "بانتظار إرسال سيارة" };
  if (phase.kind === "toPickup") return { tone: "blue", text: phase.atPickup ? "السيارة عند المبنى" : "السيارة في الطريق إلى المبنى" };
  return { tone: "cyan", text: `في ${COMPLEX_CLINIC.name} · تنتظر النتيجة` };
}

function CaseRow({ clinicCase, request, hospitalCase, hospitalRequest, awaitingOutcome, atHospital, now, phaseOf, hospitals, onUrgentOutcome, onReturn }: {
  clinicCase: ClinicAppointment;
  request?: VehicleRequest;
  hospitalCase?: ClinicAppointment;
  hospitalRequest?: VehicleRequest;
  awaitingOutcome: boolean;
  atHospital: boolean;
  now: Date;
  phaseOf: (request: VehicleRequest) => TripPhase;
  hospitals: Hospital[];
  onUrgentOutcome: (appointment: ClinicAppointment, outcome: UrgentOutcome, hospital?: Hospital) => void;
  onReturn: (appointment: ClinicAppointment) => void;
}) {
  const status = caseStatus({ clinicCase, request, hospitalCase, hospitalRequest, phaseOf });
  const open = isOpenCase(clinicCase) || Boolean(hospitalCase && isOpenCase(hospitalCase));
  const steps = [
    `طُلبت ${clinicCase.appointmentAt}${request?.requestedByName ? ` (${request.requestedByName})` : ""}`,
    request?.notificationSentAt && `أُرسلت ${request.vehiclePlate} ${request.notificationSentAt}`,
    request?.pickedUpAt && `استُلم ${timeLabel(new Date(request.pickedUpAt))}`,
    clinicCase.urgentOutcomeAt && `النتيجة ${timeLabel(new Date(clinicCase.urgentOutcomeAt))}${clinicCase.urgentOutcomeBy ? ` (${clinicCase.urgentOutcomeBy})` : ""}`,
  ].filter(Boolean).join(" · ");
  return (
    <div className={cx("p-4 sm:px-5", open && "bg-red-50/30")}>
      <div className="flex items-start gap-4">
        <TimeBlock time={clinicCase.appointmentAt} day={clinicCase.appointmentDate === localDateString(now) ? undefined : formatDay(clinicCase.appointmentDate, now)} tone={open ? "red" : undefined} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold text-ink">{clinicCase.patientName}</span>
            <span className="text-sm text-slate-500">مبنى {clinicCase.buildingNumber} · شقة {clinicCase.apartmentNumber}</span>
            {clinicCase.kind === "احتياجات خاصة" && <Badge tone="violet">احتياجات خاصة</Badge>}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge tone={status.tone} className="whitespace-normal" icon={status.tone === "green" ? CheckCircle2 : status.tone === "cyan" ? (hospitalCase ? HospitalIcon : Stethoscope) : status.tone === "red" ? AlertTriangle : Clock3}>{status.text}</Badge>
            {clinicCase.mobile && clinicCase.mobile !== "-" && <GuestContact mobile={clinicCase.mobile} />}
          </div>
          <p className="mt-1.5 text-xs text-slate-500">{steps}</p>
          {awaitingOutcome && (
            <div className="mt-3">
              <UrgentOutcomeActions appointment={clinicCase} hospitals={hospitals} onOutcome={onUrgentOutcome} />
            </div>
          )}
          {atHospital && hospitalCase && (
            <button type="button" onClick={() => window.confirm(`طلب سيارة لعودة ${hospitalCase.patientName} من ${hospitalCase.clinic} إلى المجمع؟`) && onReturn(hospitalCase)} className={cx(btn("soft", "sm"), "mt-3")}>
              <RotateCcw className="h-3.5 w-3.5" /> طلب العودة إلى المجمع
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

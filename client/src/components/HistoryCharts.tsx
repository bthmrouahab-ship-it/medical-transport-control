import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlarmClock, BarChart3, Building2, CalendarClock, CalendarDays, CarFront, CheckCircle2, Clock3, MapPinned, PieChart as PieIcon, Table2, TrendingUp, Truck } from "lucide-react";
import { BOOKING_HINTS, DELAY_STAGES, TRIP_KINDS, clockText, durationText, type ServiceSummary, type StatsFilter, type StatsSummary } from "@shared/stats";
import { BUS_ROLE_LABELS, type VehicleKind, type VehicleRole } from "@shared/transport";
import { Badge, Panel, Stat, btn, cx } from "./ui-kit";
import { KindIcon, KindLabel } from "./VehiclePicker";

// ألوان المخططات (الوضع الفاتح): السلسلة الأولى أزرق، الثانية برتقالي؛ النص بألوان النص لا بلون السلسلة
const SERIES_1 = "#2a78d6";
const SERIES_2 = "#eb6834";
// العجلة: الرحلات ذهابًا (أخضر مزرق) وعودة (برتقالي)، والمواعيد المنجزة (أزرق) والباقي رمادي (لوحة مفحوصة لعمى الألوان)
const GO = "#0f9d8a";
const BACK = "#eb6834";
const REST = "#cbd5e1";
const GRID = "#e2e8f0";
const AXIS = "#64748b";

const axisProps = { tick: { fill: AXIS, fontSize: 11 }, axisLine: false, tickLine: false } as const;
const tooltipStyle = { contentStyle: { borderRadius: 12, border: "1px solid #e2e8f0", boxShadow: "0 8px 24px -12px rgba(15,31,53,.25)", fontSize: 12, direction: "rtl" as const }, cursor: { fill: "#f1f5f9" } };

const NoData = () => <p className="py-8 text-center text-sm text-slate-400">لا توجد بيانات لهذه الفترة</p>;

const shortDate = (date: string) => `${Number(date.slice(8, 10))}/${Number(date.slice(5, 7))}`;

/** زر داخل القوائم: النقر على منطقة أو وجهة أو سيارة أو مبنى يختاره فلترًا. */
function Pick({ onClick, label, children, className = "" }: { onClick?: () => void; label: string; children: React.ReactNode; className?: string }) {
  if (!onClick) return <div className={className}>{children}</div>;
  return <button type="button" onClick={onClick} title={`عرض ${label} فقط`} className={cx("w-full text-start transition hover:bg-slate-50", className)}>{children}</button>;
}

const count = (value: number) => value.toLocaleString("en");
const share = (part: number, total: number) => (total ? Math.round((part / total) * 100) : 0);

export default function HistoryCharts({ summary, onFilter, service, trackedSince, fleetKinds }: {
  summary: StatsSummary;
  /** نوع كل سيارة في قائمة السيارات (للسيارات بلا نوع في الملخص القديم) */
  fleetKinds?: Map<string, VehicleKind>;
  onFilter?: (patch: Partial<StatsFilter>) => void;
  /** وقت توفر السيارات في الخدمة للفترة (null: لم يُحمَّل) */
  service?: ServiceSummary | null;
  /** بداية تسجيل التوفر في الخدمة (ISO) */
  trackedSince?: string | null;
}) {
  const [showTable, setShowTable] = useState(false);
  const completion = share(summary.completedTrips, summary.totalTrips);
  // الرحلات المنجزة: رحلات السيارات ذهابًا وعودة (ملفات Excel بلا اتجاه: رحلة لكل موعد منجز)
  const directions = summary.directions ?? { go: summary.completedTrips, back: 0, unknown: 0, backOnly: 0 };
  const carTrips = directions.go + directions.back + directions.unknown;
  const oneDay = summary.activeDays <= 1;
  const booking = summary.booking ?? { scheduled: 0, sameDay: 0, unknown: 0 };
  const booked = booking.scheduled + booking.sameDay;
  const dailyAverage = summary.activeDays ? Math.round(summary.totalTrips / summary.activeDays) : 0;
  // ساعات العمل المعتادة، وتتسع إذا وُجدت رحلات قبلها أو بعدها
  const busyHours = summary.byHour.filter((item) => item.trips > 0).map((item) => item.hour);
  const firstHour = Math.min(5, ...busyHours);
  const lastHour = Math.max(22, ...busyHours);
  const hours = summary.byHour.filter((item) => item.hour >= firstHour && item.hour <= lastHour);
  const zoneTotal = summary.zones.reduce((total, zone) => total + zone.trips, 0);
  const pick = (patch: Partial<StatsFilter>) => (onFilter ? () => onFilter(patch) : undefined);
  const weekdays = summary.byWeekday.filter((item) => item.days > 0).map((item) => ({ ...item, average: Math.round(item.trips / item.days) }));
  const topDestinations = summary.destinations.slice(0, 12);
  const peak = hours.reduce((best, item) => (item.trips > best.trips ? item : best), hours[0]);
  // السيارات التي عملت: في الفترة (بلا تكرار) وفي كل يوم له تفاصيل
  const working = summary.workingVehicles;
  const kindVehicles = (kind: string) => working?.byKind.find((item) => item.kind === kind)?.vehicles ?? 0;
  const vehicleDays = summary.daily.filter((day) => day.vehicles !== undefined);
  // ساعات العمل: أول خروج وآخر عودة لليوم الواحد، ومتوسط الساعات في اليوم للفترة
  const work = summary.workHours;
  const singleDay = new Set([...(work?.days ?? []), ...(service?.days ?? [])].map((day) => day.date)).size === 1;
  const kindsText = TRIP_KINDS.filter((kind) => kindVehicles(kind)).map((kind) => `${kind} ${kindVehicles(kind)}`).join(" · ");
  const roleBuses = working?.roleBuses ?? [];
  const delays = summary.delays;
  const hourRows = mergeHours(work?.vehicles ?? [], service?.vehicles ?? []);

  return (
    <div className="space-y-6">
      <div className={cx("grid grid-cols-2 gap-3 sm:grid-cols-3 lg:gap-4", oneDay ? "lg:grid-cols-4" : "lg:grid-cols-5")}>
        <Stat icon={CalendarDays} tone="blue" label="إجمالي المواعيد" value={count(summary.totalTrips)} hint={`${summary.activeDays} يوم`} />
        <Stat
          icon={CheckCircle2}
          tone="green"
          label="الرحلات المنجزة"
          title={`نسبة الإنجاز: ${count(summary.completedTrips)} موعد أُرسلت له سيارة من ${count(summary.totalTrips)}`}
          value={<span className="flex flex-wrap items-baseline gap-x-2">{count(carTrips)}<span className="rounded-full bg-emerald-50 px-2 py-0.5 text-sm font-semibold text-emerald-700">{completion}%</span></span>}
          details={<>ذهاب {count(directions.go)} · عودة {count(directions.back)}{directions.backOnly ? <span className="text-slate-400" title="طلبات عودة من المستشفى بلا رحلة ذهاب"> (منها {count(directions.backOnly)} عودة فقط)</span> : null}{directions.unknown ? <span className="text-slate-400" title="رحلات ملفات Excel بلا اتجاه"> · Excel {count(directions.unknown)}</span> : null}</>}
        />
        <Stat
          icon={CarFront}
          tone="neutral"
          label="السيارات العاملة"
          value={working?.total ?? summary.vehicles.length}
          hint={summary.activeDays > 1 && working?.dailyAverage ? `متوسط ${working.dailyAverage} يوميًا` : undefined}
          details={kindsText || undefined}
          title={roleBuses.length ? `منها ${roleBuses.map((bus) => `${BUS_ROLE_LABELS[bus.busRole]} ${bus.plate}`).join("، ")} (في الخدمة بلا رحلات مسجلة)` : undefined}
        />
        <Stat
          icon={CalendarClock}
          tone="amber"
          label="تسجيل المواعيد"
          title={`مجدولة: ${BOOKING_HINTS.scheduled} · عاجلة: ${BOOKING_HINTS.sameDay}${booking.unknown ? ` · ${count(booking.unknown)} موعد سُجّل قبل حفظ وقت التسجيل` : ""}`}
          value={booked ? (
            <span className="flex items-end gap-4">
              <span className="leading-none">{count(booking.scheduled)}<span className="mt-1 block text-[11px] font-medium text-slate-500">مجدولة</span></span>
              <span className="leading-none">{count(booking.sameDay)}<span className="mt-1 block text-[11px] font-medium text-amber-700">عاجلة</span></span>
            </span>
          ) : "—"}
          details={booked ? undefined : "تُحسب للمواعيد المسجلة بعد تحديث النظام"}
        />
        {!oneDay && <Stat icon={TrendingUp} tone="violet" label="متوسط المواعيد يوميًا" value={String(dailyAverage)} />}
      </div>

      {/* عدة أيام: المخطط اليومي والعجلة ثم التأخير؛ يوم واحد: العجلة والتأخير جنبًا إلى جنب */}
      <div className={cx("grid items-start gap-6", summary.daily.length > 1 ? "lg:grid-cols-[1.6fr_1fr]" : delays?.trips ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]" : "lg:max-w-xl")}>
        {summary.daily.length > 1 && (
          <Panel icon={TrendingUp} title="المواعيد يوميًا" description="الإجمالي والمنجز لكل يوم" bodyClassName="p-5">
            <div dir="ltr" className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={summary.daily} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="date" tickFormatter={shortDate} {...axisProps} minTickGap={20} />
                  <YAxis {...axisProps} allowDecimals={false} />
                  <Tooltip {...tooltipStyle} cursor={{ stroke: AXIS, strokeDasharray: "3 3" }} labelFormatter={(date) => `${date}`} />
                  <Legend wrapperStyle={{ fontSize: 12, color: AXIS }} />
                  <Line type="monotone" dataKey="total" name="إجمالي المواعيد" stroke={SERIES_1} strokeWidth={2} dot={summary.daily.length < 15} activeDot={{ r: 5, stroke: "#ffffff", strokeWidth: 2 }} />
                  <Line type="monotone" dataKey="completed" name="المنجزة" stroke={SERIES_2} strokeWidth={2} dot={summary.daily.length < 15} activeDot={{ r: 5, stroke: "#ffffff", strokeWidth: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        )}
        <TripsWheel summary={summary} directions={directions} oneDay={summary.daily.length <= 1} />
        {summary.daily.length <= 1 && delays && delays.trips > 0 && <DelaysPanel summary={summary} />}
      </div>

      {summary.daily.length > 1 && delays && delays.trips > 0 && <DelaysPanel summary={summary} />}

      {vehicleDays.length > 1 && working?.dailyMax ? (
        <Panel icon={CarFront} title="السيارات العاملة يوميًا" description={`عدد السيارات التي خرجت في كل يوم بلا تكرار · متوسط ${working.dailyAverage} وأعلى ${working.dailyMax} في اليوم`} bodyClassName="p-5">
          <div dir="ltr" className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={vehicleDays} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="date" tickFormatter={shortDate} {...axisProps} minTickGap={12} />
                <YAxis {...axisProps} allowDecimals={false} />
                <Tooltip {...tooltipStyle} labelFormatter={(date) => `${date}`} formatter={(value, _name, item) => [`${value} سيارة · ${item.payload.completed} رحلة منجزة`, "السيارات العاملة"]} />
                <Bar dataKey="vehicles" fill={SERIES_1} radius={[4, 4, 0, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      ) : null}

      <div className={cx("grid gap-6", !oneDay && "lg:grid-cols-2")}>
        <Panel icon={Clock3} title="خروج السيارات حسب الساعة" description={peak ? `الذروة الساعة ${peak.hour}:00 (${peak.trips} رحلة)` : undefined} bodyClassName="p-5">
          <div dir="ltr" className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hours} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="hour" tickFormatter={(hour) => `${hour}`} {...axisProps} />
                <YAxis {...axisProps} allowDecimals={false} />
                <Tooltip {...tooltipStyle} labelFormatter={(hour) => `الساعة ${hour}:00`} formatter={(value) => [value, "رحلة"]} />
                <Bar dataKey="trips" fill={SERIES_1} radius={[4, 4, 0, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        {!oneDay && <Panel icon={BarChart3} title="متوسط المواعيد حسب اليوم" description="أيام الأسبوع التي فيها رحلات" bodyClassName="p-5">
          <div dir="ltr" className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weekdays} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="weekday" reversed {...axisProps} />
                <YAxis {...axisProps} allowDecimals={false} />
                <Tooltip {...tooltipStyle} formatter={(value, _name, item) => [`${value} يوميًا (${item.payload.days} يوم)`, "المتوسط"]} />
                <Bar dataKey="average" fill={SERIES_1} radius={[4, 4, 0, 0]} maxBarSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Panel
          icon={MapPinned}
          title="أكثر الوجهات طلبًا"
          description={onFilter ? "اضغط على وجهة لعرض رحلاتها فقط" : undefined}
          actions={<button onClick={() => setShowTable((value) => !value)} className={btn("secondary", "sm")}>{showTable ? <><BarChart3 className="h-3.5 w-3.5" /> مخطط</> : <><Table2 className="h-3.5 w-3.5" /> جدول</>}</button>}
          bodyClassName="p-5"
        >
          {!summary.destinations.length ? <NoData /> : showTable ? (
            <div className="-mx-5 -my-5 max-h-96 overflow-auto">
              <table className="w-full text-start text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500">
                  <tr><th className="px-5 py-2.5 text-start font-medium">الوجهة</th><th className="py-2.5 text-start font-medium">المنطقة</th><th className="py-2.5 text-start font-medium">الرحلات</th><th className="px-5 py-2.5 text-start font-medium">متوسط المدة</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summary.destinations.map((item) => (
                    <tr key={item.key} onClick={pick({ destination: item.key })} className={onFilter ? "cursor-pointer hover:bg-slate-50" : undefined}>
                      <td className="px-5 py-2.5 font-medium text-ink">{item.name}</td>
                      <td className="py-2.5 text-slate-500">{item.zone ?? "أخرى"}</td>
                      <td className="py-2.5 tabular">{item.trips}</td>
                      <td className="px-5 py-2.5 tabular text-slate-600">{item.avgMinutes ? `${item.avgMinutes} د` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div dir="ltr" style={{ height: topDestinations.length * 30 + 20 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topDestinations} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 8 }}>
                  <CartesianGrid stroke={GRID} horizontal={false} />
                  <XAxis type="number" reversed {...axisProps} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" orientation="right" width={170} {...axisProps} tick={{ fill: AXIS, fontSize: 11 }} />
                  <Tooltip {...tooltipStyle} formatter={(value, _name, item) => [`${value} رحلة${item.payload.avgMinutes ? ` · متوسط ${item.payload.avgMinutes} د` : ""}`, item.payload.zone ?? "وجهة أخرى"]} />
                  <Bar dataKey="trips" fill={SERIES_1} radius={[4, 0, 0, 4]} maxBarSize={18} cursor={onFilter ? "pointer" : undefined} onClick={(item: { key?: string }) => item?.key && onFilter?.({ destination: item.key })} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
        <div className="space-y-6">
          <Panel icon={MapPinned} title="الرحلات حسب المنطقة" bodyClassName="p-5">
            {!summary.zones.length && <NoData />}
            <ul className="space-y-2.5">
              {summary.zones.map((zone) => {
                const share = zoneTotal ? Math.round((zone.trips / zoneTotal) * 100) : 0;
                return (
                  <li key={zone.zone}>
                    <Pick onClick={pick({ zone: zone.zone, destination: "all" })} label={zone.zone} className="rounded-lg px-1.5 py-1">
                      <div className="flex justify-between text-sm"><span className="font-medium text-slate-700">{zone.zone}</span><span className="text-slate-500 tabular">{zone.trips} · {share}%</span></div>
                      <div className="mt-1.5 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full" style={{ width: `${share}%`, background: SERIES_1 }} /></div>
                    </Pick>
                  </li>
                );
              })}
            </ul>
          </Panel>
          <Panel icon={Truck} title="نوع المركبة" description="الرحلات المنجزة والسيارات التي عملت" bodyClassName="px-3 py-2">
            <ul className="divide-y divide-slate-100 text-sm">
              {summary.byKind.map((item) => (
                <li key={item.kind}>
                  <Pick onClick={pick({ kind: item.kind })} label={item.kind} className="flex justify-between rounded-lg px-2 py-2.5">
                    <span className="text-slate-600">{item.kind}{kindVehicles(item.kind) ? <span className="text-xs text-slate-400"> · {kindVehicles(item.kind)} سيارة</span> : null}</span>
                    <span className="font-semibold text-ink tabular">{item.trips} <span className="text-xs font-normal text-slate-400">({summary.completedTrips ? Math.round((item.trips / summary.completedTrips) * 100) : 0}%)</span></span>
                  </Pick>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Panel icon={Truck} title="السيارات الأكثر عملًا" count={summary.vehicles.length || undefined} description={summary.vehicles.length ? `${summary.vehicles.length} سيارة عملت في الفترة (ومنها سيارات العودة)` : undefined} bodyClassName="px-3 py-2">
          {!summary.vehicles.length && <NoData />}
          <ul className="max-h-72 divide-y divide-slate-100 overflow-auto text-sm">
            {summary.vehicles.slice(0, 20).map((vehicle) => ({ ...vehicle, kind: vehicle.kind ?? fleetKinds?.get(vehicle.plate) ?? null })).map((item) => (
              <li key={item.plate}>
                <Pick onClick={pick({ plate: item.plate })} label={`السيارة ${item.plate}`} className="flex justify-between gap-3 rounded-lg px-2 py-2.5">
                  <span className="flex min-w-0 items-center gap-2.5">
                    {item.kind ? <KindIcon vehicle={{ kind: item.kind }} size="sm" /> : <span className="h-6 w-6 shrink-0" />}
                    <span className="min-w-0">
                      <span className="block truncate"><span dir="ltr" className="font-semibold text-ink">{item.plate}</span> <span className="text-xs text-slate-500">{item.driver}</span></span>
                      {item.kind && <span className="block text-[11px]"><KindLabel vehicle={{ kind: item.kind }} /></span>}
                    </span>
                  </span>
                  <span className="font-semibold text-ink tabular">{item.trips}</span>
                </Pick>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel icon={Building2} title="المباني الأكثر طلبًا" count={summary.buildings.length || undefined} bodyClassName="px-3 py-2">
          {!summary.buildings.length && <NoData />}
          <ul className="grid max-h-72 grid-cols-2 gap-x-4 overflow-auto text-sm">
            {summary.buildings.slice(0, 20).map((item) => (
              <li key={item.building} className="border-b border-slate-100">
                <Pick onClick={pick({ building: item.building })} label={`مبنى ${item.building}`} className="flex justify-between rounded-lg px-2 py-2.5">
                  <span className="text-slate-700">مبنى {item.building}</span>
                  <span className="font-semibold text-ink tabular">{item.trips}</span>
                </Pick>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {hourRows.length ? (
        <Panel
          icon={Clock3}
          title="ساعات السيارات: التوفر في الخدمة والعمل"
          count={hourRows.length}
          description={(
            <>
              العمل {durationText(work?.totalMinutes ?? 0)}{work?.avgDayMinutes != null && !singleDay ? ` (متوسط ${durationText(work.avgDayMinutes)} للسيارة في اليوم)` : ""}: من خروج السيارة حتى عودتها إلى المجمع
              {service ? <> · التوفر {durationText(service.totalMinutes)}: من تشغيل السيارة (متاحة ولها سائق) حتى إيقافها{trackedSince ? <>، يُسجَّل منذ <span dir="ltr">{trackedSince.slice(0, 10)}</span></> : null}</> : null}
            </>
          )}
          bodyClassName="p-0"
        >
          <div className="max-h-[28rem] overflow-auto">
            <table className="w-full min-w-[640px] text-start text-sm">
              <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-5 py-2.5 text-start font-medium">السيارة</th>
                  {singleDay ? (
                    <>
                      <th className="py-2.5 text-start font-medium">في الخدمة</th>
                      <th className="py-2.5 text-start font-medium">أول خروج · آخر عودة</th>
                    </>
                  ) : <th className="py-2.5 text-start font-medium">أيام الخدمة · العمل</th>}
                  <th className="py-2.5 text-start font-medium">التوفر في الخدمة</th>
                  <th className="py-2.5 text-start font-medium">ساعات العمل</th>
                  <th className="px-5 py-2.5 text-start font-medium" title="ساعات العمل من ساعات التوفر في الخدمة">نسبة التشغيل</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {hourRows.map((row) => (
                  <tr key={row.plate} onClick={pick({ plate: row.plate })} title={onFilter ? `عرض السيارة ${row.plate} فقط` : undefined} className={onFilter ? "cursor-pointer hover:bg-slate-50" : undefined}>
                    <td className="px-5 py-2.5">
                      <span dir="ltr" className="font-semibold text-ink">{row.plate}</span> <span className="text-xs text-slate-500">{row.driver}</span>
                      <span className="mt-0.5 flex flex-wrap gap-1 text-[11px] text-slate-500">{row.kind}{row.roles.map((role) => <span key={role}>{roleBadge(role)}</span>)}</span>
                    </td>
                    {singleDay ? (
                      <>
                        <td className="py-2.5 tabular text-slate-600"><span dir="ltr">{row.serviceFirst !== null ? `${clockText(row.serviceFirst)} – ${clockText(row.serviceLast)}` : "—"}</span></td>
                        <td className="py-2.5 tabular text-slate-600"><span dir="ltr">{row.workFirst !== null ? `${clockText(row.workFirst)} – ${clockText(row.workLast)}` : "—"}</span></td>
                      </>
                    ) : <td className="py-2.5 tabular text-slate-600">{row.serviceDays || "—"} · {row.workDays || "—"}</td>}
                    <td className="py-2.5 tabular text-slate-700">{row.serviceMinutes ? durationText(row.serviceMinutes) : "—"}</td>
                    <td className="py-2.5 font-semibold tabular text-ink">{row.workMinutes ? durationText(row.workMinutes) : "—"}</td>
                    <td className="px-5 py-2.5 tabular text-slate-600">{row.serviceMinutes ? `${share(Math.min(row.workMinutes, row.serviceMinutes), row.serviceMinutes)}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

type WheelSlice = { name: string; value: number; fill: string };

/**
 * عجلة المواعيد والرحلات: الحلقة الداخلية المواعيد (المنجزة وما لم يُنجز)، والخارجية رحلات السيارات
 * المنجزة ذهابًا وعودة. الأرقام مكتوبة بجانبها (لا يُعتمد على اللون وحده).
 */
function TripsWheel({ summary, directions, oneDay }: { summary: StatsSummary; directions: NonNullable<StatsSummary["directions"]>; oneDay: boolean }) {
  const open = summary.totalTrips - summary.completedTrips;
  const appointments: WheelSlice[] = [
    { name: "مواعيد منجزة", value: summary.completedTrips, fill: SERIES_1 },
    { name: "مواعيد غير منجزة", value: open, fill: REST },
  ].filter((slice) => slice.value > 0);
  const trips: WheelSlice[] = [
    { name: "رحلات ذهاب", value: directions.go, fill: GO },
    { name: "رحلات عودة", value: directions.back, fill: BACK },
    { name: "رحلات بلا اتجاه (Excel)", value: directions.unknown, fill: "#e2e8f0" },
  ].filter((slice) => slice.value > 0);
  const carTrips = directions.go + directions.back + directions.unknown;
  // المواعيد المنجزة برحلة عودة فقط (طلب العودة فقط من المستشفى): لذلك قد تزيد المنجزة على رحلات الذهاب
  const backOnly = directions.backOnly;
  type Row = { label: string; value: number; fill: string | null; note: string | null; title?: string; subs?: { label: string; value: number; title?: string }[] };
  const rows: Row[] = [
    { label: "المواعيد", value: summary.totalTrips, fill: null, note: null },
    {
      label: "منجزة",
      value: summary.completedTrips,
      fill: SERIES_1,
      note: `${share(summary.completedTrips, summary.totalTrips)}%`,
      title: "مواعيد أُرسلت لها سيارة",
      subs: backOnly
        ? [
          ...(!directions.unknown ? [{ label: "برحلة ذهاب", value: summary.completedTrips - backOnly }] : []),
          { label: "عودة فقط من المستشفى", value: backOnly, title: "طلب عودة من المستشفى بلا رحلة ذهاب (ذهب الضيف بنفسه أو بالإسعاف)" },
        ]
        : undefined,
    },
    { label: "غير منجزة", value: open, fill: REST, note: `${share(open, summary.totalTrips)}%`, title: "لم تُرسل لها سيارة" },
    { label: "رحلات ذهاب", value: directions.go, fill: GO, note: `${share(directions.go, carTrips)}%` },
    {
      label: "رحلات عودة",
      value: directions.back,
      fill: BACK,
      note: `${share(directions.back, carTrips)}%`,
      subs: backOnly ? [{ label: "منها لطلبات العودة فقط", value: backOnly }] : undefined,
    },
    ...(directions.unknown ? [{ label: "Excel بلا اتجاه", value: directions.unknown, fill: "#e2e8f0", note: null }] : []),
  ];
  return (
    <Panel icon={PieIcon} title={oneDay ? "مواعيد اليوم ورحلاته" : "المواعيد والرحلات"} description="الداخل: المواعيد المنجزة من الإجمالي · الخارج: رحلات الذهاب والعودة" bodyClassName="p-5">
      <div className="grid items-center gap-5 sm:grid-cols-[200px_minmax(0,1fr)] lg:grid-cols-1 xl:grid-cols-[200px_minmax(0,1fr)]">
        <div className="relative mx-auto h-52 w-52" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Tooltip {...tooltipStyle} formatter={(value, name) => [count(Number(value)), name]} />
              <Pie data={appointments} dataKey="value" nameKey="name" innerRadius="46%" outerRadius="66%" startAngle={90} endAngle={-270} stroke="#ffffff" strokeWidth={2} isAnimationActive={false}>
                {appointments.map((slice) => <Cell key={slice.name} fill={slice.fill} />)}
              </Pie>
              <Pie data={trips} dataKey="value" nameKey="name" innerRadius="72%" outerRadius="94%" startAngle={90} endAngle={-270} stroke="#ffffff" strokeWidth={2} isAnimationActive={false}>
                {trips.map((slice) => <Cell key={slice.name} fill={slice.fill} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center leading-tight">
            <span className="text-2xl font-bold tabular text-ink">{count(summary.totalTrips)}</span>
            <span className="text-[11px] text-slate-500">موعد</span>
          </div>
        </div>
        <ul className="divide-y divide-slate-100 text-sm">
          {rows.map((row) => (
            <li key={row.label} className="py-2">
              <div title={row.title} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-slate-600">
                  {row.fill ? <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: row.fill }} /> : <span className="h-2.5 w-2.5 shrink-0" />}
                  {row.label}
                </span>
                <span className="flex shrink-0 items-baseline gap-2">
                  {row.note && <span className="text-xs text-slate-400">{row.note}</span>}
                  <span className="font-semibold tabular text-ink">{count(row.value)}</span>
                </span>
              </div>
              {row.subs?.map((sub) => (
                <div key={sub.label} title={sub.title} className="mt-1 flex items-center justify-between gap-3 ps-[18px] text-xs text-slate-500">
                  <span>{sub.label}</span>
                  <span className="font-medium tabular text-slate-600">{count(sub.value)}</span>
                </div>
              ))}
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

/** تأخير الرحلات ومتى كان: عند الإرسال، أو عند الاستلام (السيارة من المجمع، أو السائق لم يسجّل وصوله، أو تأخر الوصول، أو تأخر الضيف). */
function DelaysPanel({ summary }: { summary: StatsSummary }) {
  const delays = summary.delays!;
  const lateShare = share(delays.late, delays.trips);
  const maxTrips = Math.max(1, ...delays.stages.map((item) => item.trips));
  const groups = ["عند الإرسال", "عند الاستلام"].map((when) => ({ when, stages: DELAY_STAGES.filter((item) => item.when === when) }));
  const late = delays.lateToAppointment;
  return (
    <Panel
      tone={delays.late ? "red" : "green"}
      icon={AlarmClock}
      title="تأخير الرحلات"
      count={delays.late || undefined}
      description={`${count(delays.late)} من ${count(delays.trips)} رحلة سيارة (${lateShare}%) فيها تأخير · من رحلات النظام فقط · الرحلة الواحدة قد تتأخر في أكثر من مرحلة`}
      bodyClassName="p-0"
    >
      <div className="grid gap-px bg-slate-100 md:grid-cols-[minmax(0,1fr)_260px]">
        <div className="space-y-4 bg-white p-4 sm:p-5">
          {groups.map((group) => (
            <section key={group.when} aria-label={group.when}>
              <h3 className="mb-2 text-xs font-semibold text-slate-500">{group.when}</h3>
              <ul className="space-y-3">
                {group.stages.map((item) => {
                  const stat = delays.stages.find((entry) => entry.stage === item.stage)!;
                  return (
                    <li key={item.stage}>
                      <div className="flex items-start justify-between gap-3 text-sm">
                        <span className="min-w-0">
                          <span className="font-medium text-ink">{item.label}</span>
                          <span className="block text-xs leading-5 text-slate-500">{item.hint}</span>
                        </span>
                        <span className="shrink-0 text-end">
                          <span className="font-semibold tabular text-ink">{count(stat.trips)}</span>
                          <span className="block text-xs text-slate-500">{stat.avgMinutes !== null ? `متوسط ${stat.avgMinutes} د` : "—"}</span>
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-red-400" style={{ width: `${(stat.trips / maxTrips) * 100}%` }} /></div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
        <div className="space-y-3 bg-white p-4 sm:p-5">
          <div className="rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-inset ring-slate-200/70">
            <p className="text-xs text-slate-500">رحلات فيها تأخير</p>
            <p className="mt-0.5 text-2xl font-bold tabular text-ink">{count(delays.late)} <span className="text-sm font-medium text-slate-500">{lateShare}%</span></p>
          </div>
          <div className="rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-inset ring-slate-200/70">
            <p className="text-xs text-slate-500">وصل الضيف بعد موعده</p>
            <p className="mt-0.5 text-2xl font-bold tabular text-ink">{late.measured ? count(late.trips) : "—"}{late.avgMinutes !== null && <span className="ms-1.5 text-sm font-medium text-slate-500">متوسط {late.avgMinutes} د</span>}</p>
            <p className="text-xs leading-5 text-slate-500">{late.measured ? `من ${count(late.measured)} رحلة ذهاب طبية سُجّل وصولها بالـ GPS أو بالتأكيد` : "لا توجد رحلات ذهاب سُجّل وصولها"}</p>
          </div>
          {delays.withoutArrival > 0 && (
            <p className="text-xs leading-5 text-slate-500">{count(delays.withoutArrival)} رحلة بلا وقت مسجل لوصول السيارة إلى نقطة الاستلام (قبل حفظه في النظام، أو لم تصل بعد)، فلا تُحسب مراحل الاستلام فيها.</p>
          )}
        </div>
      </div>
    </Panel>
  );
}

/** تخصيص الباص بجانب السيارة */
export const roleBadge = (role: VehicleRole) => <Badge tone="amber">{BUS_ROLE_LABELS[role]}</Badge>;

type HourRow = {
  plate: string; driver: string; kind: string; roles: VehicleRole[];
  serviceMinutes: number; serviceDays: number; serviceFirst: number | null; serviceLast: number | null;
  workMinutes: number; workDays: number; workFirst: number | null; workLast: number | null;
};

/** سيارات ساعات العمل وسيارات التوفر في الخدمة في صف واحد لكل سيارة (الأطول توفرًا ثم الأكثر عملًا أولًا). */
function mergeHours(work: NonNullable<StatsSummary["workHours"]>["vehicles"], service: ServiceSummary["vehicles"]): HourRow[] {
  const rows = new Map<string, HourRow>();
  const row = (plate: string) => rows.get(plate) ?? { plate, driver: "", kind: "", roles: [], serviceMinutes: 0, serviceDays: 0, serviceFirst: null, serviceLast: null, workMinutes: 0, workDays: 0, workFirst: null, workLast: null };
  for (const item of service) {
    rows.set(item.plate, { ...row(item.plate), driver: item.driver, kind: item.kind, roles: item.busRoles, serviceMinutes: item.minutes, serviceDays: item.days, serviceFirst: item.first, serviceLast: item.last });
  }
  for (const item of work) {
    const entry = row(item.plate);
    rows.set(item.plate, { ...entry, driver: entry.driver || item.driver, kind: entry.kind || item.kind, workMinutes: item.minutes, workDays: item.days, workFirst: item.first, workLast: item.last });
  }
  return Array.from(rows.values()).sort((a, b) => b.serviceMinutes - a.serviceMinutes || b.workMinutes - a.workMinutes);
}

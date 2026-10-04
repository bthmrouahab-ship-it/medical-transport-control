import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, Building2, CalendarDays, CarFront, CheckCircle2, Clock3, MapPinned, Table2, Timer, TrendingUp, Truck } from "lucide-react";
import { clockText, durationText, type StatsFilter, type StatsSummary } from "@shared/stats";
import { Panel, Stat, btn, cx } from "./ui-kit";

// ألوان المخططات (الوضع الفاتح): السلسلة الأولى أزرق، الثانية برتقالي؛ النص بألوان النص لا بلون السلسلة
const SERIES_1 = "#2a78d6";
const SERIES_2 = "#eb6834";
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

export default function HistoryCharts({ summary, onFilter }: { summary: StatsSummary; onFilter?: (patch: Partial<StatsFilter>) => void }) {
  const [showTable, setShowTable] = useState(false);
  const completion = summary.totalTrips ? Math.round((summary.completedTrips / summary.totalTrips) * 100) : 0;
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
  const singleDay = new Set(work?.days.map((day) => day.date)).size === 1;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 lg:gap-4">
        <Stat icon={CalendarDays} tone="blue" label="إجمالي المواعيد" value={summary.totalTrips.toLocaleString("en")} hint={`${summary.activeDays} يوم`} />
        <Stat icon={CheckCircle2} tone="green" label="نسبة الإنجاز" value={`${completion}%`} hint={`${summary.completedTrips.toLocaleString("en")} رحلة منجزة`} />
        <Stat
          icon={CarFront}
          tone="neutral"
          label="السيارات العاملة"
          value={working?.total ?? summary.vehicles.length}
          hint={summary.activeDays > 1 && working?.dailyAverage ? `متوسط ${working.dailyAverage} يوميًا` : undefined}
        />
        <Stat icon={TrendingUp} tone="violet" label="متوسط المواعيد يوميًا" value={String(dailyAverage)} />
        <Stat icon={Timer} tone="cyan" label="متوسط مدة الرحلة" value={summary.avgTripMinutes ? `${summary.avgTripMinutes} د` : "—"} />
      </div>

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

      <div className="grid gap-6 lg:grid-cols-2">
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
        <Panel icon={BarChart3} title="متوسط المواعيد حسب اليوم" description="أيام الأسبوع التي فيها رحلات" bodyClassName="p-5">
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
        </Panel>
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
            {summary.vehicles.slice(0, 20).map((item) => (
              <li key={item.plate}>
                <Pick onClick={pick({ plate: item.plate })} label={`السيارة ${item.plate}`} className="flex justify-between gap-3 rounded-lg px-2 py-2.5">
                  <span className="min-w-0 truncate"><span dir="ltr" className="font-semibold text-ink">{item.plate}</span> <span className="text-xs text-slate-500">{item.driver}</span></span>
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

      {work?.vehicles.length ? (
        <Panel
          icon={Clock3}
          title="ساعات عمل السيارات"
          count={work.vehicles.length}
          description={`المجموع ${durationText(work.totalMinutes)}${work.avgDayMinutes !== null && !singleDay ? ` · متوسط ${durationText(work.avgDayMinutes)} للسيارة في اليوم` : ""} · من خروج السيارة حتى عودتها إلى المجمع (العودة بعد رحلة الذهاب تقديرية)`}
          bodyClassName="p-0"
        >
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-start text-sm">
              <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-5 py-2.5 text-start font-medium">السيارة</th>
                  {singleDay ? (
                    <>
                      <th className="py-2.5 text-start font-medium">أول خروج</th>
                      <th className="py-2.5 text-start font-medium">آخر عودة</th>
                    </>
                  ) : (
                    <>
                      <th className="py-2.5 text-start font-medium">أيام العمل</th>
                      <th className="py-2.5 text-start font-medium">متوسط اليوم</th>
                    </>
                  )}
                  <th className="px-5 py-2.5 text-start font-medium">ساعات العمل</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {work.vehicles.map((item) => (
                  <tr key={item.plate} onClick={pick({ plate: item.plate })} title={onFilter ? `عرض السيارة ${item.plate} فقط` : undefined} className={onFilter ? "cursor-pointer hover:bg-slate-50" : undefined}>
                    <td className="px-5 py-2.5"><span dir="ltr" className="font-semibold text-ink">{item.plate}</span> <span className="text-xs text-slate-500">{item.driver}</span></td>
                    {singleDay ? (
                      <>
                        <td className="py-2.5 tabular text-slate-600"><span dir="ltr">{clockText(item.first) || "—"}</span></td>
                        <td className="py-2.5 tabular text-slate-600"><span dir="ltr">{clockText(item.last) || "—"}</span></td>
                      </>
                    ) : (
                      <>
                        <td className="py-2.5 tabular text-slate-600">{item.days}</td>
                        <td className="py-2.5 tabular text-slate-600">{durationText(item.minutes / item.days)}</td>
                      </>
                    )}
                    <td className="px-5 py-2.5 font-semibold tabular text-ink">{durationText(item.minutes)}</td>
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

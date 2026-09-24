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
import type { HistorySummary } from "@shared/history";

// ألوان المخططات (الوضع الفاتح): السلسلة الأولى أزرق، الثانية برتقالي؛ النص بألوان النص لا بلون السلسلة
const SERIES_1 = "#2a78d6";
const SERIES_2 = "#eb6834";
const GRID = "#e6e4df";
const AXIS = "#52514e";

const axisProps = { tick: { fill: AXIS, fontSize: 11 }, axisLine: false, tickLine: false } as const;
const tooltipStyle = { contentStyle: { borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12, direction: "rtl" as const }, cursor: { fill: "#f1f5f9" } };

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-xs font-bold text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-bold text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <h3 className="font-bold text-slate-900">{title}</h3>
      {subtitle && <p className="mt-1 text-xs text-slate-400">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

const shortDate = (date: string) => `${Number(date.slice(8, 10))}/${Number(date.slice(5, 7))}`;

export default function HistoryCharts({ summary }: { summary: HistorySummary }) {
  const [showTable, setShowTable] = useState(false);
  const completion = summary.totalTrips ? Math.round((summary.completedTrips / summary.totalTrips) * 100) : 0;
  const dailyAverage = summary.activeDays ? Math.round(summary.totalTrips / summary.activeDays) : 0;
  const hours = summary.byHour.filter((item) => item.hour >= 5 && item.hour <= 22);
  const weekdays = summary.byWeekday.filter((item) => item.days > 0).map((item) => ({ ...item, average: Math.round(item.trips / item.days) }));
  const topDestinations = summary.destinations.slice(0, 12);
  const peak = hours.reduce((best, item) => (item.trips > best.trips ? item : best), hours[0]);

  return (
    <div className="space-y-5">
      <p className="text-xs text-slate-500">الفترة من <b>{summary.from}</b> إلى <b>{summary.to}</b> · المصدر: {summary.source} · تاريخ الاستيراد {summary.importedAt.slice(0, 10)}</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="إجمالي المواعيد" value={summary.totalTrips.toLocaleString("en")} hint={`${summary.activeDays} يوم عمل`} />
        <Stat label="نسبة الإنجاز" value={`${completion}%`} hint={`${summary.completedTrips.toLocaleString("en")} رحلة منجزة`} />
        <Stat label="متوسط المواعيد يوميًا" value={String(dailyAverage)} hint="في الأيام المسجلة" />
        <Stat label="متوسط مدة الرحلة" value={summary.avgTripMinutes ? `${summary.avgTripMinutes} د` : "—"} hint="من خروج السيارة إلى عودتها" />
      </div>

      <Card title="المواعيد يوميًا" subtitle="الإجمالي مقابل المنجز فعليًا">
        <div dir="ltr" className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={summary.daily.filter((day) => day.total > 0)} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="date" tickFormatter={shortDate} {...axisProps} minTickGap={20} />
              <YAxis {...axisProps} allowDecimals={false} />
              <Tooltip {...tooltipStyle} cursor={{ stroke: AXIS, strokeDasharray: "3 3" }} labelFormatter={(date) => `${date}`} />
              <Legend wrapperStyle={{ fontSize: 12, color: AXIS }} />
              <Line type="monotone" dataKey="total" name="إجمالي المواعيد" stroke={SERIES_1} strokeWidth={2} dot={false} activeDot={{ r: 5, stroke: "#fcfcfb", strokeWidth: 2 }} />
              <Line type="monotone" dataKey="completed" name="المنجزة" stroke={SERIES_2} strokeWidth={2} dot={false} activeDot={{ r: 5, stroke: "#fcfcfb", strokeWidth: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="خروج السيارات حسب الساعة" subtitle={peak ? `الذروة الساعة ${peak.hour}:00 (${peak.trips} رحلة)` : undefined}>
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
        </Card>
        <Card title="متوسط المواعيد حسب اليوم" subtitle="إجمالي الرحلات ÷ عدد أيام العمل لكل يوم">
          <div dir="ltr" className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weekdays} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="weekday" reversed {...axisProps} />
                <YAxis {...axisProps} allowDecimals={false} />
                <Tooltip {...tooltipStyle} formatter={(value, _name, item) => [`${value} يوميًا (${item.payload.days} يوم)`, "المتوسط"]} />
                <Bar dataKey="average" fill={SERIES_1} radius={[4, 4, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card title="أكثر الوجهات طلبًا" subtitle="الرحلات المنجزة لكل وجهة">
          <div className="mb-3 flex justify-end"><button onClick={() => setShowTable((value) => !value)} className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-bold text-slate-600 hover:bg-slate-50">{showTable ? "عرض كمخطط" : "عرض كجدول"}</button></div>
          {showTable ? (
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-right text-xs">
                <thead className="sticky top-0 bg-white text-slate-500"><tr><th className="py-2">الوجهة</th><th>المنطقة</th><th>الرحلات</th><th>متوسط المدة</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {summary.destinations.map((item) => <tr key={item.key}><td className="py-2 font-bold text-slate-700">{item.name}</td><td className="text-slate-500">{item.zone ?? "أخرى"}</td><td>{item.trips}</td><td>{item.avgMinutes ? `${item.avgMinutes} د` : "—"}</td></tr>)}
                </tbody>
              </table>
            </div>
          ) : (
            <div dir="ltr" style={{ height: topDestinations.length * 30 + 20 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topDestinations} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 8 }}>
                  <CartesianGrid stroke={GRID} horizontal={false} />
                  <XAxis type="number" {...axisProps} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" orientation="right" width={170} {...axisProps} tick={{ fill: AXIS, fontSize: 11 }} />
                  <Tooltip {...tooltipStyle} formatter={(value, _name, item) => [`${value} رحلة${item.payload.avgMinutes ? ` · متوسط ${item.payload.avgMinutes} د` : ""}`, item.payload.zone ?? "وجهة أخرى"]} />
                  <Bar dataKey="trips" fill={SERIES_1} radius={[4, 0, 0, 4]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <div className="space-y-5">
          <Card title="الرحلات حسب المنطقة" subtitle="المستشفيات المتجاورة مجمّعة في منطقة واحدة">
            <ul className="space-y-2">
              {summary.zones.map((zone) => {
                const share = Math.round((zone.trips / summary.completedTrips) * 100);
                return (
                  <li key={zone.zone}>
                    <div className="flex justify-between text-xs"><span className="font-bold text-slate-700">{zone.zone}</span><span className="text-slate-500">{zone.trips} · {share}%</span></div>
                    <div className="mt-1 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full" style={{ width: `${share}%`, background: SERIES_1 }} /></div>
                  </li>
                );
              })}
            </ul>
          </Card>
          <Card title="نوع المركبة">
            <ul className="space-y-2 text-sm">
              {summary.byKind.map((item) => <li key={item.kind} className="flex justify-between"><span className="text-slate-600">{item.kind}</span><b>{item.trips} <span className="text-xs font-normal text-slate-400">({Math.round((item.trips / summary.completedTrips) * 100)}%)</span></b></li>)}
            </ul>
          </Card>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="السيارات الأكثر عملًا">
          <ul className="max-h-72 divide-y divide-slate-100 overflow-auto text-sm">
            {summary.vehicles.slice(0, 20).map((item) => <li key={item.plate} className="flex justify-between py-2"><span><b dir="ltr">{item.plate}</b> <span className="text-xs text-slate-500">{item.driver}</span></span><b>{item.trips}</b></li>)}
          </ul>
        </Card>
        <Card title="المباني الأكثر طلبًا">
          <ul className="grid max-h-72 grid-cols-2 gap-x-6 overflow-auto text-sm">
            {summary.buildings.slice(0, 20).map((item) => <li key={item.building} className="flex justify-between border-b border-slate-100 py-2"><span>مبنى {item.building}</span><b>{item.trips}</b></li>)}
          </ul>
        </Card>
      </div>
    </div>
  );
}

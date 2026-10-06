import type { ReactNode } from "react";
import { Ban, ClipboardCheck, Home, ListChecks, Users, Wrench } from "lucide-react";
import { CANCEL_STAGES, OUTCOMES, RETURN_OUTCOMES, type OperationsSummary } from "@shared/operations";
import type { StatsFilter } from "@shared/stats";
import { VEHICLE_FAULT_REASONS, personsText } from "@shared/transport";
import { Panel, cx } from "./ui-kit";

const count = (value: number) => value.toLocaleString("en");
const share = (part: number, total: number) => (total ? Math.round((part / total) * 100) : 0);

/** العدد مع المعدود بالعربية: طلب واحد، طلبان، 3 طلبات، 11 طلبًا */
const counted = (value: number, [one, two, few, many]: [string, string, string, string]) =>
  value === 1 ? `${one} ${one.endsWith("ة") ? "واحدة" : "واحد"}` : value === 2 ? two : value >= 3 && value <= 10 ? `${value} ${few}` : `${count(value)} ${many}`;
const REQUESTS: [string, string, string, string] = ["طلب", "طلبان", "طلبات", "طلبًا"];
const SEATS: [string, string, string, string] = ["مقعد", "مقعدان", "مقاعد", "مقعدًا"];
const TRIPS: [string, string, string, string] = ["رحلة", "رحلتان", "رحلات", "رحلة"];
const APPOINTMENTS: [string, string, string, string] = ["موعد", "موعدان", "مواعيد", "موعدًا"];

/** مدة الانتظار: دقائق، أو ساعات ودقائق، أو أيام وساعات */
export function waitText(minutes: number) {
  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded} د`;
  const hours = Math.floor(rounded / 60);
  if (hours < 24) return rounded % 60 ? `${hours} س ${rounded % 60} د` : `${hours} س`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days} يوم ${hours % 24} س` : `${days} يوم`;
}

type BarTone = "green" | "red" | "amber" | "neutral" | "blue";
const BAR: Record<BarTone, string> = { green: "bg-emerald-500", red: "bg-red-400", amber: "bg-amber-400", neutral: "bg-slate-300", blue: "bg-[#2a78d6]" };

/** صف بعنوان وشرح ورقم ونسبة، وشريط بطول الرقم (العنوان مكتوب دائمًا فلا يُعتمد على اللون وحده) */
function BarRow({ label, hint, value, total, max, tone, onClick }: { label: string; hint?: string; value: number; total: number; max: number; tone: BarTone; onClick?: () => void }) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3 text-sm">
        <span className="min-w-0 text-start">
          <span className="font-medium text-ink">{label}</span>
          {hint && <span className="block text-xs leading-5 text-slate-500">{hint}</span>}
        </span>
        <span className="shrink-0 text-end">
          <span className="font-semibold tabular text-ink">{count(value)}</span>
          <span className="block text-xs tabular text-slate-500">{share(value, total)}%</span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 rounded-full bg-slate-100"><div className={cx("h-1.5 rounded-full", BAR[tone])} style={{ width: `${max ? (value / max) * 100 : 0}%` }} /></div>
    </>
  );
  return <li>{onClick ? <button type="button" onClick={onClick} className="block w-full rounded-lg text-start hover:bg-slate-50">{body}</button> : body}</li>;
}

/** رقم كبير بعنوان في مربع رمادي فاتح */
function Kpi({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-inset ring-slate-200/70">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 text-2xl font-bold tabular text-ink">{value}</p>
      {note && <p className="text-xs leading-5 text-slate-500">{note}</p>}
    </div>
  );
}

/** قائمة أسماء بعددها (الأسباب ومن ألغى): أول 6 ثم «أخرى» */
function NameList({ title, items, total, tone, empty }: { title: string; items: { name: string; count: number }[]; total: number; tone: BarTone; empty: string }) {
  const top = items.slice(0, 6);
  const rest = items.slice(6).reduce((sum, item) => sum + item.count, 0);
  const rows = rest ? [...top, { name: `${count(items.length - 6)} أخرى`, count: rest }] : top;
  const max = Math.max(1, ...rows.map((item) => item.count));
  return (
    <section aria-label={title}>
      <h3 className="mb-2 text-xs font-semibold text-slate-500">{title}</h3>
      {rows.length ? (
        <ul className="space-y-3">{rows.map((item) => <BarRow key={item.name} label={item.name} value={item.count} total={total} max={max} tone={tone} />)}</ul>
      ) : <p className="text-sm text-slate-400">{empty}</p>}
    </section>
  );
}

/**
 * سير العمل في الإحصائيات (رحلات النظام فقط): مصير المواعيد، والإلغاء ومرحلته، والعودة إلى المجمع،
 * وجمع الضيوف وإشغال المقاعد، وتغيير السيارات وإزالة الضيوف، وموافقة مسؤول العيادة.
 */
export default function OperationsStats({ ops, onFilter }: { ops: OperationsSummary; onFilter?: (patch: Partial<StatsFilter>) => void }) {
  if (!ops.appointments) return null;
  const total = ops.appointments;
  const outcomes = ops.outcomes.filter((item) => item.count || item.outcome === "served");
  const maxOutcome = Math.max(1, ...outcomes.map((item) => item.count));
  const unserved = ops.outcomes.filter((item) => item.outcome !== "served" && item.outcome !== "open").reduce((sum, item) => sum + item.count, 0);
  const cancel = ops.cancel;
  const returns = ops.returns;
  const maxReturn = Math.max(1, ...returns.items.map((item) => item.count));
  const grouping = ops.grouping;
  const incidents = ops.incidents;
  const approval = ops.approval;
  const loading = cancel.stages === null;

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          icon={ListChecks}
          title="مصير المواعيد"
          count={total}
          description={`لم يُخدم بسيارة: ${count(unserved)} من ${count(total)} (${share(unserved, total)}%) · من مواعيد النظام في الفترة والفلاتر المختارة`}
          bodyClassName="p-4 sm:p-5"
        >
          <ul className="space-y-3">
            {outcomes.map((item) => {
              const meta = OUTCOMES.find((entry) => entry.outcome === item.outcome)!;
              return <BarRow key={item.outcome} label={meta.label} hint={meta.hint} value={item.count} total={total} max={maxOutcome} tone={meta.tone} />;
            })}
          </ul>
        </Panel>

        <Panel
          icon={Home}
          title="العودة إلى المجمع"
          count={returns.total || undefined}
          description={returns.total ? `كيف عاد إلى المجمع من استُلم في رحلة الذهاب (${count(returns.total)})` : "لا يوجد ضيوف استُلموا في رحلة الذهاب في هذه الفترة"}
          bodyClassName="p-4 sm:p-5"
        >
          {returns.total ? (
            <ul className="space-y-3">
              {returns.items.filter((item) => item.count || item.outcome === "car").map((item) => {
                const meta = RETURN_OUTCOMES.find((entry) => entry.outcome === item.outcome)!;
                return <BarRow key={item.outcome} label={meta.label} hint={meta.hint} value={item.count} total={returns.total} max={maxReturn} tone={meta.tone} />;
              })}
            </ul>
          ) : <p className="py-6 text-center text-sm text-slate-400">لا توجد بيانات لهذه الفترة</p>}
        </Panel>
      </div>

      <Panel
        tone={cancel.total ? "red" : "neutral"}
        icon={Ban}
        title="إلغاء المواعيد"
        count={cancel.total || undefined}
        description={`أُلغي ${count(cancel.total)} من ${count(total)} (${share(cancel.total, total)}%) · المرحلة من سجل العمليات`}
        bodyClassName="p-0"
      >
        <div className="grid gap-px bg-slate-100 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_240px]">
          <div className="space-y-5 bg-white p-4 sm:p-5">
            <section aria-label="متى أُلغي">
              <h3 className="mb-2 text-xs font-semibold text-slate-500">متى أُلغي</h3>
              {cancel.stages ? (
                <ul className="space-y-3">
                  {CANCEL_STAGES.map((meta) => {
                    const value = cancel.stages!.find((item) => item.stage === meta.stage)!.count;
                    const max = Math.max(1, ...cancel.stages!.map((item) => item.count));
                    return <BarRow key={meta.stage} label={meta.label} hint={meta.hint} value={value} total={cancel.total} max={max} tone={meta.stage === "dispatched" || meta.stage === "atPickup" ? "red" : "neutral"} />;
                  })}
                </ul>
              ) : <p className="text-sm text-slate-400">{loading ? "جارٍ تحميل سجل العمليات…" : "—"}</p>}
            </section>
          </div>
          <div className="space-y-5 bg-white p-4 sm:p-5">
            <NameList title="سبب الإلغاء" items={cancel.reasons} total={cancel.total} tone="red" empty="لا توجد مواعيد ملغاة" />
            <NameList title="من ألغى" items={cancel.by} total={cancel.total} tone="neutral" empty="—" />
          </div>
          <div className="order-first space-y-3 bg-white p-4 sm:p-5 md:order-none">
            <Kpi label="مواعيد ملغاة" value={<>{count(cancel.total)} <span className="text-sm font-medium text-slate-500">{share(cancel.total, total)}%</span></>} />
            <Kpi
              label="سيارات أُرسلت ثم أُلغي طلبها"
              value={cancel.wastedCars === null ? "—" : count(cancel.wastedCars)}
              note="رحلات ضائعة: أُلغي الموعد أو طلب السيارة بعد إرسالها"
            />
          </div>
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          icon={Users}
          title="جمع الضيوف وإشغال المقاعد"
          count={grouping.trips || undefined}
          description="الرحلة المجمّعة رحلة سيارة واحدة · الإشغال: الأشخاص (الضيف والمرافق والـ Nurse) من مقاعد السيارة المعتمدة"
          bodyClassName="p-4 sm:p-5"
        >
          {grouping.trips ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Kpi label="رحلات السيارات" value={count(grouping.trips)} note={`لـ ${counted(grouping.requests, REQUESTS)} سيارة`} />
                <Kpi
                  label="رحلات مجمّعة"
                  value={<>{count(grouping.grouped)} <span className="text-sm font-medium text-slate-500">{share(grouping.grouped, grouping.trips)}%</span></>}
                  note={grouping.grouped ? `فيها ${counted(grouping.groupedRequests, REQUESTS)} · وفّر الجمع ${counted(grouping.requests - grouping.trips, TRIPS)}` : "لم تُجمع رحلات في هذه الفترة"}
                />
                <Kpi label="متوسط الأشخاص في الرحلة" value={(grouping.persons / grouping.trips).toFixed(1)} note={personsText(grouping.persons)} />
                <Kpi label="إشغال المقاعد" value={`${share(grouping.persons, grouping.seats)}%`} note={`${personsText(grouping.persons)} في ${counted(grouping.seats, SEATS)}`} />
              </div>
              <table className="mt-4 w-full text-start text-sm">
                <thead className="text-xs text-slate-500">
                  <tr>
                    <th className="py-2 text-start font-medium">نوع السيارة</th>
                    <th className="py-2 text-start font-medium">الرحلات</th>
                    <th className="py-2 text-start font-medium">المجمّعة</th>
                    <th className="py-2 text-start font-medium">متوسط الأشخاص</th>
                    <th className="py-2 text-start font-medium">الإشغال</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {grouping.byKind.map((item) => (
                    <tr key={item.kind} onClick={onFilter ? () => onFilter({ kind: item.kind }) : undefined} className={onFilter ? "cursor-pointer hover:bg-slate-50" : undefined}>
                      <td className="py-2 font-medium text-ink">{item.kind}</td>
                      <td className="py-2 tabular">{count(item.trips)}</td>
                      <td className="py-2 tabular">{count(item.grouped)} <span className="text-xs text-slate-500">{share(item.grouped, item.trips)}%</span></td>
                      <td className="py-2 tabular">{(item.persons / Math.max(1, item.trips)).toFixed(1)}</td>
                      <td className="py-2 tabular">{share(item.persons, item.seats)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : <p className="py-6 text-center text-sm text-slate-400">لا توجد رحلات سيارات من النظام في هذه الفترة</p>}
        </Panel>

        <Panel
          tone={approval.excluded || approval.pendingPast ? "amber" : "neutral"}
          icon={ClipboardCheck}
          title="موافقة مسؤول العيادة"
          count={approval.total || undefined}
          description="المواعيد الطبية (بلا طلب العودة فقط والرحلات غير الطبية) · الانتظار من إضافة الموعد حتى الموافقة"
          bodyClassName="p-4 sm:p-5"
        >
          {approval.total ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Kpi label="موافق عليها" value={<>{count(approval.approved)} <span className="text-sm font-medium text-slate-500">{share(approval.approved, approval.total)}%</span></>} note={approval.direct ? `منها ${count(approval.direct)} أضافها المسؤول بنفسه` : undefined} />
                <Kpi label="مستبعدة" value={<>{count(approval.excluded)} <span className="text-sm font-medium text-slate-500">{share(approval.excluded, approval.total)}%</span></>} />
                <Kpi label="بانتظار الموافقة" value={count(approval.pending)} note={approval.pendingPast ? `منها ${count(approval.pendingPast)} فات وقتها بلا موافقة` : "لم يفت وقت أي منها"} />
                <Kpi
                  label="متوسط انتظار الموافقة"
                  value={approval.avgWaitMinutes === null ? "—" : waitText(approval.avgWaitMinutes)}
                  note={approval.medianWaitMinutes === null ? "لا توجد مواعيد انتظرت الموافقة بوقت إضافة محفوظ" : `الوسيط ${waitText(approval.medianWaitMinutes)} · من ${counted(approval.waited, APPOINTMENTS)}`}
                />
              </div>
              {approval.people.length > 0 && (
                <table className="mt-4 w-full text-start text-sm">
                  <thead className="text-xs text-slate-500">
                    <tr>
                      <th className="py-2 text-start font-medium">المسؤول</th>
                      <th className="py-2 text-start font-medium">موافقة</th>
                      <th className="py-2 text-start font-medium">استبعاد</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {approval.people.map((item) => (
                      <tr key={item.name}>
                        <td className="py-2 font-medium text-ink">{item.name}</td>
                        <td className="py-2 tabular">{count(item.approved)}</td>
                        <td className="py-2 tabular">{count(item.excluded)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : <p className="py-6 text-center text-sm text-slate-400">لا توجد مواعيد طبية من العيادة في هذه الفترة</p>}
        </Panel>
      </div>

      <Panel
        tone={incidents.faults ? "red" : "neutral"}
        icon={Wrench}
        title="تغيير السيارات وإزالة الضيوف من الرحلات"
        count={incidents.changes === null ? undefined : (incidents.changes + (incidents.removals ?? 0)) || undefined}
        description={`تغيير سيارة رحلة بعد إرسالها (الرحلة المجمّعة مرة واحدة)، وإزالة ضيف من رحلة جارية · من سجل العمليات`}
        bodyClassName="p-0"
      >
        {incidents.changes === null ? (
          <p className="p-5 text-sm text-slate-400">{loading ? "جارٍ تحميل سجل العمليات…" : "—"}</p>
        ) : incidents.changes || incidents.removals ? (
          <div className="grid gap-px bg-slate-100 md:grid-cols-[240px_minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-3 bg-white p-4 sm:p-5">
              <Kpi label="تغيير السيارة" value={count(incidents.changes)} note={`منها ${count(incidents.faults)} ${VEHICLE_FAULT_REASONS.join(" أو ")}`} />
              <Kpi label="إزالة ضيف من رحلة" value={count(incidents.removals ?? 0)} note="عاد طلبه إلى «بانتظار التوزيع»" />
            </div>
            <div className="space-y-5 bg-white p-4 sm:p-5">
              <NameList title="سبب تغيير السيارة" items={incidents.changeReasons} total={incidents.changes} tone="red" empty="لم تتغير سيارة أي رحلة" />
              <NameList title="سبب إزالة الضيف" items={incidents.removeReasons} total={incidents.removals ?? 0} tone="amber" empty="لم يُزل ضيف من أي رحلة" />
            </div>
            <div className="bg-white p-4 sm:p-5">
              <h3 className="mb-2 text-xs font-semibold text-slate-500">حسب السيارة</h3>
              <table className="w-full text-start text-sm">
                <thead className="text-xs text-slate-500">
                  <tr>
                    <th className="py-2 text-start font-medium">السيارة</th>
                    <th className="py-2 text-start font-medium" title="تغيّرت هذه السيارة في رحلة بعد إرسالها">تغييرها</th>
                    <th className="py-2 text-start font-medium">منها أعطال</th>
                    <th className="py-2 text-start font-medium" title="أُزيل ضيف من رحلة هذه السيارة">إزالة ضيف</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {incidents.vehicles.slice(0, 12).map((item) => (
                    <tr key={item.plate}>
                      <td className="py-2 font-semibold text-ink"><span dir="ltr">{item.plate}</span></td>
                      <td className="py-2 tabular">{count(item.changes)}</td>
                      <td className={cx("py-2 tabular", item.faults ? "font-semibold text-red-700" : "")}>{count(item.faults)}</td>
                      <td className="py-2 tabular">{count(item.removals)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : <p className="p-5 text-sm text-slate-400">لم تتغير سيارة أي رحلة ولم يُزل ضيف من رحلة في هذه الفترة</p>}
      </Panel>
    </div>
  );
}

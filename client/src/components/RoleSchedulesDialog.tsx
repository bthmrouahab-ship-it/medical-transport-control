import { useMemo, useState } from "react";
import { Bus, CalendarClock, CheckCircle2, Plus, RotateCcw, School, Trash2 } from "lucide-react";
import {
  DAY_MINUTES,
  DEFAULT_SCHEDULES,
  MAX_RESERVED_RUNS,
  SCHEDULED_ROLES,
  WEEKDAY_NAMES,
  clockOf,
  isAllDay,
  scheduleOf,
  scheduleText,
  type ReservedRun,
  type RoleSchedule,
  type RoleSchedules,
  type ScheduledRole,
} from "@shared/transport";
import { Modal, btn, cx, inputClass } from "./ui-kit";

/** أوقات تخصيص قيد التعديل: الأوقات نصوص «HH:MM» من حقول الوقت */
type Draft = { days: number[]; allDay: boolean; runs: { from: string; to: string }[] };

const LABELS: Record<ScheduledRole, { title: string; hint: string; icon: typeof School }> = {
  school: { title: "سيارات المدارس", hint: "إيصال الأولاد إلى المدارس وإرجاعهم", icon: School },
  nonMedical: { title: "باص الجامعة", hint: "لا يُرسل في الرحلات الطبية ولا غير الطبية في أوقاته", icon: Bus },
};

const toDraft = (schedule: RoleSchedule): Draft => ({
  days: [...schedule.days],
  allDay: schedule.runs.length === 1 && isAllDay(schedule.runs[0]),
  runs: schedule.runs.filter((run) => !isAllDay(run)).map((run) => ({ from: clockOf(run.from), to: run.to >= DAY_MINUTES ? "00:00" : clockOf(run.to) })),
});

const minutesOf = (time: string) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

/** الأوقات المكتوبة إلى RoleSchedule مرتبة، أو سبب عدم صلاحيتها. نهاية «00:00» تعني منتصف الليل (نهاية اليوم). */
function fromDraft(draft: Draft): { schedule: RoleSchedule } | { error: string } {
  const days = [...draft.days].sort((a, b) => a - b);
  if (draft.allDay) return { schedule: { days, runs: [{ from: 0, to: DAY_MINUTES }] } };
  const runs: ReservedRun[] = [];
  for (const run of draft.runs) {
    const from = minutesOf(run.from);
    const end = minutesOf(run.to);
    if (from === null || end === null) return { error: "اكتب وقت البداية والنهاية لكل وقت" };
    const to = end === 0 ? DAY_MINUTES : end;
    if (to <= from) return { error: `وقت النهاية بعد البداية (${run.from}–${run.to})` };
    runs.push({ from, to });
  }
  runs.sort((a, b) => a.from - b.from);
  const overlap = runs.find((run, index) => index > 0 && run.from < runs[index - 1].to);
  if (overlap) return { error: `الأوقات متداخلة عند ${clockOf(overlap.from)}` };
  return { schedule: { days, runs } };
}

const same = (a: RoleSchedule, b: RoleSchedule) => JSON.stringify(a) === JSON.stringify(b);

/**
 * أوقات سيارات المدارس وباص الجامعة (مشرف السيارات): الأيام، وأوقات كل يوم أو «طوال اليوم». في هذه الأوقات لا تُرسل
 * السيارة في أي رحلة وتبقى في الخدمة. تُحفظ للجميع (meta/schedules) دفعة واحدة.
 */
export default function RoleSchedulesDialog({ schedules, counts, onSave, onClose }: {
  schedules: RoleSchedules | null;
  /** عدد السيارات المخصصة لكل تخصيص الآن */
  counts: Record<ScheduledRole, number>;
  onSave: (next: RoleSchedules) => void;
  onClose: () => void;
}) {
  const saved = useMemo(() => Object.fromEntries(SCHEDULED_ROLES.map((role) => [role, scheduleOf(schedules, role)])) as Record<ScheduledRole, RoleSchedule>, [schedules]);
  const [drafts, setDrafts] = useState<Record<ScheduledRole, Draft>>(() => Object.fromEntries(SCHEDULED_ROLES.map((role) => [role, toDraft(saved[role])])) as Record<ScheduledRole, Draft>);
  const results = Object.fromEntries(SCHEDULED_ROLES.map((role) => [role, fromDraft(drafts[role])])) as Record<ScheduledRole, ReturnType<typeof fromDraft>>;
  const valid = SCHEDULED_ROLES.every((role) => "schedule" in results[role]);
  const changed = SCHEDULED_ROLES.filter((role) => {
    const result = results[role];
    return "schedule" in result && !same(result.schedule, saved[role]);
  });

  const update = (role: ScheduledRole, patch: (draft: Draft) => Draft) => setDrafts((current) => ({ ...current, [role]: patch(current[role]) }));
  const toggleDay = (role: ScheduledRole, day: number) => update(role, (draft) => ({
    ...draft, days: draft.days.includes(day) ? draft.days.filter((item) => item !== day) : [...draft.days, day],
  }));
  const setRun = (role: ScheduledRole, index: number, field: "from" | "to", value: string) => update(role, (draft) => ({
    ...draft, runs: draft.runs.map((run, at) => (at === index ? { ...run, [field]: value } : run)),
  }));

  function save() {
    if (!valid) return;
    onSave(Object.fromEntries(SCHEDULED_ROLES.map((role) => [role, (results[role] as { schedule: RoleSchedule }).schedule])) as RoleSchedules);
  }

  return (
    <Modal
      tone="violet"
      icon={CalendarClock}
      title="أوقات سيارات المدارس وباص الجامعة"
      description="في هذه الأوقات لا تُرسل السيارة في أي رحلة، وتبقى في الخدمة فلا تقل ساعات عملها في الإحصائيات."
      onClose={onClose}
      footer={(
        <>
          <p className="me-auto self-center text-xs text-slate-500">{changed.length ? `تغيّرت أوقات ${changed.map((role) => LABELS[role].title).join(" و")}` : "لا تغيير بعد"}</p>
          <button type="button" onClick={onClose} className={btn("secondary")}>إلغاء</button>
          <button type="button" disabled={!valid || !changed.length} onClick={save} className={btn("primary")}><CheckCircle2 className="h-4 w-4" /> حفظ الأوقات</button>
        </>
      )}
    >
      <div className="space-y-4">
        {SCHEDULED_ROLES.map((role) => {
          const draft = drafts[role];
          const result = results[role];
          const label = LABELS[role];
          const IconComponent = label.icon;
          const isDefault = "schedule" in result && same(result.schedule, DEFAULT_SCHEDULES[role]);
          return (
            <fieldset key={role} aria-label={`أوقات ${label.title}`} className="rounded-xl bg-slate-50 p-4 ring-1 ring-inset ring-slate-200">
              <legend className="sr-only">أوقات {label.title}</legend>
              <div className="flex items-start gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700"><IconComponent className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">{label.title}</p>
                  <p className="text-xs leading-5 text-slate-500">
                    {label.hint} · {counts[role] ? `${counts[role] === 1 ? "سيارة واحدة مخصصة" : counts[role] === 2 ? "سيارتان مخصصتان" : `${counts[role]} سيارات مخصصة`}` : "لا توجد سيارة مخصصة الآن"}
                  </p>
                </div>
                {!isDefault && (
                  <button type="button" onClick={() => update(role, () => toDraft(DEFAULT_SCHEDULES[role]))} className={btn("ghost", "sm")} title={scheduleText(DEFAULT_SCHEDULES[role])}>
                    <RotateCcw className="h-3.5 w-3.5" /> الافتراضي
                  </button>
                )}
              </div>

              <p className="mb-1.5 mt-3 text-[13px] font-medium text-slate-700">الأيام</p>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAY_NAMES.map((name, day) => (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={draft.days.includes(day)}
                    aria-label={`${label.title}: ${name}`}
                    onClick={() => toggleDay(role, day)}
                    className={cx("h-8 rounded-lg px-2.5 text-xs font-medium ring-inset transition",
                      draft.days.includes(day) ? "bg-brand-50 text-brand-700 ring-2 ring-brand-600" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100")}
                  >
                    {name}
                  </button>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[13px] font-medium text-slate-700">الأوقات</p>
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={draft.allDay}
                    aria-label={`${label.title}: طوال اليوم`}
                    onChange={(event) => update(role, (current) => ({
                      ...current,
                      allDay: event.target.checked,
                      runs: !event.target.checked && !current.runs.length ? [{ from: "", to: "" }] : current.runs,
                    }))}
                    className="h-4 w-4 accent-brand-600"
                  />
                  طوال اليوم
                </label>
              </div>
              {!draft.allDay && (
                <ul className="mt-2 space-y-2">
                  {draft.runs.map((run, index) => (
                    <li key={index} className="flex items-center gap-2">
                      <label className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-slate-500">
                        من
                        <input type="time" value={run.from} aria-label={`${label.title}: بداية الوقت ${index + 1}`} onChange={(event) => setRun(role, index, "from", event.target.value)} className={cx(inputClass, "h-9 min-w-0 bg-white px-2 tabular")} />
                      </label>
                      <label className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-slate-500">
                        إلى
                        <input type="time" value={run.to} aria-label={`${label.title}: نهاية الوقت ${index + 1}`} onChange={(event) => setRun(role, index, "to", event.target.value)} className={cx(inputClass, "h-9 min-w-0 bg-white px-2 tabular")} />
                      </label>
                      <button
                        type="button"
                        aria-label={`${label.title}: حذف الوقت ${index + 1}`}
                        onClick={() => update(role, (current) => ({ ...current, runs: current.runs.filter((_, at) => at !== index) }))}
                        className={cx(btn("ghost", "sm"), "w-9 shrink-0 px-0 text-slate-500 hover:text-red-700")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                  <li>
                    <button
                      type="button"
                      disabled={draft.runs.length >= MAX_RESERVED_RUNS}
                      onClick={() => update(role, (current) => ({ ...current, runs: [...current.runs, { from: "", to: "" }] }))}
                      className={btn("secondary", "sm")}
                    >
                      <Plus className="h-3.5 w-3.5" /> إضافة وقت
                    </button>
                  </li>
                </ul>
              )}

              <p role="status" className={cx("mt-3 text-xs leading-5", "error" in result ? "font-medium text-red-700" : "text-slate-600")}>
                {"error" in result ? result.error : <>محجوزة: <span className="font-semibold text-ink">{scheduleText(result.schedule)}</span>{!result.schedule.days.length || !result.schedule.runs.length ? " (تُرسل في أي وقت)" : ""}</>}
              </p>
            </fieldset>
          );
        })}
      </div>
    </Modal>
  );
}

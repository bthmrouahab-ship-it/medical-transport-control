import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, FileSpreadsheet, FilterX, Loader2, Lock, Pencil, Search, BriefcaseMedical, Trash2, Upload, UserPlus, UsersRound, X } from "lucide-react";
import {
  NURSE_APARTMENT,
  NURSE_BUILDING,
  NURSE_LABEL,
  guestIndex,
  guestOfAppointment,
  isNurse,
  normalizeAge,
  normalizeGuestMobile,
  normalizeHealthNumber,
  normalizeUnit,
  parseGuestRows,
  parseNurseRows,
  planGuestImport,
  tableRows,
  searchGuests,
  validateGuest,
  type Guest,
  type GuestRecord,
} from "@shared/guests";
import { GENDERS, localDateString, type ClinicAppointment, type Gender } from "@shared/transport";
import { loadState, saveState } from "@/lib/appStore";
import { api } from "@/lib/api";
import { authErrorMessage } from "@/lib/auth";
import { useGuests } from "@/lib/useShared";
import { Badge, EmptyState, Panel, PageHeader, btn, cx, inputClass, labelClass } from "./ui-kit";

const PAGE = 50;
const WAITING = "بانتظار طلب السيارة";
const COLUMNS_HINT = "الاسم باللغة العربية، الاسم باللغة الإنجليزية، الجنس، العمر، الرقم الصحي، رقم الهاتف، رقم المبنى، رقم الشقة";
const NURSE_COLUMNS_HINT = "الاسم كامل عربي، الاسم انجليزي، رقم الجوال، الجهة/المؤسسة";

/** nurses: قائمة الممرضات (تُقارن بالممرضات فقط، وملف الضيوف بالضيوف فقط) */
type ImportPreview = { fileName: string; nurses: boolean; plan: ReturnType<typeof planGuestImport>; errors: string[]; removeMissing: boolean };
type KindFilter = "all" | "guests" | "nurses";

/** ترتيب المباني: الأرقام أولًا بترتيبها ثم R1 وR2 */
const byUnit = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

/**
 * قائمة ضيوف المجمع (لمدير النظام): رفع ملف Excel، والبحث، وتعديل المبنى والشقة، وإضافة ضيف وحذفه.
 * العمر والرقم الصحي يُحفظان مع الضيف ولا يظهران هنا ولا عند طلب الموعد، بل في الإحصائيات فقط.
 */
export default function GuestManager() {
  const guests = useGuests();
  const fileInput = useRef<HTMLInputElement>(null);
  const nurseInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [building, setBuilding] = useState("all");
  const [kind, setKind] = useState<KindFilter>("all");
  const [limit, setLimit] = useState(PAGE);
  const [editing, setEditing] = useState<{ id: string; buildingNumber: string; apartmentNumber: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [reading, setReading] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [saving, setSaving] = useState(false);

  const buildings = useMemo(() => Array.from(new Set(guests.map((guest) => guest.buildingNumber))).sort(byUnit), [guests]);
  const nurseCount = useMemo(() => guests.filter(isNurse).length, [guests]);
  const filtering = Boolean(query.trim()) || building !== "all" || kind !== "all";
  const shown = useMemo(() => {
    const list = query.trim() ? searchGuests(guests, query, guests.length) : guests;
    return list.filter((guest) => (building === "all" || guest.buildingNumber === building)
      && (kind === "all" || isNurse(guest) === (kind === "nurses")));
  }, [guests, query, building, kind]);

  /** ملف الضيوف، أو قائمة الممرضات (نموذج إضافة البيانات: العناوين بعد عنوان النموذج، والسكن مبنى 03 شقة 001) */
  async function readFile(file: File | undefined, nurses: boolean) {
    if (!file) return;
    setReading(true);
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheets = workbook.SheetNames.map((name) => workbook.Sheets[name]).filter((item) => item["!ref"]);
      let parsed: ReturnType<typeof parseGuestRows>;
      if (nurses) {
        // أول ورقة فيها جدول بعمود الاسم
        const table = sheets.map((sheet) => tableRows(XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" }))).find((item) => item.rows.length);
        parsed = table ? parseNurseRows(table.rows, table.firstRow) : { guests: [], errors: [] };
      } else {
        // أول ورقة فيها بيانات
        parsed = parseGuestRows(sheets[0] ? XLSX.utils.sheet_to_json<Record<string, unknown>>(sheets[0], { defval: "" }) : []);
      }
      const { guests: incoming, errors } = parsed;
      if (!incoming.length) {
        toast.error(nurses ? "لم يُعثر على ممرضات في الملف" : "لم يُعثر على ضيوف في الملف", { description: errors[0] ?? `الأعمدة المطلوبة: ${nurses ? NURSE_COLUMNS_HINT : COLUMNS_HINT}`, duration: 12000 });
        return;
      }
      setPreview({ fileName: file.name, nurses, plan: planGuestImport(incoming, guests), errors, removeMissing: false });
      setAdding(false);
    } catch (error) {
      console.error("[guests] import", error);
      toast.error("تعذر قراءة الملف. تأكد أنه ملف Excel.");
    } finally {
      setReading(false);
      if (fileInput.current) fileInput.current.value = "";
      if (nurseInput.current) nurseInput.current.value = "";
    }
  }

  async function saveImport() {
    if (!preview) return;
    setSaving(true);
    try {
      const result = await api<{ added: number; updated: number; unchanged: number; removed: number }>("guests.import", {
        guests: JSON.parse(JSON.stringify(preview.plan.guests)),
        remove: preview.removeMissing ? preview.plan.missing.map((guest) => guest.id) : [],
        kind: preview.nurses ? "nurses" : "guests",
      });
      toast.success(preview.nurses ? "حُفظت قائمة الممرضات" : "حُفظت قائمة الضيوف", {
        description: `${result.added} جديد، ${result.updated} تحديث، ${result.unchanged} بلا تغيير${result.removed ? `، وحُذف ${result.removed}` : ""}. تظهر في الصفحة خلال ثوانٍ.`,
        duration: 8000,
      });
      setPreview(null);
    } catch (error) {
      toast.error(authErrorMessage(error, "تعذر حفظ قائمة الضيوف"));
    } finally {
      setSaving(false);
    }
  }

  /** المبنى والشقة الجديدان، ومعهما مواعيد الضيف القادمة التي لم يُطلب لها سيارة بعد */
  function saveUnit() {
    if (!editing) return;
    const guest = guests.find((item) => item.id === editing.id);
    if (!guest) return;
    const next: Guest = { ...guest, buildingNumber: normalizeUnit(editing.buildingNumber), apartmentNumber: normalizeUnit(editing.apartmentNumber) };
    const error = validateGuest(next, guests);
    if (error) {
      toast.error(error);
      return;
    }
    if (next.buildingNumber === guest.buildingNumber && next.apartmentNumber === guest.apartmentNumber) {
      setEditing(null);
      return;
    }
    const index = guestIndex(guests);
    saveState("fox_guests", guests.map((item) => (item.id === guest.id ? next : item)), guests);
    const today = localDateString();
    const appointments = loadState<ClinicAppointment[]>("fox_appointments", []);
    let moved = 0;
    const updated = appointments.map((appointment) => {
      if (appointment.status !== WAITING || appointment.appointmentDate < today || guestOfAppointment(index, appointment)?.id !== guest.id) return appointment;
      moved += 1;
      return { ...appointment, guestId: guest.id, buildingNumber: next.buildingNumber, apartmentNumber: next.apartmentNumber };
    });
    if (moved) saveState("fox_appointments", updated, appointments);
    toast.success(`حُفظ المبنى والشقة ${isNurse(guest) ? "للممرضة" : "للضيف"} ${guest.name}`, { description: moved ? `وتحدّثا في ${moved} ${moved === 1 ? "موعد قادم" : "مواعيد قادمة"} لم يُطلب لها سيارة بعد.` : undefined });
    setEditing(null);
  }

  function remove(guest: Guest) {
    const who = isNurse(guest) ? "الممرضة" : "الضيف";
    if (!window.confirm(`حذف ${who} ${guest.name} (مبنى ${guest.buildingNumber} شقة ${guest.apartmentNumber}) من القائمة؟\nلن يمكن إضافة مواعيد جديدة، وتبقى المواعيد السابقة كما هي.`)) return;
    saveState("fox_guests", guests.filter((item) => item.id !== guest.id), guests);
    toast.success(`حُذف${isNurse(guest) ? "ت" : ""} ${who} ${guest.name} من القائمة`);
  }

  function add(guest: GuestRecord) {
    const error = validateGuest(guest, guests);
    if (error) {
      toast.error(error);
      return false;
    }
    saveState("fox_guests", [...guests, JSON.parse(JSON.stringify(guest))], guests);
    toast.success(isNurse(guest) ? `أُضيفت الممرضة ${guest.name} إلى القائمة` : `أُضيف الضيف ${guest.name} إلى القائمة`);
    setAdding(false);
    return true;
  }

  const visible = shown.slice(0, limit);
  const cell = "px-4 py-3 align-middle";
  return (
    <>
      <PageHeader
        title="ضيوف المجمع والممرضات"
        subtitle="تُضاف المواعيد لضيوف هذه القائمة وممرضاتها فقط. العمر والرقم الصحي لا يظهران هنا ولا عند طلب الموعد، بل في الإحصائيات فقط."
        actions={(
          <>
            <input ref={fileInput} type="file" accept=".xlsx,.xls" className="hidden" onChange={(event) => readFile(event.target.files?.[0], false)} />
            <input ref={nurseInput} type="file" accept=".xlsx,.xls" className="hidden" onChange={(event) => readFile(event.target.files?.[0], true)} />
            <button type="button" disabled={reading} onClick={() => fileInput.current?.click()} className={btn("secondary")}>
              {reading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} رفع ملف الضيوف (Excel)
            </button>
            <button type="button" disabled={reading} onClick={() => nurseInput.current?.click()} className={btn("secondary")}>
              <BriefcaseMedical className="h-4 w-4" /> رفع قائمة الممرضات (Excel)
            </button>
            <button type="button" onClick={() => { setAdding(true); setPreview(null); }} className={btn("primary")}><UserPlus className="h-4 w-4" /> إضافة ضيف</button>
          </>
        )}
      />

      {preview && <ImportPreviewPanel preview={preview} saving={saving} onChange={setPreview} onSave={saveImport} onCancel={() => setPreview(null)} />}
      {adding && <NewGuestForm buildings={buildings} onAdd={add} onCancel={() => setAdding(false)} />}

      <Panel
        icon={UsersRound}
        title={nurseCount ? "قائمة الضيوف والممرضات" : "قائمة الضيوف"}
        count={filtering ? shown.length : guests.length}
        description={guests.length ? `${(guests.length - nurseCount).toLocaleString("en")} ضيف${nurseCount ? ` و${nurseCount.toLocaleString("en")} ممرضة` : ""} في ${buildings.length} مبنى${filtering ? ` · ${shown.length.toLocaleString("en")} مطابق` : ""}` : undefined}
        actions={filtering && <button type="button" onClick={() => { setQuery(""); setBuilding("all"); setKind("all"); setLimit(PAGE); }} className={btn("ghost", "sm")}><FilterX className="h-4 w-4" /> مسح الفلاتر</button>}
      >
        {guests.length > 0 && (
          <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-[minmax(0,1fr)_180px_200px] sm:px-5">
            <label className="relative block">
              <span className="sr-only">بحث في الضيوف</span>
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={query} onChange={(event) => { setQuery(event.target.value); setLimit(PAGE); }} placeholder="بحث: الاسم بالعربية أو الإنجليزية، المبنى والشقة، الهاتف..." className={cx(inputClass, "h-10 ps-9")} />
            </label>
            <select aria-label="المبنى" value={building} onChange={(event) => { setBuilding(event.target.value); setLimit(PAGE); }} className={cx(inputClass, "h-10", building !== "all" && "border-brand-600 bg-brand-50 text-brand-700")}>
              <option value="all">كل المباني</option>
              {buildings.map((item) => <option key={item} value={item}>مبنى {item}</option>)}
            </select>
            <select aria-label="النوع" value={kind} onChange={(event) => { setKind(event.target.value as KindFilter); setLimit(PAGE); }} className={cx(inputClass, "h-10", kind !== "all" && "border-brand-600 bg-brand-50 text-brand-700")}>
              <option value="all">الضيوف والممرضات</option>
              <option value="guests">الضيوف فقط</option>
              <option value="nurses">الممرضات فقط ({nurseCount})</option>
            </select>
          </div>
        )}

        {!guests.length ? (
          <EmptyState icon={FileSpreadsheet} title="لم تُرفع قائمة الضيوف بعد" hint={<>لا تستطيع العيادة إضافة موعد قبل رفعها. ارفع ملف Excel بالأعمدة: {COLUMNS_HINT}.</>} />
        ) : !shown.length ? (
          <EmptyState icon={Search} title="لا يوجد ضيف مطابق" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-start text-xs text-slate-500">
                  <th scope="col" className="px-4 py-2.5 text-start font-semibold">الضيف</th>
                  <th scope="col" className="px-4 py-2.5 text-start font-semibold">الجنس</th>
                  <th scope="col" className="px-4 py-2.5 text-start font-semibold">المبنى</th>
                  <th scope="col" className="px-4 py-2.5 text-start font-semibold">الشقة</th>
                  <th scope="col" className="px-4 py-2.5 text-start font-semibold">الهاتف</th>
                  <th scope="col" className="px-4 py-2.5 text-start font-semibold"><span className="sr-only">إجراءات</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((guest) => {
                  const edit = editing?.id === guest.id ? editing : null;
                  return (
                    <tr key={guest.id} className={cx("transition-colors hover:bg-slate-50/70", edit && "bg-brand-50/40 hover:bg-brand-50/40")}>
                      <td className={cell}>
                        <p className="flex flex-wrap items-center gap-1.5 font-medium text-ink">
                          {guest.name}
                          {isNurse(guest) && <Badge tone="violet" icon={BriefcaseMedical}>{NURSE_LABEL}</Badge>}
                        </p>
                        {(guest.nameEn || guest.organization) && <p className="text-xs text-slate-500">{guest.nameEn && <bdi>{guest.nameEn}</bdi>}{guest.nameEn && guest.organization ? " · " : ""}{guest.organization && <bdi>{guest.organization}</bdi>}</p>}
                      </td>
                      <td className={cx(cell, "text-slate-600")}>{guest.gender ?? <span className="text-slate-300">—</span>}</td>
                      {edit ? (
                        <>
                          <td className={cell}><div className="w-24"><input aria-label={`مبنى ${guest.name}`} value={edit.buildingNumber} onChange={(event) => setEditing({ ...edit, buildingNumber: event.target.value })} list="guest-buildings" dir="ltr" className={cx(inputClass, "h-9 bg-white ring-1 ring-inset ring-slate-300")} /></div></td>
                          <td className={cell}><div className="w-24"><input aria-label={`شقة ${guest.name}`} value={edit.apartmentNumber} onChange={(event) => setEditing({ ...edit, apartmentNumber: event.target.value })} onKeyDown={(event) => event.key === "Enter" && saveUnit()} dir="ltr" className={cx(inputClass, "h-9 bg-white ring-1 ring-inset ring-slate-300")} /></div></td>
                        </>
                      ) : (
                        <>
                          <td className={cx(cell, "font-medium tabular text-slate-700")}>{guest.buildingNumber}</td>
                          <td className={cx(cell, "tabular text-slate-700")}>{guest.apartmentNumber}</td>
                        </>
                      )}
                      <td className={cx(cell, "text-slate-600")}>{guest.mobile ? <span dir="ltr" className="tabular">{guest.mobile}</span> : <span className="text-slate-300">—</span>}</td>
                      <td className={cx(cell, "whitespace-nowrap")}>
                        {edit ? (
                          <div className="flex gap-1.5">
                            <button type="button" onClick={saveUnit} className={btn("success", "sm")}><Check className="h-3.5 w-3.5" /> حفظ</button>
                            <button type="button" onClick={() => setEditing(null)} aria-label="إلغاء التعديل" className={cx(btn("ghost", "sm"), "w-9 px-0")}><X className="h-4 w-4" /></button>
                          </div>
                        ) : (
                          <div className="flex gap-1.5">
                            <button type="button" onClick={() => setEditing({ id: guest.id, buildingNumber: guest.buildingNumber, apartmentNumber: guest.apartmentNumber })} className={btn("secondary", "sm")}><Pencil className="h-3.5 w-3.5" /> المبنى والشقة</button>
                            <button type="button" onClick={() => remove(guest)} aria-label={`حذف ${guest.name}`} title="حذف من القائمة" className={cx(btn("danger", "sm"), "w-9 px-0")}><Trash2 className="h-3.5 w-3.5" /></button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <datalist id="guest-buildings">{buildings.map((item) => <option key={item} value={item} />)}</datalist>
            {shown.length > visible.length && (
              <div className="flex items-center justify-center gap-3 border-t border-slate-100 p-3 text-xs text-slate-500">
                يظهر {visible.length.toLocaleString("en")} من {shown.length.toLocaleString("en")}
                <button type="button" onClick={() => setLimit((current) => current + PAGE * 4)} className={btn("secondary", "sm")}>عرض المزيد</button>
              </div>
            )}
          </div>
        )}
      </Panel>
    </>
  );
}

function ImportPreviewPanel({ preview, saving, onChange, onSave, onCancel }: {
  preview: ImportPreview;
  saving: boolean;
  onChange: (preview: ImportPreview) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { plan, errors, nurses } = preview;
  return (
    <Panel tone="amber" icon={nurses ? BriefcaseMedical : FileSpreadsheet} title={nurses ? "مراجعة قائمة الممرضات قبل الحفظ" : "مراجعة ملف الضيوف قبل الحفظ"} description={preview.fileName} className="mb-6" bodyClassName="space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap gap-2">
        <Badge tone="neutral">{plan.guests.length.toLocaleString("en")} {nurses ? "ممرضة" : "ضيف"} في الملف</Badge>
        <Badge tone="green">{plan.added.toLocaleString("en")} {nurses ? "جديدة" : "جديد"}</Badge>
        <Badge tone="blue">{plan.updated.toLocaleString("en")} {nurses ? "موجودة في القائمة (تُحدَّث بياناتها)" : "موجود في القائمة (تُحدَّث بياناته)"}</Badge>
        {errors.length > 0 && <Badge tone="red">{errors.length.toLocaleString("en")} صف لم يُقرأ</Badge>}
      </div>
      <p className="text-sm leading-6 text-slate-600">
        {nurses
          ? `كل الممرضات في مبنى ${NURSE_BUILDING} شقة ${NURSE_APARTMENT}، ويُطلب لهن سيارة مثل الضيوف. الممرضة الموجودة بنفس الاسم تُحدَّث بياناتها وتبقى مواعيدها مرتبطة بها. الرقم الشخصي والجنسية لا يُحفظان، وقائمة الضيوف لا تتغير.`
          : "الضيف الموجود بنفس الاسم تُحدَّث بياناته من الملف (ومنها المبنى والشقة)، وتبقى مواعيده مرتبطة به. العمر والرقم الصحي يُحفظان للإحصائيات فقط. قائمة الممرضات لا تتغير."}
      </p>
      {errors.length > 0 && (
        <ul className="max-h-40 space-y-1 overflow-y-auto rounded-xl bg-red-50 p-3 text-xs leading-5 text-red-800 ring-1 ring-inset ring-red-200">
          {errors.slice(0, 50).map((error) => <li key={error}>{error}</li>)}
          {errors.length > 50 && <li>و{errors.length - 50} أخرى</li>}
        </ul>
      )}
      {plan.missing.length > 0 && (
        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl bg-slate-50 p-3 text-sm text-slate-700 ring-1 ring-inset ring-slate-200">
          <input type="checkbox" checked={preview.removeMissing} onChange={(event) => onChange({ ...preview, removeMissing: event.target.checked })} className="mt-0.5 h-4 w-4 accent-brand-600" />
          <span>
            حذف {plan.missing.length.toLocaleString("en")} {nurses ? (plan.missing.length === 1 ? "ممرضة موجودة" : "ممرضات موجودات") : plan.missing.length === 1 ? "ضيف موجود" : "ضيوف موجودين"} في القائمة وغير {nurses ? "موجودات" : "موجودين"} في الملف
            <span className="block text-xs text-slate-500">{nurses ? "مثل من انتهى عملها. تبقى المواعيد السابقة، ولا تُضاف مواعيد جديدة." : "مثل من غادر المجمع. تبقى مواعيدهم السابقة، ولا تُضاف لهم مواعيد جديدة."}</span>
          </span>
        </label>
      )}
      <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
        <button type="button" disabled={saving} onClick={onSave} className={btn("primary")}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} حفظ القائمة
        </button>
        <button type="button" disabled={saving} onClick={onCancel} className={btn("secondary")}>إلغاء</button>
      </div>
    </Panel>
  );
}

function NewGuestForm({ buildings, onAdd, onCancel }: { buildings: string[]; onAdd: (guest: GuestRecord) => boolean; onCancel: () => void }) {
  const [form, setForm] = useState({ name: "", nameEn: "", gender: "" as Gender | "", age: "", healthNumber: "", mobile: "", buildingNumber: "", apartmentNumber: "", nurse: false });
  const set = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (form.age.trim() && normalizeAge(form.age) === undefined) {
      toast.error("العمر غير صحيح.");
      return;
    }
    const mobile = normalizeGuestMobile(form.mobile);
    if (form.mobile.trim() && !mobile) {
      toast.error("رقم الهاتف غير صحيح.");
      return;
    }
    const age = normalizeAge(form.age);
    const healthNumber = normalizeHealthNumber(form.healthNumber);
    onAdd({
      id: `G-${Date.now().toString(36)}`,
      name: form.name.trim().replace(/\s+/g, " "),
      ...(form.nameEn.trim() ? { nameEn: form.nameEn.trim().replace(/\s+/g, " ") } : {}),
      ...(form.gender ? { gender: form.gender } : {}),
      ...(mobile ? { mobile } : {}),
      buildingNumber: normalizeUnit(form.buildingNumber),
      apartmentNumber: normalizeUnit(form.apartmentNumber),
      ...(age !== undefined ? { age } : {}),
      ...(healthNumber ? { healthNumber } : {}),
      ...(form.nurse ? { nurse: true as const } : {}),
    });
  }

  const field = (label: string, key: Exclude<keyof typeof form, "nurse">, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <input value={form[key]} onChange={(event) => set({ [key]: event.target.value })} className={inputClass} {...extra} />
    </label>
  );
  return (
    <Panel tone="brand" icon={UserPlus} title="إضافة ضيف إلى القائمة" className="mb-6">
      <form onSubmit={submit} className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">{field("الاسم بالعربية", "name", { required: true, autoFocus: true })}</div>
        <div className="sm:col-span-2">{field("الاسم بالإنجليزية", "nameEn", { dir: "ltr" })}</div>
        <label className="flex cursor-pointer items-center gap-2.5 rounded-xl bg-violet-50/60 px-3 py-2.5 text-sm text-ink ring-1 ring-inset ring-violet-200 sm:col-span-2 lg:col-span-4">
          <input
            type="checkbox"
            checked={form.nurse}
            // الممرضات في مبنى 03 شقة 001
            onChange={(event) => set({ nurse: event.target.checked, ...(event.target.checked && !form.buildingNumber && !form.apartmentNumber ? { buildingNumber: NURSE_BUILDING, apartmentNumber: NURSE_APARTMENT } : {}) })}
            className="h-4 w-4 accent-brand-600"
          />
          <BriefcaseMedical className="h-4 w-4 text-violet-700" /> ممرضة
          <span className="text-xs text-slate-500">· مبنى {NURSE_BUILDING} شقة {NURSE_APARTMENT}، ويُطلب لها سيارة مثل الضيف</span>
        </label>
        <label className="block">
          <span className={labelClass}>الجنس</span>
          <select value={form.gender} onChange={(event) => set({ gender: event.target.value as Gender | "" })} className={inputClass}>
            <option value="">غير محدد</option>
            {GENDERS.map((gender) => <option key={gender} value={gender}>{gender}</option>)}
          </select>
        </label>
        {field("رقم الهاتف", "mobile", { dir: "ltr", type: "tel" })}
        {field("رقم المبنى", "buildingNumber", { dir: "ltr", required: true, list: "new-guest-buildings" })}
        {field("رقم الشقة", "apartmentNumber", { dir: "ltr", required: true })}
        <datalist id="new-guest-buildings">{buildings.map((item) => <option key={item} value={item} />)}</datalist>
        <fieldset className="rounded-xl bg-slate-50 p-4 ring-1 ring-inset ring-slate-200 sm:col-span-2 lg:col-span-4">
          <legend className="sr-only">بيانات الإحصائيات</legend>
          <p className="mb-3 flex items-center gap-1.5 text-xs font-medium text-slate-500"><Lock className="h-3.5 w-3.5" /> لا يظهران عند طلب الموعد، وفي الإحصائيات فقط</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {field("العمر", "age", { dir: "ltr", inputMode: "numeric" })}
            {field("الرقم الصحي", "healthNumber", { dir: "ltr" })}
          </div>
        </fieldset>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
          <button type="submit" className={btn("primary")}><Check className="h-4 w-4" /> إضافة الضيف</button>
          <button type="button" onClick={onCancel} className={btn("secondary")}>إلغاء</button>
        </div>
      </form>
    </Panel>
  );
}

import { useMemo, useState } from "react";
import {
  Activity,
  Accessibility,
  AlertTriangle,
  ArrowUpLeft,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  Clock3,
  Filter,
  Hospital,
  LayoutDashboard,
  MapPinned,
  Menu,
  Navigation,
  Phone,
  Plus,
  Radio,
  RefreshCw,
  Route,
  Search,
  ShieldCheck,
  Truck,
  Upload,
  UsersRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { chooseVehicle } from "@shared/dispatch";

type Status = "مجدول" | "في الطريق" | "تم الاستلام" | "وصل للمستشفى" | "مكتملة" | "متأخرة";
type View = "overview" | "appointments" | "fleet" | "tracking";

type Appointment = {
  id: number;
  time: string;
  patient: string;
  area: string;
  destination: string;
  service: string;
  vehicle: string;
  driver: string;
  kind: "سيدان" | "احتياجات خاصة" | "باص";
  status: Status;
  priority?: boolean;
};

type FleetVehicle = {
  plate: string;
  driver: string;
  phone: string;
  kind: string;
  state: "متاحة" | "في رحلة" | "تحتاج متابعة";
  next: string;
  color: string;
};

const seedAppointments: Appointment[] = [
  { id: 1, time: "07:30", patient: "مريض 001", area: "الثمامة", destination: "مركز الثمامة الصحي", service: "فحص دم", vehicle: "943438", driver: "خرم", kind: "سيدان", status: "مكتملة" },
  { id: 2, time: "08:00", patient: "مريض 002", area: "الوكرة", destination: "مستشفى الوكرة", service: "أسنان", vehicle: "108443", driver: "جودي عبد الرحمن", kind: "احتياجات خاصة", status: "تم الاستلام", priority: true },
  { id: 3, time: "08:15", patient: "مريض 003", area: "روضة الخيل", destination: "مستشفى سدرة", service: "عيادة عيون", vehicle: "956479", driver: "كمال", kind: "سيدان", status: "في الطريق" },
  { id: 4, time: "09:00", patient: "مريض 004", area: "بن عمران", destination: "مركز العلاج الطبيعي", service: "علاج طبيعي", vehicle: "157724", driver: "محمد سراج", kind: "احتياجات خاصة", status: "مجدول", priority: true },
  { id: 5, time: "09:30", patient: "مريض 005", area: "الثمامة", destination: "المستشفى الكوبي", service: "عيادة خارجية", vehicle: "956405", driver: "إسماعيل", kind: "سيدان", status: "مجدول" },
  { id: 6, time: "10:10", patient: "مريض 006", area: "الغرافة", destination: "مركز حمد التخصصي", service: "قلب", vehicle: "975536", driver: "خيرالدين", kind: "سيدان", status: "متأخرة" },
  { id: 7, time: "11:00", patient: "مريض 007", area: "الريان", destination: "مستشفى حمد العام", service: "متابعة", vehicle: "329538", driver: "عادل", kind: "باص", status: "مجدول" },
  { id: 8, time: "13:30", patient: "مريض 008", area: "الثمامة", destination: "مركز إعادة التأهيل", service: "تأهيل حركي", vehicle: "158774", driver: "عبد الله", kind: "احتياجات خاصة", status: "مجدول", priority: true },
];

const fleet: FleetVehicle[] = [
  { plate: "943438", driver: "خرم", phone: "77712995", kind: "سيدان", state: "متاحة", next: "لا توجد رحلة تالية", color: "#0e9f6e" },
  { plate: "956479", driver: "كمال", phone: "55339592", kind: "سيدان", state: "في رحلة", next: "الوصول إلى سدرة · 08:15", color: "#2864dc" },
  { plate: "108443", driver: "جودي عبد الرحمن", phone: "70734689", kind: "احتياجات خاصة", state: "في رحلة", next: "استلام مريض · 08:00", color: "#9b51e0" },
  { plate: "157724", driver: "محمد سراج", phone: "70922766", kind: "احتياجات خاصة", state: "متاحة", next: "مخصص لمريض يحتاج مرافقًا", color: "#9b51e0" },
  { plate: "975536", driver: "خيرالدين", phone: "30038512", kind: "سيدان", state: "تحتاج متابعة", next: "تأخير 12 دقيقة", color: "#e47725" },
  { plate: "329538", driver: "عادل", phone: "55226916", kind: "باص", state: "متاحة", next: "رحلة حمد العام · 11:00", color: "#0e9f6e" },
];

const statusStyles: Record<Status, string> = {
  مكتملة: "bg-emerald-50 text-emerald-700 border-emerald-100",
  "في الطريق": "bg-blue-50 text-blue-700 border-blue-100",
  "تم الاستلام": "bg-violet-50 text-violet-700 border-violet-100",
  "وصل للمستشفى": "bg-cyan-50 text-cyan-700 border-cyan-100",
  مجدول: "bg-slate-50 text-slate-600 border-slate-200",
  متأخرة: "bg-orange-50 text-orange-700 border-orange-100",
};

const nextStatus: Partial<Record<Status, Status>> = {
  مجدول: "في الطريق",
  "في الطريق": "تم الاستلام",
  "تم الاستلام": "وصل للمستشفى",
  "وصل للمستشفى": "مكتملة",
};

function StatCard({ title, value, caption, icon: Icon, tone }: { title: string; value: string; caption: string; icon: typeof Truck; tone: string }) {
  return (
    <div className="group rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_8px_30px_rgba(25,45,85,0.04)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_40px_rgba(25,45,85,0.08)]">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <p className="mt-3 text-3xl font-bold tracking-tight text-slate-900">{value}</p>
        </div>
        <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${tone}`}><Icon className="h-5 w-5" /></div>
      </div>
      <p className="mt-4 text-xs text-slate-400">{caption}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${statusStyles[status]}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{status}</span>;
}

export default function Home() {
  const [view, setView] = useState<View>("overview");
  const [appointments, setAppointments] = useState(seedAppointments);
  const [query, setQuery] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [newAppointment, setNewAppointment] = useState({ patient: "", time: "14:00", area: "", destination: "", kind: "سيدان" as Appointment["kind"] });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return appointments;
    return appointments.filter((a) => [a.patient, a.destination, a.driver, a.area, a.vehicle].some((v) => v.toLowerCase().includes(q)));
  }, [appointments, query]);

  const counts = useMemo(() => ({
    total: appointments.length,
    active: appointments.filter((a) => ["في الطريق", "تم الاستلام", "وصل للمستشفى"].includes(a.status)).length,
    complete: appointments.filter((a) => a.status === "مكتملة").length,
    delayed: appointments.filter((a) => a.status === "متأخرة").length,
  }), [appointments]);

  function advance(id: number) {
    setAppointments((current) => current.map((item) => {
      if (item.id !== id) return item;
      const status = nextStatus[item.status] ?? item.status;
      toast.success(`تم تحديث رحلة ${item.id} إلى: ${status}`);
      return { ...item, status };
    }));
  }

  function addAppointment() {
    if (!newAppointment.patient || !newAppointment.destination || !newAppointment.area) {
      toast.error("أكمل اسم المريض والمنطقة والوجهة أولًا");
      return;
    }
    const available = chooseVehicle(
      fleet.map((v) => ({ plate: v.plate, driver: v.driver, kind: v.kind as "سيدان" | "احتياجات خاصة" | "باص", available: v.state === "متاحة" })),
      { kind: newAppointment.kind, requiresAccessibility: newAppointment.kind === "احتياجات خاصة" },
    );
    const created: Appointment = {
      id: Math.max(...appointments.map((a) => a.id)) + 1,
      ...newAppointment,
      service: "موعد جديد",
      vehicle: available?.plate ?? "بانتظار التخصيص",
      driver: available?.driver ?? "غير مخصص",
      status: "مجدول",
    };
    setAppointments((current) => [...current, created].sort((a, b) => a.time.localeCompare(b.time)));
    setNewAppointment({ patient: "", time: "14:00", area: "", destination: "", kind: "سيدان" });
    setShowNew(false);
    toast.success(available ? `تمت إضافة الموعد وتخصيص السيارة ${available.plate}` : "تمت إضافة الموعد إلى قائمة التخصيص");
  }

  const nav = [
    { id: "overview" as View, label: "لوحة اليوم", icon: LayoutDashboard },
    { id: "appointments" as View, label: "المواعيد", icon: CalendarDays },
    { id: "fleet" as View, label: "السيارات والسائقون", icon: Truck },
    { id: "tracking" as View, label: "التتبع المباشر", icon: MapPinned },
  ];
  const currentTitle = nav.find((item) => item.id === view)?.label ?? "لوحة اليوم";

  return (
    <div className="min-h-screen bg-[#f5f7fb] text-slate-900" dir="rtl">
      <aside className={`fixed inset-y-0 right-0 z-40 w-[274px] border-l border-slate-200 bg-[#10233f] text-white transition-transform duration-200 lg:translate-x-0 ${mobileMenu ? "translate-x-0" : "translate-x-full"}`}>
        <div className="flex h-full flex-col px-4 py-5">
          <div className="flex items-center gap-3 border-b border-white/10 px-2 pb-6">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#4de0bc] text-[#10233f]"><Route className="h-6 w-6" /></div>
            <div><p className="text-sm font-bold tracking-wide">فوكس ترانزيت</p><p className="mt-0.5 text-xs text-slate-300">إدارة النقل الطبي</p></div>
          </div>
          <div className="mt-7 px-3 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">مساحة التشغيل</div>
          <nav className="mt-3 space-y-1">
            {nav.map((item) => {
              const Icon = item.icon;
              const active = view === item.id;
              return <button key={item.id} onClick={() => { setView(item.id); setMobileMenu(false); }} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold transition ${active ? "bg-[#244669] text-[#83f0d0] shadow-inner" : "text-slate-300 hover:bg-white/5 hover:text-white"}`}><Icon className="h-[18px] w-[18px]" />{item.label}{item.id === "tracking" && <span className="mr-auto h-2 w-2 rounded-full bg-[#4de0bc]" />}</button>;
            })}
          </nav>
          <div className="mt-auto rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center gap-2 text-[#83f0d0]"><Radio className="h-4 w-4" /><span className="text-xs font-bold">النظام يعمل</span></div>
            <p className="mt-2 text-xs leading-5 text-slate-300">تحديث آخر رحلة قبل 28 ثانية</p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full w-[82%] rounded-full bg-[#4de0bc]" /></div>
          </div>
          <div className="mt-4 flex items-center gap-3 px-2 text-xs text-slate-400"><div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#2b4b70] font-bold text-[#83f0d0]">م</div><div><p className="font-semibold text-slate-200">مشرف العمليات</p><p>إدارة الأسطول</p></div></div>
        </div>
      </aside>

      <div className="min-h-screen lg:mr-[274px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-slate-200/80 bg-[#f5f7fb]/90 px-5 backdrop-blur-xl lg:px-8">
          <div className="flex items-center gap-3"><button className="rounded-xl border border-slate-200 bg-white p-2 lg:hidden" onClick={() => setMobileMenu(true)}><Menu className="h-5 w-5" /></button><div><div className="flex items-center gap-2"><span className="text-xs font-semibold text-slate-400">الاثنين، 22 سبتمبر 2026</span><span className="h-1 w-1 rounded-full bg-slate-300" /><span className="text-xs font-semibold text-emerald-600">وردية الصباح</span></div><h1 className="mt-1 text-xl font-bold text-slate-900">{currentTitle}</h1></div></div>
          <div className="flex items-center gap-2 sm:gap-3"><div className="hidden items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-500 sm:flex"><Activity className="h-4 w-4 text-emerald-500" /> 18 سيارة على الطريق</div><button onClick={() => setShowNew(true)} className="flex items-center gap-2 rounded-xl bg-[#1f5c66] px-3 py-2.5 text-xs font-bold text-white shadow-lg shadow-[#1f5c66]/15 transition hover:bg-[#164d57] active:scale-[.98]"><Plus className="h-4 w-4" /> <span className="hidden sm:inline">إضافة موعد</span></button><div className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500"><span className="relative"><Radio className="h-4 w-4" /><span className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-orange-400 ring-2 ring-white" /></span></div></div>
        </header>

        <main className="mx-auto max-w-[1440px] p-5 lg:p-8">
          {view === "overview" && <Overview appointments={appointments} counts={counts} onAdvance={advance} onViewAppointments={() => setView("appointments")} />}
          {view === "appointments" && <AppointmentsView appointments={filtered} query={query} setQuery={setQuery} onAdvance={advance} onNew={() => setShowNew(true)} />}
          {view === "fleet" && <FleetView appointments={appointments} />}
          {view === "tracking" && <TrackingView appointments={appointments} />}
        </main>
      </div>

      {showNew && <NewAppointmentModal value={newAppointment} setValue={setNewAppointment} onClose={() => setShowNew(false)} onSubmit={addAppointment} />}
    </div>
  );
}

function Overview({ appointments, counts, onAdvance, onViewAppointments }: { appointments: Appointment[]; counts: { total: number; active: number; complete: number; delayed: number }; onAdvance: (id: number) => void; onViewAppointments: () => void }) {
  return <>
    <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-sm font-semibold text-[#1f7c76]">نظرة تشغيلية سريعة</p><h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 lg:text-3xl">كل رحلة في مكانها الصحيح.</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">راقب المواعيد، أعد استخدام السيارة بعد انتهاء الرحلة، وتدخل مبكرًا عند ظهور تأخير.</p></div><div className="flex items-center gap-2 text-xs font-semibold text-slate-400"><RefreshCw className="h-4 w-4" /> آخر تحديث منذ 28 ثانية</div></div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><StatCard title="إجمالي المواعيد" value={`${counts.total}`} caption="اليوم · 3 مواعيد تحتاج أولوية" icon={CalendarDays} tone="bg-[#e6f4f1] text-[#1f7c76]" /><StatCard title="رحلات نشطة" value={`${counts.active}`} caption="سيارات تنفذ مهمة الآن" icon={Navigation} tone="bg-[#e9efff] text-[#2864dc]" /><StatCard title="مكتملة" value={`${counts.complete}`} caption="منذ بداية الوردية" icon={CheckCircle2} tone="bg-[#e7f6ed] text-[#168653]" /><StatCard title="تحتاج متابعة" value={`${counts.delayed}`} caption="تدخل المشرف مطلوب" icon={AlertTriangle} tone="bg-[#fff1e6] text-[#d86f20]" /></div>
    <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_360px]">
      <section className="rounded-2xl border border-slate-200/80 bg-white shadow-[0_8px_30px_rgba(25,45,85,0.04)]"><div className="flex flex-col gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="font-bold text-slate-900">الرحلات القادمة</h3><p className="mt-1 text-xs text-slate-400">ترتيب زمني مع قابلية تحديث الحالة</p></div><button onClick={onViewAppointments} className="flex items-center gap-1 text-xs font-bold text-[#1f7c76] hover:text-[#165e5a]">عرض كل المواعيد <ChevronLeft className="h-4 w-4" /></button></div><div className="divide-y divide-slate-100">{appointments.slice(0, 6).map((a) => <AppointmentRow key={a.id} item={a} onAdvance={onAdvance} />)}</div></section>
      <section className="rounded-2xl border border-slate-200/80 bg-[#10233f] p-5 text-white shadow-[0_8px_30px_rgba(25,45,85,0.12)]"><div className="flex items-center justify-between"><div><p className="text-xs font-semibold text-[#83f0d0]">مؤشر التشغيل</p><h3 className="mt-1 text-lg font-bold">توزيع اليوم</h3></div><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10"><ShieldCheck className="h-5 w-5 text-[#83f0d0]" /></div></div><div className="mt-8 flex items-center justify-center"><div className="relative flex h-40 w-40 items-center justify-center rounded-full" style={{ background: "conic-gradient(#4de0bc 0deg 230deg, #6886ac 230deg 300deg, #e47725 300deg 338deg, #ffffff1a 338deg 360deg)" }}><div className="flex h-28 w-28 flex-col items-center justify-center rounded-full bg-[#10233f]"><span className="text-3xl font-bold">82%</span><span className="text-[10px] text-slate-400">كفاءة الجدولة</span></div></div></div><div className="mt-8 space-y-3 text-xs"><Legend color="bg-[#4de0bc]" label="رحلات منجزة" value="58%" /><Legend color="bg-[#6886ac]" label="رحلات مجدولة" value="24%" /><Legend color="bg-[#e47725]" label="تحتاج متابعة" value="8%" /></div><button onClick={() => toast.info("سيظهر التقرير التفصيلي بعد ربط قاعدة البيانات") } className="mt-7 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 py-3 text-xs font-bold text-slate-200 hover:bg-white/10">فتح تقرير الكفاءة <ArrowUpLeft className="h-4 w-4" /></button></section>
    </div>
  </>;
}

function Legend({ color, label, value }: { color: string; label: string; value: string }) { return <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-slate-300"><span className={`h-2 w-2 rounded-full ${color}`} />{label}</span><span className="font-bold text-white">{value}</span></div>; }

function AppointmentRow({ item, onAdvance }: { item: Appointment; onAdvance: (id: number) => void }) {
  return <div className="flex flex-col gap-3 px-5 py-4 transition hover:bg-slate-50/80 sm:flex-row sm:items-center"><div className="flex min-w-[84px] items-center gap-2"><Clock3 className="h-4 w-4 text-slate-300" /><span className="text-sm font-bold text-slate-800">{item.time}</span></div><div className="flex min-w-0 flex-1 items-center gap-3"><div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold ${item.priority ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-500"}`}>{item.priority ? <Accessibility className="h-4 w-4" /> : item.patient.slice(-3)}</div><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-800">{item.patient}</p><p className="mt-1 truncate text-xs text-slate-400">{item.area} <span className="px-1 text-slate-300">·</span> {item.destination}</p></div></div><div className="hidden min-w-[145px] items-center gap-2 text-xs text-slate-500 lg:flex"><Truck className="h-4 w-4 text-slate-300" /><span>{item.vehicle}</span><span className="text-slate-300">·</span><span>{item.driver}</span></div><StatusBadge status={item.status} /><button disabled={!nextStatus[item.status]} onClick={() => onAdvance(item.id)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-500 transition hover:border-[#a7dcd2] hover:bg-[#f0fbf8] hover:text-[#1f7c76] disabled:cursor-default disabled:opacity-40">{nextStatus[item.status] ? "تحديث" : "مكتمل"}</button></div>;
}

function AppointmentsView({ appointments, query, setQuery, onAdvance, onNew }: { appointments: Appointment[]; query: string; setQuery: (v: string) => void; onAdvance: (id: number) => void; onNew: () => void }) {
  return <><div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-sm font-semibold text-[#1f7c76]">خطة اليوم</p><h2 className="mt-2 text-2xl font-bold">المواعيد والرحلات</h2><p className="mt-2 text-sm text-slate-500">ابحث، راجع التخصيص، وحدث حالة الرحلة من نفس الجدول.</p></div><div className="flex gap-2"><button onClick={() => toast.info("استيراد Excel سيكون متاحًا في النسخة المتصلة بقاعدة البيانات")} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50"><Upload className="h-4 w-4" /> استيراد Excel</button><button onClick={onNew} className="flex items-center gap-2 rounded-xl bg-[#1f5c66] px-3 py-2.5 text-xs font-bold text-white hover:bg-[#164d57]"><Plus className="h-4 w-4" /> موعد جديد</button></div></div><div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_8px_30px_rgba(25,45,85,0.04)]"><div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row"><div className="relative flex-1"><Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث باسم المريض، المستشفى، السائق أو السيارة..." className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pr-10 pl-4 text-sm outline-none transition focus:border-[#83cfc1] focus:bg-white" /></div><button className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 text-xs font-bold text-slate-500 hover:bg-slate-50"><Filter className="h-4 w-4" /> تصفية حسب الحالة</button></div><div className="hidden grid-cols-[90px_1.5fr_1.2fr_1.1fr_1fr_100px] gap-4 border-b border-slate-100 bg-slate-50/70 px-5 py-3 text-[11px] font-bold text-slate-400 lg:grid"><span>الوقت</span><span>المريض / الاستلام</span><span>الوجهة</span><span>السيارة / السائق</span><span>نوع الرحلة</span><span>الحالة</span></div><div className="divide-y divide-slate-100">{appointments.map((item) => <div key={item.id} className="grid gap-3 px-5 py-4 transition hover:bg-slate-50/70 lg:grid-cols-[90px_1.5fr_1.2fr_1.1fr_1fr_100px] lg:items-center lg:gap-4"><div className="flex items-center gap-2 text-sm font-bold"><Clock3 className="h-4 w-4 text-slate-300" />{item.time}</div><div><p className="text-sm font-bold">{item.patient}</p><p className="mt-1 text-xs text-slate-400">نقطة الاستلام: {item.area}</p></div><div><p className="text-sm font-semibold text-slate-700">{item.destination}</p><p className="mt-1 text-xs text-slate-400">{item.service}</p></div><div><p className="text-xs font-bold text-slate-700">{item.vehicle} <span className="font-normal text-slate-400">· {item.driver}</span></p><p className="mt-1 text-xs text-slate-400">{item.kind}</p></div><div>{item.priority ? <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-1 text-xs font-bold text-violet-700"><Accessibility className="h-3.5 w-3.5" /> أولوية خاصة</span> : <span className="text-xs text-slate-500">رحلة عادية</span>}</div><div className="flex items-center gap-2"><StatusBadge status={item.status} /><button disabled={!nextStatus[item.status]} onClick={() => onAdvance(item.id)} className="text-[11px] font-bold text-[#1f7c76] disabled:hidden">التالي</button></div></div>)}</div>{appointments.length === 0 && <div className="p-12 text-center text-sm text-slate-400">لا توجد نتائج مطابقة.</div>}</div></>;
}

function FleetView({ appointments }: { appointments: Appointment[] }) {
  return <><div className="mb-6"><p className="text-sm font-semibold text-[#1f7c76]">الأسطول والسائقون</p><h2 className="mt-2 text-2xl font-bold">من متاح الآن؟</h2><p className="mt-2 text-sm text-slate-500">قائمة سريعة تساعدك على إعادة استخدام السيارة بعد انتهاء المهمة السابقة.</p></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{fleet.map((vehicle) => { const current = appointments.find((a) => a.vehicle === vehicle.plate && ["في الطريق", "تم الاستلام"].includes(a.status)); return <div key={vehicle.plate} className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_8px_30px_rgba(25,45,85,0.04)]"><div className="flex items-start justify-between"><div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-xl" style={{ backgroundColor: `${vehicle.color}18`, color: vehicle.color }}><Truck className="h-5 w-5" /></div><div><p className="font-bold">{vehicle.plate}</p><p className="mt-1 text-xs text-slate-400">{vehicle.kind}</p></div></div><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${vehicle.state === "متاحة" ? "bg-emerald-50 text-emerald-700" : vehicle.state === "في رحلة" ? "bg-blue-50 text-blue-700" : "bg-orange-50 text-orange-700"}`}>{vehicle.state}</span></div><div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4"><div><p className="text-xs text-slate-400">السائق</p><p className="mt-1 text-sm font-bold">{vehicle.driver}</p></div><a href={`tel:${vehicle.phone}`} className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-50 text-slate-500 hover:bg-[#e6f4f1] hover:text-[#1f7c76]"><Phone className="h-4 w-4" /></a></div><div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">{current ? <span className="flex items-center gap-2 text-blue-700"><Navigation className="h-3.5 w-3.5" />{current.destination}</span> : <span>{vehicle.next}</span>}</div></div>; })}</div><div className="mt-6 rounded-2xl border border-dashed border-[#b6dcd5] bg-[#f2fbf8] p-5"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 text-[#1f7c76]" /><div><p className="font-bold text-[#165e5a]">قاعدة التوزيع الحالية</p><p className="mt-1 text-sm leading-6 text-slate-600">المركبة المتاحة تُفضّل إذا كانت مناسبة لنوع الرحلة. رحلات الاحتياجات الخاصة تُوجّه أولًا إلى مركبات التجهيز الخاص، ثم تُراجع يدويًا قبل الإرسال.</p></div></div></div></>;
}

function TrackingView({ appointments }: { appointments: Appointment[] }) {
  const active = appointments.filter((a) => ["في الطريق", "تم الاستلام", "متأخرة"].includes(a.status));
  return <><div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-sm font-semibold text-[#1f7c76]">مركز المتابعة</p><h2 className="mt-2 text-2xl font-bold">تتبع الرحلات النشطة</h2><p className="mt-2 text-sm text-slate-500">هذه الواجهة جاهزة لاستقبال موقع GPS من هاتف السائق أو جهاز المركبة.</p></div><div className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> نظام التتبع متصل</div></div><div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]"><div className="relative min-h-[470px] overflow-hidden rounded-2xl border border-slate-200 bg-[#dfeae9] shadow-[0_8px_30px_rgba(25,45,85,0.06)]"><div className="absolute inset-0 opacity-50" style={{ backgroundImage: "linear-gradient(30deg, transparent 47%, #ffffff 48%, #ffffff 51%, transparent 52%), linear-gradient(120deg, transparent 47%, #ffffff 48%, #ffffff 51%, transparent 52%), linear-gradient(#b9d0ce 1px, transparent 1px), linear-gradient(90deg, #b9d0ce 1px, transparent 1px)", backgroundSize: "240px 180px, 180px 250px, 44px 44px, 44px 44px" }} /><div className="absolute right-[18%] top-[18%] h-44 w-44 rounded-full border-[18px] border-white/50" /><div className="absolute left-[16%] bottom-[18%] h-52 w-52 rounded-full border-[24px] border-white/40" /><div className="absolute right-[8%] top-[7%] rounded-full bg-white/80 px-3 py-2 text-xs font-bold text-slate-600 shadow-sm"><MapPinned className="ml-1 inline h-3.5 w-3.5 text-[#1f7c76]" /> خريطة التشغيل · تجريبية</div><MapPin position="right-[22%] top-[32%]" color="#2864dc" label="956479" /><MapPin position="left-[28%] top-[48%]" color="#9b51e0" label="108443" /><MapPin position="right-[44%] top-[68%]" color="#e47725" label="975536" /></div><div className="space-y-3">{active.length === 0 ? <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">لا توجد رحلات نشطة حاليًا.</div> : active.map((item) => <div key={item.id} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_8px_30px_rgba(25,45,85,0.04)]"><div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e8f0ff] text-[#2864dc]"><Navigation className="h-4 w-4" /></div><div><p className="text-sm font-bold">{item.vehicle} · {item.driver}</p><p className="mt-1 text-xs text-slate-400">إلى {item.destination}</p></div></div><StatusBadge status={item.status} /></div><div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs"><span className="flex items-center gap-1.5 text-slate-400"><Clock3 className="h-3.5 w-3.5" /> آخر تحديث منذ 28 ثانية</span><button onClick={() => toast.info("سيتم فتح مشاركة الموقع بعد ربط GPS") } className="font-bold text-[#1f7c76]">فتح المسار <ArrowUpLeft className="mr-1 inline h-3.5 w-3.5" /></button></div></div>)}</div></div></>;
}

function MapPin({ position, color, label }: { position: string; color: string; label: string }) { return <div className={`absolute ${position}`}><div className="relative flex h-9 w-9 items-center justify-center rounded-full border-4 border-white shadow-lg" style={{ backgroundColor: color }}><Truck className="h-4 w-4 text-white" /></div><span className="absolute right-1/2 top-11 translate-x-1/2 whitespace-nowrap rounded-md bg-white/90 px-2 py-1 text-[10px] font-bold text-slate-600 shadow-sm">{label}</span></div>; }

function NewAppointmentModal({ value, setValue, onClose, onSubmit }: { value: { patient: string; time: string; area: string; destination: string; kind: Appointment["kind"] }; setValue: (v: { patient: string; time: string; area: string; destination: string; kind: Appointment["kind"] }) => void; onClose: () => void; onSubmit: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#10233f]/35 p-4 backdrop-blur-sm"><div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between"><div><p className="text-sm font-bold text-[#1f7c76]">رحلة جديدة</p><h3 className="mt-1 text-xl font-bold">إضافة موعد طبي</h3><p className="mt-1 text-xs text-slate-400">سيحاول النظام اقتراح سيارة متاحة ومناسبة.</p></div><button onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button></div><div className="mt-6 grid gap-4 sm:grid-cols-2"><label className="sm:col-span-2"><span className="mb-1.5 block text-xs font-bold text-slate-600">اسم المريض أو الرقم</span><input value={value.patient} onChange={(e) => setValue({ ...value, patient: e.target.value })} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-[#83cfc1]" placeholder="مثال: مريض 009" /></label><label><span className="mb-1.5 block text-xs font-bold text-slate-600">وقت الموعد</span><input type="time" value={value.time} onChange={(e) => setValue({ ...value, time: e.target.value })} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-[#83cfc1]" /></label><label><span className="mb-1.5 block text-xs font-bold text-slate-600">منطقة الاستلام</span><input value={value.area} onChange={(e) => setValue({ ...value, area: e.target.value })} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-[#83cfc1]" placeholder="الثمامة" /></label><label className="sm:col-span-2"><span className="mb-1.5 block text-xs font-bold text-slate-600">المستشفى أو العيادة</span><input value={value.destination} onChange={(e) => setValue({ ...value, destination: e.target.value })} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-[#83cfc1]" placeholder="مستشفى الوكرة" /></label><label className="sm:col-span-2"><span className="mb-1.5 block text-xs font-bold text-slate-600">نوع المركبة المطلوبة</span><select value={value.kind} onChange={(e) => setValue({ ...value, kind: e.target.value as Appointment["kind"] })} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#83cfc1]"><option>سيدان</option><option>احتياجات خاصة</option><option>باص</option></select></label></div><div className="mt-7 flex gap-3"><button onClick={onSubmit} className="flex-1 rounded-xl bg-[#1f5c66] py-3 text-sm font-bold text-white hover:bg-[#164d57]">حفظ واقتراح سيارة</button><button onClick={onClose} className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50">إلغاء</button></div></div></div>;
}

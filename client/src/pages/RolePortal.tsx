import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  BellRing,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ClipboardPlus,
  Clock3,
  Hospital,
  LockKeyhole,
  LogOut,
  ShieldCheck,
  Stethoscope,
  Truck,
  UsersRound,
} from "lucide-react";
import {
  assignVehicle,
  canRequestVehicle,
  type AppointmentKind,
  type ClinicAppointment,
  type Vehicle,
  type VehicleRequest,
} from "@shared/transport";
import Home from "./Home";

type Role = "clinic" | "buildingSupervisor" | "fleetSupervisor";
type Session = { role: Role; name: string };

const vehicles: Vehicle[] = [
  { plate: "943438", driver: "خرم", phone: "77712995", kind: "سيدان", available: true },
  { plate: "956479", driver: "كمال", phone: "55339592", kind: "سيدان", available: true },
  { plate: "108443", driver: "جودي عبد الرحمن", phone: "70734689", kind: "احتياجات خاصة", available: true },
  { plate: "157724", driver: "محمد سراج", phone: "70922766", kind: "احتياجات خاصة", available: true },
  { plate: "329538", driver: "عادل", phone: "55226916", kind: "باص", available: true },
];

const seedAppointments: ClinicAppointment[] = [
  { id: "APT-1001", patientName: "مريض 001", clinic: "مركز الثمامة الصحي", pickupArea: "الثمامة", appointmentAt: "07:30", kind: "سيدان", status: "بانتظار طلب السيارة" },
  { id: "APT-1002", patientName: "مريض 002", clinic: "مستشفى الوكرة", pickupArea: "الوكرة", appointmentAt: "08:00", kind: "احتياجات خاصة", notes: "يحتاج مرافقًا", status: "بانتظار طلب السيارة" },
  { id: "APT-1003", patientName: "مريض 003", clinic: "مستشفى سدرة", pickupArea: "روضة الخيل", appointmentAt: "08:15", kind: "سيدان", status: "تم طلب السيارة" },
];

const seedRequests: VehicleRequest[] = [
  { id: "REQ-2001", appointmentId: "APT-1003", vehiclePlate: "956479", driver: "كمال", status: "تم التأكيد", notificationMethod: "whatsapp", createdAt: "08:02" },
];

function loadState<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function saveState<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

function RoleIcon({ role }: { role: Role }) {
  if (role === "clinic") return <Stethoscope className="h-5 w-5" />;
  if (role === "buildingSupervisor") return <ShieldCheck className="h-5 w-5" />;
  return <Truck className="h-5 w-5" />;
}

export default function RolePortal() {
  const [session, setSession] = useState<Session | null>(() => loadState<Session | null>("fox_session", null));
  const [showManager, setShowManager] = useState(false);
  if (showManager) return <div><button onClick={() => setShowManager(false)} className="fixed left-5 top-5 z-50 rounded-xl bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-lg"><ArrowLeft className="ml-1 inline h-4 w-4" /> العودة للبوابة</button><Home /></div>;
  if (!session) return <Login onLogin={(next) => { setSession(next); saveState("fox_session", next); }} />;
  return <RoleShell session={session} onLogout={() => { setSession(null); localStorage.removeItem("fox_session"); }} onManager={() => setShowManager(true)} />;
}

function Login({ onLogin }: { onLogin: (session: Session) => void }) {
  const [role, setRole] = useState<Role>("buildingSupervisor");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const roles: { id: Role; title: string; description: string }[] = [
    { id: "clinic", title: "العيادة", description: "إضافة مواعيد المرضى فقط" },
    { id: "buildingSupervisor", title: "مشرف المبنى", description: "طلب السيارة وتأكيد الحضور والاستلام" },
    { id: "fleetSupervisor", title: "مشرف السيارات", description: "إدارة الأسطول والسائقين" },
  ];
  const demo = role === "clinic" ? "clinic / clinic123" : role === "buildingSupervisor" ? "building / building123" : "fleet / fleet123";
  function submit(event: React.FormEvent) {
    event.preventDefault();
    const expected = role === "clinic" ? ["clinic", "clinic123"] : role === "buildingSupervisor" ? ["building", "building123"] : ["fleet", "fleet123"];
    if (username !== expected[0] || password !== expected[1]) {
      toast.error("اسم المستخدم أو كلمة المرور غير صحيحة");
      return;
    }
    onLogin({ role, name: role === "clinic" ? "موظف العيادة" : role === "buildingSupervisor" ? "مشرف المبنى" : "مشرف السيارات" });
  }
  return <div className="flex min-h-screen items-center justify-center bg-[#f5f7fb] p-4" dir="rtl"><div className="grid w-full max-w-5xl overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_24px_70px_rgba(16,35,63,.12)] lg:grid-cols-[.9fr_1.1fr]"><div className="hidden bg-[#10233f] p-10 text-white lg:block"><div className="flex items-center gap-3"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#4de0bc] text-[#10233f]"><Truck className="h-6 w-6" /></div><div><p className="font-bold">فوكس ترانزيت</p><p className="text-xs text-slate-300">إدارة النقل الطبي</p></div></div><div className="mt-24"><p className="text-sm font-bold text-[#83f0d0]">دخول آمن حسب الدور</p><h1 className="mt-3 text-4xl font-bold leading-[1.25]">الموعد أولًا،<br />والسيارة في وقتها.</h1><p className="mt-5 max-w-sm text-sm leading-7 text-slate-300">لا يمكن إنشاء طلب سيارة من دون موعد طبي مسجل. كل دور يرى ما يحتاجه فقط.</p></div><div className="mt-24 flex items-center gap-2 text-xs text-slate-400"><LockKeyhole className="h-4 w-4 text-[#4de0bc]" /> صلاحيات منفصلة للعيادة ومشرف المبنى ومشرف السيارات</div></div><div className="p-6 sm:p-10"><div className="lg:hidden"><p className="text-sm font-bold text-[#1f7c76]">فوكس ترانزيت</p><h1 className="mt-2 text-2xl font-bold">بوابة التشغيل</h1></div><div className="mt-6"><p className="text-sm font-bold text-[#1f7c76]">اختر نوع الدخول</p><div className="mt-4 grid gap-2 sm:grid-cols-3">{roles.map((item) => <button key={item.id} onClick={() => setRole(item.id)} className={`min-h-[92px] rounded-2xl border p-3 text-right transition ${role === item.id ? "border-[#65cbbb] bg-[#eefaf7] text-[#165e5a]" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}><div className="flex items-center justify-between"><RoleIcon role={item.id} /><span className={`h-2.5 w-2.5 rounded-full ${role === item.id ? "bg-[#1f9d88]" : "bg-slate-200"}`} /></div><p className="mt-4 text-sm font-bold">{item.title}</p><p className="mt-1 text-[10px] leading-4 text-slate-400">{item.description}</p></button>)}</div></div><form onSubmit={submit} className="mt-8 space-y-4"><label className="block"><span className="mb-1.5 block text-xs font-bold text-slate-600">اسم المستخدم</span><input value={username} onChange={(e) => setUsername(e.target.value)} className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-[#65cbbb] focus:bg-white" placeholder="أدخل اسم المستخدم" /></label><label className="block"><span className="mb-1.5 block text-xs font-bold text-slate-600">كلمة المرور</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-[#65cbbb] focus:bg-white" placeholder="أدخل كلمة المرور" /></label><button className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#1f5c66] text-sm font-bold text-white shadow-lg shadow-[#1f5c66]/20 hover:bg-[#164d57]">دخول إلى البوابة <ChevronLeft className="h-4 w-4" /></button></form><p className="mt-5 rounded-xl bg-amber-50 p-3 text-center text-[11px] text-amber-700">بيانات التجربة: <b dir="ltr">{demo}</b></p></div></div></div>;
}

function RoleShell({ session, onLogout, onManager }: { session: Session; onLogout: () => void; onManager: () => void }) {
  const [appointments, setAppointments] = useState<ClinicAppointment[]>(() => loadState("fox_appointments", seedAppointments));
  const [requests, setRequests] = useState<VehicleRequest[]>(() => loadState("fox_requests", seedRequests));
  const [view, setView] = useState<"home" | "new">("home");
  const isClinic = session.role === "clinic";
  const isBuildingSupervisor = session.role === "buildingSupervisor";
  const isFleetSupervisor = session.role === "fleetSupervisor";
  const title = isClinic ? "مواعيد العيادة" : isBuildingSupervisor ? "طلبات واستلام المرضى" : "إدارة الأسطول";
  function updateAppointments(next: ClinicAppointment[]) { setAppointments(next); saveState("fox_appointments", next); }
  function updateRequests(next: VehicleRequest[]) { setRequests(next); saveState("fox_requests", next); }
  function updateRequestStatus(requestId: string, status: VehicleRequest["status"]) {
    updateRequests(requests.map((request) => request.id === requestId ? { ...request, status } : request));
    const request = requests.find((item) => item.id === requestId);
    if (request && status === "تم استلام المريض") updateAppointments(appointments.map((appointment) => appointment.id === request.appointmentId ? { ...appointment, status: "مكتملة" } : appointment));
    toast.success(status === "تم التأكيد" ? "تم تأكيد طلب السيارة" : status === "وصلت السيارة" ? "تم تسجيل حضور السيارة" : "تم تأكيد استلام المريض");
  }
  return <div className="min-h-screen bg-[#f5f7fb]" dir="rtl"><header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b border-slate-200 bg-[#f5f7fb]/95 px-5 backdrop-blur-xl lg:px-10"><div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#10233f] text-[#4de0bc]"><RoleIcon role={session.role} /></div><div><p className="text-xs font-semibold text-[#1f7c76]">{isClinic ? "مساحة العيادة" : isBuildingSupervisor ? "مساحة مشرف المبنى" : "مساحة مشرف السيارات"}</p><h1 className="text-xl font-bold">{title}</h1></div></div><div className="flex items-center gap-2"><span className="hidden text-xs font-semibold text-slate-400 sm:inline">{session.name}</span>{isFleetSupervisor && <button onClick={onManager} className="hidden rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 lg:inline">فتح لوحة الأسطول</button>}<button aria-label="تسجيل الخروج" onClick={onLogout} className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:text-red-600"><LogOut className="h-4 w-4" /></button></div></header><main className="mx-auto max-w-6xl p-5 lg:p-10">{view === "home" && isClinic && <ClinicHome appointments={appointments} onNew={() => setView("new")} />}{view === "new" && isClinic && <ClinicForm onBack={() => setView("home")} onSave={(appointment) => { updateAppointments([...appointments, appointment].sort((a, b) => a.appointmentAt.localeCompare(b.appointmentAt))); setView("home"); toast.success("تم تسجيل الموعد وأصبح متاحًا لمشرف المبنى"); }} />}{view === "home" && isBuildingSupervisor && <SupervisorHome appointments={appointments} requests={requests} onRequest={(request, appointmentId) => { updateRequests([...requests, request]); updateAppointments(appointments.map((a) => a.id === appointmentId ? { ...a, status: "تم طلب السيارة" } : a)); toast.success(`تم إنشاء طلب السيارة ${request.vehiclePlate}`); }} onUpdateRequest={updateRequestStatus} />}{view === "home" && isFleetSupervisor && <FleetSupervisorNotice onManager={onManager} />}</main></div>;
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) { return <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-sm font-bold text-[#1f7c76]">{eyebrow}</p><h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 lg:text-3xl">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{description}</p></div>{action}</div>; }

function ClinicHome({ appointments, onNew }: { appointments: ClinicAppointment[]; onNew: () => void }) { return <><PageHeading eyebrow="إدخال المواعيد فقط" title="مواعيد المرضى" description="أضف الموعد الطبي، وسيتولى المشرف طلب السيارة المناسبة. لا تظهر لك صلاحيات توزيع السيارات." action={<button onClick={onNew} className="flex min-h-11 items-center gap-2 rounded-xl bg-[#1f5c66] px-4 text-sm font-bold text-white hover:bg-[#164d57]"><ClipboardPlus className="h-4 w-4" /> إضافة موعد</button>} /><div className="mb-6 grid gap-4 sm:grid-cols-3"><InfoCard icon={CalendarDays} label="مواعيد اليوم" value={String(appointments.length)} tone="teal" /><InfoCard icon={Clock3} label="بانتظار السيارة" value={String(appointments.filter((a) => a.status === "بانتظار طلب السيارة").length)} tone="amber" /><InfoCard icon={CheckCircle2} label="تم طلب السيارة" value={String(appointments.filter((a) => a.status === "تم طلب السيارة").length)} tone="blue" /></div><div className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="border-b border-slate-100 p-5"><h3 className="font-bold">المواعيد المسجلة</h3><p className="mt-1 text-xs text-slate-400">المشرف يرى هذه القائمة لطلب السيارة</p></div><div className="divide-y divide-slate-100">{appointments.map((a) => <AppointmentCard key={a.id} appointment={a} />)}</div></div></>; }

function SupervisorHome({ appointments, requests, onRequest, onUpdateRequest }: { appointments: ClinicAppointment[]; requests: VehicleRequest[]; onRequest: (request: VehicleRequest, appointmentId: string) => void; onUpdateRequest: (requestId: string, status: VehicleRequest["status"]) => void }) { const pending = appointments.filter((a) => a.status !== "مكتملة"); return <><PageHeading eyebrow="مشرف المبنى" title="اطلب السيارة وتابع وصولها واستلام المريض" description="اختر موعدًا مسجلًا من العيادة، ثم أكد حضور السيارة واستلام المريض عند إتمام كل خطوة." /><div className="mb-6 flex items-center gap-3 rounded-2xl border border-[#b7dfd7] bg-[#effbf8] p-4 text-sm text-[#165e5a]"><ShieldCheck className="h-5 w-5 shrink-0" /><span>لا يمكن إنشاء طلب سيارة من دون موعد طبي مسجل. كل طلب مرتبط برقم موعد <b>APT</b>.</span></div><div className="grid gap-4">{pending.map((appointment) => { const request = requests.find((r) => r.appointmentId === appointment.id); return <SupervisorAppointment key={appointment.id} appointment={appointment} request={request} onRequest={onRequest} onUpdateRequest={onUpdateRequest} />; })}</div></>; }

function SupervisorAppointment({ appointment, request, onRequest, onUpdateRequest }: { appointment: ClinicAppointment; request?: VehicleRequest; onRequest: (request: VehicleRequest, appointmentId: string) => void; onUpdateRequest: (requestId: string, status: VehicleRequest["status"]) => void }) { const [method, setMethod] = useState<"whatsapp" | "call">("whatsapp"); const vehicle = assignVehicle(vehicles, appointment.kind); function requestCar() { if (!canRequestVehicle(appointment, request) || !vehicle) { toast.error("لا يوجد موعد قابل للطلب أو لا توجد سيارة متاحة"); return; } onRequest({ id: `REQ-${Date.now()}`, appointmentId: appointment.id, vehiclePlate: vehicle.plate, driver: vehicle.driver, status: "مطلوب", notificationMethod: method, createdAt: new Date().toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" }) }, appointment.id); } const nextAction = request?.status === "مطلوب" ? { label: "تأكيد طلب السيارة", status: "تم التأكيد" as const } : request?.status === "تم التأكيد" ? { label: "تأكيد حضور السيارة", status: "وصلت السيارة" as const } : request?.status === "وصلت السيارة" ? { label: "تأكيد استلام المريض", status: "تم استلام المريض" as const } : null; return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_8px_30px_rgba(25,45,85,.04)]"><div className="flex flex-col gap-4 lg:flex-row lg:items-center"><div className="flex flex-1 items-center gap-3"><div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#eef4f7] text-[#1f5c66]"><CalendarDays className="h-5 w-5" /></div><div><div className="flex flex-wrap items-center gap-2"><p className="font-bold">{appointment.patientName}</p><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">{appointment.id}</span></div><p className="mt-1 text-xs text-slate-400">{appointment.appointmentAt} · {appointment.pickupArea} إلى {appointment.clinic} · {appointment.kind}</p></div></div><div className="flex items-center gap-2 text-xs text-slate-500"><Truck className="h-4 w-4 text-slate-300" />{request ? `${request.vehiclePlate} · ${request.driver}` : vehicle ? `مقترح: ${vehicle.plate} · ${vehicle.driver}` : "لا توجد سيارة"}</div><span className={`rounded-full px-3 py-1.5 text-xs font-bold ${request ? "bg-violet-50 text-violet-700" : "bg-amber-50 text-amber-700"}`}>{request?.status ?? "بانتظار الطلب"}</span>{!request && <div className="flex items-center gap-2"><select value={method} onChange={(e) => setMethod(e.target.value as "whatsapp" | "call")} className="h-10 rounded-xl border border-slate-200 bg-white px-2 text-xs font-bold"><option value="whatsapp">واتساب</option><option value="call">اتصال</option></select><button onClick={requestCar} className="flex min-h-10 items-center gap-2 rounded-xl bg-[#1f5c66] px-3 text-xs font-bold text-white hover:bg-[#164d57]"><BellRing className="h-4 w-4" /> طلب السيارة</button></div>}{request && nextAction && <button onClick={() => onUpdateRequest(request.id, nextAction.status)} className="flex min-h-10 items-center gap-2 rounded-xl bg-[#1f5c66] px-3 text-xs font-bold text-white hover:bg-[#164d57]"><CheckCircle2 className="h-4 w-4" /> {nextAction.label}</button>}{request?.status === "تم استلام المريض" && <span className="flex items-center gap-1 text-xs font-bold text-emerald-700"><CheckCircle2 className="h-4 w-4" /> مكتملة</span>}</div></div>; }

function FleetSupervisorNotice({ onManager }: { onManager: () => void }) { return <><PageHeading eyebrow="مشرف السيارات" title="إدارة الأسطول والسائقين" description="هذه الصفحة مخصصة لمتابعة السيارات والسائقين والتوزيع التشغيلي فقط." action={<button onClick={onManager} className="flex min-h-11 items-center gap-2 rounded-xl bg-[#1f5c66] px-4 text-sm font-bold text-white hover:bg-[#164d57]"><Truck className="h-4 w-4" /> فتح لوحة الأسطول</button>} /><div className="rounded-2xl border border-slate-200 bg-white p-8 text-center"><Truck className="mx-auto h-10 w-10 text-[#1f7c76]" /><h3 className="mt-4 text-lg font-bold">صلاحياتك منفصلة عن مشرف المبنى</h3><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-500">مشرف السيارات يدير حالة المركبات والسائقين. مشرف المبنى هو المسؤول عن طلب السيارة وتأكيد حضورها واستلام المريض.</p></div></>; }

function ClinicForm({ onBack, onSave }: { onBack: () => void; onSave: (appointment: ClinicAppointment) => void }) { const [form, setForm] = useState({ patientName: "", clinic: "", pickupArea: "", appointmentAt: "09:00", kind: "سيدان" as AppointmentKind, notes: "" }); function submit(event: React.FormEvent) { event.preventDefault(); if (!form.patientName || !form.clinic || !form.pickupArea || !form.appointmentAt) { toast.error("أكمل بيانات المريض والعيادة والوقت"); return; } onSave({ ...form, id: `APT-${Date.now().toString().slice(-6)}`, status: "بانتظار طلب السيارة" }); } return <div className="mx-auto max-w-3xl"><button onClick={onBack} className="mb-5 flex items-center gap-2 text-sm font-bold text-[#1f7c76]"><ArrowLeft className="h-4 w-4" /> العودة للمواعيد</button><div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_8px_30px_rgba(25,45,85,.04)] sm:p-8"><div className="flex items-start gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#eefaf7] text-[#1f7c76]"><Hospital className="h-5 w-5" /></div><div><p className="text-sm font-bold text-[#1f7c76]">نموذج العيادة</p><h2 className="mt-1 text-2xl font-bold">إضافة موعد طبي</h2><p className="mt-1 text-xs text-slate-400">لن يتم طلب السيارة من هذه الصفحة.</p></div></div><form onSubmit={submit} className="mt-7 grid gap-4 sm:grid-cols-2"><Field label="اسم المريض أو الرقم" value={form.patientName} onChange={(v) => setForm({ ...form, patientName: v })} placeholder="مريض 009" wide /><Field label="اسم العيادة أو المستشفى" value={form.clinic} onChange={(v) => setForm({ ...form, clinic: v })} placeholder="مستشفى حمد العام" wide /><Field label="منطقة الاستلام" value={form.pickupArea} onChange={(v) => setForm({ ...form, pickupArea: v })} placeholder="الثمامة" /><Field label="وقت الموعد" value={form.appointmentAt} onChange={(v) => setForm({ ...form, appointmentAt: v })} type="time" /><label className="block sm:col-span-2"><span className="mb-1.5 block text-xs font-bold text-slate-600">نوع الرحلة</span><select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as AppointmentKind })} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#65cbbb]"><option>سيدان</option><option>احتياجات خاصة</option><option>باص</option></select></label><label className="block sm:col-span-2"><span className="mb-1.5 block text-xs font-bold text-slate-600">ملاحظات اختيارية</span><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="min-h-24 w-full resize-none rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-[#65cbbb]" placeholder="مثال: يحتاج مرافقًا أو كرسيًا متحركًا" /></label><div className="flex gap-3 sm:col-span-2"><button className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#1f5c66] text-sm font-bold text-white hover:bg-[#164d57]"><CheckCircle2 className="h-4 w-4" /> حفظ الموعد</button><button type="button" onClick={onBack} className="rounded-xl border border-slate-200 px-5 text-sm font-bold text-slate-600">إلغاء</button></div></form></div></div>; }

function Field({ label, value, onChange, placeholder = "", type = "text", wide }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string; wide?: boolean }) { return <label className={`block ${wide ? "sm:col-span-2" : ""}`}><span className="mb-1.5 block text-xs font-bold text-slate-600">{label}</span><input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#65cbbb]" /></label>; }

function AppointmentCard({ appointment }: { appointment: ClinicAppointment }) { return <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center"><div className="flex min-w-[95px] items-center gap-2 text-sm font-bold"><Clock3 className="h-4 w-4 text-slate-300" />{appointment.appointmentAt}</div><div className="flex-1"><p className="text-sm font-bold">{appointment.patientName}</p><p className="mt-1 text-xs text-slate-400">{appointment.pickupArea} · {appointment.clinic} · {appointment.kind}</p></div><span className={`rounded-full px-3 py-1.5 text-xs font-bold ${appointment.status === "تم طلب السيارة" ? "bg-violet-50 text-violet-700" : "bg-amber-50 text-amber-700"}`}>{appointment.status}</span></div>; }
function InfoCard({ icon: Icon, label, value, tone }: { icon: typeof CalendarDays; label: string; value: string; tone: "teal" | "amber" | "blue" }) { const styles = { teal: "bg-[#e6f4f1] text-[#1f7c76]", amber: "bg-[#fff1e6] text-[#d86f20]", blue: "bg-[#e9efff] text-[#2864dc]" }; return <div className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between"><p className="text-xs font-bold text-slate-500">{label}</p><div className={`flex h-10 w-10 items-center justify-center rounded-xl ${styles[tone]}`}><Icon className="h-5 w-5" /></div></div><p className="mt-4 text-3xl font-bold">{value}</p></div>; }
function EmptyState() { return <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center"><UsersRound className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 font-bold text-slate-600">لا توجد رحلات جديدة</p><p className="mt-1 text-sm text-slate-400">ستظهر الرحلة هنا بعد طلبها من المشرف.</p></div>; }

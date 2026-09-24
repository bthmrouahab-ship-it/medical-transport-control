import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Accessibility,
  ArrowLeft,
  BellRing,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ClipboardPlus,
  Clock3,
  Download,
  FileSpreadsheet,
  Hospital,
  LockKeyhole,
  LogOut,
  MapPin,
  Pencil,
  MessageCircle,
  Phone,
  RotateCcw,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Trash2,
  Truck,
  Upload,
  UsersRound,
  XCircle,
} from "lucide-react";
import {
  appointmentPickupLabel,
  assignVehicle,
  assignVehicleForTrips,
  buildDriverTripsMessage,
  canRequestVehicle,
  driverCallLink,
  driverWhatsAppLink,
  migrateAppointment,
  migrateRequest,
  parseImportedAppointments,
  suggestTripGroups,
  type AppointmentKind,
  type AssistanceNeed,
  type ClinicAppointment,
  type Vehicle,
  type VehicleRequest,
} from "@shared/transport";
import Home from "./Home";
import { loadState, removeState, saveState, subscribeState } from "@/lib/appStore";

type Role = "clinic" | "buildingSupervisor" | "fleetSupervisor";
type Session = { role: Role; name: string };
type ClinicView = "home" | "form";

const vehicles: Vehicle[] = [
  { plate: "943438", driver: "خرم", phone: "77712995", kind: "سيدان", available: true },
  { plate: "956479", driver: "كمال", phone: "55339592", kind: "سيدان", available: true },
  { plate: "108443", driver: "جودي عبد الرحمن", phone: "70734689", kind: "احتياجات خاصة", available: true },
  { plate: "157724", driver: "محمد سراج", phone: "70922766", kind: "احتياجات خاصة", available: true },
  { plate: "329538", driver: "عادل", phone: "55226916", kind: "باص", available: true },
];

function loadAppointments() {
  // يبدأ النظام بقائمة فارغة؛ المواعيد تُضاف من حساب العيادة.
  return loadState<unknown[]>("fox_appointments", [])
    .map((appointment, index) => migrateAppointment(appointment, index))
    .filter((appointment): appointment is ClinicAppointment => Boolean(appointment));
}

function loadRequests() {
  return loadState<unknown[]>("fox_requests", [])
    .map(migrateRequest)
    .filter((request): request is VehicleRequest => Boolean(request));
}

function RoleIcon({ role }: { role: Role }) {
  if (role === "clinic") return <Stethoscope className="h-5 w-5" />;
  if (role === "buildingSupervisor") return <ShieldCheck className="h-5 w-5" />;
  return <Truck className="h-5 w-5" />;
}

export default function RolePortal() {
  const [session, setSession] = useState<Session | null>(() => loadState<Session | null>("fox_session", null));
  const [showManager, setShowManager] = useState(false);

  if (showManager) {
    return (
      <div>
        <button onClick={() => setShowManager(false)} className="fixed left-5 top-5 z-50 rounded-xl bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-lg">
          <ArrowLeft className="ml-1 inline h-4 w-4" /> العودة للبوابة
        </button>
        <Home />
      </div>
    );
  }

  if (!session) {
    return <Login onLogin={(next) => { setSession(next); saveState("fox_session", next); }} />;
  }

  return (
    <RoleShell
      session={session}
      onLogout={() => { setSession(null); removeState("fox_session"); }}
      onManager={() => setShowManager(true)}
    />
  );
}

function Login({ onLogin }: { onLogin: (session: Session) => void }) {
  const [role, setRole] = useState<Role>("buildingSupervisor");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const roles: { id: Role; title: string; description: string }[] = [
    { id: "clinic", title: "العيادة", description: "إضافة مواعيد المرضى فقط" },
    { id: "buildingSupervisor", title: "مشرف المبنى", description: "طلب السيارة وتأكيد الحضور والاستلام" },
    { id: "fleetSupervisor", title: "مشرف السيارات", description: "إدارة السيارات والسائقين" },
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f5f7fb] p-4" dir="rtl">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_24px_70px_rgba(16,35,63,.12)] lg:grid-cols-[.9fr_1.1fr]">
        <div className="hidden bg-[#10233f] p-10 text-white lg:block">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#e43846] text-[#10233f]"><Truck className="h-6 w-6" /></div>
            <div className="flex items-center gap-2">
              <img src="/manus-storage/qrc-logo_b418c07b.png" alt="الهلال الأحمر القطري" className="h-10 w-28 rounded-lg bg-white p-1 object-contain" />
              <div><p className="font-bold">الهلال الأحمر القطري</p><p className="text-xs text-slate-300">سيارات مجمع الثمامة</p></div>
            </div>
          </div>
          <div className="mt-24">
            <p className="text-sm font-bold text-[#ff9ba3]">دخول آمن حسب الدور</p>
            <h1 className="mt-3 text-4xl font-bold leading-[1.25]">الموعد أولًا،<br />والسيارة في وقتها.</h1>
            <p className="mt-5 max-w-sm text-sm leading-7 text-slate-300">لا يمكن إنشاء طلب سيارة من دون موعد طبي مسجل. كل دور يرى ما يحتاجه فقط.</p>
          </div>
          <div className="mt-24 flex items-center gap-2 text-xs text-slate-400"><LockKeyhole className="h-4 w-4 text-[#e43846]" /> صلاحيات منفصلة للعيادة ومشرف المبنى ومشرف السيارات</div>
        </div>
        <div className="p-6 sm:p-10">
          <div className="lg:hidden"><img src="/manus-storage/qrc-logo_b418c07b.png" alt="الهلال الأحمر القطري" className="h-14 w-40 object-contain" /><h1 className="mt-2 text-2xl font-bold">سيارات مجمع الثمامة</h1></div>
          <div className="mt-6">
            <p className="text-sm font-bold text-[#a61d2d]">اختر نوع الدخول</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {roles.map((item) => (
                <button key={item.id} onClick={() => setRole(item.id)} className={`min-h-[92px] rounded-2xl border p-3 text-right transition ${role === item.id ? "border-[#e6a1aa] bg-[#fff1f2] text-[#861b2a]" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>
                  <div className="flex items-center justify-between"><RoleIcon role={item.id} /><span className={`h-2.5 w-2.5 rounded-full ${role === item.id ? "bg-[#1f9d88]" : "bg-slate-200"}`} /></div>
                  <p className="mt-4 text-sm font-bold">{item.title}</p>
                  <p className="mt-1 text-[10px] leading-4 text-slate-400">{item.description}</p>
                </button>
              ))}
            </div>
          </div>
          <form onSubmit={submit} className="mt-8 space-y-4">
            <Field label="اسم المستخدم" value={username} onChange={setUsername} placeholder="أدخل اسم المستخدم" />
            <Field label="كلمة المرور" value={password} onChange={setPassword} placeholder="أدخل كلمة المرور" type="password" />
            <button className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#a61d2d] text-sm font-bold text-white shadow-lg shadow-[#a61d2d]/20 hover:bg-[#8b1725]">دخول إلى البوابة <ChevronLeft className="h-4 w-4" /></button>
          </form>
          <p className="mt-5 rounded-xl bg-amber-50 p-3 text-center text-[11px] text-amber-700">بيانات التجربة: <b dir="ltr">{demo}</b></p>
        </div>
      </div>
    </div>
  );
}

function RoleShell({ session, onLogout, onManager }: { session: Session; onLogout: () => void; onManager: () => void }) {
  const [appointments, setAppointments] = useState<ClinicAppointment[]>(loadAppointments);
  const [requests, setRequests] = useState<VehicleRequest[]>(loadRequests);
  const [fleetVehicles, setFleetVehicles] = useState<Vehicle[]>(() => loadState("fox_fleet", vehicles));
  const [audit, setAudit] = useState<string[]>(() => loadState("fox_audit", []));
  const [view, setView] = useState<ClinicView>("home");
  const [editingAppointment, setEditingAppointment] = useState<ClinicAppointment | null>(null);
  const isClinic = session.role === "clinic";
  const isBuildingSupervisor = session.role === "buildingSupervisor";
  const isFleetSupervisor = session.role === "fleetSupervisor";
  const title = isClinic ? "مواعيد العيادة" : isBuildingSupervisor ? "طلبات واستلام المرضى" : "إدارة السيارات";

  // تحديث الشاشة فورًا عند وصول تغييرات من مستخدمين آخرين
  useEffect(() => subscribeState((key) => {
    if (key === "fox_appointments") setAppointments(loadAppointments());
    else if (key === "fox_requests") setRequests(loadRequests());
    else if (key === "fox_fleet") setFleetVehicles(loadState("fox_fleet", vehicles));
    else if (key === "fox_audit") setAudit(loadState("fox_audit", []));
  }), []);

  function updateAppointments(next: ClinicAppointment[]) { setAppointments(next); saveState("fox_appointments", next); }
  function updateRequests(next: VehicleRequest[]) { setRequests(next); saveState("fox_requests", next); }
  function updateFleet(next: Vehicle[]) { setFleetVehicles(next); saveState("fox_fleet", next); }
  function logAudit(message: string) {
    const next = [`${new Date().toLocaleString("ar-SA")} — ${message}`, ...audit].slice(0, 50);
    setAudit(next);
    saveState("fox_audit", next);
  }

  async function exportStats() {
    try {
      const XLSX = await import("xlsx");
      const rows = appointments.map((appointment) => {
        const appointmentRequests = requests.filter((request) => request.appointmentId === appointment.id);
        return {
          "رقم الموعد": appointment.id,
          "المريض": appointment.patientName,
          "رقم الموبايل": appointment.mobile,
          "الوجهة": appointment.clinic,
          "رقم المبنى": appointment.buildingNumber,
          "رقم الشقة": appointment.apartmentNumber,
          "وقت الموعد": appointment.appointmentAt,
          "نوع الرحلة": appointment.kind,
          "احتياجات المريض": appointment.assistance.join("، ") || "لا يحتاج",
          "حالة الموعد": appointment.status,
          "طلبات السيارات": appointmentRequests.map((request) => `${request.direction}: ${request.vehiclePlate ?? "بانتظار التوزيع"} - ${request.status}`).join(" | "),
        };
      });
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(rows);
      worksheet["!cols"] = [
        { wch: 16 }, { wch: 22 }, { wch: 16 }, { wch: 26 }, { wch: 12 }, { wch: 12 },
        { wch: 12 }, { wch: 18 }, { wch: 24 }, { wch: 20 }, { wch: 34 },
      ];
      XLSX.utils.book_append_sheet(workbook, worksheet, "الإحصائيات");
      XLSX.writeFile(workbook, `medical-transport-statistics-${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success("تم إصدار ملف Excel للإحصائيات");
    } catch {
      toast.error("تعذر إصدار ملف Excel. حاول مرة أخرى.");
    }
  }

  function updateRequestStatus(requestId: string, status: VehicleRequest["status"]) {
    updateRequests(requests.map((request) => request.id === requestId ? { ...request, status } : request));
    const request = requests.find((item) => item.id === requestId);
    if (request && status === "تم استلام المريض") {
      updateAppointments(appointments.map((appointment) => appointment.id === request.appointmentId
        ? { ...appointment, status: request.direction === "عودة" ? "مكتملة" : "تم استلام المريض" }
        : appointment));
    }
    logAudit(`${status} للطلب ${requestId}`);
    toast.success(status === "وصلت السيارة" ? "تم تسجيل حضور السيارة" : "تم تأكيد استلام المريض");
  }

  function openNewAppointment() {
    setEditingAppointment(null);
    setView("form");
  }

  function openEditAppointment(appointment: ClinicAppointment) {
    if (appointment.status !== "بانتظار طلب السيارة") {
      toast.error("لا يمكن تعديل موعد مرتبط بطلب سيارة");
      return;
    }
    setEditingAppointment(appointment);
    setView("form");
  }

  function saveAppointment(appointment: ClinicAppointment) {
    const next = editingAppointment
      ? appointments.map((item) => item.id === appointment.id ? appointment : item)
      : [...appointments, appointment];
    updateAppointments(next.sort((a, b) => a.appointmentAt.localeCompare(b.appointmentAt)));
    logAudit(editingAppointment ? `تعديل الموعد ${appointment.id}` : `إضافة الموعد ${appointment.id}`);
    setEditingAppointment(null);
    setView("home");
    toast.success(editingAppointment ? "تم تحديث الموعد" : "تم تسجيل الموعد وأصبح متاحًا لمشرف المبنى");
  }

  function deleteAppointment(appointment: ClinicAppointment) {
    if (appointment.status !== "بانتظار طلب السيارة") {
      toast.error("لا يمكن حذف موعد مرتبط بطلب سيارة");
      return;
    }
    if (!window.confirm(`هل تريد حذف موعد ${appointment.patientName}؟`)) return;
    updateAppointments(appointments.filter((item) => item.id !== appointment.id));
    logAudit(`حذف الموعد ${appointment.id}`);
    toast.success("تم حذف الموعد");
  }

  return (
    <div className="min-h-screen bg-[#f5f7fb]" dir="rtl">
      <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b border-slate-200 bg-[#f5f7fb]/95 px-5 backdrop-blur-xl lg:px-10">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#10233f] text-[#e43846]"><RoleIcon role={session.role} /></div>
          <div><p className="text-xs font-semibold text-[#a61d2d]">{isClinic ? "مساحة العيادة" : isBuildingSupervisor ? "مساحة مشرف المبنى" : "مساحة مشرف السيارات"}</p><h1 className="text-xl font-bold">{title}</h1></div>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden text-xs font-semibold text-slate-400 sm:inline">{session.name}</span>
          {isFleetSupervisor && <button onClick={onManager} className="hidden rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 lg:inline">فتح لوحة السيارات</button>}
          <button aria-label="تسجيل الخروج" onClick={onLogout} className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:text-red-600"><LogOut className="h-4 w-4" /></button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl p-5 lg:p-10">
        {view === "home" && isClinic && (
          <ClinicHome
            appointments={appointments}
            onNew={openNewAppointment}
            onEdit={openEditAppointment}
            onDelete={deleteAppointment}
            onImport={(imported) => {
              updateAppointments([...appointments, ...imported].sort((a, b) => a.appointmentAt.localeCompare(b.appointmentAt)));
              logAudit(`استيراد ${imported.length} موعد من Excel`);
            }}
          />
        )}
        {view === "form" && isClinic && (
          <ClinicForm
            initial={editingAppointment}
            onBack={() => { setEditingAppointment(null); setView("home"); }}
            onSave={saveAppointment}
          />
        )}
        {view === "home" && isBuildingSupervisor && (
          <SupervisorHome
            appointments={appointments}
            requests={requests}
            onRequest={(request, appointmentId) => {
              updateRequests([...requests, request]);
              updateAppointments(appointments.map((appointment) => appointment.id === appointmentId ? { ...appointment, status: request.direction === "عودة" ? "طلب عودة" : "تم طلب السيارة" } : appointment));
              logAudit(`إرسال طلب ${request.direction} ${request.id} إلى مشرف السيارات`);
              toast.success("تم إرسال الطلب إلى مشرف السيارات");
            }}
            onUpdateRequest={updateRequestStatus}
            onCancel={(appointment, request) => {
              updateRequests(requests.filter((item) => item.id !== request.id));
              updateAppointments(appointments.map((item) => item.id === appointment.id
                ? { ...item, status: request.direction === "عودة" ? "تم استلام المريض" : "بانتظار طلب السيارة" }
                : item));
              logAudit(`إلغاء طلب ${request.direction} ${request.id} بواسطة مشرف المبنى`);
              toast.success("تم إلغاء طلب السيارة");
            }}
            onReturn={(appointment, request) => {
              const returnRequest: VehicleRequest = {
                id: `REQ-${Date.now()}`,
                appointmentId: appointment.id,
                direction: "عودة",
                status: "بانتظار التوزيع",
                notificationMethod: request.notificationMethod,
                createdAt: new Date().toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" }),
              };
              updateRequests([...requests, returnRequest]);
              updateAppointments(appointments.map((item) => item.id === appointment.id ? { ...item, status: "طلب عودة" } : item));
              logAudit(`إرسال طلب عودة ${returnRequest.id} إلى مشرف السيارات`);
              toast.success("تم إرسال طلب العودة إلى مشرف السيارات");
            }}
          />
        )}
        {view === "home" && isFleetSupervisor && (
          <FleetSupervisorNotice
            vehicles={fleetVehicles}
            appointments={appointments}
            requests={requests}
            audit={audit}
            onManager={onManager}
            onUpdate={(next) => { updateFleet(next); logAudit("تغيير حالة سيارة في إدارة السيارات"); }}
            onDispatch={(requestIds, vehicle) => {
              const sentAt = new Date().toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" });
              const groupId = requestIds.length > 1 ? `GRP-${Date.now()}` : undefined;
              updateRequests(requests.map((request) => requestIds.includes(request.id)
                ? { ...request, vehiclePlate: vehicle.plate, driver: vehicle.driver, status: "تم إرسال السيارة", groupId, notificationSentAt: sentAt }
                : request));
              logAudit(`إرسال السيارة ${vehicle.plate} إلى ${requestIds.length} طلب`);
              toast.success(requestIds.length > 1 ? `تم جمع ${requestIds.length} رحلات وإرسال السيارة ${vehicle.plate}` : `تم إرسال السيارة ${vehicle.plate}`);
            }}
            onExport={exportStats}
          />
        )}
      </main>
    </div>
  );
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><p className="text-sm font-bold text-[#a61d2d]">{eyebrow}</p><h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 lg:text-3xl">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{description}</p></div>
      {action}
    </div>
  );
}

function ClinicHome({ appointments, onNew, onEdit, onDelete, onImport }: {
  appointments: ClinicAppointment[];
  onNew: () => void;
  onEdit: (appointment: ClinicAppointment) => void;
  onDelete: (appointment: ClinicAppointment) => void;
  onImport: (appointments: ClinicAppointment[]) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  async function importExcel(file?: File) {
    if (!file) return;
    setImporting(true);
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const firstSheet = workbook.SheetNames[0];
      if (!firstSheet) throw new Error("empty workbook");
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[firstSheet], { defval: "" });
      const result = parseImportedAppointments(rows, appointments);
      if (!result.appointments.length) {
        toast.error(result.errors[0] ?? "لم يتم العثور على مواعيد صالحة في الملف");
        return;
      }
      if (!window.confirm(`تم العثور على ${result.appointments.length} موعد صالح. هل تريد إضافتها؟`)) return;
      onImport(result.appointments);
      toast.success(`تم استيراد ${result.appointments.length} موعد من Excel`);
      if (result.errors.length) toast.warning(`تم تجاهل ${result.errors.length} صف غير صالح أو مكرر`);
    } catch {
      toast.error("تعذر قراءة الملف. استخدم قالب Excel المعتمد.");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function downloadTemplate() {
    try {
      const XLSX = await import("xlsx");
      const worksheet = XLSX.utils.json_to_sheet([{
        "اسم المريض أو الرقم": "مريض 001",
        "اسم العيادة أو المستشفى": "مستشفى حمد العام",
        "رقم المبنى": "12",
        "رقم الشقة": "4",
        "رقم الموبايل": "55123456",
        "وقت الموعد": "09:30",
        "نوع الرحلة": "عادي",
        "احتياجات المريض": "يحتاج مرافق، كرسي متحرك",
      }]);
      worksheet["!cols"] = [
        { wch: 22 }, { wch: 28 }, { wch: 14 }, { wch: 14 },
        { wch: 16 }, { wch: 14 }, { wch: 18 }, { wch: 30 },
      ];
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "المواعيد");
      XLSX.writeFile(workbook, "قالب-مواعيد-مجمع-الثمامة.xlsx");
      toast.success("تم تنزيل قالب Excel");
    } catch {
      toast.error("تعذر إنشاء قالب Excel");
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="إدخال المواعيد فقط"
        title="مواعيد المرضى"
        description="أضف موعدًا يدويًا أو استورد مجموعة مواعيد من Excel، ثم عدّل أو احذف المواعيد قبل طلب السيارة."
        action={(
          <div className="flex flex-wrap gap-2">
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(event) => importExcel(event.target.files?.[0])} />
            <button onClick={downloadTemplate} className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-600 hover:bg-slate-50"><Download className="h-4 w-4 text-[#a61d2d]" /> تنزيل قالب</button>
            <button disabled={importing} onClick={() => fileInputRef.current?.click()} className="flex min-h-11 items-center gap-2 rounded-xl border border-[#e6b7b7] bg-[#fff7f7] px-4 text-sm font-bold text-[#a61d2d] hover:bg-[#fff1f2] disabled:opacity-60"><Upload className="h-4 w-4" /> {importing ? "جارٍ الاستيراد" : "استيراد Excel"}</button>
            <button onClick={onNew} className="flex min-h-11 items-center gap-2 rounded-xl bg-[#a61d2d] px-4 text-sm font-bold text-white hover:bg-[#8b1725]"><ClipboardPlus className="h-4 w-4" /> إضافة موعد</button>
          </div>
        )}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <InfoCard icon={CalendarDays} label="مواعيد اليوم" value={String(appointments.length)} tone="teal" />
        <InfoCard icon={Clock3} label="بانتظار السيارة" value={String(appointments.filter((appointment) => appointment.status === "بانتظار طلب السيارة").length)} tone="amber" />
        <InfoCard icon={CheckCircle2} label="مرتبطة بطلب سيارة" value={String(appointments.filter((appointment) => appointment.status !== "بانتظار طلب السيارة").length)} tone="blue" />
      </div>

      <div className="mb-6 flex items-start gap-3 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-xs leading-6 text-blue-800">
        <FileSpreadsheet className="mt-0.5 h-5 w-5 shrink-0" />
        <span><b>استيراد Excel:</b> استخدم القالب المعتمد. الأعمدة المطلوبة هي اسم المريض، المستشفى، رقم المبنى، رقم الشقة، رقم الموبايل، وقت الموعد، ونوع الرحلة. يمكن كتابة احتياجات المريض في عمود واحد.</span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 p-5"><h3 className="font-bold">المواعيد المسجلة</h3><p className="mt-1 text-xs text-slate-400">التعديل والحذف متاحان قبل إنشاء طلب السيارة فقط.</p></div>
        <div className="divide-y divide-slate-100">
          {appointments.length
            ? appointments.map((appointment) => <AppointmentCard key={appointment.id} appointment={appointment} onEdit={onEdit} onDelete={onDelete} />)
            : <EmptyState />}
        </div>
      </div>
    </>
  );
}

function SupervisorHome({ appointments, requests, onRequest, onUpdateRequest, onCancel, onReturn }: {
  appointments: ClinicAppointment[];
  requests: VehicleRequest[];
  onRequest: (request: VehicleRequest, appointmentId: string) => void;
  onUpdateRequest: (requestId: string, status: VehicleRequest["status"]) => void;
  onCancel: (appointment: ClinicAppointment, request: VehicleRequest) => void;
  onReturn: (appointment: ClinicAppointment, request: VehicleRequest) => void;
}) {
  const [buildingFilter, setBuildingFilter] = useState("all");
  const pending = appointments.filter((appointment) => appointment.status !== "مكتملة");
  const buildingNumbers = Array.from(new Set(pending.map((appointment) => appointment.buildingNumber))).sort((first, second) => first.localeCompare(second, "ar", { numeric: true }));
  const visibleAppointments = buildingFilter === "all"
    ? pending
    : pending.filter((appointment) => appointment.buildingNumber === buildingFilter);

  return (
    <>
      <PageHeading
        eyebrow="مشرف المبنى"
        title="اطلب السيارة وتابع وصولها واستلام المريض"
        description="أرسل الطلب إلى مشرف السيارات، وستظهر بيانات السيارة والسائق هنا بعد اعتمادها وإرسالها."
        action={(
          <label className="min-w-52">
            <span className="mb-1.5 block text-xs font-bold text-slate-600">فلتر رقم المبنى</span>
            <select value={buildingFilter} onChange={(event) => setBuildingFilter(event.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-[#d88994]">
              <option value="all">كل المباني ({pending.length})</option>
              {buildingNumbers.map((building) => <option key={building} value={building}>مبنى {building}</option>)}
            </select>
          </label>
        )}
      />
      <div className="mb-6 flex items-center gap-3 rounded-2xl border border-[#f0b8bf] bg-[#effbf8] p-4 text-sm text-[#861b2a]"><ShieldCheck className="h-5 w-5 shrink-0" /><span>لا تظهر السيارة أو السائق إلا بعد أن يختارهما مشرف السيارات ويرسل التنبيه. يمكن إلغاء الطلب قبل وصول السيارة.</span></div>
      <div className="grid gap-4">
        {visibleAppointments.length
          ? visibleAppointments.map((appointment) => {
            const request = [...requests].reverse().find((item) => item.appointmentId === appointment.id);
            return <SupervisorAppointment key={appointment.id} appointment={appointment} request={request} onRequest={onRequest} onUpdateRequest={onUpdateRequest} onCancel={onCancel} onReturn={onReturn} />;
          })
          : <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"><Building2 className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 font-bold text-slate-600">لا توجد مواعيد مطابقة</p><p className="mt-1 text-sm text-slate-400">غيّر رقم المبنى من الفلتر لعرض مواعيد أخرى.</p></div>}
      </div>
    </>
  );
}

function SupervisorAppointment({ appointment, request, onRequest, onUpdateRequest, onCancel, onReturn }: {
  appointment: ClinicAppointment;
  request?: VehicleRequest;
  onRequest: (request: VehicleRequest, appointmentId: string) => void;
  onUpdateRequest: (requestId: string, status: VehicleRequest["status"]) => void;
  onCancel: (appointment: ClinicAppointment, request: VehicleRequest) => void;
  onReturn: (appointment: ClinicAppointment, request: VehicleRequest) => void;
}) {
  const [method, setMethod] = useState<"whatsapp" | "call">("whatsapp");

  function requestCar() {
    if (!canRequestVehicle(appointment, request)) {
      toast.error("لا يوجد موعد قابل للطلب");
      return;
    }
    onRequest({
      id: `REQ-${Date.now()}`,
      appointmentId: appointment.id,
      direction: "ذهاب",
      status: "بانتظار التوزيع",
      notificationMethod: method,
      createdAt: new Date().toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" }),
    }, appointment.id);
  }

  const nextAction = request?.status === "تم إرسال السيارة"
    ? { label: "تأكيد حضور السيارة", status: "وصلت السيارة" as const }
    : request?.status === "وصلت السيارة"
      ? { label: "تأكيد استلام المريض", status: "تم استلام المريض" as const }
      : null;
  const pickup = appointmentPickupLabel(appointment);
  const assistance = appointment.assistance.join("، ");
  const canCancel = request?.status === "بانتظار التوزيع" || request?.status === "تم إرسال السيارة";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_8px_30px_rgba(25,45,85,.04)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className="flex flex-1 items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#eef4f7] text-[#a61d2d]"><CalendarDays className="h-5 w-5" /></div>
          <div>
            <div className="flex flex-wrap items-center gap-2"><p className="font-bold">{appointment.patientName}</p><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">{appointment.id}</span></div>
            <p className="mt-1 text-xs text-slate-400">{appointment.appointmentAt} · {request?.direction === "عودة" ? appointment.clinic : pickup} إلى {request?.direction === "عودة" ? pickup : appointment.clinic} · {appointment.kind}</p>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400"><Phone className="h-3.5 w-3.5" /><span dir="ltr">{appointment.mobile}</span>{assistance && <><span>·</span><Accessibility className="h-3.5 w-3.5" /><span>{assistance}</span></>}</p>
          </div>
        </div>

        {request?.status === "بانتظار التوزيع" && (
          <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700"><Clock3 className="h-4 w-4" /> بانتظار إرسال السيارة من المشرف</div>
        )}
        {request?.vehiclePlate && request.driver && request.status !== "بانتظار التوزيع" && (
          <div className="flex items-center gap-2 text-xs font-bold text-slate-600"><Truck className="h-4 w-4 text-[#a61d2d]" />{request.vehiclePlate} · {request.driver}{request.groupId && <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] text-blue-700">رحلة مجمعة</span>}</div>
        )}
        <span className={`w-fit rounded-full px-3 py-1.5 text-xs font-bold ${request ? "bg-violet-50 text-violet-700" : "bg-amber-50 text-amber-700"}`}>{request?.status ?? "بانتظار الطلب"}</span>

        {!request && (
          <div className="flex items-center gap-2">
            <select value={method} onChange={(event) => setMethod(event.target.value as "whatsapp" | "call")} className="h-10 rounded-xl border border-slate-200 bg-white px-2 text-xs font-bold"><option value="whatsapp">واتساب</option><option value="call">اتصال</option></select>
            <button onClick={requestCar} className="flex min-h-10 items-center gap-2 rounded-xl bg-[#a61d2d] px-3 text-xs font-bold text-white hover:bg-[#8b1725]"><BellRing className="h-4 w-4" /> طلب السيارة</button>
          </div>
        )}
        {request && nextAction && <button onClick={() => onUpdateRequest(request.id, nextAction.status)} className="flex min-h-10 items-center gap-2 rounded-xl bg-[#a61d2d] px-3 text-xs font-bold text-white hover:bg-[#8b1725]"><CheckCircle2 className="h-4 w-4" /> {nextAction.label}</button>}
        {request && canCancel && <button onClick={() => window.confirm("هل تريد إلغاء طلب السيارة؟") && onCancel(appointment, request)} className="flex min-h-10 items-center gap-1 rounded-xl border border-red-100 px-3 text-xs font-bold text-red-600 hover:bg-red-50"><XCircle className="h-4 w-4" /> إلغاء الطلب</button>}
        {request?.status === "تم استلام المريض" && <div className="flex items-center gap-2"><span className="flex items-center gap-1 text-xs font-bold text-emerald-700"><CheckCircle2 className="h-4 w-4" /> تم الاستلام</span><button onClick={() => onReturn(appointment, request)} className="flex min-h-10 items-center gap-1 rounded-xl border border-[#e6b7b7] bg-[#fff7f7] px-3 text-xs font-bold text-[#b33b3b]"><RotateCcw className="h-4 w-4" /> طلب عودة المريض</button></div>}
      </div>
    </div>
  );
}

function FleetSupervisorNotice({ vehicles: currentVehicles, appointments, requests, audit, onManager, onUpdate, onDispatch, onExport }: {
  vehicles: Vehicle[];
  appointments: ClinicAppointment[];
  requests: VehicleRequest[];
  audit: string[];
  onManager: () => void;
  onUpdate: (vehicles: Vehicle[]) => void;
  onDispatch: (requestIds: string[], vehicle: Vehicle) => void;
  onExport: () => void;
}) {
  const [selectedVehicles, setSelectedVehicles] = useState<Record<string, string>>({});
  const pendingRequests = requests.filter((request) => request.status === "بانتظار التوزيع");
  const activeVehiclePlates = new Set(requests
    .filter((request) => request.status === "تم إرسال السيارة" || request.status === "وصلت السيارة")
    .map((request) => request.vehiclePlate)
    .filter((plate): plate is string => Boolean(plate)));
  const dispatchableVehicles = currentVehicles.filter((vehicle) => vehicle.available && !activeVehiclePlates.has(vehicle.plate));
  const pendingAppointments = pendingRequests
    .map((request) => appointments.find((appointment) => appointment.id === request.appointmentId))
    .filter((appointment): appointment is ClinicAppointment => Boolean(appointment));
  const groupSuggestions = suggestTripGroups(pendingAppointments).slice(0, 4);
  const sentRequests = [...requests].filter((request) => request.status !== "بانتظار التوزيع").reverse().slice(0, 6);

  /** بيانات تواصل السائق لطلب مُرسل: الرسالة تشمل كل رحلات المجموعة إن وُجدت. */
  function driverContact(sentRequestIds: string[], vehicle: Vehicle | undefined) {
    if (!vehicle) return { whatsapp: "", call: "" };
    const trips = sentRequestIds
      .map((id) => requests.find((item) => item.id === id))
      .filter((item): item is VehicleRequest => Boolean(item))
      .map((item) => ({ request: { ...item, vehiclePlate: vehicle.plate }, appointment: appointments.find((appointment) => appointment.id === item.appointmentId) }))
      .filter((trip): trip is { request: VehicleRequest; appointment: ClinicAppointment } => Boolean(trip.appointment));
    return {
      whatsapp: trips.length ? driverWhatsAppLink(vehicle.phone, buildDriverTripsMessage(trips)) : "",
      call: driverCallLink(vehicle.phone),
    };
  }

  /** يرسل السيارة ثم يفتح واتساب برسالة جاهزة للسائق (ضمن نفس الضغطة حتى لا يحجبها المتصفح). */
  function dispatchAndNotify(requestIds: string[], vehicle: Vehicle) {
    onDispatch(requestIds, vehicle);
    const wantsWhatsApp = requestIds.some((id) => requests.find((item) => item.id === id)?.notificationMethod === "whatsapp");
    const { whatsapp, call } = driverContact(requestIds, vehicle);
    if (wantsWhatsApp && whatsapp) {
      window.open(whatsapp, "_blank", "noopener");
    } else if (!wantsWhatsApp && call) {
      toast.info(`اتصل بالسائق ${vehicle.driver} لإبلاغه بالرحلة`, { action: { label: "اتصال", onClick: () => { window.location.href = call; } }, duration: 15000 });
    } else if (!whatsapp && !call) {
      toast.error(`رقم السائق ${vehicle.driver} غير صالح، عدّله في لوحة السيارات`);
    }
  }

  function dispatchRequest(request: VehicleRequest, appointment: ClinicAppointment) {
    const suggested = assignVehicleForTrips(dispatchableVehicles, [appointment]);
    const selectedPlate = selectedVehicles[request.id] || suggested?.plate;
    const vehicle = dispatchableVehicles.find((item) => item.plate === selectedPlate);
    if (!vehicle) {
      toast.error("اختر سيارة متاحة ومناسبة للرحلة");
      return;
    }
    dispatchAndNotify([request.id], vehicle);
  }

  function dispatchGroup(appointmentIds: string[]) {
    const groupedAppointments = appointmentIds
      .map((appointmentId) => appointments.find((appointment) => appointment.id === appointmentId))
      .filter((appointment): appointment is ClinicAppointment => Boolean(appointment));
    const groupedRequestIds = pendingRequests
      .filter((request) => appointmentIds.includes(request.appointmentId))
      .map((request) => request.id);
    const vehicle = assignVehicleForTrips(dispatchableVehicles, groupedAppointments);
    if (!vehicle || groupedRequestIds.length < 2) {
      toast.error("لا توجد سيارة مناسبة ومتاحة لجمع هذه الرحلات");
      return;
    }
    dispatchAndNotify(groupedRequestIds, vehicle);
  }

  return (
    <>
      <PageHeading
        eyebrow="مشرف السيارات"
        title="طلبات السيارات والتوزيع"
        description="استقبل تنبيهات مشرفي المباني، اختر السيارة والسائق، ثم أرسلها: يفتح واتساب برسالة جاهزة للسائق، ويظهر التعيين لمشرف المبنى."
        action={<div className="flex flex-wrap gap-2"><button onClick={onExport} className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-600"><Download className="h-4 w-4 text-[#a61d2d]" /> إصدار Excel</button><button onClick={onManager} className="flex min-h-11 items-center gap-2 rounded-xl bg-[#a61d2d] px-4 text-sm font-bold text-white hover:bg-[#8b1725]"><Truck className="h-4 w-4" /> لوحة السيارات</button></div>}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <InfoCard icon={BellRing} label="طلبات بانتظار التوزيع" value={String(pendingRequests.length)} tone="amber" />
        <InfoCard icon={CheckCircle2} label="جاهزة للإرسال" value={String(dispatchableVehicles.length)} tone="blue" />
        <InfoCard icon={Settings2} label="سيارات خارج الخدمة" value={String(currentVehicles.filter((vehicle) => !vehicle.available).length)} tone="teal" />
      </div>

      <section className="overflow-hidden rounded-2xl border border-amber-200 bg-white">
        <div className="flex items-center justify-between border-b border-amber-100 bg-amber-50/70 p-5">
          <div><h3 className="flex items-center gap-2 font-bold text-amber-900"><BellRing className="h-5 w-5" /> تنبيهات طلب السيارات</h3><p className="mt-1 text-xs text-amber-700">كل طلب جديد يحتاج اختيار سيارة وإرسالها من هذه الصفحة.</p></div>
          <span className="rounded-full bg-amber-200 px-3 py-1 text-xs font-bold text-amber-900">{pendingRequests.length} جديد</span>
        </div>
        <div className="divide-y divide-slate-100">
          {pendingRequests.length ? pendingRequests.map((request) => {
            const appointment = appointments.find((item) => item.id === request.appointmentId);
            if (!appointment) return null;
            const suggested = assignVehicleForTrips(dispatchableVehicles, [appointment]);
            const selectedPlate = selectedVehicles[request.id] || suggested?.plate || "none";
            const compatibleVehicles = dispatchableVehicles.filter((vehicle) => appointment.kind === "احتياجات خاصة" ? vehicle.kind === "احتياجات خاصة" : vehicle.kind !== "احتياجات خاصة");
            return (
              <div key={request.id} className="grid gap-4 p-5 lg:grid-cols-[1.4fr_.8fr_auto] lg:items-center">
                <div>
                  <div className="flex flex-wrap items-center gap-2"><p className="font-bold">{appointment.patientName}</p><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">{request.direction} · {request.id}</span></div>
                  <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500"><Clock3 className="h-4 w-4" />{appointment.appointmentAt}<MapPin className="mr-2 h-4 w-4" />{appointmentPickupLabel(appointment)} إلى {appointment.clinic}</p>
                  <p className="mt-2 text-[11px] text-slate-400">{appointment.kind} · تنبيه السائق: {request.notificationMethod === "whatsapp" ? "واتساب" : "اتصال"}</p>
                </div>
                <label>
                  <span className="mb-1.5 block text-xs font-bold text-slate-600">السيارة والسائق</span>
                  <select value={selectedPlate} onChange={(event) => setSelectedVehicles((current) => ({ ...current, [request.id]: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold outline-none focus:border-[#d88994]">
                    {!compatibleVehicles.length && <option value="none">لا توجد سيارة مناسبة</option>}
                    {compatibleVehicles.map((vehicle) => <option key={vehicle.plate} value={vehicle.plate}>{vehicle.plate} · {vehicle.driver} · {vehicle.kind}</option>)}
                  </select>
                </label>
                <button disabled={!compatibleVehicles.length} onClick={() => dispatchRequest(request, appointment)} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#a61d2d] px-4 text-sm font-bold text-white hover:bg-[#8b1725] disabled:cursor-not-allowed disabled:opacity-40"><Send className="h-4 w-4" /> إرسال السيارة</button>
              </div>
            );
          }) : <div className="p-8 text-center"><CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500" /><p className="mt-3 font-bold text-slate-700">لا توجد طلبات جديدة</p><p className="mt-1 text-xs text-slate-400">ستظهر طلبات مشرف المبنى هنا فور إنشائها.</p></div>}
        </div>
      </section>

      <section className="mt-6 overflow-hidden rounded-2xl border border-blue-100 bg-white">
        <div className="border-b border-blue-100 bg-blue-50/60 p-5"><h3 className="flex items-center gap-2 font-bold text-blue-900"><Sparkles className="h-5 w-5" /> اقتراحات جمع الرحلات</h3><p className="mt-1 text-xs leading-5 text-blue-700">المعادلة: 45 نقطة للقرب الزمني ناقص فرق الدقائق، +35 لنفس المبنى، +25 لنفس الوجهة، +10 لنفس نوع الرحلة. يظهر الاقتراح عند 55 نقطة فأكثر وخلال 45 دقيقة.</p></div>
        <div className="grid gap-4 p-5 lg:grid-cols-2">
          {groupSuggestions.length ? groupSuggestions.map((suggestion) => {
            const groupedAppointments = suggestion.appointmentIds.map((id) => appointments.find((appointment) => appointment.id === id)).filter((appointment): appointment is ClinicAppointment => Boolean(appointment));
            const vehicle = assignVehicleForTrips(dispatchableVehicles, groupedAppointments);
            return (
              <div key={suggestion.appointmentIds.join("-")} className="rounded-2xl border border-blue-100 bg-[#f8fbff] p-4">
                <div className="flex items-start justify-between gap-3"><div><p className="font-bold text-slate-800">{groupedAppointments.map((appointment) => appointment.patientName).join(" + ")}</p><p className="mt-1 text-xs text-slate-500">{suggestion.reason}</p></div><span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-bold text-blue-700">{suggestion.score} نقطة</span></div>
                <p className="mt-3 text-xs text-slate-500">السيارة المقترحة: <b>{vehicle ? `${vehicle.plate} · ${vehicle.driver}` : "غير متاحة"}</b></p>
                <button disabled={!vehicle} onClick={() => dispatchGroup(suggestion.appointmentIds)} className="mt-4 flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-white text-xs font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-40"><Send className="h-4 w-4" /> جمع الرحلتين وإرسال السيارة</button>
              </div>
            );
          }) : <p className="col-span-full rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">لا توجد رحلات متقاربة مناسبة للجمع حاليًا.</p>}
        </div>
      </section>

      <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 p-5"><h3 className="font-bold">الطلبات المرسلة</h3><p className="mt-1 text-xs text-slate-400">آخر التعيينات التي أصبحت ظاهرة لمشرف المبنى.</p></div>
        <div className="divide-y divide-slate-100">
          {sentRequests.length ? sentRequests.map((request) => {
            const appointment = appointments.find((item) => item.id === request.appointmentId);
            const vehicle = currentVehicles.find((item) => item.plate === request.vehiclePlate);
            const active = request.status === "تم إرسال السيارة" || request.status === "وصلت السيارة";
            const groupIds = request.groupId ? requests.filter((item) => item.groupId === request.groupId).map((item) => item.id) : [request.id];
            const contact = active ? driverContact(groupIds, vehicle) : { whatsapp: "", call: "" };
            return <div key={request.id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center"><div className="flex-1"><p className="font-bold">{appointment?.patientName ?? request.appointmentId}</p><p className="mt-1 text-xs text-slate-400">{request.direction} · {appointment?.appointmentAt ?? "—"} · {appointment?.clinic ?? "—"}</p></div><div className="text-xs font-bold text-slate-600">{request.vehiclePlate ?? "—"} · {request.driver ?? "—"}</div>{(contact.whatsapp || contact.call) && <div className="flex gap-2">{contact.whatsapp && <a href={contact.whatsapp} target="_blank" rel="noopener noreferrer" className="flex min-h-9 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-bold text-white hover:bg-emerald-700"><MessageCircle className="h-4 w-4" /> واتساب</a>}{contact.call && <a href={contact.call} className="flex min-h-9 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50"><Phone className="h-4 w-4" /> اتصال</a>}</div>}<span className="w-fit rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700">{request.status}</span></div>;
          }) : <p className="p-5 text-xs text-slate-400">لا توجد سيارات مرسلة بعد.</p>}
        </div>
      </section>

      <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 p-5"><h3 className="font-bold">حالة السيارات</h3><p className="mt-1 text-xs text-slate-400">السيارات المتاحة فقط تدخل في التوزيع والاقتراحات.</p></div>
        <div className="divide-y divide-slate-100">
          {currentVehicles.map((vehicle) => <div key={vehicle.plate} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center"><div className="flex flex-1 items-center gap-3"><div className={`flex h-11 w-11 items-center justify-center rounded-xl ${vehicle.available ? "bg-[#fff1f2] text-[#a61d2d]" : "bg-slate-100 text-slate-400"}`}><Truck className="h-5 w-5" /></div><div><p className="font-bold">{vehicle.plate} · {vehicle.driver}</p><p className="mt-1 text-xs text-slate-400">{vehicle.kind} · {vehicle.phone}</p></div></div><span className={`rounded-full px-3 py-1.5 text-xs font-bold ${vehicle.available ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{vehicle.available ? "متاحة للخدمة" : "خارج الخدمة"}</span><button onClick={() => onUpdate(currentVehicles.map((item) => item.plate === vehicle.plate ? { ...item, available: !item.available } : item))} className={`min-h-10 rounded-xl px-3 text-xs font-bold ${vehicle.available ? "border border-slate-200 text-slate-600" : "bg-[#a61d2d] text-white"}`}>{vehicle.available ? "إيقاف عن الخدمة" : "إتاحة للخدمة"}</button></div>)}
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white"><div className="border-b border-slate-100 p-5"><h3 className="font-bold">سجل العمليات</h3><p className="mt-1 text-xs text-slate-400">تتبع طلبات السيارات وتغييرات حالتها</p></div><div className="max-h-48 divide-y divide-slate-100 overflow-auto">{audit.length ? audit.map((item, index) => <p key={`${item}-${index}`} className="px-5 py-3 text-xs text-slate-500">{item}</p>) : <p className="p-5 text-xs text-slate-400">لا توجد عمليات مسجلة بعد</p>}</div></section>
    </>
  );
}

function ClinicForm({ initial, onBack, onSave }: { initial: ClinicAppointment | null; onBack: () => void; onSave: (appointment: ClinicAppointment) => void }) {
  const [form, setForm] = useState(() => ({
    patientName: initial?.patientName ?? "",
    clinic: initial?.clinic ?? "",
    buildingNumber: initial?.buildingNumber ?? "",
    apartmentNumber: initial?.apartmentNumber ?? "",
    mobile: initial?.mobile === "-" ? "" : initial?.mobile ?? "",
    appointmentAt: initial?.appointmentAt ?? "09:00",
    kind: initial?.kind ?? "عادي" as AppointmentKind,
    assistance: initial?.assistance ?? [] as AssistanceNeed[],
  }));

  function toggleAssistance(need: AssistanceNeed) {
    setForm((current) => ({
      ...current,
      assistance: current.assistance.includes(need)
        ? current.assistance.filter((item) => item !== need)
        : [...current.assistance, need],
    }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.patientName || !form.clinic || !form.buildingNumber || !form.apartmentNumber || !form.mobile || !form.appointmentAt) {
      toast.error("أكمل بيانات المريض والمبنى والشقة والموبايل والموعد");
      return;
    }
    const normalizedMobile = form.mobile.replace(/[\s-]/g, "");
    if (!/^\+?\d{8,15}$/.test(normalizedMobile)) {
      toast.error("أدخل رقم موبايل صحيحًا من 8 إلى 15 رقمًا");
      return;
    }
    onSave({
      ...form,
      mobile: normalizedMobile,
      id: initial?.id ?? `APT-${Date.now().toString().slice(-6)}`,
      status: initial?.status ?? "بانتظار طلب السيارة",
    });
  }

  return (
    <div className="mx-auto max-w-3xl">
      <button onClick={onBack} className="mb-5 flex items-center gap-2 text-sm font-bold text-[#a61d2d]"><ArrowLeft className="h-4 w-4" /> العودة للمواعيد</button>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_8px_30px_rgba(25,45,85,.04)] sm:p-8">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#fff1f2] text-[#a61d2d]"><Hospital className="h-5 w-5" /></div>
          <div><p className="text-sm font-bold text-[#a61d2d]">نموذج العيادة</p><h2 className="mt-1 text-2xl font-bold">{initial ? "تعديل موعد طبي" : "إضافة موعد طبي"}</h2><p className="mt-1 text-xs text-slate-400">لن يتم طلب السيارة من هذه الصفحة.</p></div>
        </div>
        <form onSubmit={submit} className="mt-7 grid gap-4 sm:grid-cols-2">
          <Field label="اسم المريض أو الرقم" value={form.patientName} onChange={(value) => setForm({ ...form, patientName: value })} placeholder="مريض 009" wide />
          <Field label="اسم العيادة أو المستشفى" value={form.clinic} onChange={(value) => setForm({ ...form, clinic: value })} placeholder="مستشفى حمد العام" wide />
          <Field label="رقم المبنى" value={form.buildingNumber} onChange={(value) => setForm({ ...form, buildingNumber: value })} placeholder="12" />
          <Field label="رقم الشقة" value={form.apartmentNumber} onChange={(value) => setForm({ ...form, apartmentNumber: value })} placeholder="4" />
          <Field label="رقم الموبايل" value={form.mobile} onChange={(value) => setForm({ ...form, mobile: value })} placeholder="55123456" type="tel" dir="ltr" />
          <Field label="وقت الموعد" value={form.appointmentAt} onChange={(value) => setForm({ ...form, appointmentAt: value })} type="time" />

          <fieldset className="sm:col-span-2">
            <legend className="mb-2 block text-xs font-bold text-slate-600">نوع الرحلة</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {(["عادي", "احتياجات خاصة"] as AppointmentKind[]).map((kind) => (
                <button key={kind} type="button" onClick={() => setForm({ ...form, kind })} className={`flex min-h-12 items-center gap-3 rounded-xl border px-4 text-sm font-bold transition ${form.kind === kind ? "border-[#d88994] bg-[#fff1f2] text-[#861b2a]" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>
                  {kind === "احتياجات خاصة" ? <Accessibility className="h-5 w-5" /> : <Truck className="h-5 w-5" />}{kind}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="sm:col-span-2">
            <legend className="mb-2 block text-xs font-bold text-slate-600">احتياجات المريض</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {(["يحتاج مرافق", "كرسي متحرك"] as AssistanceNeed[]).map((need) => {
                const selected = form.assistance.includes(need);
                return (
                  <label key={need} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-4 text-sm font-bold transition ${selected ? "border-[#a8d9cf] bg-[#effbf8] text-[#176d5f]" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>
                    <input type="checkbox" checked={selected} onChange={() => toggleAssistance(need)} className="h-4 w-4 accent-[#a61d2d]" />
                    {need}
                  </label>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-slate-400">يمكن اختيار الخيارين معًا أو تركهما دون تحديد.</p>
          </fieldset>

          <div className="flex gap-3 sm:col-span-2">
            <button className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#a61d2d] text-sm font-bold text-white hover:bg-[#8b1725]"><CheckCircle2 className="h-4 w-4" /> {initial ? "حفظ التعديلات" : "حفظ الموعد"}</button>
            <button type="button" onClick={onBack} className="rounded-xl border border-slate-200 px-5 text-sm font-bold text-slate-600">إلغاء</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder = "", type = "text", wide, dir }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  wide?: boolean;
  dir?: "rtl" | "ltr";
}) {
  return (
    <label className={`block ${wide ? "sm:col-span-2" : ""}`}>
      <span className="mb-1.5 block text-xs font-bold text-slate-600">{label}</span>
      <input dir={dir} type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#e6a1aa]" />
    </label>
  );
}

function AppointmentCard({ appointment, onEdit, onDelete }: {
  appointment: ClinicAppointment;
  onEdit: (appointment: ClinicAppointment) => void;
  onDelete: (appointment: ClinicAppointment) => void;
}) {
  const editable = appointment.status === "بانتظار طلب السيارة";
  return (
    <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center">
      <div className="flex min-w-[95px] items-center gap-2 text-sm font-bold"><Clock3 className="h-4 w-4 text-slate-300" />{appointment.appointmentAt}</div>
      <div className="flex-1">
        <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-bold">{appointment.patientName}</p><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">{appointment.id}</span></div>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400"><Building2 className="h-3.5 w-3.5" />{appointmentPickupLabel(appointment)}<span>·</span>{appointment.clinic}<span>·</span>{appointment.kind}</p>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400"><Phone className="h-3.5 w-3.5" /><span dir="ltr">{appointment.mobile}</span>{appointment.assistance.length > 0 && <><span>·</span><Accessibility className="h-3.5 w-3.5" /><span>{appointment.assistance.join("، ")}</span></>}</p>
      </div>
      <span className={`w-fit rounded-full px-3 py-1.5 text-xs font-bold ${appointment.status === "بانتظار طلب السيارة" ? "bg-amber-50 text-amber-700" : "bg-violet-50 text-violet-700"}`}>{appointment.status}</span>
      <div className="flex items-center gap-2">
        <button disabled={!editable} title={editable ? "تعديل الموعد" : "لا يمكن التعديل بعد طلب السيارة"} onClick={() => onEdit(appointment)} className="flex min-h-10 items-center gap-1 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"><Pencil className="h-3.5 w-3.5" /> تعديل</button>
        <button disabled={!editable} title={editable ? "حذف الموعد" : "لا يمكن الحذف بعد طلب السيارة"} onClick={() => onDelete(appointment)} className="flex min-h-10 items-center gap-1 rounded-xl border border-red-100 px-3 text-xs font-bold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" /> حذف</button>
      </div>
    </div>
  );
}

function InfoCard({ icon: Icon, label, value, tone }: { icon: typeof CalendarDays; label: string; value: string; tone: "teal" | "amber" | "blue" }) {
  const styles = { teal: "bg-[#e6f4f1] text-[#a61d2d]", amber: "bg-[#fff1e6] text-[#d86f20]", blue: "bg-[#e9efff] text-[#2864dc]" };
  return <div className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between"><p className="text-xs font-bold text-slate-500">{label}</p><div className={`flex h-10 w-10 items-center justify-center rounded-xl ${styles[tone]}`}><Icon className="h-5 w-5" /></div></div><p className="mt-4 text-3xl font-bold">{value}</p></div>;
}

function EmptyState() {
  return <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center"><UsersRound className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 font-bold text-slate-600">لا توجد مواعيد مسجلة</p><p className="mt-1 text-sm text-slate-400">أضف موعدًا جديدًا أو استورد ملف Excel.</p></div>;
}

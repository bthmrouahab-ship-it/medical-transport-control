import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Languages, Loader2 } from "lucide-react";
import {
  DEFAULT_VEHICLES,
  approvalOf,
  buildDriverMessage,
  isApproved,
  isNonMedical,
  isReturnOnly,
  localDateString,
  migrateAppointment,
  migrateRequest,
  requestPersons,
  statusText,
  whatsappLink,
  type Approval,
  type ClinicAppointment,
  type Vehicle,
  type VehicleRequest,
} from "@shared/transport";
import type { UserProfile } from "@shared/users";
import { useHospitals } from "@/lib/useShared";
import AppHeader from "@/components/AppHeader";
import { addDays, btn, byAppointmentTime, headerButton, timeLabel } from "@/components/ui-kit";
import { pickupDetails } from "@shared/trips";
import { checkReplyChanges, confirmPendingChecks, type CheckKind } from "@shared/driverChecks";
import { CLINIC_TEXT, useLang } from "@/lib/i18n";
import { ClinicForm, ClinicHome } from "./ClinicPages";
import { SupervisorHome } from "./SupervisorPage";
import { FleetSupervisorPage } from "./FleetSupervisorPage";
import Login from "./Login";
import ChangePasswordForm from "@/components/ChangePasswordForm";
import { SHARED_KEYS, clearSharedBackend, loadState, removeState, saveState, setSharedBackend, subscribeState } from "@/lib/appStore";
import { createApiBackend } from "@/lib/apiBackend";
import { authErrorMessage, logout, watchSession } from "@/lib/auth";

// صفحات تُحمَّل حسب دور المستخدم فقط، حتى لا يحمّل كل مستخدم كود الأدوار الأخرى والخرائط والمخططات
const AdminPanel = lazy(() => import("./AdminPanel"));
const DriverPage = lazy(() => import("./DriverPage"));
const FleetDashboard = lazy(() => import("@/components/FleetDashboard"));

function PageLoading() {
  return <div className="flex min-h-screen items-center justify-center bg-page text-slate-400" dir="rtl"><Loader2 className="h-6 w-6 animate-spin" /><span className="sr-only">جارٍ التحميل</span></div>;
}

type Role = "clinic" | "clinicLead" | "buildingSupervisor" | "buildingLead" | "fleetSupervisor";
type Session = { role: Role; name: string; uid: string };
type ClinicView = "home" | "form";

/** تسجيل خروج تلقائي بعد هذه المدة من دون أي نشاط على الصفحة. */
const IDLE_LOGOUT_MS = 60 * 60 * 1000;

function loadAppointments() {
  return loadState<unknown[]>("fox_appointments", [])
    .map((appointment, index) => migrateAppointment(appointment, index))
    .filter((appointment): appointment is ClinicAppointment => Boolean(appointment));
}

function loadRequests() {
  return loadState<unknown[]>("fox_requests", [])
    .map(migrateRequest)
    .filter((request): request is VehicleRequest => Boolean(request));
}

type Gate =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "profile"; profile: UserProfile }
  | { status: "ready"; profile: UserProfile }
  | { status: "error"; message: string };

/**
 * بوابة الدخول: لا تُحمَّل أي بيانات قبل تسجيل الدخول بحساب مفعّل،
 * ثم تُفتح صفحة الدور المسجل في ملف المستخدم (وليس دورًا يختاره المستخدم).
 */
export default function RolePortal() {
  const [gate, setGate] = useState<Gate>({ status: "loading" });
  const [changingPassword, setChangingPassword] = useState(false);
  const [showManager, setShowManager] = useState(false);
  // المستخدم الذي حُمّلت (أو يجري تحميل) بياناته المشتركة
  const dataUid = useRef<string | null>(null);
  const dataLoaded = useRef(false);

  const signOutNow = useCallback(async (message?: string) => {
    clearSharedBackend();
    dataUid.current = null;
    dataLoaded.current = false;
    setShowManager(false);
    setChangingPassword(false);
    await logout().catch(() => {});
    if (message) toast.error(message);
  }, []);

  useEffect(() => {
    // مسح بقايا الإصدارات السابقة التي كانت تحفظ الجلسة وبيانات المرضى على الجهاز.
    ["fox_session", "fox_audit", ...SHARED_KEYS].forEach(removeState);

    return watchSession((profile, message) => {
      if (!profile) {
        clearSharedBackend();
        dataUid.current = null;
        dataLoaded.current = false;
        setShowManager(false);
        setChangingPassword(false);
        setGate({ status: "signedOut" });
        if (message) toast.error(message);
        return;
      }
      if (!profile.active) {
        signOutNow("تم إيقاف حسابك. تواصل مع مدير النظام.");
        return;
      }
      // تحديث الملف (مثل تغيير الاسم) لا يعيد تحميل الصفحة؛ السائق لا يحتاج تحميل بيانات
      const stillReady = (current: Gate) => current.status === "ready" && current.profile.uid === profile.uid
        && (profile.role === "driver"
          ? current.profile.role === "driver"
          : dataLoaded.current && dataUid.current === profile.uid && current.profile.role === profile.role);
      setGate((current) => stillReady(current)
        ? { status: "ready", profile }
        : { status: "profile", profile });
    }, (error) => {
      console.error("[auth] session", error);
      setGate({ status: "error", message: authErrorMessage(error, "تعذر الاتصال بالخادم. تحقق من الإنترنت ثم أعد تحميل الصفحة.") });
    });
  }, [signOutNow]);

  // تحميل البيانات المشتركة بعد التحقق من الحساب وتغيير كلمة المرور المؤقتة.
  useEffect(() => {
    if (gate.status !== "profile" || gate.profile.mustChangePassword) return;
    const profile = gate.profile;
    // السائق لا يحمّل بيانات المرضى أو الطلبات؛ صفحته ترسل الموقع فقط
    if (profile.role === "driver") {
      clearSharedBackend();
      dataUid.current = null;
      dataLoaded.current = false;
      setGate({ status: "ready", profile });
      return;
    }
    if (dataUid.current === profile.uid) {
      if (dataLoaded.current) setGate({ status: "ready", profile });
      return;
    }
    dataUid.current = profile.uid;
    dataLoaded.current = false;
    setSharedBackend(createApiBackend(), (error) => {
      console.error("[save]", error);
      toast.error(authErrorMessage(error, "تعذر حفظ التغيير. تحقق من الاتصال وحاول مرة أخرى."));
    })
      .then(() => {
        if (dataUid.current !== profile.uid) return;
        dataLoaded.current = true;
        setGate((current) => current.status === "profile" && current.profile.uid === profile.uid ? { status: "ready", profile: current.profile } : current);
      })
      .catch((error) => {
        console.error("[data] init", error);
        if (dataUid.current !== profile.uid) return;
        dataUid.current = null;
        setGate({ status: "error", message: "تعذر تحميل البيانات. تحقق من الاتصال ثم أعد تحميل الصفحة." });
      });
  }, [gate]);

  // تسجيل خروج تلقائي عند عدم النشاط
  const signedIn = gate.status === "profile" || gate.status === "ready";
  useEffect(() => {
    if (!signedIn) return;
    let last = Date.now();
    const touch = () => { last = Date.now(); };
    const events = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    events.forEach((name) => window.addEventListener(name, touch, { passive: true }));
    const timer = window.setInterval(() => {
      if (Date.now() - last > IDLE_LOGOUT_MS) signOutNow("تم تسجيل الخروج تلقائيًا بسبب عدم النشاط.");
    }, 60 * 1000);
    return () => {
      events.forEach((name) => window.removeEventListener(name, touch));
      window.clearInterval(timer);
    };
  }, [signedIn, signOutNow]);

  if (gate.status === "loading" || (gate.status === "profile" && !gate.profile.mustChangePassword)) {
    return <PageLoading />;
  }
  if (gate.status === "signedOut") return <Login />;
  if (gate.status === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-page p-4" dir="rtl">
        <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-card ring-1 ring-slate-200/80">
          <p className="font-semibold text-slate-700">{gate.message}</p>
          <div className="mt-5 flex justify-center gap-3">
            <button onClick={() => window.location.reload()} className={btn("primary")}>إعادة المحاولة</button>
            <button onClick={() => signOutNow()} className={btn("secondary")}>تسجيل الخروج</button>
          </div>
        </div>
      </div>
    );
  }

  const profile = gate.profile;
  if (profile.mustChangePassword || changingPassword) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-page p-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-card ring-1 ring-slate-200/80 sm:p-8">
          <ChangePasswordForm
            required={profile.mustChangePassword}
            onDone={() => setChangingPassword(false)}
            onCancel={profile.mustChangePassword ? () => signOutNow() : () => setChangingPassword(false)}
          />
        </div>
      </div>
    );
  }

  if (profile.role === "driver") {
    return <Suspense fallback={<PageLoading />}><DriverPage profile={profile} onLogout={() => signOutNow()} onChangePassword={() => setChangingPassword(true)} /></Suspense>;
  }

  if (profile.role === "admin") {
    return <Suspense fallback={<PageLoading />}><AdminPanel profile={profile} onLogout={() => signOutNow()} onChangePassword={() => setChangingPassword(true)} /></Suspense>;
  }

  if (showManager && profile.role === "fleetSupervisor") {
    return (
      <div className="min-h-screen bg-page" dir="rtl">
        <AppHeader
          role="مشرف السيارات"
          name={profile.displayName}
          actions={<button onClick={() => setShowManager(false)} className={headerButton}><ArrowRight className="h-4 w-4" /> التوزيع</button>}
          onLogout={() => signOutNow()}
        />
        <main className="mx-auto max-w-7xl p-4 lg:p-8"><Suspense fallback={<div className="flex min-h-64 items-center justify-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>}><FleetDashboard alerts actor={profile.displayName} /></Suspense></main>
      </div>
    );
  }

  return (
    <RoleShell
      key={profile.uid + profile.role}
      session={{ role: profile.role, name: profile.displayName, uid: profile.uid }}
      onLogout={() => signOutNow()}
      onManager={() => setShowManager(true)}
      onChangePassword={() => setChangingPassword(true)}
    />
  );
}

const ROLE_TITLES: Record<Role, string> = {
  clinic: "العيادة",
  clinicLead: "مسؤول العيادة",
  buildingSupervisor: "مشرف المبنى",
  buildingLead: "مسؤول مشرفي المباني",
  fleetSupervisor: "مشرف السيارات",
};

function RoleShell({ session, onLogout, onManager, onChangePassword }: {
  session: Session;
  onLogout: () => void;
  onManager: () => void;
  onChangePassword: () => void;
}) {
  const [appointments, setAppointments] = useState<ClinicAppointment[]>(loadAppointments);
  const [requests, setRequests] = useState<VehicleRequest[]>(loadRequests);
  const [fleetVehicles, setFleetVehicles] = useState<Vehicle[]>(() => loadState("fox_fleet", DEFAULT_VEHICLES));
  const [view, setView] = useState<ClinicView>("home");
  const [editingAppointment, setEditingAppointment] = useState<ClinicAppointment | null>(null);
  /** نموذج جديد لطلب عودة فقط من المستشفى (بدل موعد) */
  const [newReturnOnly, setNewReturnOnly] = useState(false);
  const [lang, setLang] = useLang();
  // مسؤول العيادة يبدأ بمواعيد الغد (يوافق عليها قبل يومها)
  const [selectedDate, setSelectedDate] = useState(() => (session.role === "clinicLead" ? addDays(localDateString(), 1) : localDateString()));
  const hospitals = useHospitals();
  const isClinic = session.role === "clinic" || session.role === "clinicLead";
  const isClinicLead = session.role === "clinicLead";
  const t = CLINIC_TEXT[isClinic ? lang : "ar"];

  // تحديث الشاشة فورًا عند وصول تغييرات من مستخدمين آخرين
  useEffect(() => {
    const refresh = (key: string) => {
      if (key === "fox_appointments") setAppointments(loadAppointments());
      else if (key === "fox_requests") setRequests(loadRequests());
      else if (key === "fox_fleet") setFleetVehicles(loadState("fox_fleet", DEFAULT_VEHICLES));
    };
    const stop = subscribeState(refresh);
    // تغييرات وصلت بين أول عرض للصفحة وبدء الاشتراك
    ["fox_appointments", "fox_requests", "fox_fleet"].forEach(refresh);
    return stop;
  }, []);

  // المقارنة مع ما يعرضه الموقع (بعد التوحيد) حتى لا تُكتب مواعيد أو طلبات لم تتغير
  function updateAppointments(next: ClinicAppointment[]) { saveState("fox_appointments", next, appointments); setAppointments(next); }
  // أحدث قائمة للمواعيد: للأزرار التي تعمل بعد تغيّر القائمة (مثل «تراجع» في رسالة الاستبعاد)
  const latestAppointments = useRef(appointments);
  latestAppointments.current = appointments;
  function updateRequests(next: VehicleRequest[]) { saveState("fox_requests", next, requests); setRequests(next); }
  function updateFleet(next: Vehicle[]) { setFleetVehicles(next); saveState("fox_fleet", next); }

  async function exportStats() {
    try {
      const XLSX = await import("xlsx");
      const rows = appointments.map((appointment) => {
        const appointmentRequests = requests.filter((request) => request.appointmentId === appointment.id);
        return {
          "رقم الموعد": appointment.id,
          "الضيف": appointment.patientName,
          "رقم الموبايل": appointment.mobile,
          "الوجهة": appointment.clinic,
          "رقم المبنى": appointment.buildingNumber,
          "رقم الشقة": appointment.apartmentNumber,
          "تاريخ الموعد": appointment.appointmentDate,
          "وقت الموعد": appointment.appointmentAt,
          "نوع الرحلة": appointment.kind,
          "احتياجات الضيف": appointment.assistance.join("، ") || "لا يحتاج",
          "حالة الموعد": statusText(appointment.status),
          "طلبات السيارات": appointmentRequests.map((request) => `${request.direction}: ${request.vehiclePlate ?? "بانتظار التوزيع"} - ${request.status}`).join(" | "),
        };
      });
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(rows);
      worksheet["!cols"] = [{ wch: 16 }, { wch: 22 }, { wch: 16 }, { wch: 26 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 18 }, { wch: 24 }, { wch: 20 }, { wch: 34 }];
      XLSX.utils.book_append_sheet(workbook, worksheet, "الرحلات");
      XLSX.writeFile(workbook, `transport-${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success("تم إصدار ملف Excel");
    } catch {
      toast.error("تعذر إصدار ملف Excel. حاول مرة أخرى.");
    }
  }

  function updateRequestStatus(requestId: string, status: VehicleRequest["status"]) {
    const request = requests.find((item) => item.id === requestId);
    const appointment = request && appointments.find((item) => item.id === request.appointmentId);
    // عند استلام المريض: وقت بداية الطريق، والوقت المتوقع للوصول، وإحداثيات الوجهة لاكتشاف الوصول عبر GPS
    const passengers = request?.groupId ? requests.filter((item) => item.groupId === request.groupId).length : 1;
    // النقل بين موعدين: الاستلام من مستشفى الموعد الأول
    const firstAppointment = request?.fromAppointmentId ? appointments.find((item) => item.id === request.fromAppointmentId) ?? null : null;
    const pickup = status === "تم استلام المريض" && request && appointment
      ? pickupDetails(request, appointment, hospitals, new Date(), passengers, firstAppointment)
      : {};
    // ما سجّله السائق وينتظر الرد يُعتبر مؤكدًا من المشرف الذي تقدّم بالحالة بنفسه
    const confirmed = request ? confirmPendingChecks(request, session.name) : {};
    updateRequests(requests.map((item) => item.id === requestId ? { ...item, status, ...pickup, ...confirmed } : item));
    // عودة الـ Nurse فقط لا تغيّر حالة موعد الضيف (يبقى في موعده)
    if (request && status === "تم استلام المريض" && !request.nurseOnly) {
      // الموعد الأول في النقل ينتهي عند استلام الضيف منه
      updateAppointments(appointments.map((appointment) => appointment.id === request.appointmentId
        ? { ...appointment, status: request.direction === "عودة" ? "مكتملة" : "تم استلام المريض" }
        : appointment.id === request.fromAppointmentId ? { ...appointment, status: "مكتملة" } : appointment));
    }
    toast.success(status === "وصلت السيارة" ? "تم تسجيل وصول السيارة" : request?.nurseOnly ? "تم تأكيد استلام الـ Nurse" : "تم تأكيد استلام الضيف", {
      description: "etaAt" in pickup && pickup.etaAt ? `الوصول المتوقع إلى الوجهة ${timeLabel(new Date(pickup.etaAt))}` : undefined,
    });
  }

  /**
   * رد مشرف المبنى على ما سجّله السائق من تطبيقه. النفي يعيد الطلب إلى المرحلة السابقة (ونفي الاستلام
   * يعيد حالة الموعد كما كانت قبله)، ويصل تنبيه لمشرف السيارات والسائق.
   */
  function replyToDriverCheck(request: VehicleRequest, kind: CheckKind, reply: "confirmed" | "denied") {
    const { set, unset } = checkReplyChanges(request, kind, reply, session.name);
    updateRequests(requests.map((item) => {
      if (item.id !== request.id) return item;
      const next: VehicleRequest = { ...item, ...set };
      unset.forEach((field) => delete next[field]);
      return next;
    }));
    if (reply === "denied" && kind === "pickup" && !request.nurseOnly) {
      updateAppointments(appointments.map((appointment) => appointment.id === request.appointmentId
        ? { ...appointment, status: request.direction === "عودة" ? "طلب عودة" : "تم طلب السيارة" }
        : appointment.id === request.fromAppointmentId ? { ...appointment, status: "تم استلام المريض" } : appointment));
    }
    if (reply === "confirmed") toast.success(kind === "arrival" ? "تم تأكيد وصول السيارة" : "تم تأكيد استلام الضيف");
    else toast.warning(kind === "arrival" ? "سُجّل أن السيارة لم تصل" : "سُجّل أن الضيف لم يُستلم", { description: "عادت الرحلة إلى المرحلة السابقة، ووصل تنبيه لمشرف السيارات والسائق." });
  }

  /** وصول السيارة إلى الوجهة: بتأكيد مشرف السيارات، أو بانتهاء المدة التقديرية لسيارة بلا GPS. */
  function markArrived(requestIds: string[], source: "manual" | "estimate") {
    const arrivedAt = new Date().toISOString();
    updateRequests(requests.map((request) => requestIds.includes(request.id) && request.status === "تم استلام المريض"
      ? { ...request, status: "وصلت الوجهة" as const, arrivedAt: source === "estimate" && request.etaAt ? request.etaAt : arrivedAt, arrivalSource: source }
      : request));
  }

  /**
   * إنهاء رحلة عالقة من مشرف السيارات (أُرسلت السيارة ولم يُسجَّل استلام الضيف): تُعتبر الرحلة منتهية
   * فتصبح السيارة متاحة، وتتقدم حالة الموعد كما عند الاستلام (العودة والموعد الأول في النقل: مكتملة).
   */
  function endTrips(requestIds: string[]) {
    const arrivedAt = new Date().toISOString();
    const ended = requests.filter((request) => requestIds.includes(request.id) && (request.status === "تم إرسال السيارة" || request.status === "وصلت السيارة"));
    if (!ended.length) return;
    updateRequests(requests.map((request) => ended.includes(request)
      ? { ...request, status: "وصلت الوجهة" as const, arrivedAt, arrivalSource: "manual" as const }
      : request));
    const next = new Map<string, ClinicAppointment["status"]>();
    // عودة الـ Nurse فقط لا تغيّر حالة موعد الضيف
    for (const request of ended.filter((item) => !item.nurseOnly)) {
      next.set(request.appointmentId, request.direction === "عودة" ? "مكتملة" : "تم استلام المريض");
      if (request.fromAppointmentId) next.set(request.fromAppointmentId, "مكتملة");
    }
    const moves: Partial<Record<ClinicAppointment["status"], ClinicAppointment["status"]>> = { "تم طلب السيارة": "تم استلام المريض", "طلب عودة": "مكتملة", "تم استلام المريض": "مكتملة" };
    updateAppointments(appointments.map((appointment) => next.has(appointment.id) && moves[appointment.status] === next.get(appointment.id)
      ? { ...appointment, status: next.get(appointment.id)! }
      : appointment));
    toast.success(`انتهت رحلة السيارة ${ended[0].vehiclePlate ?? ""}، وأصبحت متاحة`);
  }

  function openEditAppointment(appointment: ClinicAppointment) {
    if (appointment.status !== "بانتظار طلب السيارة") {
      toast.error(t.errLocked);
      return;
    }
    setEditingAppointment(appointment);
    setView("form");
  }

  /**
   * موافقة مسؤول العيادة على الموعد الجديد: ما يضيفه المسؤول موافق عليه باسمه، وما تضيفه العيادة ينتظر موافقته.
   * تعديل العيادة لموعد غير مستبعد يعيده إلى انتظار الموافقة (المستبعد يبقى مستبعدًا).
   */
  function withApproval(appointment: ClinicAppointment, before?: ClinicAppointment): ClinicAppointment {
    const { approval: _approval, approvedBy: _approvedBy, approvedAt: _approvedAt, excludedBy: _excludedBy, excludedAt: _excludedAt, ...rest } = appointment;
    if (before) {
      // نموذج التعديل لا يحمل خانات الموافقة: تبقى كما كانت للمسؤول وللموعد المستبعد
      if (isClinicLead || approvalOf(before) === "excluded") {
        const kept = Object.fromEntries((["approval", "approvedBy", "approvedAt", "excludedBy", "excludedAt"] as const)
          .flatMap((field) => (before[field] !== undefined ? [[field, before[field]]] : [])));
        return { ...rest, ...kept };
      }
      return { ...rest, approval: "pending" };
    }
    return isClinicLead
      ? { ...rest, approval: "approved", approvedBy: session.name, approvedAt: new Date().toISOString() }
      : { ...rest, approval: "pending" };
  }

  /** موافقة مسؤول العيادة أو استبعاده أو إرجاعه (للمواعيد التي لم يُطلب لها سيارة بعد)، لموعد أو أكثر في حفظ واحد */
  function setApproval(changes: Record<string, Approval>) {
    const at = new Date().toISOString();
    const current = latestAppointments.current;
    const next = current.map((appointment) => {
      const approval = changes[appointment.id];
      if (!approval || appointment.status !== "بانتظار طلب السيارة") return appointment;
      const { approvedBy: _approvedBy, approvedAt: _approvedAt, excludedBy: _excludedBy, excludedAt: _excludedAt, ...rest } = appointment;
      if (approval === "approved") return { ...rest, approval, approvedBy: session.name, approvedAt: at };
      if (approval === "excluded") return { ...rest, approval, excludedBy: session.name, excludedAt: at };
      return { ...rest, approval };
    });
    saveState("fox_appointments", next, current);
    latestAppointments.current = next;
    setAppointments(next);
  }

  /** موعد واحد، أو موعدان لنفس الضيف في نفس اليوم يُضافان معًا في حفظ واحد */
  function saveAppointment(saved: ClinicAppointment[]) {
    const [first] = saved;
    const before = editingAppointment ? appointments.find((item) => item.id === first.id) : undefined;
    const stamped = saved.map((appointment) => withApproval(appointment, before));
    const [appointment] = stamped;
    const next = editingAppointment
      ? appointments.map((item) => item.id === appointment.id ? appointment : item)
      : [...appointments, ...stamped];
    updateAppointments(next.sort(byAppointmentTime));
    setEditingAppointment(null);
    setSelectedDate(appointment.appointmentDate);
    setView("home");
    const reset = Boolean(before) && approvalOf(before!) === "approved" && approvalOf(appointment) === "pending";
    const returnOnly = isReturnOnly(appointment);
    toast.success(editingAppointment ? (returnOnly ? t.updatedReturn : t.updated) : saved.length > 1 ? t.savedTwo : returnOnly ? t.savedReturn : t.saved, { description: reset ? t.resetApproval : undefined });
  }

  function deleteAppointment(appointment: ClinicAppointment) {
    if (appointment.status !== "بانتظار طلب السيارة") {
      toast.error(t.errLocked);
      return;
    }
    if (!window.confirm(t.confirmDelete(appointment.patientName))) return;
    updateAppointments(appointments.filter((item) => item.id !== appointment.id));
    toast.success(t.deleted);
  }

  /** إرسال سيارة لطلب أو أكثر، أو ضمّ طلب إلى رحلة سيارة في الطريق (joinRequestIds). */
  /**
   * إرسال سيارة أو أكثر في حفظ واحد (التوزيع التلقائي يرسل عدة سيارات معًا). joinRequestIds: طلبات في الطريق
   * تنضم إليها الرحلة الجديدة. يعيد رسالة كل سائق لإرسالها عبر واتساب.
   */
  function dispatchMany(items: { requestIds: string[]; vehicle: Vehicle; joinRequestIds?: string[] }[]) {
    const sentAt = timeLabel(new Date());
    let next = requests;
    const stamp = Date.now();
    items.forEach(({ requestIds, vehicle, joinRequestIds = [] }, index) => {
      const joined = next.filter((request) => joinRequestIds.includes(request.id));
      const groupId = requestIds.length + joinRequestIds.length > 1 ? joined.find((request) => request.groupId)?.groupId ?? `GRP-${stamp}-${index}` : undefined;
      next = next.map((request) => requestIds.includes(request.id)
        ? { ...request, vehiclePlate: vehicle.plate, driver: vehicle.driver, status: "تم إرسال السيارة" as const, groupId, notificationSentAt: sentAt }
        : joinRequestIds.includes(request.id) ? { ...request, groupId } : request);
    });
    updateRequests(next);
    return items.map(({ requestIds, vehicle, joinRequestIds = [] }) => {
      const allIds = [...requestIds, ...joinRequestIds];
      const trips = next
        .filter((request) => allIds.includes(request.id))
        .map((request) => {
          const appointment = appointments.find((item) => item.id === request.appointmentId)!;
          return {
            request,
            appointment,
            from: request.fromAppointmentId ? appointments.find((item) => item.id === request.fromAppointmentId) ?? null : null,
            persons: appointment ? requestPersons(request, appointment, next) : 1,
          };
        })
        .filter((trip) => trip.appointment);
      return { vehicle, count: allIds.length, message: buildDriverMessage(trips, vehicle, hospitals) };
    });
  }

  function dispatch(requestIds: string[], vehicle: Vehicle, joinRequestIds: string[] = []) {
    const [{ count, message }] = dispatchMany([{ requestIds, vehicle, joinRequestIds }]);
    toast.success(count > 1 ? `رحلة مجمّعة (${count}) · السيارة ${vehicle.plate}` : `تم إرسال السيارة ${vehicle.plate}`, {
      action: vehicle.phone ? { label: "واتساب السائق", onClick: () => window.open(whatsappLink(vehicle.phone, message), "_blank", "noopener") } : undefined,
      duration: 10000,
    });
  }

  return (
    <div className="min-h-screen bg-page" dir={t.dir}>
      <AppHeader
        role={isClinicLead ? t.leadWorkspace : isClinic ? t.workspace : ROLE_TITLES[session.role]}
        name={session.name}
        labels={isClinic ? { changePassword: t.changePassword, logout: t.logout, app: lang === "en" ? "Al Thumama Complex Transport" : undefined } : undefined}
        actions={(
          <>
            {isClinic && <button onClick={() => setLang(lang === "ar" ? "en" : "ar")} className={headerButton}><Languages className="h-4 w-4" /> {t.switchLang}</button>}
          </>
        )}
        onChangePassword={onChangePassword}
        onLogout={onLogout}
      />

      <main className={`mx-auto p-4 lg:p-8 ${session.role === "fleetSupervisor" ? "max-w-7xl" : "max-w-6xl"}`}>
        {view === "home" && isClinic && (
          <ClinicHome
            t={t}
            lang={lang}
            appointments={appointments.filter((appointment) => !isNonMedical(appointment))}
            date={selectedDate}
            onDateChange={setSelectedDate}
            onNew={(returnOnly) => { setEditingAppointment(null); setNewReturnOnly(Boolean(returnOnly)); setView("form"); }}
            onEdit={openEditAppointment}
            onDelete={deleteAppointment}
            onImport={(imported) => {
              updateAppointments([...appointments, ...imported.map((appointment) => withApproval(appointment))].sort(byAppointmentTime));
            }}
            lead={isClinicLead}
            onApproval={setApproval}
          />
        )}
        {view === "form" && isClinic && (
          <ClinicForm
            t={t}
            lang={lang}
            defaultDate={selectedDate}
            initial={editingAppointment}
            returnOnly={editingAppointment ? isReturnOnly(editingAppointment) : newReturnOnly}
            onBack={() => { setEditingAppointment(null); setView("home"); }}
            onSave={saveAppointment}
          />
        )}
        {(session.role === "buildingSupervisor" || session.role === "buildingLead") && (
          <SupervisorHome
            uid={session.uid}
            lead={session.role === "buildingLead"}
            // لا يظهر لمشرف المبنى إلا ما وافق عليه مسؤول العيادة
            appointments={appointments.filter(isApproved)}
            requests={requests}
            vehicles={fleetVehicles}
            onRequest={(request, appointmentId) => {
              // الطلب باسم المشرف الذي طلبه: هو وحده يتابعه
              updateRequests([...requests, { ...request, requestedBy: session.uid }]);
              updateAppointments(appointments.map((appointment) => appointment.id === appointmentId ? { ...appointment, status: request.direction === "عودة" ? "طلب عودة" : "تم طلب السيارة" } : appointment));
              toast.success("تم إرسال الطلب إلى مشرف السيارات");
            }}
            onUpdateRequest={updateRequestStatus}
            onCheckReply={replyToDriverCheck}
            onCancel={(appointment, request) => {
              updateRequests(requests.filter((item) => item.id !== request.id));
              // إلغاء عودة الـ Nurse فقط لا يغيّر موعد الضيف
              if (!request.nurseOnly) {
                // طلب العودة فقط يعود إلى انتظار طلب سيارته (الضيف ما زال في المستشفى)
                updateAppointments(appointments.map((item) => item.id === appointment.id
                  ? { ...item, status: request.direction === "عودة" && !isReturnOnly(item) ? "تم استلام المريض" : "بانتظار طلب السيارة" }
                  : item));
              }
              toast.success("تم إلغاء طلب السيارة");
            }}
            onReturn={(appointment, request) => {
              // الـ Nurse طُلبت عودتها وحدها ولم تُستلم بعد: تعود مع الضيف في نفس الطلب (والسيارة إن أُرسلت)
              const nurseTrip = requests.find((item) => item.nurseOnly && item.appointmentId === appointment.id
                && (item.status === "بانتظار التوزيع" || item.status === "تم إرسال السيارة" || item.status === "وصلت السيارة"));
              if (nurseTrip) {
                updateRequests(requests.map((item) => {
                  if (item.id !== nurseTrip.id) return item;
                  const { nurseOnly: _nurseOnly, ...rest } = item;
                  return rest;
                }));
                updateAppointments(appointments.map((item) => item.id === appointment.id ? { ...item, status: "طلب عودة" } : item));
                toast.success("الضيف يعود مع الـ Nurse في نفس الطلب", { description: nurseTrip.vehiclePlate ? `السيارة ${nurseTrip.vehiclePlate} في طريقها` : undefined });
                return;
              }
              const returnRequest: VehicleRequest = {
                id: `REQ-${Date.now()}`,
                appointmentId: appointment.id,
                direction: "عودة",
                status: "بانتظار التوزيع",
                notificationMethod: request.notificationMethod,
                createdAt: timeLabel(new Date()),
                requestedBy: session.uid,
              };
              updateRequests([...requests, returnRequest]);
              updateAppointments(appointments.map((item) => item.id === appointment.id ? { ...item, status: "طلب عودة" } : item));
              toast.success("تم إرسال طلب العودة");
            }}
            onNurseReturn={(appointment, request) => {
              // الـ Nurse تعود وحدها إلى المجمع ويبقى الضيف في موعده (حالة الموعد لا تتغير)
              const nurseRequest: VehicleRequest = {
                id: `REQ-${Date.now()}`,
                appointmentId: appointment.id,
                direction: "عودة",
                status: "بانتظار التوزيع",
                notificationMethod: request.notificationMethod,
                createdAt: timeLabel(new Date()),
                requestedBy: session.uid,
                nurseOnly: true,
              };
              updateRequests([...requests, nurseRequest]);
              toast.success("تم إرسال طلب عودة الـ Nurse فقط", { description: "يبقى الضيف في «ضيوف في الموعد» حتى تُطلب عودته" });
            }}
            onSelfReturn={(appointment) => {
              // الضيف عاد إلى المجمع بنفسه: ينتهي موعده بلا سيارة عودة
              updateAppointments(appointments.map((item) => item.id === appointment.id
                ? { ...item, status: "مكتملة" as const, returnedSelf: true, returnedSelfBy: session.name, returnedSelfAt: new Date().toISOString() }
                : item));
              toast.success(`سُجّل أن ${appointment.patientName} عاد بنفسه`);
            }}
            onTransfer={(appointment, request, next) => {
              // بدل العودة إلى المجمع: طلب ذهاب للموعد التالي يبدأ من مستشفى هذا الموعد
              const transfer: VehicleRequest = {
                id: `REQ-${Date.now()}`,
                appointmentId: next.id,
                direction: "ذهاب",
                status: "بانتظار التوزيع",
                notificationMethod: request.notificationMethod,
                createdAt: timeLabel(new Date()),
                requestedBy: session.uid,
                fromAppointmentId: appointment.id,
              };
              updateRequests([...requests, transfer]);
              updateAppointments(appointments.map((item) => item.id === next.id ? { ...item, status: "تم طلب السيارة" } : item));
              toast.success(`تم طلب نقل الضيف إلى موعده التالي (${next.appointmentAt} · ${next.clinic})`);
            }}
            onCancelAppointment={(appointment, reason, request) => {
              // طلب السيارة القائم يُلغى أولًا حتى تتفرغ السيارة، ثم يُعلَّم الموعد ملغيًا مع السبب
              if (request) updateRequests(requests.filter((item) => item.id !== request.id));
              updateAppointments(appointments.map((item) => item.id === appointment.id
                ? { ...item, status: "ملغي" as const, cancelReason: reason, cancelledBy: session.name, cancelledAt: new Date().toISOString() }
                : item));
              toast.success("تم إلغاء الموعد", { description: request?.vehiclePlate ? `وأُلغي طلب السيارة ${request.vehiclePlate}` : undefined });
            }}
          />
        )}
        {session.role === "fleetSupervisor" && (
          <FleetSupervisorPage
            vehicles={fleetVehicles}
            appointments={appointments}
            requests={requests}
            onManager={onManager}
            onUpdate={updateFleet}
            onDispatch={dispatch}
            onDispatchMany={dispatchMany}
            onArrived={markArrived}
            onEndTrip={endTrips}
            onExport={exportStats}
            date={selectedDate}
            onDateChange={setSelectedDate}
            onAddTrip={(appointment, request) => {
              updateAppointments([...appointments, appointment].sort(byAppointmentTime));
              updateRequests([...requests, request]);
              toast.success("تمت إضافة الرحلة إلى الطلبات");
              setSelectedDate(appointment.appointmentDate);
            }}
          />
        )}
      </main>
    </div>
  );
}

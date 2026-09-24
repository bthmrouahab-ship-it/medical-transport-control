import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { onAuthStateChanged } from "firebase/auth";
import { ArrowRight, Languages, Loader2, MapPin } from "lucide-react";
import {
  DEFAULT_VEHICLES,
  buildDriverMessage,
  migrateAppointment,
  migrateRequest,
  whatsappLink,
  type ClinicAppointment,
  type Vehicle,
  type VehicleRequest,
} from "@shared/transport";
import type { UserProfile } from "@shared/users";
import { useHospitals } from "@/lib/useShared";
import AppHeader from "@/components/AppHeader";
import { byAppointmentTime, timeLabel } from "@/components/ui-kit";
import { CLINIC_TEXT, useLang } from "@/lib/i18n";
import { ClinicForm, ClinicHome } from "./ClinicPages";
import { SupervisorHome } from "./SupervisorPage";
import { FleetSupervisorPage } from "./FleetSupervisorPage";
import FleetDashboard from "@/components/FleetDashboard";
import Login from "./Login";
import AdminPanel from "./AdminPanel";
import DriverPage from "./DriverPage";
import ChangePasswordForm from "@/components/ChangePasswordForm";
import { SHARED_KEYS, clearSharedBackend, loadState, removeState, saveState, setSharedBackend, subscribeState } from "@/lib/appStore";
import { appendAudit } from "@/lib/audit";
import { auth, authReady, firestore } from "@/lib/firebase";
import { createFirestoreBackend } from "@/lib/firestoreBackend";
import { isLoginInProgress, logout, watchProfile } from "@/lib/auth";

type Role = "clinic" | "buildingSupervisor" | "fleetSupervisor";
type Session = { role: Role; name: string };
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
    ["fox_session", ...SHARED_KEYS].forEach(removeState);

    let stopProfile: (() => void) | null = null;
    let stopAuth: (() => void) | null = null;
    let cancelled = false;
    authReady.then(() => {
      if (cancelled) return;
      stopAuth = onAuthStateChanged(auth, (user) => {
        stopProfile?.();
        stopProfile = null;
        if (!user || user.isAnonymous) {
          if (user) logout().catch(() => {});
          clearSharedBackend();
          dataUid.current = null;
          dataLoaded.current = false;
          setGate({ status: "signedOut" });
          return;
        }
        // أثناء تسجيل الدخول تبقى شاشة الدخول ظاهرة حتى تظهر رسالة الخطأ إن كان الحساب موقوفًا
        if (!isLoginInProgress()) setGate({ status: "loading" });
        stopProfile = watchProfile(user.uid, (profile) => {
          if (!profile || !profile.active) {
            if (isLoginInProgress()) return;
            signOutNow(profile ? "تم إيقاف حسابك. تواصل مع مدير النظام." : "انتهت صلاحية هذا الحساب. سجّل الدخول مرة أخرى.");
            return;
          }
          // تحديث الملف (مثل تغيير الاسم) لا يعيد تحميل الصفحة؛ السائق لا يحتاج تحميل بيانات
          const stillReady = (current: Gate) => current.status === "ready" && current.profile.uid === profile.uid
            && (profile.role === "driver"
              ? current.profile.role === "driver"
              : dataLoaded.current && dataUid.current === profile.uid);
          setGate((current) => stillReady(current)
            ? { status: "ready", profile }
            : { status: "profile", profile });
        }, (error) => {
          console.error("[auth] profile", error);
          if (!isLoginInProgress()) signOutNow("تعذر التحقق من صلاحيات الحساب. سجّل الدخول مرة أخرى.");
        });
      });
    });
    return () => {
      cancelled = true;
      stopProfile?.();
      stopAuth?.();
    };
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
    setSharedBackend(createFirestoreBackend(firestore), (error) => {
      console.error("[firestore]", error);
      toast.error("تعذر حفظ التغيير في قاعدة البيانات. تحقق من الاتصال وحاول مرة أخرى.");
    })
      .then(() => {
        if (dataUid.current !== profile.uid) return;
        dataLoaded.current = true;
        setGate((current) => current.status === "profile" && current.profile.uid === profile.uid ? { status: "ready", profile: current.profile } : current);
      })
      .catch((error) => {
        console.error("[firestore] init", error);
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
    return <div className="flex min-h-screen items-center justify-center bg-[#f5f7fb] text-slate-400" dir="rtl"><Loader2 className="h-6 w-6 animate-spin" /><span className="sr-only">جارٍ التحميل</span></div>;
  }
  if (gate.status === "signedOut") return <Login />;
  if (gate.status === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f7fb] p-4" dir="rtl">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <p className="font-bold text-slate-700">{gate.message}</p>
          <div className="mt-5 flex justify-center gap-3">
            <button onClick={() => window.location.reload()} className="rounded-xl bg-[#a61d2d] px-4 py-2 text-sm font-bold text-white">إعادة المحاولة</button>
            <button onClick={() => signOutNow()} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600">تسجيل الخروج</button>
          </div>
        </div>
      </div>
    );
  }

  const profile = gate.profile;
  if (profile.mustChangePassword || changingPassword) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f7fb] p-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_24px_70px_rgba(16,35,63,.08)] sm:p-8">
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
    return <DriverPage profile={profile} onLogout={() => signOutNow()} onChangePassword={() => setChangingPassword(true)} />;
  }

  if (profile.role === "admin") {
    return <AdminPanel profile={profile} onLogout={() => signOutNow()} onChangePassword={() => setChangingPassword(true)} />;
  }

  if (showManager && profile.role === "fleetSupervisor") {
    return (
      <div className="min-h-screen bg-[#f5f7fb]" dir="rtl">
        <AppHeader
          role="مشرف السيارات"
          name={profile.displayName}
          actions={<button onClick={() => setShowManager(false)} className="flex h-10 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700"><ArrowRight className="h-4 w-4" /> التوزيع</button>}
          onLogout={() => signOutNow()}
        />
        <main className="mx-auto max-w-7xl p-4 lg:p-8"><FleetDashboard actor={profile.displayName} /></main>
      </div>
    );
  }

  return (
    <RoleShell
      key={profile.uid + profile.role}
      session={{ role: profile.role, name: profile.displayName }}
      onLogout={() => signOutNow()}
      onManager={() => setShowManager(true)}
      onChangePassword={() => setChangingPassword(true)}
    />
  );
}

const ROLE_TITLES: Record<Role, string> = {
  clinic: "العيادة",
  buildingSupervisor: "مشرف المبنى",
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
  const [audit, setAudit] = useState<string[]>(() => loadState("fox_audit", []));
  const [view, setView] = useState<ClinicView>("home");
  const [editingAppointment, setEditingAppointment] = useState<ClinicAppointment | null>(null);
  const [lang, setLang] = useLang();
  const hospitals = useHospitals();
  const isClinic = session.role === "clinic";
  const t = CLINIC_TEXT[isClinic ? lang : "ar"];

  // تحديث الشاشة فورًا عند وصول تغييرات من مستخدمين آخرين
  useEffect(() => subscribeState((key) => {
    if (key === "fox_appointments") setAppointments(loadAppointments());
    else if (key === "fox_requests") setRequests(loadRequests());
    else if (key === "fox_fleet") setFleetVehicles(loadState("fox_fleet", DEFAULT_VEHICLES));
    else if (key === "fox_audit") setAudit(loadState("fox_audit", []));
  }), []);

  function updateAppointments(next: ClinicAppointment[]) { setAppointments(next); saveState("fox_appointments", next); }
  function updateRequests(next: VehicleRequest[]) { setRequests(next); saveState("fox_requests", next); }
  function updateFleet(next: Vehicle[]) { setFleetVehicles(next); saveState("fox_fleet", next); }
  function logAudit(message: string) {
    setAudit(appendAudit(message, session.name));
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
          "تاريخ الموعد": appointment.appointmentDate,
          "وقت الموعد": appointment.appointmentAt,
          "نوع الرحلة": appointment.kind,
          "احتياجات المريض": appointment.assistance.join("، ") || "لا يحتاج",
          "حالة الموعد": appointment.status,
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
    updateRequests(requests.map((request) => request.id === requestId ? { ...request, status } : request));
    const request = requests.find((item) => item.id === requestId);
    if (request && status === "تم استلام المريض") {
      updateAppointments(appointments.map((appointment) => appointment.id === request.appointmentId
        ? { ...appointment, status: request.direction === "عودة" ? "مكتملة" : "تم استلام المريض" }
        : appointment));
    }
    logAudit(`${status} للطلب ${requestId}`);
    toast.success(status === "وصلت السيارة" ? "تم تسجيل وصول السيارة" : "تم تأكيد استلام المريض");
  }

  function openEditAppointment(appointment: ClinicAppointment) {
    if (appointment.status !== "بانتظار طلب السيارة") {
      toast.error(t.errLocked);
      return;
    }
    setEditingAppointment(appointment);
    setView("form");
  }

  function saveAppointment(appointment: ClinicAppointment) {
    const next = editingAppointment
      ? appointments.map((item) => item.id === appointment.id ? appointment : item)
      : [...appointments, appointment];
    updateAppointments(next.sort(byAppointmentTime));
    logAudit(editingAppointment ? `تعديل الموعد ${appointment.id}` : `إضافة الموعد ${appointment.id}`);
    setEditingAppointment(null);
    setView("home");
    toast.success(editingAppointment ? t.updated : t.saved);
  }

  function deleteAppointment(appointment: ClinicAppointment) {
    if (appointment.status !== "بانتظار طلب السيارة") {
      toast.error(t.errLocked);
      return;
    }
    if (!window.confirm(t.confirmDelete(appointment.patientName))) return;
    updateAppointments(appointments.filter((item) => item.id !== appointment.id));
    logAudit(`حذف الموعد ${appointment.id}`);
    toast.success(t.deleted);
  }

  /** إرسال سيارة لطلب أو أكثر، أو ضمّ طلب إلى رحلة سيارة في الطريق (joinRequestIds). */
  function dispatch(requestIds: string[], vehicle: Vehicle, joinRequestIds: string[] = []) {
    const sentAt = timeLabel(new Date());
    const joined = requests.filter((request) => joinRequestIds.includes(request.id));
    const allIds = [...requestIds, ...joinRequestIds];
    const groupId = allIds.length > 1 ? joined.find((request) => request.groupId)?.groupId ?? `GRP-${Date.now()}` : undefined;
    const next = requests.map((request) => requestIds.includes(request.id)
      ? { ...request, vehiclePlate: vehicle.plate, driver: vehicle.driver, status: "تم إرسال السيارة" as const, groupId, notificationSentAt: sentAt }
      : joinRequestIds.includes(request.id) ? { ...request, groupId } : request);
    updateRequests(next);
    logAudit(joinRequestIds.length
      ? `ضم ${requestIds.length} طلب إلى رحلة السيارة ${vehicle.plate}`
      : `إرسال السيارة ${vehicle.plate} إلى ${requestIds.length} طلب`);
    const trips = next
      .filter((request) => allIds.includes(request.id))
      .map((request) => ({ request, appointment: appointments.find((item) => item.id === request.appointmentId)! }))
      .filter((trip) => trip.appointment);
    const message = buildDriverMessage(trips, vehicle, hospitals);
    toast.success(allIds.length > 1 ? `رحلة مجمّعة (${allIds.length}) · السيارة ${vehicle.plate}` : `تم إرسال السيارة ${vehicle.plate}`, {
      action: vehicle.phone ? { label: "واتساب السائق", onClick: () => window.open(whatsappLink(vehicle.phone, message), "_blank", "noopener") } : undefined,
      duration: 10000,
    });
  }

  return (
    <div className="min-h-screen bg-[#f5f7fb]" dir={t.dir}>
      <AppHeader
        role={isClinic ? t.workspace : ROLE_TITLES[session.role]}
        name={session.name}
        labels={isClinic ? { changePassword: t.changePassword, logout: t.logout, app: lang === "en" ? "Al Thumama Complex Transport" : undefined } : undefined}
        actions={(
          <>
            {isClinic && <button onClick={() => setLang(lang === "ar" ? "en" : "ar")} className="flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50"><Languages className="h-4 w-4" /> {t.switchLang}</button>}
            {session.role === "fleetSupervisor" && <button onClick={onManager} className="hidden h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50 sm:flex"><MapPin className="h-4 w-4" /> الخريطة</button>}
          </>
        )}
        onChangePassword={onChangePassword}
        onLogout={onLogout}
      />

      <main className="mx-auto max-w-6xl p-4 lg:p-8">
        {view === "home" && isClinic && (
          <ClinicHome
            t={t}
            appointments={appointments}
            onNew={() => { setEditingAppointment(null); setView("form"); }}
            onEdit={openEditAppointment}
            onDelete={deleteAppointment}
            onImport={(imported) => {
              updateAppointments([...appointments, ...imported].sort(byAppointmentTime));
              logAudit(`استيراد ${imported.length} موعد من Excel`);
            }}
          />
        )}
        {view === "form" && isClinic && (
          <ClinicForm
            t={t}
            lang={lang}
            initial={editingAppointment}
            onBack={() => { setEditingAppointment(null); setView("home"); }}
            onSave={saveAppointment}
          />
        )}
        {session.role === "buildingSupervisor" && (
          <SupervisorHome
            appointments={appointments}
            requests={requests}
            onRequest={(request, appointmentId) => {
              updateRequests([...requests, request]);
              updateAppointments(appointments.map((appointment) => appointment.id === appointmentId ? { ...appointment, status: request.direction === "عودة" ? "طلب عودة" : "تم طلب السيارة" } : appointment));
              logAudit(`طلب ${request.direction} ${request.id}`);
              toast.success("تم إرسال الطلب إلى مشرف السيارات");
            }}
            onUpdateRequest={updateRequestStatus}
            onCancel={(appointment, request) => {
              updateRequests(requests.filter((item) => item.id !== request.id));
              updateAppointments(appointments.map((item) => item.id === appointment.id
                ? { ...item, status: request.direction === "عودة" ? "تم استلام المريض" : "بانتظار طلب السيارة" }
                : item));
              logAudit(`إلغاء طلب ${request.direction} ${request.id}`);
              toast.success("تم إلغاء طلب السيارة");
            }}
            onReturn={(appointment, request) => {
              const returnRequest: VehicleRequest = {
                id: `REQ-${Date.now()}`,
                appointmentId: appointment.id,
                direction: "عودة",
                status: "بانتظار التوزيع",
                notificationMethod: request.notificationMethod,
                createdAt: timeLabel(new Date()),
              };
              updateRequests([...requests, returnRequest]);
              updateAppointments(appointments.map((item) => item.id === appointment.id ? { ...item, status: "طلب عودة" } : item));
              logAudit(`طلب عودة ${returnRequest.id}`);
              toast.success("تم إرسال طلب العودة");
            }}
          />
        )}
        {session.role === "fleetSupervisor" && (
          <FleetSupervisorPage
            vehicles={fleetVehicles}
            appointments={appointments}
            requests={requests}
            audit={audit}
            onManager={onManager}
            onUpdate={(next) => { updateFleet(next); logAudit("تغيير حالة سيارة"); }}
            onDispatch={dispatch}
            onExport={exportStats}
          />
        )}
      </main>
    </div>
  );
}

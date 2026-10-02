import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  ClipboardList,
  Contact,
  Copy,
  IdCard,
  KeyRound,
  Loader2,
  Map as MapIcon,
  Pencil,
  Plus,
  Power,
  ShieldCheck,
  Trash2,
  Truck,
  UserPlus,
  UsersRound,
  Search,
  FilterX,
  X,
} from "lucide-react";
import {
  BUS_ROLE_LABELS,
  DEFAULT_VEHICLES,
  VEHICLE_KINDS,
  busRoleOf,
  localDateString,
  mergeVehicle,
  migrateRequest,
  validateVehicle,
  vehicleHasActiveTrip,
  type Vehicle,
  type VehicleKind,
  type VehicleRequest,
} from "@shared/transport";
import {
  ROLE_LABELS,
  USER_ROLES,
  generateTemporaryPassword,
  type UserProfile,
  type UserRole,
} from "@shared/users";
import { hasSharedState, loadState, saveState, saveStates, subscribeState } from "@/lib/appStore";
import { useDrivers } from "@/lib/useShared";
import { driverOfAccount, type Driver } from "@shared/drivers";
import { DRIVERS_SEED } from "@shared/seedData";
import AppHeader from "@/components/AppHeader";
import ActivityLog from "@/components/ActivityLog";
import { dayRange } from "@/lib/activity";
import { Badge, EmptyState, Panel, PageHeader, Segmented, addDays, btn, cx, inputClass, labelClass } from "@/components/ui-kit";
import { HISTORY_SEED } from "@shared/historySeed";
import { syncHospitals, type Hospital } from "@shared/hospitals";
import { authErrorMessage, createUser, resetUserPassword, updateUser, watchUsers } from "@/lib/auth";

// الخريطة والإحصائيات تُحمَّل عند فتح تبويبها فقط
const FleetDashboard = lazy(() => import("@/components/FleetDashboard"));
const GuestManager = lazy(() => import("@/components/GuestManager"));
const DriverManager = lazy(() => import("@/components/DriverManager"));

type Tab = "dashboard" | "users" | "guests" | "vehicles" | "drivers" | "audit";

function loadRequests() {
  return loadState<unknown[]>("fox_requests", [])
    .map(migrateRequest)
    .filter((request): request is VehicleRequest => Boolean(request));
}

export default function AdminPanel({ profile, onLogout, onChangePassword }: {
  profile: UserProfile;
  onLogout: () => void;
  onChangePassword: () => void;
}) {
  const [tab, setTab] = useState<Tab>("users");
  const [vehicles, setVehicles] = useState<Vehicle[]>(() => loadState("fox_fleet", DEFAULT_VEHICLES));
  const [requests, setRequests] = useState<VehicleRequest[]>(loadRequests);

  useEffect(() => {
    // البيانات الأولية: السيارات والإحصائيات السابقة، وتحديث مواقع المستشفيات غير المؤكدة من الدليل.
    // السيارات الأولية مع سائقيها (قائمة السائقين منفصلة، وكل سيارة مخصصة لسائقها في الورقة)
    if (!hasSharedState("fox_fleet")) {
      const withDrivers = !hasSharedState("fox_drivers");
      saveStates([
        ...(withDrivers ? [{ key: "fox_drivers" as const, value: DRIVERS_SEED }] : []),
        { key: "fox_fleet", value: withDrivers ? DEFAULT_VEHICLES : DEFAULT_VEHICLES.map(({ driverId: _id, ...vehicle }) => ({ ...vehicle, driver: "", phone: "" })) },
      ]);
    }
    if (!hasSharedState("fox_history")) saveState("fox_history", HISTORY_SEED);
    if (hasSharedState("fox_hospitals")) {
      const stored = loadState<Hospital[]>("fox_hospitals", []);
      const synced = syncHospitals(stored);
      if (JSON.stringify(synced) !== JSON.stringify(stored)) saveState("fox_hospitals", synced);
    }
    const refresh = (key: string) => {
      if (key === "fox_fleet") setVehicles(loadState("fox_fleet", DEFAULT_VEHICLES));
      else if (key === "fox_requests") setRequests(loadRequests());
    };
    const stop = subscribeState(refresh);
    // تغييرات وصلت بين أول عرض للصفحة وبدء الاشتراك
    ["fox_fleet", "fox_requests"].forEach(refresh);
    return stop;
  }, []);

  // كل عملية يسجّلها الخادم في سجل العمليات مع اسم المدير ووقتها
  function updateVehicles(next: Vehicle[]) {
    setVehicles(next);
    saveState("fox_fleet", next);
  }

  const tabs: { value: Tab; label: string; icon: typeof UsersRound }[] = [
    { value: "dashboard", label: "الخريطة والإحصائيات", icon: MapIcon },
    { value: "users", label: "المستخدمون", icon: UsersRound },
    { value: "guests", label: "الضيوف", icon: Contact },
    { value: "vehicles", label: "السيارات", icon: Truck },
    { value: "drivers", label: "السائقون", icon: IdCard },
    { value: "audit", label: "سجل العمليات", icon: ClipboardList },
  ];

  return (
    <div className="min-h-screen bg-page" dir="rtl">
      <AppHeader role="مدير النظام" name={profile.displayName} onChangePassword={onChangePassword} onLogout={onLogout} />

      <main className="mx-auto max-w-7xl p-4 lg:p-8">
        <nav className="mb-7" aria-label="أقسام لوحة المدير">
          <Segmented label="أقسام لوحة المدير" value={tab} onChange={setTab} options={tabs} />
        </nav>
        {tab === "dashboard" && <Suspense fallback={<div className="flex min-h-64 items-center justify-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /><span className="sr-only">جارٍ التحميل</span></div>}><FleetDashboard canEdit actor={profile.displayName} /></Suspense>}
        {tab === "users" && <UsersTab profile={profile} />}
        {tab === "guests" && <Suspense fallback={<div className="flex min-h-64 items-center justify-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /><span className="sr-only">جارٍ التحميل</span></div>}><GuestManager /></Suspense>}
        {tab === "vehicles" && <VehiclesTab vehicles={vehicles} requests={requests} onChange={updateVehicles} />}
        {tab === "drivers" && <Suspense fallback={<div className="flex min-h-64 items-center justify-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /><span className="sr-only">جارٍ التحميل</span></div>}><DriverManager vehicles={vehicles} /></Suspense>}
        {tab === "audit" && <AuditTab />}
      </main>
    </div>
  );
}

// ————— المستخدمون —————

function UsersTab({ profile }: { profile: UserProfile }) {
  const drivers = useDrivers();
  const [users, setUsers] = useState<UserProfile[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [issued, setIssued] = useState<{ username: string; password: string } | null>(null);
  const [busyUid, setBusyUid] = useState<string | null>(null);

  useEffect(() => watchUsers(setUsers, (error) => toast.error(authErrorMessage(error, "تعذر تحميل المستخدمين"))), []);

  async function run(uid: string, action: () => Promise<void>, success: string) {
    setBusyUid(uid);
    try {
      await action();
      toast.success(success);
    } catch (error) {
      toast.error(authErrorMessage(error));
    } finally {
      setBusyUid(null);
    }
  }

  function resetPassword(user: UserProfile) {
    if (!window.confirm(`إصدار كلمة مرور مؤقتة جديدة للمستخدم ${user.username}؟ ستتوقف كلمة المرور الحالية فورًا.`)) return;
    const password = generateTemporaryPassword();
    run(user.uid, async () => {
      await resetUserPassword(user, password);
      setIssued({ username: user.username, password });
    }, "تم إصدار كلمة مرور مؤقتة");
  }

  const activeCount = users?.filter((user) => user.active).length ?? 0;

  // فلتر الحسابات: بحث بالاسم الظاهر أو اسم الدخول أو السيارة، والدور، والحالة
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRole | "all">("all");
  const [stateFilter, setStateFilter] = useState<"all" | "active" | "inactive" | "pending">("all");
  const filtering = Boolean(query.trim()) || roleFilter !== "all" || stateFilter !== "all";
  const shownUsers = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (users ?? []).filter((user) => (roleFilter === "all" || user.role === roleFilter)
      && (stateFilter === "all"
        || (stateFilter === "active" && user.active)
        || (stateFilter === "inactive" && !user.active)
        || (stateFilter === "pending" && user.active && user.mustChangePassword))
      && words.every((word) => `${user.displayName} ${user.username} ${user.vehiclePlate ?? ""} ${driverOfAccount(drivers, user.uid)?.name ?? ""} ${ROLE_LABELS[user.role]}`.toLowerCase().includes(word)));
  }, [users, drivers, query, roleFilter, stateFilter]);
  const roleCounts = new Map<UserRole, number>();
  for (const user of users ?? []) roleCounts.set(user.role, (roleCounts.get(user.role) ?? 0) + 1);

  return (
    <>
      <PageHeader
        title="المستخدمون"
        subtitle="الحسابات والأدوار وكلمات المرور المؤقتة"
        actions={<button onClick={() => { setShowForm(true); setIssued(null); }} className={btn("primary")}><UserPlus className="h-4 w-4" /> إضافة مستخدم</button>}
      />

      {issued && <IssuedPassword {...issued} onClose={() => setIssued(null)} />}
      {showForm && (
        <NewUserForm
          drivers={drivers}
          onCancel={() => setShowForm(false)}
          onCreate={async (input) => {
            await createUser(input, profile.username);
            setShowForm(false);
            setIssued({ username: input.username.trim().toLowerCase(), password: input.password });
            toast.success("تم إنشاء المستخدم");
          }}
        />
      )}

      <Panel
        icon={UsersRound}
        title="الحسابات"
        count={filtering ? shownUsers.length : users?.length}
        description={users ? (filtering ? `${shownUsers.length} من ${users.length} حساب` : `${activeCount} حساب مفعّل`) : undefined}
        actions={filtering && <button type="button" onClick={() => { setQuery(""); setRoleFilter("all"); setStateFilter("all"); }} className={btn("ghost", "sm")}><FilterX className="h-4 w-4" /> مسح الفلاتر</button>}
      >
        <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-[minmax(0,1fr)_190px_190px] sm:px-5">
          <label className="relative block">
            <span className="sr-only">بحث في المستخدمين</span>
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="بحث: الاسم، اسم الدخول، السائق، السيارة..." className={cx(inputClass, "h-10 ps-9")} />
          </label>
          <select aria-label="الدور" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as UserRole | "all")} className={cx(inputClass, "h-10", roleFilter !== "all" && "border-brand-600 bg-brand-50 text-brand-700")}>
            <option value="all">كل الأدوار</option>
            {USER_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]} ({roleCounts.get(role) ?? 0})</option>)}
          </select>
          <select aria-label="حالة الحساب" value={stateFilter} onChange={(event) => setStateFilter(event.target.value as typeof stateFilter)} className={cx(inputClass, "h-10", stateFilter !== "all" && "border-brand-600 bg-brand-50 text-brand-700")}>
            <option value="all">كل الحالات</option>
            <option value="active">مفعّل</option>
            <option value="inactive">موقوف</option>
            <option value="pending">بانتظار تغيير كلمة المرور</option>
          </select>
        </div>
        <div className="divide-y divide-slate-100">
          {users === null && <p className="flex items-center justify-center gap-2 p-8 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> جارٍ التحميل...</p>}
          {users !== null && !shownUsers.length && <EmptyState icon={Search} title="لا توجد حسابات مطابقة" />}
          {shownUsers.map((user) => {
            const isSelf = user.uid === profile.uid;
            const busy = busyUid === user.uid;
            return (
              <div key={user.uid} className={cx("grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] lg:items-center", !user.active && "bg-slate-50/70")}>
                <div className="flex min-w-0 items-center gap-3">
                  <span className={cx("flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold", user.active ? "bg-navy-900 text-white" : "bg-slate-200 text-slate-500")}>{user.displayName.trim().charAt(0) || "؟"}</span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-ink">{user.displayName}</p>
                      <span dir="ltr" className="text-xs text-slate-400">{user.username}</span>
                      {isSelf && <Badge tone="blue">أنت</Badge>}
                      {!user.active && <Badge tone="red">موقوف</Badge>}
                      {user.active && user.mustChangePassword && <Badge tone="amber">بانتظار تغيير كلمة المرور</Badge>}
                    </div>
                    <button disabled={busy} onClick={() => {
                      const name = window.prompt("الاسم الظاهر الجديد", user.displayName);
                      if (name === null || name.trim() === user.displayName) return;
                      run(user.uid, () => updateUser(user.uid, { displayName: name }), "تم تحديث الاسم");
                    }} className="mt-0.5 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-brand-600"><Pencil className="h-3 w-3" /> تعديل الاسم</button>
                  </div>
                </div>
                <div className="grid gap-2">
                  <select aria-label="الدور" disabled={isSelf || busy} value={user.role} onChange={(event) => {
                    const role = event.target.value as UserRole;
                    run(user.uid, () => updateUser(user.uid, { role }), "تم تغيير الدور");
                  }} className={cx(inputClass, "h-10 font-medium")}>
                    {USER_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
                  </select>
                  {user.role === "driver" && (
                    <>
                      {/* حساب التطبيق يُربط بسائق من قائمة السائقين، وسيارته يخصصها مشرف السيارات لسائقه في بداية الشفت */}
                      <DriverSelect drivers={drivers} uid={user.uid} label={`سائق الحساب ${user.username}`} disabled={busy} value={driverOfAccount(drivers, user.uid)?.id ?? ""} onChange={(driverId) => {
                        run(user.uid, () => updateUser(user.uid, { driverId }), driverId ? "تم ربط الحساب بالسائق" : "تم إلغاء ربط الحساب");
                      }} />
                      <p className="text-xs text-slate-500">
                        {!driverOfAccount(drivers, user.uid) ? "اربط الحساب بسائق من قائمة السائقين"
                          : user.vehiclePlate ? <>السيارة الآن: <span dir="ltr" className="font-semibold text-ink tabular">{user.vehiclePlate}</span> (يخصصها مشرف السيارات)</>
                          : "بلا سيارة الآن · يخصصها مشرف السيارات في بداية الشفت"}
                      </p>
                    </>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  <button disabled={isSelf || busy} onClick={() => resetPassword(user)} className={btn("secondary", "sm")}><KeyRound className="h-3.5 w-3.5" /> كلمة مرور جديدة</button>
                  <button disabled={isSelf || busy} onClick={() => {
                    if (user.active && !window.confirm(`إيقاف حساب ${user.username}؟ سيُمنع من الدخول فورًا.`)) return;
                    run(user.uid, () => updateUser(user.uid, { active: !user.active }), user.active ? "تم إيقاف الحساب" : "تم تفعيل الحساب");
                  }} className={btn(user.active ? "danger" : "success", "sm")}><Power className="h-3.5 w-3.5" /> {user.active ? "إيقاف" : "تفعيل"}</button>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    </>
  );
}

/** سائق من القائمة لحساب تطبيق السائق: السائق المرتبط بحساب آخر يظهر معطّلًا */
function DriverSelect({ drivers, uid, value, onChange, label, disabled }: {
  drivers: Driver[];
  uid?: string;
  value: string;
  onChange: (driverId: string) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <select aria-label={label} disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)} className={cx(inputClass, "h-10")}>
      <option value="">{value ? "إلغاء ربط الحساب" : "اختر السائق"}</option>
      {drivers.map((driver) => {
        const taken = Boolean(driver.uid && driver.uid !== uid);
        return <option key={driver.id} value={driver.id} disabled={taken}>{driver.name}{driver.phone ? ` · ${driver.phone}` : ""}{taken ? " (مرتبط بحساب آخر)" : ""}</option>;
      })}
    </select>
  );
}

function NewUserForm({ drivers, onCreate, onCancel }: {
  drivers: Driver[];
  onCreate: (input: { username: string; displayName: string; role: UserRole; password: string; driverId?: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({ username: "", displayName: "", role: "clinic" as UserRole, password: generateTemporaryPassword(), driverId: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const { driverId, ...input } = form;
      await onCreate(form.role === "driver" && driverId ? { ...input, driverId } : input);
    } catch (createError) {
      setError(authErrorMessage(createError, "تعذر إنشاء المستخدم"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel tone="brand" icon={UserPlus} title="مستخدم جديد" className="mb-6" actions={<button type="button" onClick={onCancel} aria-label="إغلاق" className={btn("ghost", "sm")}><X className="h-4 w-4" /></button>}>
      <form onSubmit={submit} className="grid gap-5 p-5 sm:grid-cols-2 sm:p-6">
        <label><span className={labelClass}>اسم المستخدم (بالإنجليزية)</span><input dir="ltr" autoCapitalize="none" spellCheck={false} value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} placeholder="clinic.ahmed" className={inputClass} /></label>
        <label><span className={labelClass}>الاسم الظاهر</span><input value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} placeholder="أحمد - العيادة" className={inputClass} /></label>
        <label><span className={labelClass}>الدور</span>
          <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as UserRole })} className={cx(inputClass, "font-medium")}>
            {USER_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
          </select>
        </label>
        <label><span className={labelClass}>كلمة المرور المؤقتة</span>
          <div className="flex gap-2">
            <input dir="ltr" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} className={cx(inputClass, "font-mono")} />
            <button type="button" onClick={() => setForm({ ...form, password: generateTemporaryPassword() })} className={cx(btn("secondary"), "h-11")}>توليد</button>
          </div>
        </label>
        {form.role === "driver" && (
          <label className="sm:col-span-2"><span className={labelClass}>السائق (من قائمة السائقين؛ سيارته يخصصها مشرف السيارات في بداية الشفت)</span>
            <DriverSelect drivers={drivers} label="السائق" value={form.driverId} onChange={(driverId) => {
              const driver = drivers.find((item) => item.id === driverId);
              setForm({ ...form, driverId, displayName: form.displayName.trim() || !driver ? form.displayName : driver.name });
            }} />
          </label>
        )}
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-medium text-red-700 ring-1 ring-inset ring-red-200 sm:col-span-2">{error}</p>}
        <div className="flex gap-3 border-t border-slate-100 pt-5 sm:col-span-2">
          <button disabled={busy} className={cx(btn("primary", "lg"), "flex-1")}><CheckCircle2 className="h-4 w-4" /> {busy ? "جارٍ الإنشاء..." : "إنشاء الحساب"}</button>
          <button type="button" onClick={onCancel} className={btn("secondary", "lg")}>إلغاء</button>
        </div>
      </form>
    </Panel>
  );
}

function IssuedPassword({ username, password, onClose }: { username: string; password: string; onClose: () => void }) {
  return (
    <div role="status" className="mb-6 flex flex-col gap-3 rounded-2xl bg-emerald-50 p-5 text-sm text-emerald-900 ring-1 ring-inset ring-emerald-200 sm:flex-row sm:items-center">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700"><ShieldCheck className="h-5 w-5" /></span>
      <div className="flex-1">
        <p className="font-semibold">سلّم هذه البيانات للمستخدم بشكل آمن. لن تظهر مرة أخرى.</p>
        <p className="mt-1">اسم المستخدم: <b dir="ltr">{username}</b> · كلمة المرور المؤقتة: <b dir="ltr" className="font-mono">{password}</b></p>
      </div>
      <button onClick={() => navigator.clipboard?.writeText(`${username} / ${password}`).then(() => toast.success("تم النسخ"), () => toast.error("تعذر النسخ"))} className={btn("secondary", "sm")}><Copy className="h-3.5 w-3.5" /> نسخ</button>
      <button onClick={onClose} aria-label="إغلاق" className={btn("ghost", "sm")}><X className="h-4 w-4" /></button>
    </div>
  );
}

// ————— السيارات —————

/** السيارة رقمها ونوعها فقط؛ السائق منفصل عنها (تبويب «السائقون»)، ويخصصه مشرف السيارات في بداية الشفت */
type VehicleDraft = { plate: string; kind: VehicleKind };

function VehiclesTab({ vehicles, requests, onChange }: {
  vehicles: Vehicle[];
  requests: VehicleRequest[];
  onChange: (next: Vehicle[]) => void;
}) {
  // null = لا يوجد نموذج مفتوح، "" = سيارة جديدة، غير ذلك = رقم السيارة قيد التعديل
  const [editing, setEditing] = useState<string | null>(null);

  function save(draft: VehicleDraft) {
    const original = editing ? vehicles.find((vehicle) => vehicle.plate === editing) : undefined;
    const result = validateVehicle(draft, vehicles, original?.plate);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    if (original && result.vehicle.plate !== original.plate && vehicleHasActiveTrip(original.plate, requests)) {
      toast.error("لا يمكن تغيير رقم سيارة في رحلة جارية");
      return;
    }
    if (original) {
      onChange(vehicles.map((vehicle) => vehicle.plate === original.plate ? mergeVehicle(vehicle, result.vehicle) : vehicle));
      toast.success("تم تحديث بيانات السيارة");
    } else {
      onChange([...vehicles, { ...result.vehicle, driver: "", phone: "", available: true }]);
      toast.success("تمت إضافة السيارة", { description: "يخصص لها مشرف السيارات سائقًا قبل إرسالها في الرحلات" });
    }
    setEditing(null);
  }

  function remove(vehicle: Vehicle) {
    if (vehicleHasActiveTrip(vehicle.plate, requests)) {
      toast.error("لا يمكن حذف سيارة في رحلة جارية");
      return;
    }
    if (!window.confirm(`حذف السيارة ${vehicle.plate}${vehicle.driver ? ` (${vehicle.driver})` : ""}؟`)) return;
    onChange(vehicles.filter((item) => item.plate !== vehicle.plate));
    toast.success("تم حذف السيارة");
  }

  const availableCount = vehicles.filter((vehicle) => vehicle.available).length;
  return (
    <>
      <PageHeader
        title="السيارات"
        subtitle={`${vehicles.length} سيارة · ${availableCount} متاحة للخدمة · السائقون في تبويب «السائقون»`}
        actions={<button onClick={() => setEditing("")} className={btn("primary")}><Plus className="h-4 w-4" /> إضافة سيارة</button>}
      />
      {editing === "" && <VehicleForm onSave={save} onCancel={() => setEditing(null)} />}
      <Panel icon={Truck} title="السيارات" count={vehicles.length}>
        <div className="divide-y divide-slate-100">
          {vehicles.length === 0 && <EmptyState icon={Truck} title="لا توجد سيارات مسجلة" />}
          {vehicles.map((vehicle) => {
            if (editing === vehicle.plate) return <div key={vehicle.plate} className="bg-slate-50/70 p-3"><VehicleForm initial={vehicle} onSave={save} onCancel={() => setEditing(null)} /></div>;
            const onTrip = vehicleHasActiveTrip(vehicle.plate, requests);
            return (
              <div key={vehicle.plate} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:px-5">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className={cx("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", vehicle.available ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400")}><Truck className="h-5 w-5" /></span>
                  <div className="min-w-0">
                    <p className="font-semibold text-ink"><span dir="ltr" className="tabular">{vehicle.plate}</span> · {vehicle.kind}{busRoleOf(vehicle) ? ` · ${BUS_ROLE_LABELS[busRoleOf(vehicle)!]}` : ""}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                      {vehicle.driver
                        ? <><span>السائق الآن: {vehicle.driver}</span>{vehicle.phone && <><span className="text-slate-300">·</span><span dir="ltr">{vehicle.phone}</span></>}</>
                        : <span className="font-medium text-amber-700">بلا سائق · يخصصه مشرف السيارات</span>}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {onTrip ? <Badge tone="blue">في رحلة جارية</Badge> : vehicle.available ? <Badge tone="green">متاحة للخدمة</Badge> : <Badge>خارج الخدمة</Badge>}
                  <button onClick={() => setEditing(vehicle.plate)} className={btn("secondary", "sm")}><Pencil className="h-3.5 w-3.5" /> تعديل</button>
                  <button onClick={() => remove(vehicle)} className={btn("danger", "sm")}><Trash2 className="h-3.5 w-3.5" /> حذف</button>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    </>
  );
}

function VehicleForm({ initial, onSave, onCancel }: { initial?: Vehicle; onSave: (draft: VehicleDraft) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<VehicleDraft>({
    plate: initial?.plate ?? "",
    kind: initial?.kind ?? "سيدان",
  });

  const form = (
    <form onSubmit={(event) => { event.preventDefault(); onSave(draft); }} className="grid gap-5 p-5 sm:grid-cols-2">
      <label><span className={labelClass}>رقم السيارة</span><input dir="ltr" value={draft.plate} onChange={(event) => setDraft({ ...draft, plate: event.target.value })} className={inputClass} /></label>
      <label><span className={labelClass}>نوع السيارة</span>
        <select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as VehicleKind })} className={cx(inputClass, "font-medium")}>
          {VEHICLE_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
        </select>
      </label>
      <div className="flex gap-3 sm:col-span-2">
        <button className={cx(btn("primary"), "flex-1 sm:flex-none")}><CheckCircle2 className="h-4 w-4" /> {initial ? "حفظ التعديلات" : "إضافة السيارة"}</button>
        <button type="button" onClick={onCancel} className={btn("secondary")}>إلغاء</button>
      </div>
    </form>
  );
  // التعديل داخل قائمة السيارات، والإضافة في قسم مستقل فوقها
  return initial
    ? <div className="rounded-xl bg-white ring-1 ring-slate-200">{form}</div>
    : <Panel tone="brand" icon={Plus} title="سيارة جديدة" className="mb-6">{form}</Panel>;
}

// ————— سجل العمليات —————

type AuditPeriod = "today" | "7d" | "30d" | "all";

/** كل العمليات في النظام مع من نفّذها ووقتها (يسجّلها الخادم)، مع التصدير. */
function AuditTab() {
  const [period, setPeriod] = useState<AuditPeriod>("today");
  const range = useMemo(() => {
    const today = localDateString();
    if (period === "all") return {};
    return dayRange(period === "today" ? today : addDays(today, period === "7d" ? -6 : -29), today);
  }, [period]);
  const labels: Record<AuditPeriod, string> = { today: "اليوم", "7d": "آخر 7 أيام", "30d": "آخر 30 يومًا", all: "كل الفترات" };
  return (
    <>
      <PageHeader
        title="سجل العمليات"
        subtitle="كل عملية في النظام مع اسم من نفّذها ووقتها، يسجّلها الخادم ولا يمكن تعديلها"
        actions={<Segmented label="الفترة" value={period} onChange={setPeriod} options={(Object.keys(labels) as AuditPeriod[]).map((value) => ({ value, label: labels[value] }))} />}
      />
      <ActivityLog since={range.since} until={range.until} periodLabel={labels[period]} />
    </>
  );
}

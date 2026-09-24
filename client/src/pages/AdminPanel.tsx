import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  ClipboardList,
  Copy,
  KeyRound,
  LogOut,
  Map as MapIcon,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Truck,
  UserCog,
  UserPlus,
  UsersRound,
  X,
} from "lucide-react";
import {
  DEFAULT_VEHICLES,
  VEHICLE_KINDS,
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
import { hasSharedState, loadState, saveState, subscribeState } from "@/lib/appStore";
import { appendAudit } from "@/lib/audit";
import FleetDashboard from "@/components/FleetDashboard";
import { authErrorMessage, createUser, resetUserPassword, updateUser, watchUsers } from "@/lib/auth";

type Tab = "dashboard" | "users" | "vehicles" | "audit";

const inputClass = "h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#e6a1aa]";

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
  const [audit, setAudit] = useState<string[]>(() => loadState("fox_audit", []));

  useEffect(() => {
    // أول دخول للمدير: حفظ قائمة السيارات الأولية في قاعدة البيانات حتى يعدّلها المشرفون.
    if (!hasSharedState("fox_fleet")) saveState("fox_fleet", DEFAULT_VEHICLES);
    return subscribeState((key) => {
      if (key === "fox_fleet") setVehicles(loadState("fox_fleet", DEFAULT_VEHICLES));
      else if (key === "fox_requests") setRequests(loadRequests());
      else if (key === "fox_audit") setAudit(loadState("fox_audit", []));
    });
  }, []);

  function log(message: string) {
    setAudit(appendAudit(message, profile.displayName));
  }

  function updateVehicles(next: Vehicle[], message: string) {
    setVehicles(next);
    saveState("fox_fleet", next);
    log(message);
  }

  const tabs: { id: Tab; label: string; icon: typeof UsersRound }[] = [
    { id: "dashboard", label: "لوحة السيارات والخريطة", icon: MapIcon },
    { id: "users", label: "المستخدمون والأدوار", icon: UsersRound },
    { id: "vehicles", label: "السيارات والسائقون", icon: Truck },
    { id: "audit", label: "سجل العمليات", icon: ClipboardList },
  ];

  return (
    <div className="min-h-screen bg-[#f5f7fb]" dir="rtl">
      <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b border-slate-200 bg-[#f5f7fb]/95 px-5 backdrop-blur-xl lg:px-10">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#10233f] text-[#e43846]"><UserCog className="h-5 w-5" /></div>
          <div><p className="text-xs font-semibold text-[#a61d2d]">مساحة مدير النظام</p><h1 className="text-xl font-bold">إدارة النظام</h1></div>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden text-xs font-semibold text-slate-400 sm:inline">{profile.displayName}</span>
          <button onClick={onChangePassword} aria-label="تغيير كلمة المرور" title="تغيير كلمة المرور" className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:text-[#a61d2d]"><KeyRound className="h-4 w-4" /></button>
          <button aria-label="تسجيل الخروج" onClick={onLogout} className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:text-red-600"><LogOut className="h-4 w-4" /></button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl p-5 lg:p-10">
        <nav className="mb-7 flex gap-2 overflow-x-auto" aria-label="أقسام لوحة المدير">
          {tabs.map((item) => (
            <button key={item.id} onClick={() => setTab(item.id)} aria-current={tab === item.id ? "page" : undefined} className={`flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-4 text-sm font-bold ${tab === item.id ? "bg-[#a61d2d] text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
              <item.icon className="h-4 w-4" /> {item.label}
            </button>
          ))}
        </nav>
        {tab === "dashboard" && <FleetDashboard canEdit actor={profile.displayName} />}
        {tab === "users" && <UsersTab profile={profile} vehicles={vehicles} onLog={log} />}
        {tab === "vehicles" && <VehiclesTab vehicles={vehicles} requests={requests} onChange={updateVehicles} />}
        {tab === "audit" && (
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 p-5"><h3 className="font-bold">سجل العمليات</h3><p className="mt-1 text-xs text-slate-400">آخر 50 عملية في النظام مع اسم من نفّذها.</p></div>
            <div className="max-h-[60vh] divide-y divide-slate-100 overflow-auto">
              {audit.length ? audit.map((item, index) => <p key={`${item}-${index}`} className="px-5 py-3 text-xs text-slate-500">{item}</p>) : <p className="p-5 text-xs text-slate-400">لا توجد عمليات مسجلة بعد</p>}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

// ————— المستخدمون —————

function UsersTab({ profile, vehicles, onLog }: { profile: UserProfile; vehicles: Vehicle[]; onLog: (message: string) => void }) {
  const [users, setUsers] = useState<UserProfile[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [issued, setIssued] = useState<{ username: string; password: string } | null>(null);
  const [busyUid, setBusyUid] = useState<string | null>(null);

  useEffect(() => watchUsers(setUsers, (error) => toast.error(authErrorMessage(error, "تعذر تحميل المستخدمين"))), []);

  async function run(uid: string, action: () => Promise<void>, success: string, logMessage: string) {
    setBusyUid(uid);
    try {
      await action();
      toast.success(success);
      onLog(logMessage);
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
    }, "تم إصدار كلمة مرور مؤقتة", `إعادة تعيين كلمة مرور المستخدم ${user.username}`);
  }

  return (
    <>
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><p className="text-sm font-bold text-[#a61d2d]">الحسابات والصلاحيات</p><h2 className="mt-2 text-2xl font-bold">المستخدمون</h2><p className="mt-2 text-sm text-slate-500">كل مستخدم يرى صفحة دوره فقط. الحساب الجديد يغيّر كلمة المرور المؤقتة عند أول دخول.</p></div>
        <button onClick={() => { setShowForm(true); setIssued(null); }} className="flex min-h-11 items-center gap-2 rounded-xl bg-[#a61d2d] px-4 text-sm font-bold text-white hover:bg-[#8b1725]"><UserPlus className="h-4 w-4" /> إضافة مستخدم</button>
      </div>

      {issued && <IssuedPassword {...issued} onClose={() => setIssued(null)} />}
      {showForm && (
        <NewUserForm
          vehicles={vehicles}
          onCancel={() => setShowForm(false)}
          onCreate={async (input) => {
            await createUser(input, profile.username);
            onLog(`إضافة المستخدم ${input.username} بدور ${ROLE_LABELS[input.role]}`);
            setShowForm(false);
            setIssued({ username: input.username.trim().toLowerCase(), password: input.password });
            toast.success("تم إنشاء المستخدم");
          }}
        />
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="divide-y divide-slate-100">
          {users === null && <p className="p-6 text-center text-sm text-slate-400">جارٍ التحميل...</p>}
          {users?.map((user) => {
            const isSelf = user.uid === profile.uid;
            const busy = busyUid === user.uid;
            return (
              <div key={user.uid} className="grid gap-3 p-5 lg:grid-cols-[1.3fr_1fr_auto] lg:items-center">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bold">{user.displayName}</p>
                    <span dir="ltr" className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-500">{user.username}</span>
                    {isSelf && <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700">أنت</span>}
                    {!user.active && <span className="rounded-full bg-red-50 px-2 py-1 text-[10px] font-bold text-red-700">موقوف</span>}
                    {user.active && user.mustChangePassword && <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700">بانتظار تغيير كلمة المرور</span>}
                  </div>
                  <button disabled={busy} onClick={() => {
                    const name = window.prompt("الاسم الظاهر الجديد", user.displayName);
                    if (name === null || name.trim() === user.displayName) return;
                    run(user.uid, () => updateUser(user.uid, { displayName: name }), "تم تحديث الاسم", `تغيير اسم المستخدم ${user.username}`);
                  }} className="mt-1 flex items-center gap-1 text-[11px] font-bold text-slate-400 hover:text-[#a61d2d]"><Pencil className="h-3 w-3" /> تعديل الاسم</button>
                </div>
                <label>
                  <span className="sr-only">الدور</span>
                  <select disabled={isSelf || busy} value={user.role} onChange={(event) => {
                    const role = event.target.value as UserRole;
                    const vehiclePlate = role === "driver" ? user.vehiclePlate ?? vehicles[0]?.plate : undefined;
                    if (role === "driver" && !vehiclePlate) {
                      toast.error("أضف سيارة أولًا لربطها بالسائق");
                      return;
                    }
                    run(user.uid, () => updateUser(user.uid, vehiclePlate ? { role, vehiclePlate } : { role }), "تم تغيير الدور", `تغيير دور ${user.username} إلى ${ROLE_LABELS[role]}`);
                  }} className={`${inputClass} font-bold disabled:bg-slate-50 disabled:text-slate-400`}>
                    {USER_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
                  </select>
                  {user.role === "driver" && (
                    <select aria-label="سيارة السائق" disabled={busy} value={user.vehiclePlate ?? ""} onChange={(event) => {
                      const vehiclePlate = event.target.value;
                      run(user.uid, () => updateUser(user.uid, { vehiclePlate }), "تم ربط السائق بالسيارة", `ربط السائق ${user.username} بالسيارة ${vehiclePlate}`);
                    }} className={`${inputClass} mt-2`}>
                      {!user.vehiclePlate && <option value="">اختر السيارة</option>}
                      {vehicles.map((vehicle) => <option key={vehicle.plate} value={vehicle.plate}>{vehicle.plate} · {vehicle.driver}</option>)}
                    </select>
                  )}
                </label>
                <div className="flex flex-wrap gap-2">
                  <button disabled={isSelf || busy} onClick={() => resetPassword(user)} className="flex min-h-10 items-center gap-1 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40"><KeyRound className="h-3.5 w-3.5" /> كلمة مرور جديدة</button>
                  <button disabled={isSelf || busy} onClick={() => {
                    if (user.active && !window.confirm(`إيقاف حساب ${user.username}؟ سيُمنع من الدخول فورًا.`)) return;
                    run(user.uid, () => updateUser(user.uid, { active: !user.active }), user.active ? "تم إيقاف الحساب" : "تم تفعيل الحساب", `${user.active ? "إيقاف" : "تفعيل"} المستخدم ${user.username}`);
                  }} className={`min-h-10 rounded-xl px-3 text-xs font-bold disabled:opacity-40 ${user.active ? "border border-red-100 text-red-600 hover:bg-red-50" : "bg-emerald-600 text-white"}`}>{user.active ? "إيقاف" : "تفعيل"}</button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

function NewUserForm({ vehicles, onCreate, onCancel }: {
  vehicles: Vehicle[];
  onCreate: (input: { username: string; displayName: string; role: UserRole; password: string; vehiclePlate?: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({ username: "", displayName: "", role: "clinic" as UserRole, password: generateTemporaryPassword(), vehiclePlate: vehicles[0]?.plate ?? "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await onCreate(form);
    } catch (createError) {
      setError(authErrorMessage(createError, "تعذر إنشاء المستخدم"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mb-6 grid gap-4 rounded-2xl border border-[#f0c4ca] bg-white p-5 sm:grid-cols-2">
      <h3 className="flex items-center gap-2 font-bold sm:col-span-2"><UserPlus className="h-5 w-5 text-[#a61d2d]" /> مستخدم جديد</h3>
      <label><span className="mb-1.5 block text-xs font-bold text-slate-600">اسم المستخدم (بالإنجليزية)</span><input dir="ltr" autoCapitalize="none" spellCheck={false} value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} placeholder="clinic.ahmed" className={inputClass} /></label>
      <label><span className="mb-1.5 block text-xs font-bold text-slate-600">الاسم الظاهر</span><input value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} placeholder="أحمد - العيادة" className={inputClass} /></label>
      <label><span className="mb-1.5 block text-xs font-bold text-slate-600">الدور</span>
        <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as UserRole })} className={`${inputClass} font-bold`}>
          {USER_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
        </select>
      </label>
      {form.role === "driver" && (
        <label className="sm:col-span-2"><span className="mb-1.5 block text-xs font-bold text-slate-600">السيارة (يرسل السائق موقعها عبر GPS الهاتف)</span>
          <select value={form.vehiclePlate} onChange={(event) => setForm({ ...form, vehiclePlate: event.target.value })} className={`${inputClass} font-bold`}>
            {vehicles.map((vehicle) => <option key={vehicle.plate} value={vehicle.plate}>{vehicle.plate} · {vehicle.driver} · {vehicle.kind}</option>)}
          </select>
        </label>
      )}
      <label><span className="mb-1.5 block text-xs font-bold text-slate-600">كلمة المرور المؤقتة</span>
        <div className="flex gap-2">
          <input dir="ltr" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} className={`${inputClass} font-mono`} />
          <button type="button" onClick={() => setForm({ ...form, password: generateTemporaryPassword() })} className="shrink-0 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-600 hover:bg-slate-50">توليد</button>
        </div>
      </label>
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-700 sm:col-span-2">{error}</p>}
      <div className="flex gap-3 sm:col-span-2">
        <button disabled={busy} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#a61d2d] text-sm font-bold text-white hover:bg-[#8b1725] disabled:opacity-60"><CheckCircle2 className="h-4 w-4" /> {busy ? "جارٍ الإنشاء..." : "إنشاء الحساب"}</button>
        <button type="button" onClick={onCancel} className="rounded-xl border border-slate-200 px-5 text-sm font-bold text-slate-600">إلغاء</button>
      </div>
    </form>
  );
}

function IssuedPassword({ username, password, onClose }: { username: string; password: string; onClose: () => void }) {
  return (
    <div role="status" className="mb-6 flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-900 sm:flex-row sm:items-center">
      <ShieldCheck className="h-6 w-6 shrink-0" />
      <div className="flex-1">
        <p className="font-bold">سلّم هذه البيانات للمستخدم بشكل آمن. لن تظهر مرة أخرى.</p>
        <p className="mt-1">اسم المستخدم: <b dir="ltr">{username}</b> · كلمة المرور المؤقتة: <b dir="ltr" className="font-mono">{password}</b></p>
      </div>
      <button onClick={() => navigator.clipboard?.writeText(`${username} / ${password}`).then(() => toast.success("تم النسخ"), () => toast.error("تعذر النسخ"))} className="flex min-h-10 items-center gap-1 rounded-xl bg-white px-3 text-xs font-bold text-emerald-800"><Copy className="h-3.5 w-3.5" /> نسخ</button>
      <button onClick={onClose} aria-label="إغلاق" className="flex h-10 w-10 items-center justify-center rounded-xl text-emerald-800 hover:bg-white"><X className="h-4 w-4" /></button>
    </div>
  );
}

// ————— السيارات —————

type VehicleDraft = { plate: string; driver: string; phone: string; kind: VehicleKind };

function VehiclesTab({ vehicles, requests, onChange }: {
  vehicles: Vehicle[];
  requests: VehicleRequest[];
  onChange: (next: Vehicle[], message: string) => void;
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
      onChange(vehicles.map((vehicle) => vehicle.plate === original.plate ? { ...vehicle, ...result.vehicle } : vehicle), `تعديل بيانات السيارة ${result.vehicle.plate}`);
      toast.success("تم تحديث بيانات السيارة");
    } else {
      onChange([...vehicles, { ...result.vehicle, available: true }], `إضافة السيارة ${result.vehicle.plate}`);
      toast.success("تمت إضافة السيارة");
    }
    setEditing(null);
  }

  function remove(vehicle: Vehicle) {
    if (vehicleHasActiveTrip(vehicle.plate, requests)) {
      toast.error("لا يمكن حذف سيارة في رحلة جارية");
      return;
    }
    if (!window.confirm(`حذف السيارة ${vehicle.plate} (${vehicle.driver})؟`)) return;
    onChange(vehicles.filter((item) => item.plate !== vehicle.plate), `حذف السيارة ${vehicle.plate}`);
    toast.success("تم حذف السيارة");
  }

  return (
    <>
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><p className="text-sm font-bold text-[#a61d2d]">بيانات الأسطول</p><h2 className="mt-2 text-2xl font-bold">السيارات والسائقون</h2><p className="mt-2 text-sm text-slate-500">عدّل رقم السيارة واسم السائق ورقم هاتفه ونوع السيارة. التغييرات تظهر فورًا لمشرف السيارات.</p></div>
        <button onClick={() => setEditing("")} className="flex min-h-11 items-center gap-2 rounded-xl bg-[#a61d2d] px-4 text-sm font-bold text-white hover:bg-[#8b1725]"><Plus className="h-4 w-4" /> إضافة سيارة</button>
      </div>
      {editing === "" && <VehicleForm onSave={save} onCancel={() => setEditing(null)} />}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="divide-y divide-slate-100">
          {vehicles.length === 0 && <p className="p-6 text-center text-sm text-slate-400">لا توجد سيارات مسجلة.</p>}
          {vehicles.map((vehicle) => editing === vehicle.plate
            ? <div key={vehicle.plate} className="p-3"><VehicleForm initial={vehicle} onSave={save} onCancel={() => setEditing(null)} /></div>
            : (
              <div key={vehicle.plate} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
                <div className="flex flex-1 items-center gap-3">
                  <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${vehicle.available ? "bg-[#fff1f2] text-[#a61d2d]" : "bg-slate-100 text-slate-400"}`}><Truck className="h-5 w-5" /></div>
                  <div>
                    <p className="font-bold">{vehicle.plate} · {vehicle.driver}</p>
                    <p className="mt-1 text-xs text-slate-400">{vehicle.kind} · <span dir="ltr">{vehicle.phone}</span> · {vehicle.available ? "متاحة للخدمة" : "خارج الخدمة"}{vehicleHasActiveTrip(vehicle.plate, requests) && " · في رحلة جارية"}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setEditing(vehicle.plate)} className="flex min-h-10 items-center gap-1 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-600 hover:bg-slate-50"><Pencil className="h-3.5 w-3.5" /> تعديل</button>
                  <button onClick={() => remove(vehicle)} className="flex min-h-10 items-center gap-1 rounded-xl border border-red-100 px-3 text-xs font-bold text-red-600 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /> حذف</button>
                </div>
              </div>
            ))}
        </div>
      </section>
    </>
  );
}

function VehicleForm({ initial, onSave, onCancel }: { initial?: Vehicle; onSave: (draft: VehicleDraft) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<VehicleDraft>({
    plate: initial?.plate ?? "",
    driver: initial?.driver ?? "",
    phone: initial?.phone ?? "",
    kind: initial?.kind ?? "سيدان",
  });

  return (
    <form onSubmit={(event) => { event.preventDefault(); onSave(draft); }} className="mb-4 grid gap-4 rounded-2xl border border-[#f0c4ca] bg-white p-5 sm:grid-cols-2 lg:grid-cols-4">
      <label><span className="mb-1.5 block text-xs font-bold text-slate-600">رقم السيارة</span><input dir="ltr" value={draft.plate} onChange={(event) => setDraft({ ...draft, plate: event.target.value })} className={inputClass} /></label>
      <label><span className="mb-1.5 block text-xs font-bold text-slate-600">اسم السائق</span><input value={draft.driver} onChange={(event) => setDraft({ ...draft, driver: event.target.value })} className={inputClass} /></label>
      <label><span className="mb-1.5 block text-xs font-bold text-slate-600">هاتف السائق</span><input dir="ltr" type="tel" value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} className={inputClass} /></label>
      <label><span className="mb-1.5 block text-xs font-bold text-slate-600">نوع السيارة</span>
        <select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as VehicleKind })} className={`${inputClass} font-bold`}>
          {VEHICLE_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
        </select>
      </label>
      <div className="flex gap-3 sm:col-span-2 lg:col-span-4">
        <button className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#a61d2d] text-sm font-bold text-white hover:bg-[#8b1725]"><CheckCircle2 className="h-4 w-4" /> {initial ? "حفظ التعديلات" : "إضافة السيارة"}</button>
        <button type="button" onClick={onCancel} className="rounded-xl border border-slate-200 px-5 text-sm font-bold text-slate-600">إلغاء</button>
      </div>
    </form>
  );
}

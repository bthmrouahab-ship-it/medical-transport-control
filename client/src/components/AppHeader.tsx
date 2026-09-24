import type { ReactNode } from "react";
import { KeyRound, LogOut } from "lucide-react";
import { Crescent } from "./BrandLogo";

/** رأس موحّد لكل الصفحات: الشعار واسم النظام والدور، ثم أزرار الحساب. */
export default function AppHeader({ role, name, actions, onChangePassword, onLogout, labels }: {
  role: string;
  name?: string;
  actions?: ReactNode;
  onChangePassword?: () => void;
  onLogout?: () => void;
  labels?: { changePassword: string; logout: string; app?: string };
}) {
  const text = { changePassword: "تغيير كلمة المرور", logout: "تسجيل الخروج", app: "سيارات مجمع الثمامة", ...labels };
  return (
    <header className="sticky top-0 z-[1000] border-b border-slate-200 bg-white/95 backdrop-blur-xl">
      <div className="mx-auto flex h-[68px] max-w-7xl items-center justify-between gap-3 px-4 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white ring-1 ring-slate-200"><Crescent className="h-7 w-7" /></div>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-bold text-slate-900">{text.app}</p>
            <p className="truncate text-xs font-semibold text-[#a61d2d]">{role}{name && name !== role ? <span className="text-slate-400"> · {name}</span> : null}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          {onChangePassword && <button onClick={onChangePassword} aria-label={text.changePassword} title={text.changePassword} className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:text-[#a61d2d]"><KeyRound className="h-4 w-4" /></button>}
          {onLogout && <button onClick={onLogout} aria-label={text.logout} title={text.logout} className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:text-red-600"><LogOut className="h-4 w-4" /></button>}
        </div>
      </div>
    </header>
  );
}

import type { ReactNode } from "react";
import { KeyRound, LogOut } from "lucide-react";
import { LogoMark } from "./BrandLogo";

/** رأس موحّد لكل الصفحات: شريط داكن فيه الشعار واسم النظام والدور، ثم أزرار الحساب. */
export default function AppHeader({ role, name, actions, onChangePassword, onLogout, labels, children }: {
  role: string;
  name?: string;
  actions?: ReactNode;
  onChangePassword?: () => void;
  onLogout?: () => void;
  labels?: { changePassword: string; logout: string; app?: string };
  /** شريط إضافي داخل الرأس الثابت (مثل حالة موقع السائق) */
  children?: ReactNode;
}) {
  const text = {
    changePassword: labels?.changePassword ?? "تغيير كلمة المرور",
    logout: labels?.logout ?? "تسجيل الخروج",
    app: labels?.app ?? "سيارات مجمع الثمامة",
  };
  const iconButton = "flex h-10 w-10 items-center justify-center rounded-xl text-slate-300 transition hover:bg-white/10 hover:text-white";
  return (
    <header className="sticky top-0 z-[1000] bg-navy-900 text-white shadow-[0_4px_16px_-8px_rgba(15,39,66,.6)]">
      <div className="h-[3px] bg-brand-600" />
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white p-0.5 shadow-sm"><LogoMark className="h-full w-full" /></div>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-[15px] font-semibold">{text.app}</p>
            <p className="mt-0.5 truncate text-xs text-slate-300">
              <span className="font-medium text-white">{role}</span>
              {name && name !== role ? <span> · {name}</span> : null}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {actions}
          {onChangePassword && <button onClick={onChangePassword} aria-label={text.changePassword} title={text.changePassword} className={iconButton}><KeyRound className="h-[18px] w-[18px]" /></button>}
          {onLogout && <button onClick={onLogout} aria-label={text.logout} title={text.logout} className={iconButton}><LogOut className="h-[18px] w-[18px]" /></button>}
        </div>
      </div>
      {children}
    </header>
  );
}

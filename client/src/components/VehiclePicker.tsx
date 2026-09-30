import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Accessibility, Bus, CarFront, Check, ChevronDown } from "lucide-react";
import type { Vehicle, VehicleKind } from "@shared/transport";
import { cx, inputClass } from "./ui-kit";

/**
 * علامة ولون ثابتان لكل نوع سيارة، حتى يميّزها مشرف السيارات بنظرة: سيدان أزرق بسيارة،
 * واحتياجات خاصة بنفسجي بكرسي متحرك، وباص برتقالي بباص. اللون لا يأتي وحده: الأيقونة والاسم معه دائمًا.
 */
export const KIND_STYLE: Record<VehicleKind, { icon: typeof CarFront; text: string; chip: string; label: string }> = {
  "سيدان": { icon: CarFront, text: "text-blue-700", chip: "bg-blue-50 text-blue-700 ring-blue-200", label: "سيدان" },
  "احتياجات خاصة": { icon: Accessibility, text: "text-violet-700", chip: "bg-violet-50 text-violet-700 ring-violet-200", label: "احتياجات خاصة" },
  "باص": { icon: Bus, text: "text-orange-700", chip: "bg-orange-50 text-orange-700 ring-orange-200", label: "باص" },
};

const styleOf = (vehicle: Pick<Vehicle, "kind">) => KIND_STYLE[vehicle.kind] ?? KIND_STYLE["سيدان"];

/** أيقونة نوع السيارة في مربع بلونه */
export function KindIcon({ vehicle, size = "md" }: { vehicle: Pick<Vehicle, "kind">; size?: "sm" | "md" }) {
  const style = styleOf(vehicle);
  const Icon = style.icon;
  return (
    <span aria-hidden="true" className={cx("flex shrink-0 items-center justify-center rounded-lg ring-1 ring-inset", style.chip, size === "sm" ? "h-6 w-6" : "h-8 w-8")}>
      <Icon className={size === "sm" ? "h-3.5 w-3.5" : "h-[18px] w-[18px]"} />
    </span>
  );
}

/** رقم السيارة واسم نوعها بلونه (مع تخصيص الباص إن وُجد) */
export function KindLabel({ vehicle, extra }: { vehicle: Pick<Vehicle, "kind">; extra?: string }) {
  return <span className={cx("font-semibold", styleOf(vehicle).text)}>{styleOf(vehicle).label}{extra ? ` · ${extra}` : ""}</span>;
}

export type VehicleOption = { vehicle: Vehicle; why: string | null };

/**
 * اختيار السيارة لرحلة بدل القائمة المنسدلة العادية: كل سيارة بعلامة نوعها ولونه، ورقمها وسائقها،
 * ثم مكانها ورحلاتها اليوم. غير المتاحة ظاهرة ومعطّلة مع السبب. القائمة فوق الصفحة (لا يقصّها القسم).
 */
export function VehiclePicker({ label, options, value, onChange, disabled, invalid, placeholder, driverOf, details, roleOf }: {
  label: string;
  options: VehicleOption[];
  value: string;
  onChange: (plate: string) => void;
  disabled?: boolean;
  /** إطار أحمر (مثل سيارة مختارة لرحلتين في التوزيع التلقائي) */
  invalid?: boolean;
  placeholder: string;
  driverOf: (vehicle: Vehicle) => string;
  /** مكان السيارة ورحلاتها اليوم */
  details: (vehicle: Vehicle) => string;
  /** تخصيص الباص (باص المجمع...) */
  roleOf?: (vehicle: Vehicle) => string | undefined;
}) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const selected = options.find((option) => option.vehicle.plate === value && !option.why)?.vehicle;
  const enabled = options.map((option, index) => (option.why ? -1 : index)).filter((index) => index >= 0);

  function show() {
    if (disabled) return;
    const current = options.findIndex((option) => option.vehicle.plate === value && !option.why);
    setActive(current >= 0 ? current : enabled[0] ?? 0);
    setOpen(true);
  }

  function choose(index: number) {
    const option = options[index];
    if (!option || option.why) return;
    onChange(option.vehicle.plate);
    setOpen(false);
    button.current?.focus();
  }

  function move(step: 1 | -1) {
    if (!enabled.length) return;
    const at = enabled.indexOf(active);
    setActive(enabled[(at + step + enabled.length) % enabled.length]);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        show();
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      move(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(active);
    } else if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") {
        event.preventDefault();
        // لا تُغلق النافذة التي فيها القائمة، بل القائمة وحدها
        event.nativeEvent.stopPropagation();
      }
      setOpen(false);
    }
  }

  const roleText = (vehicle: Vehicle) => roleOf?.(vehicle);
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
        className={cx(inputClass, "flex h-auto min-h-10 min-w-0 flex-1 items-center gap-2.5 py-1.5 pe-2 text-start disabled:cursor-not-allowed",
          invalid && "border-red-400 bg-red-50", open && "border-brand-600/50 bg-white ring-4 ring-brand-600/10")}
      >
        {selected ? (
          <>
            <KindIcon vehicle={selected} size="sm" />
            <span className="min-w-0 flex-1 truncate text-sm">
              <span dir="ltr" className={cx("font-bold tabular", styleOf(selected).text)}>{selected.plate}</span>
              <span className="text-slate-400"> · </span>
              <span className="font-medium text-ink">{driverOf(selected)}</span>
              <span className="text-slate-400"> · </span>
              <KindLabel vehicle={selected} extra={roleText(selected)} />
            </span>
          </>
        ) : <span className="min-w-0 flex-1 truncate text-sm text-slate-400">{placeholder}</span>}
        <ChevronDown className={cx("h-4 w-4 shrink-0 text-slate-400 transition", open && "rotate-180")} />
      </button>
      {open && button.current && (
        <VehicleList
          anchor={button.current}
          id={id}
          label={label}
          options={options}
          value={value}
          active={active}
          onActive={setActive}
          onChoose={choose}
          onClose={() => setOpen(false)}
          onKeyDown={onKeyDown}
          render={(vehicle, why) => (
            <>
              <KindIcon vehicle={vehicle} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">
                  <span dir="ltr" className={cx("font-bold tabular", why ? "text-slate-400" : styleOf(vehicle).text)}>{vehicle.plate}</span>
                  <span className="text-slate-400"> · </span>
                  <span className={why ? "text-slate-400" : "font-medium text-ink"}>{driverOf(vehicle)}</span>
                </span>
                <span className="block truncate text-xs">
                  <span className={why ? "font-semibold text-slate-400" : undefined}>{why ? `${styleOf(vehicle).label}${roleText(vehicle) ? ` · ${roleText(vehicle)}` : ""}` : <KindLabel vehicle={vehicle} extra={roleText(vehicle)} />}</span>
                  <span className="text-slate-400"> · </span>
                  <span className={why ? "text-red-700/80" : "text-slate-500"}>{why ?? details(vehicle)}</span>
                </span>
              </span>
            </>
          )}
        />
      )}
    </>
  );
}

function VehicleList({ anchor, id, label, options, value, active, onActive, onChoose, onClose, onKeyDown, render }: {
  anchor: HTMLElement;
  id: string;
  label: string;
  options: VehicleOption[];
  value: string;
  active: number;
  onActive: (index: number) => void;
  onChoose: (index: number) => void;
  onClose: () => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
  render: (vehicle: Vehicle, why: string | null) => ReactNode;
}) {
  const list = useRef<HTMLUListElement>(null);
  const [place, setPlace] = useState({ top: -9999, left: 0, width: 320, maxHeight: 360 });

  // تحت الزر (أو فوقه إن لم يتسع المكان)، ومحصورة داخل الشاشة، وتتبع الزر إذا تحركت الصفحة
  const position = useCallback(() => {
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 340), window.innerWidth - 16);
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const height = Math.min(list.current?.scrollHeight ?? 360, 360);
    const up = below < Math.min(height, 240) && above > below;
    const maxHeight = Math.max(160, Math.min(360, up ? above : below));
    const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
    setPlace({ top: up ? Math.max(8, rect.top - 6 - Math.min(height, maxHeight)) : rect.bottom + 6, left, width, maxHeight });
  }, [anchor]);

  useLayoutEffect(() => {
    position();
    list.current?.focus({ preventScroll: true });
  }, [position]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  useEffect(() => {
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (!list.current?.contains(target) && !anchor.contains(target)) onClose();
    };
    const follow = (event: Event) => !list.current?.contains(event.target as Node) && position();
    document.addEventListener("mousedown", outside);
    document.addEventListener("touchstart", outside);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", position);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("touchstart", outside);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", position);
    };
  }, [anchor, onClose, position]);

  return createPortal(
    <ul
      ref={list}
      id={`${id}-list`}
      role="listbox"
      aria-label={label}
      tabIndex={-1}
      dir="rtl"
      aria-activedescendant={`${id}-${active}`}
      onKeyDown={onKeyDown}
      style={{ top: place.top, left: place.left, width: place.width, maxHeight: place.maxHeight, visibility: place.top < -1000 ? "hidden" : undefined }}
      className="animate-rise fixed z-[2000] overflow-y-auto rounded-xl bg-white p-1.5 text-ink shadow-raised outline-none ring-1 ring-slate-900/10"
    >
      {options.map(({ vehicle, why }, index) => (
        <li
          key={vehicle.plate}
          id={`${id}-${index}`}
          data-index={index}
          role="option"
          aria-selected={vehicle.plate === value && !why}
          aria-disabled={Boolean(why)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onChoose(index)}
          onMouseEnter={() => !why && onActive(index)}
          className={cx(
            "flex items-center gap-2.5 rounded-lg px-2.5 py-2",
            why ? "cursor-not-allowed opacity-60" : "cursor-pointer",
            !why && index === active && "bg-slate-100",
          )}
        >
          {render(vehicle, why)}
          {vehicle.plate === value && !why && <Check className="h-4 w-4 shrink-0 text-brand-600" />}
        </li>
      ))}
    </ul>,
    document.body,
  );
}

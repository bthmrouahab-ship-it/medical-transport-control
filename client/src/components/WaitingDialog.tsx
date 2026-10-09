import { useMemo, useState } from "react";
import { Hourglass } from "lucide-react";
import { distanceKm, type Hospital } from "@shared/hospitals";
import type { Vehicle, VehicleWaiting } from "@shared/transport";
import { Modal, btn, choiceClass, cx, inputClass, labelClass } from "./ui-kit";

/** ضيف ذهبت به السيارة اليوم ويمكن أن تنتظره لعودته */
export type WaitCandidate = { appointmentId: string; name: string; place: string; hospitalId?: string };

/** «0.3 كم» أو «150 م» */
const distanceText = (km: number) => (km < 1 ? `${Math.round(km * 1000 / 10) * 10} م` : `${km.toFixed(1)} كم`);

/**
 * انتظار السيارة في المستشفى بدل عودتها إلى المجمع (من تنبيه السيارة المتوقفة أو من قائمة السيارات): المكان (الأقرب إلى
 * السيارة أولًا)، والضيف الذي تنتظره لعودته اختياريًا، وملاحظة. لا تُرسل في رحلة أخرى حتى ينتهي الانتظار.
 */
export default function WaitingDialog({ vehicle, driver, position, places, candidates, onConfirm, onClose }: {
  vehicle: Vehicle;
  driver: string;
  /** موقع السيارة الآن (GPS) أو مكانها التقديري، لترتيب الأماكن بالقرب */
  position: { lat: number; lng: number } | null;
  places: Hospital[];
  candidates: WaitCandidate[];
  onConfirm: (waiting: VehicleWaiting) => void;
  onClose: () => void;
}) {
  const sorted = useMemo(() => places
    .map((place) => ({ place, km: position ? distanceKm(position, place) : null }))
    .sort((a, b) => (a.km ?? 0) - (b.km ?? 0) || a.place.name.localeCompare(b.place.name, "ar")), [places, position]);
  // المكان المقترح: مستشفى آخر ضيف ذهبت به، إن كانت قريبة منه، وإلا الأقرب إلى السيارة
  const first = candidates[0];
  const nearest = sorted[0];
  const firstPlace = first?.hospitalId ? sorted.find((item) => item.place.id === first.hospitalId) : undefined;
  const initial = firstPlace && (firstPlace.km === null || firstPlace.km <= 1) ? firstPlace.place : nearest?.place;
  const [placeId, setPlaceId] = useState(initial?.id ?? "");
  const [appointmentId, setAppointmentId] = useState(first && (!first.hospitalId || first.hospitalId === initial?.id) ? first.appointmentId : "");
  const [note, setNote] = useState("");
  const place = sorted.find((item) => item.place.id === placeId)?.place;
  // بلا مكان معروف قريب: تنتظر في مكانها الحالي
  const here = !place && position;

  function confirm() {
    const target = place ? { place: place.name, hospitalId: place.id, lat: place.lat, lng: place.lng } : here ? { place: "مكانها الحالي", lat: position!.lat, lng: position!.lng } : null;
    if (!target) return;
    onConfirm({ ...target, ...(appointmentId ? { appointmentId } : {}), ...(note.trim() ? { note: note.trim() } : {}) });
  }

  return (
    <Modal
      tone="cyan"
      icon={Hourglass}
      title="انتظار في المستشفى"
      description={<>السيارة <span dir="ltr" className="font-semibold">{vehicle.plate}</span>{driver ? ` · ${driver}` : ""}</>}
      onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={onClose} className={btn("secondary")}>إلغاء</button>
          <button type="button" disabled={!place && !here} onClick={confirm} className={btn("primary")}><Hourglass className="h-4 w-4" /> انتظار في المستشفى</button>
        </>
      )}
    >
      <ul className="space-y-1.5 rounded-xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700 ring-1 ring-inset ring-slate-200/70">
        <li>تبقى السيارة في المستشفى ولا تعود إلى المجمع، ولا تُرسل في رحلة أخرى حتى ينتهي الانتظار.</li>
        <li>عند طلب عودة الضيف الذي تنتظره تُقترح له أولًا، ويُرسلها المشرف كالمعتاد.</li>
        <li>ينتهي الانتظار بـ «إنهاء الانتظار»، أو بإرسال السيارة في أي رحلة، أو بنهاية اليوم.</li>
      </ul>
      <label className="mt-4 block">
        <span className={labelClass}>مكان الانتظار</span>
        <select value={placeId} onChange={(event) => setPlaceId(event.target.value)} className={inputClass} aria-label="مكان الانتظار">
          {position && <option value="">مكانها الحالي (لا يوجد مستشفى قريب)</option>}
          {sorted.map(({ place, km }) => <option key={place.id} value={place.id}>{place.name}{km !== null ? ` · ${distanceText(km)}` : ""}</option>)}
        </select>
      </label>
      <fieldset className="mt-4">
        <legend className={labelClass}>تنتظر عودة</legend>
        <div className="space-y-2">
          {candidates.map((candidate) => (
            <label key={candidate.appointmentId} className={cx(choiceClass(appointmentId === candidate.appointmentId), "flex items-center gap-3")}>
              <input type="radio" name="waiting-guest" checked={appointmentId === candidate.appointmentId} onChange={() => setAppointmentId(candidate.appointmentId)} className="accent-brand-600" />
              <span className="min-w-0 flex-1"><span className="font-medium text-ink">{candidate.name}</span> <span className="text-xs text-slate-500">· {candidate.place}</span></span>
            </label>
          ))}
          <label className={cx(choiceClass(!appointmentId), "flex items-center gap-3")}>
            <input type="radio" name="waiting-guest" checked={!appointmentId} onChange={() => setAppointmentId("")} className="accent-brand-600" />
            <span className="text-slate-700">بلا ضيف محدد</span>
          </label>
        </div>
      </fieldset>
      <label className="mt-4 block">
        <span className={labelClass}>ملاحظة (اختياري)</span>
        <input value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} placeholder="مثل: الضيف في غسيل الكلى حتى 13:00" className={inputClass} />
      </label>
    </Modal>
  );
}

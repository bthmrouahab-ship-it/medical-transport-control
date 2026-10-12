import { useEffect, useState } from "react";
import { ensureHistory, historyFrom } from "./appStore";

/**
 * أول تحميل يرسل مواعيد آخر 30 يومًا (والقادمة والمفتوحة) فقط. needed: الصفحة تحتاج الأقدم (الإحصائيات، «كل الأيام»،
 * يوم قبل أول يوم محمّل)، فتُحمَّل مرة واحدة. يعيد true أثناء التحميل.
 */
export function useHistory(needed: boolean): boolean {
  const [loading, setLoading] = useState(() => needed && historyFrom() !== null);
  useEffect(() => {
    if (!needed || historyFrom() === null) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    ensureHistory()
      .catch((error) => console.error("[history]", error))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [needed]);
  return loading;
}

/** اليوم قبل أول يوم محمّل؟ (يحتاج تحميل الأقدم) */
export const beforeLoaded = (date: string) => {
  const from = historyFrom();
  return from !== null && date < from;
};

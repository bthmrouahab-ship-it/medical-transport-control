import { useEffect, useState } from "react";

/** وضع العرض في صفحة السائق: تلقائي، أو فاتح، أو داكن. */
export type DriverTheme = "auto" | "light" | "dark";
export const DRIVER_THEMES: DriverTheme[] = ["auto", "light", "dark"];

const STORAGE_KEY = "althumama.driverTheme";
/** الليل في الوضع التلقائي: من 6 مساءً إلى 6 صباحًا */
const NIGHT_FROM = 18;
const NIGHT_TO = 6;
/** خلفية الصفحة في الوضع الداكن (slate-950)، للمساحة خارج الصفحة عند السحب */
const DARK_PAGE = "#020617";

const isNight = (date = new Date()) => date.getHours() >= NIGHT_FROM || date.getHours() < NIGHT_TO;
const darkQuery = () => (typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null);

function storedTheme(): DriverTheme {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "auto";
  } catch {
    return "auto";
  }
}

/**
 * الوضع الداكن لصفحة السائق (للقيادة ليلًا): في «تلقائي» يصبح داكنًا إن كان الهاتف على الوضع الداكن
 * أو في الليل، ويتغير وحده دون إعادة فتح الصفحة. الاختيار يُحفظ على الهاتف.
 */
export function useDriverTheme(): { theme: DriverTheme; dark: boolean; setTheme: (theme: DriverTheme) => void } {
  const [theme, setThemeState] = useState<DriverTheme>(storedTheme);
  const [systemDark, setSystemDark] = useState(() => darkQuery()?.matches ?? false);
  const [night, setNight] = useState(() => isNight());

  useEffect(() => {
    const query = darkQuery();
    const onChange = () => setSystemDark(query?.matches ?? false);
    query?.addEventListener?.("change", onChange);
    const timer = window.setInterval(() => setNight(isNight()), 60000);
    return () => {
      query?.removeEventListener?.("change", onChange);
      window.clearInterval(timer);
    };
  }, []);

  const dark = theme === "dark" || (theme === "auto" && (systemDark || night));

  // خلفية الصفحة كلها داكنة أيضًا (ما يظهر عند السحب خارج حدودها)
  useEffect(() => {
    if (!dark) return;
    const html = document.documentElement.style;
    const body = document.body.style;
    const previous = { html: html.backgroundColor, body: body.backgroundColor };
    html.backgroundColor = DARK_PAGE;
    body.backgroundColor = DARK_PAGE;
    return () => {
      html.backgroundColor = previous.html;
      body.backgroundColor = previous.body;
    };
  }, [dark]);

  function setTheme(next: DriverTheme) {
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* التخزين غير متاح: يبقى الاختيار حتى إغلاق الصفحة */
    }
  }

  return { theme, dark, setTheme };
}

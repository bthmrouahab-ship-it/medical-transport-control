import { describe, expect, it } from "vitest";
import { isValidMobile, normalizeMobile } from "../shared/text";
import { normalizeGuestMobile, validateGuest } from "../shared/guests";

describe("رقم الهاتف في قطر: 8 أرقام بالضبط", () => {
  it("يحذف المسافات والشرطات ورمز قطر ويحوّل الأرقام العربية", () => {
    expect(normalizeMobile("5550 0011")).toBe("55500011");
    expect(normalizeMobile("٥٥٥-٠٠٠-١١")).toBe("55500011");
    expect(normalizeMobile("+974 5550 0011")).toBe("55500011");
    expect(normalizeMobile("00974-55500011")).toBe("55500011");
    expect(normalizeMobile("97455500011")).toBe("55500011");
  });

  it("يقبل 8 أرقام فقط، لا أكثر ولا أقل", () => {
    expect(isValidMobile("55500011")).toBe(true);
    expect(isValidMobile("5550001")).toBe(false);
    expect(isValidMobile("555000111")).toBe(false);
    expect(isValidMobile("+55500011")).toBe(false);
    expect(isValidMobile(normalizeMobile("+974 55500011"))).toBe(true);
  });

  it("قائمة الضيوف: أول رقم صالح من 8 أرقام، وإلا بلا رقم", () => {
    expect(normalizeGuestMobile("5550001/55500022")).toBe("55500022");
    expect(normalizeGuestMobile("+97455500011")).toBe("55500011");
    expect(normalizeGuestMobile("5550001")).toBe("");
    const guest = { id: "G-1", name: "ضيف تجربة", buildingNumber: "1", apartmentNumber: "2" };
    expect(validateGuest({ ...guest, mobile: "5550001" }, [])).toBe("رقم الهاتف غير صحيح: 8 أرقام.");
    expect(validateGuest({ ...guest, mobile: "55500011" }, [])).toBeNull();
  });
});

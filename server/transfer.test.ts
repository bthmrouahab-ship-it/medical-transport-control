import { describe, expect, it } from "vitest";
import { DEFAULT_HOSPITALS, ORIGIN } from "../shared/hospitals";
import { buildDriverMessage, nextAppointmentOf, parseImportedAppointments, planDispatch, sameDayAppointments, type ClinicAppointment, type VehicleRequest } from "../shared/transport";
import { estimateTravelMinutes, pickupDetails, suggestReturnRedirects, tripEndpoints, vehicleLocationState } from "../shared/trips";

const wakra = DEFAULT_HOSPITALS.find((hospital) => hospital.id === "wakra")!;
const hgh = DEFAULT_HOSPITALS.find((hospital) => hospital.id === "hgh")!;
const now = new Date(2026, 8, 24, 9, 0);
const appointment = (id: string, time: string, extra: Partial<ClinicAppointment> = {}): ClinicAppointment => ({
  id, patientName: "ضيف تجربة", clinic: "مستشفى الوكرة", hospitalId: "wakra", buildingNumber: "17", apartmentNumber: "3", mobile: "55500000",
  appointmentDate: "2026-09-24", appointmentAt: time, kind: "عادي", assistance: [], status: "بانتظار طلب السيارة", ...extra,
});
const first = appointment("A1", "09:30", { status: "تم استلام المريض" });
const second = appointment("A2", "12:00", { clinic: "مستشفى حمد العام", hospitalId: "hgh" });
const transfer: VehicleRequest = {
  id: "R-T", appointmentId: "A2", direction: "ذهاب", status: "بانتظار التوزيع", notificationMethod: "whatsapp", createdAt: "10:30", fromAppointmentId: "A1",
};

describe("two appointments for the same guest on the same day", () => {
  it("finds the guest's next appointment that can take a transfer", () => {
    const other = appointment("B1", "12:00", { patientName: "ضيف آخر" });
    const cancelled = appointment("A3", "11:00", { status: "ملغي" });
    const list = [first, second, other, cancelled];
    expect(nextAppointmentOf(first, list, now)?.id).toBe("A2");
    expect(sameDayAppointments(second, list).map((item) => item.id)).toEqual(["A1"]);
    // بعد طلب سيارة للموعد الثاني من المجمع، لا نقل إليه
    expect(nextAppointmentOf(first, [first, { ...second, status: "تم طلب السيارة" }], now)).toBeNull();
    // المسافات وحالة الأحرف لا تغيّر الضيف
    expect(nextAppointmentOf(first, [first, { ...second, patientName: " ضيف  تجربة " }], now)?.id).toBe("A2");
  });

  it("routes the transfer from the first hospital to the second", () => {
    const route = tripEndpoints(second, "ذهاب", DEFAULT_HOSPITALS, first);
    expect(route.from).toEqual({ lat: wakra.lat, lng: wakra.lng });
    expect(route.to).toEqual({ lat: hgh.lat, lng: hgh.lng });
    const details = pickupDetails(transfer, second, DEFAULT_HOSPITALS, now, 1, first);
    expect(details.destLat).toBe(hgh.lat);
    // الوقت المتوقع محسوب من الوكرة إلى حمد العام
    expect((Date.parse(details.etaAt!) - now.getTime()) / 60000).toBe(estimateTravelMinutes(wakra, hgh, now));
    const message = buildDriverMessage([{ appointment: second, request: transfer, from: first }], { plate: "111", driver: "علي" });
    expect(message).toContain("نقل بين موعدين");
    expect(message).toContain("من: مستشفى الوكرة (بعد موعده 09:30)");
    expect(message).toContain("إلى: مستشفى حمد العام");
    expect(message).not.toContain("مبنى 17");
  });

  it("does not group a transfer with trips leaving the complex, and redirects an outside car to it", () => {
    const fromComplex = appointment("C1", "12:05", { patientName: "ضيف ثالث", clinic: "مستشفى حمد العام", hospitalId: "hgh", buildingNumber: "18" });
    const plan = planDispatch([
      { request: transfer, appointment: second },
      { request: { ...transfer, id: "R-C", appointmentId: "C1", fromAppointmentId: undefined }, appointment: fromComplex },
    ], [{ plate: "111", driver: "علي", phone: "1", kind: "سيدان", available: true }, { plate: "222", driver: "حسن", phone: "2", kind: "سيدان", available: true }]);
    expect(plan.assignments.every((item) => item.requestIds.length === 1)).toBe(true);

    // سيارة أوصلت ضيفًا إلى الوكرة للتو: قريبة من الضيف الذي يُنقل من الوكرة
    const arrived = new Date(now.getTime() - 60000).toISOString();
    const car: VehicleRequest = { id: "R-X", appointmentId: "X", vehiclePlate: "111", direction: "ذهاب", status: "وصلت الوجهة", notificationMethod: "whatsapp", createdAt: "08:00", arrivedAt: arrived, etaAt: arrived, arrivalSource: "gps", destLat: wakra.lat, destLng: wakra.lng };
    const states = new Map([["111", vehicleLocationState("111", [car], [], DEFAULT_HOSPITALS, now)]]);
    const redirects = suggestReturnRedirects([{ request: transfer, appointment: second, from: first }], [{ plate: "111", driver: "علي", phone: "1", kind: "سيدان", available: true }], states);
    expect(redirects.map((item) => [item.request.id, item.vehicle.plate, item.pickup])).toEqual([["R-T", "111", "مستشفى الوكرة"]]);
    expect(ORIGIN.name).toBe("مجمع الثمامة");
  });

  it("reads escort and nurse as separate needs when importing", () => {
    const rows = [{ "اسم الضيف أو الرقم": "ضيف", "اسم العيادة أو المستشفى": "مستشفى الوكرة", "رقم المبنى": "1", "رقم الشقة": "2", "رقم الموبايل": "55500000",
      "تاريخ الموعد": "2026-09-24", "وقت الموعد": "10:00", "نوع الرحلة": "عادي", "احتياجات الضيف": "يحتاج مرافق، Needs Nurse" }];
    const [imported] = parseImportedAppointments(rows, [], 1, "2026-09-24").appointments;
    expect(imported.assistance).toEqual(["يحتاج مرافق", "يحتاج Nurse"]);
  });
});

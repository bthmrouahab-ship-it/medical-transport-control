import { describe, expect, it } from "vitest";
import { DEFAULT_HOSPITALS, ORIGIN, matchHospital } from "../shared/hospitals";
import { NON_MEDICAL_DESTINATIONS, calculateTripGroupingScore, destinationLabels, nonMedicalPlace, type ClinicAppointment } from "../shared/transport";
import { pickupDetails, tripEndpoints, UNKNOWN_TRAVEL_MINUTES } from "../shared/trips";

const trip = (id: string, clinic: string, extra: Partial<ClinicAppointment> = {}) => ({
  id, patientName: `ضيف ${id}`, clinic, buildingNumber: "5", apartmentNumber: "1", mobile: "55500000", appointmentDate: "2026-10-04",
  appointmentAt: "10:00", kind: "عادي", assistance: [], status: "تم طلب السيارة", category: "غير طبية", ...extra,
}) as ClinicAppointment;

describe("non-medical destinations with a location", () => {
  it("the new places have their location; the old ones and «أخرى» stay without", () => {
    for (const name of ["جامعة الدوحة للعلوم والتكنولوجيا", "جامعة أوريكس", "جامعة لوسيل", "المدرسة الفلسطينية", "مركز النور للمكفوفين"]) {
      expect(nonMedicalPlace(trip("N1", name)), name).not.toBeNull();
      // ليست مستشفيات في الدليل
      expect(matchHospital(name), name).toBeNull();
    }
    expect(nonMedicalPlace(trip("N1", "جامعة لوسيل"))).toMatchObject({ lat: 25.402188, lng: 51.512937, nameEn: "Lusail University" });
    expect(nonMedicalPlace(trip("N1", "الجامعة"))).toBeNull();
    expect(nonMedicalPlace(trip("N1", "النادي"))).toBeNull();
    // موعد طبي باسم مشابه لا يأخذ موقع الرحلة غير الطبية
    expect(nonMedicalPlace(trip("A1", "جامعة لوسيل", { category: undefined }))).toBeNull();
    expect(new Set(NON_MEDICAL_DESTINATIONS.map((item) => item.place?.id).filter(Boolean)).size).toBe(5);
  });

  it("the trip goes to the place and back from it, with a computed arrival time", () => {
    const going = tripEndpoints(trip("N1", "جامعة الدوحة للعلوم والتكنولوجيا"), "ذهاب");
    expect(going.from).toEqual({ lat: ORIGIN.lat, lng: ORIGIN.lng });
    expect(going.to).toEqual({ lat: 25.360687, lng: 51.481062 });
    expect(tripEndpoints(trip("N1", "المدرسة الفلسطينية"), "عودة").from).toEqual({ lat: 25.222313, lng: 51.495812 });
    const now = new Date("2026-10-04T05:00:00.000Z");
    const details = pickupDetails({ direction: "ذهاب" }, trip("N1", "جامعة لوسيل"), DEFAULT_HOSPITALS, now);
    expect(details).toMatchObject({ destLat: 25.402188, destLng: 51.512937 });
    const minutes = (new Date(details.etaAt!).getTime() - now.getTime()) / 60000;
    expect(minutes).not.toBe(UNKNOWN_TRAVEL_MINUTES);
    // بلا موقع: الوقت التقديري الافتراضي كما كان
    const unknown = pickupDetails({ direction: "ذهاب" }, trip("N1", "الجامعة"), DEFAULT_HOSPITALS, now);
    expect(unknown.destLat).toBeUndefined();
  });

  it("near non-medical places group together, but never with a medical appointment", () => {
    const lusail = trip("N1", "جامعة لوسيل");
    const noor = trip("N2", "مركز النور للمكفوفين", { appointmentAt: "10:10" });
    expect(calculateTripGroupingScore(lusail, noor)).toMatchObject({ sameDestination: false, nearbyDestination: true });
    expect(calculateTripGroupingScore(lusail, trip("N3", "جامعة لوسيل")).sameDestination).toBe(true);
    // الشفلح بجانب مركز النور، لكنه موعد طبي
    const shafallah = trip("A1", "مركز الشفلح", { category: undefined, hospitalId: "shafallah", appointmentAt: "10:05" });
    expect(calculateTripGroupingScore(noor, shafallah)).toMatchObject({ sameDestination: false, nearbyDestination: false, sameDirection: false, destinationKm: null });
  });

  it("the driver sees the English name", () => {
    expect(destinationLabels(trip("N1", "جامعة أوريكس"), DEFAULT_HOSPITALS).en).toBe("Oryx University (Liverpool John Moores University)");
    expect(destinationLabels(trip("N1", "مركز النور للمكفوفين"), DEFAULT_HOSPITALS).en).toBe("Al Noor Center For The Blind");
  });
});

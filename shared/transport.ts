export type AppointmentKind = "سيدان" | "احتياجات خاصة" | "باص";

export type ClinicAppointment = {
  id: string;
  patientName: string;
  clinic: string;
  pickupArea: string;
  appointmentAt: string;
  kind: AppointmentKind;
  notes?: string;
  status: "بانتظار طلب السيارة" | "تم طلب السيارة" | "مكتملة";
};

export type Vehicle = {
  plate: string;
  driver: string;
  phone: string;
  kind: AppointmentKind;
  available: boolean;
};

export type VehicleRequest = {
  id: string;
  appointmentId: string;
  vehiclePlate: string;
  driver: string;
  status: "مطلوب" | "تم التأكيد" | "وصلت السيارة" | "تم استلام المريض";
  notificationMethod: "whatsapp" | "call";
  createdAt: string;
};

export function canRequestVehicle(appointment: ClinicAppointment | undefined, existingRequest?: VehicleRequest) {
  return Boolean(appointment && !existingRequest && appointment.status !== "مكتملة");
}

export function assignVehicle(vehicles: Vehicle[], kind: AppointmentKind) {
  const available = vehicles.filter((vehicle) => vehicle.available);
  if (kind === "احتياجات خاصة") return available.find((vehicle) => vehicle.kind === "احتياجات خاصة") ?? null;
  return available.find((vehicle) => vehicle.kind === kind)
    ?? available.find((vehicle) => vehicle.kind === "سيدان")
    ?? available[0]
    ?? null;
}

export function buildDriverMessage(appointment: ClinicAppointment, request: VehicleRequest) {
  return `رحلة جديدة: ${appointment.patientName} من ${appointment.pickupArea} إلى ${appointment.clinic} الساعة ${appointment.appointmentAt}. السيارة ${request.vehiclePlate}.`;
}

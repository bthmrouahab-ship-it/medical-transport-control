import type { Hospital } from "@shared/hospitals";
import type { OperationsSummary, OpsEvent } from "@shared/operations";
import type { CalendarDay, ServiceSummary, StatsFilter, StatsSummary, TripStat } from "@shared/stats";
import type { ClinicAppointment, RoleSchedules, VehicleKind, VehicleRequest } from "@shared/transport";
import type { guestStats } from "@shared/guests";
import type { ReportSection } from "@/lib/report";

/** من الموعد ما يحتاجه جدول «المواعيد بالتفصيل» فقط (بلا الهاتف ولا الاحتياجات) */
export type ViewerAppointment = Pick<ClinicAppointment, "id" | "appointmentDate" | "appointmentAt" | "patientName" | "buildingNumber" | "clinic" | "category" | "returnOnly" | "status">;
export type ViewerRequest = Pick<VehicleRequest, "appointmentId" | "vehiclePlate">;

/**
 * بيانات صفحة الإحصائيات المصدرة (HTML): الإحصائيات كما على الموقع للفترة كاملة (summary وoperations وservice محسوبة
 * في الموقع)، ورحلات الفترة وسجلاتها لحساب صفحة كل يوم أو الأيام المحددة في الصفحة نفسها، والرحلات بالتفصيل (بلا سجل العمليات).
 */
export type ReportViewerData = {
  title: string;
  subtitle: string;
  periodLabel: string;
  /** شعار النظام (data URL): الصفحة تعمل بلا اتصال بالموقع */
  logo?: string;
  filter: StatsFilter;
  summary: StatsSummary;
  operations: OperationsSummary;
  service: ServiceSummary | null;
  trackedSince: string | null;
  opsLog: OpsEvent[] | null;
  trips: TripStat[];
  appointments: ViewerAppointment[];
  requests: ViewerRequest[];
  hospitals: Hospital[];
  schedules: RoleSchedules | null;
  fleetKinds: [string, VehicleKind][];
  guests: ReturnType<typeof guestStats> | null;
  /** تقويم الأيام (لأكثر من يوم) */
  calendar: { days: CalendarDay[]; today: string } | null;
  /** الجداول التفصيلية: الرحلات بالتفصيل (تُفلتر بتاريخ كل صفحة يوم) */
  sections: ReportSection[];
};

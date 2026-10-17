// الصيانة: الأنواع والحالات وحسابات القيد

export const MAINTENANCE_TYPES = {
  consumable: "استهلاكية (زيوت وفلاتر)",
  electrical: "كهرباء",
  body_paint: "سمكرة ودهان",
  mechanical: "ميكانيكا",
  tires: "بنشر وإطارات",
  other: "أخرى",
} as const;
export type MaintenanceType = keyof typeof MAINTENANCE_TYPES;

export const MAINTENANCE_PROVIDERS = { internal: "ورشة داخلية", external: "ورشة خارجية / مورد" } as const;

export const MAINTENANCE_STATUS = {
  draft: { label: "مسودة", tone: "gray" },
  approved: { label: "تحت التنفيذ", tone: "blue" },
  completed: { label: "مكتمل", tone: "green" },
} as const;

export const LINE_KINDS = { part: "قطعة غيار", labor: "شغل يد" } as const;

export const BREAKDOWN_STATUS = {
  pending_supervisor: { label: "بانتظار المشرف", tone: "amber" },
  pending_approval: { label: "بانتظار الاعتماد", tone: "amber" },
  approved: { label: "معتمد", tone: "blue" },
  in_progress: { label: "تحت التنفيذ", tone: "blue" },
  completed: { label: "مكتمل", tone: "green" },
  rejected: { label: "مرفوض", tone: "red" },
} as const;
export type BreakdownStatus = keyof typeof BREAKDOWN_STATUS;

export const PRIORITIES = {
  low: { label: "منخفضة", tone: "gray" },
  normal: { label: "عادية", tone: "blue" },
  urgent: { label: "عاجلة", tone: "red" },
} as const;

// الطلب الذي تتجاوز تكلفته التقديرية هذا الحد يحتاج اعتماد المدير بعد المشرف
export const BREAKDOWN_APPROVAL_LIMIT = Number(process.env.BREAKDOWN_APPROVAL_LIMIT || 5000);

// الإطارات على حسابها، وباقي الأنواع على صيانة وإصلاح المركبات
export const maintenanceAccountCode = (type: MaintenanceType) => (type === "tires" ? "5108" : "5107");

// تنبيه الخطة الدورية قبل موعدها بهذه الأيام
export const PLAN_ALERT_DAYS = 7;

// أنواع نافذة «الإضافة السريعة» المشتركة بين الخادم والمتصفح.

export const QUICK_KINDS = [
  "city",
  "route",
  "vehicle",
  "driver",
  "customer",
  "supplier",
  "carrier",
  "workshop",
  "fuel_station",
  "customs_broker",
  "product",
  "vehicle_type",
  "account",
  // القوائم التي يضيف لها المستخدم (src/data/custom-lists.ts)
  "asset_kind",
  "vehicle_status",
  "ownership",
  "plate_type",
  "violation_type",
  "maintenance_kind",
] as const;
export type QuickKind = (typeof QUICK_KINDS)[number];

export interface QuickOption {
  value: string;
  label: string;
  /** عنوان المجموعة في القائمة (الحساب الأب مثلاً) */
  group?: string;
  /** وصف صغير بجانب الخيار */
  hint?: string;
  fill?: Record<string, string>;
}

export interface QuickField {
  key: string;
  label: string;
  type?: "text" | "number" | "date" | "select" | "check";
  options?: QuickOption[];
  required?: boolean;
  /** زر + بجانب القائمة لإضافة عنصر من نوع آخر (مثل مدينة داخل نافذة المسار) */
  create?: QuickKind;
  default?: string;
  ltr?: boolean;
  hint?: string;
  /** يظهر الحقل فقط إذا كان حقل الاختيار هذا مفعّلاً */
  showIf?: string;
  /** عنوان قسم يبدأ قبل هذا الحقل */
  section?: string;
}

export interface QuickForm {
  title: string;
  /** الحقل الذي يُملأ بالنص المكتوب في القائمة قبل فتح النافذة */
  primary: string;
  fields: QuickField[];
  note?: string;
}

export type QuickResult =
  | { option: QuickOption; message?: string }
  | { error: string };

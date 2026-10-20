// قوالب الاستيراد من Excel على طريقة وافق: لكل بند أعمدته وشروط كل عمود وأمثلة.
// الملف نفسه يُستخدم لبناء القالب المنزّل، ولمطابقة أعمدة الملف المرفوع، ولعرض المعالج.

import type { Entity } from "@/lib/permissions";

export interface ImportField {
  key: string;
  label: string;
  en: string;
  required?: boolean;
  // شرط القيمة كما يظهر في صف «قواعد التحقق» بالقالب
  rule?: string;
  // أسماء أخرى للعمود تُطابق تلقائياً (من وافق أو أنظمة أخرى)
  aliases?: string[];
  width?: number;
}

export interface ImportSpec {
  entity: string;
  title: string;
  // اسم السجل للرسائل: «فاتورة»، «مركبة»
  noun: string;
  permission: Entity;
  backHref: string;
  intro: string;
  fields: ImportField[];
  // الصفوف المتتالية بنفس القيمة في هذا العمود سجل واحد بعدة سطور (الفاتورة وبنودها)
  groupBy?: string;
  samples: Record<string, string>[];
}

const MUST_MATCH = "يجب أن يطابق تماماً الموجود في النظام (انظر ورقة «القوائم»)";

export const IMPORT_SPECS: Record<string, ImportSpec> = {
  "sales-invoices": {
    entity: "sales-invoices",
    title: "استيراد فواتير البيع",
    noun: "فاتورة",
    permission: "sales_invoices",
    backHref: "/invoices",
    intro: "كل صف بند واحد. الفاتورة ذات عدة بنود تُكرر صفوفها بنفس رقم الفاتورة. تُستورد الفواتير مسودات لتراجعها ثم تصدرها.",
    groupBy: "reference",
    fields: [
      { key: "customer", label: "اسم العميل", en: "Customer name", required: true, rule: MUST_MATCH, aliases: ["العميل", "customer"], width: 26 },
      { key: "reference", label: "رقم الفاتورة", en: "Invoice number", required: true, rule: "يجمع بنود الفاتورة الواحدة، ولا يُستورد الرقم مرتين", aliases: ["رقم المرجع", "invoice no"], width: 16 },
      { key: "currency", label: "العملة", en: "Currency", required: true, rule: "رمز العملة: SAR أو KWD أو USD", width: 10 },
      { key: "invoiceDate", label: "التاريخ", en: "Date", required: true, rule: "yyyy-mm-dd أو dd/mm/yyyy", aliases: ["تاريخ الفاتورة", "invoice date"], width: 13 },
      { key: "dueDate", label: "تاريخ الاستحقاق", en: "Due date", rule: "فارغ = بعد 30 يوماً من التاريخ", aliases: ["تاريخ الإستحقاق"], width: 13 },
      { key: "taxInclusive", label: "الأسعار شاملة أو خالية من الضريبة", en: "Price is inc. or exc. tax", rule: "شامل الضريبة أو خالٍ من الضريبة (inc. tax / exc. tax)، فارغ = خالٍ", width: 16 },
      { key: "notes", label: "ملاحظات", en: "Notes", width: 24 },
      { key: "description", label: "وصف البند", en: "Item description", required: true, aliases: ["وصف المنتج", "الوصف"], width: 30 },
      { key: "quantity", label: "الكمية", en: "Item qty", required: true, rule: "رقم أكبر من صفر", aliases: ["كمية المنتج"], width: 9 },
      { key: "unitPrice", label: "السعر", en: "Item Price", required: true, rule: "سعر الوحدة بعملة الفاتورة", aliases: ["سعر المنتج"], width: 12 },
      { key: "account", label: "حساب البند", en: "Item Account", required: true, rule: "رقم أو اسم حساب إيراد في شجرة الحسابات", aliases: ["حساب المنتج", "الحساب"], width: 24 },
      { key: "taxCode", label: "معدل الضريبة", en: "Item tax rate name", rule: "15% أو صفر أو معفى، فارغ = 15%", aliases: ["إسم معدل الضريبة للمنتج", "اسم معدل الضريبة للمنتج", "الضريبة"], width: 14 },
      { key: "costCenter", label: "مركز التكلفة أو المركبة", en: "Item Cost Center", rule: "رقم لوحة المركبة أو رمز/اسم مركز التكلفة", aliases: ["مركز تكلفة المنتج", "مركز التكلفة", "المركبة"], width: 18 },
      { key: "discount", label: "الخصم %", en: "Item discount (%)", rule: "نسبة من 0 إلى 100", aliases: ["الخصم على المنتج"], width: 9 },
    ],
    samples: [
      { customer: "شركة مثال للتجارة", reference: "INV-001", currency: "SAR", invoiceDate: "2026-10-01", dueDate: "2026-10-31", taxInclusive: "خالٍ من الضريبة", description: "نقل حاوية الرياض ← الدمام", quantity: "2", unitPrice: "1500", account: "4101", taxCode: "15%", costCenter: "", discount: "" },
      { customer: "شركة مثال للتجارة", reference: "INV-002", currency: "SAR", invoiceDate: "2026-10-05", dueDate: "", taxInclusive: "شامل الضريبة", description: "نقل دولي إلى الكويت", quantity: "1", unitPrice: "5750", account: "إيراد النقل الدولي", taxCode: "صفر", costCenter: "", discount: "" },
      { customer: "شركة مثال للتجارة", reference: "INV-002", currency: "SAR", invoiceDate: "2026-10-05", dueDate: "", taxInclusive: "شامل الضريبة", description: "رسوم تخليص", quantity: "1", unitPrice: "300", account: "4103", taxCode: "15%", costCenter: "", discount: "5" },
    ],
  },

  vehicles: {
    entity: "vehicles",
    title: "استيراد المركبات",
    noun: "مركبة",
    permission: "vehicles",
    backHref: "/vehicles",
    intro: "كل صف مركبة. لكل مركبة يُنشأ مركز تكلفتها تلقائياً، ويجب ربطها بحساب الأصل في شجرة الحسابات.",
    fields: [
      { key: "plate", label: "اللوحة", en: "Plate", required: true, rule: "لا تتكرر", aliases: ["رقم اللوحة"], width: 14 },
      { key: "chassis", label: "رقم الشاسيه", en: "Chassis", required: true, rule: "لا يتكرر", aliases: ["الشاسيه", "vin"], width: 20 },
      { key: "assetAccount", label: "حساب الأصل", en: "Asset account", required: true, rule: "رقم أو اسم حساب الأصل، مثل 120101 الشاحنات (الرؤوس)", aliases: ["الحساب", "account"], width: 24 },
      { key: "vehicleType", label: "النوع", en: "Type", rule: MUST_MATCH, aliases: ["نوع المركبة"], width: 14 },
      { key: "make", label: "الماركة", en: "Make", width: 12 },
      { key: "model", label: "الطراز", en: "Model", width: 12 },
      { key: "year", label: "سنة الصنع", en: "Year", rule: "مثل 2022", width: 9 },
      { key: "ownership", label: "الملكية", en: "Ownership", rule: "مملوكة أو مستأجرة، فارغ = مملوكة", width: 11 },
      { key: "odometer", label: "العداد (كم)", en: "Odometer", rule: "رقم", aliases: ["العداد"], width: 11 },
    ],
    samples: [
      { plate: "أ ب ج 1234", chassis: "WDB9634031L000001", assetAccount: "120101", vehicleType: "", make: "مرسيدس", model: "أكتروس", year: "2022", ownership: "مملوكة", odometer: "120000" },
      { plate: "د هـ و 5678", chassis: "TRL0000000000002", assetAccount: "المقطورات", vehicleType: "", make: "", model: "", year: "2020", ownership: "مستأجرة", odometer: "" },
    ],
  },

  customers: {
    entity: "customers",
    title: "استيراد العملاء",
    noun: "عميل",
    permission: "parties",
    backHref: "/parties",
    intro: "كل صف عميل. الاسم لا يتكرر، ويُستخدم كما هو عند استيراد فواتير البيع.",
    fields: [
      { key: "nameAr", label: "اسم العميل", en: "Name", required: true, rule: "لا يتكرر", aliases: ["الاسم", "الاسم بالعربي", "customer name"], width: 28 },
      { key: "nameEn", label: "الاسم بالإنجليزي", en: "English name", width: 24 },
      { key: "kind", label: "النوع", en: "Type", rule: "منشأة أو فرد، فارغ = منشأة", width: 10 },
      { key: "vatNumber", label: "الرقم الضريبي", en: "VAT number", rule: "15 رقماً", aliases: ["رقم ضريبة القيمة المضافة"], width: 18 },
      { key: "crNumber", label: "السجل التجاري", en: "CR number", width: 14 },
      { key: "mobile", label: "الجوال", en: "Mobile", aliases: ["رقم الجوال", "phone"], width: 14 },
      { key: "email", label: "البريد الإلكتروني", en: "Email", width: 22 },
      { key: "country", label: "الدولة", en: "Country", rule: "رمز من حرفين: SA أو KW، فارغ = SA", width: 9 },
      { key: "currency", label: "العملة الافتراضية", en: "Currency", rule: "SAR أو KWD، فارغ = SAR", width: 11 },
    ],
    samples: [
      { nameAr: "شركة مثال للتجارة", nameEn: "Example Trading Co.", kind: "منشأة", vatNumber: "300000000000003", crNumber: "1010000000", mobile: "0500000000", email: "info@example.com", country: "SA", currency: "SAR" },
    ],
  },
};

export const DELETE_ROW_MARK = "احذف الصف";

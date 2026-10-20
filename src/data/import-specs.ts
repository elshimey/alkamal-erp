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

  receipts: {
    entity: "receipts",
    title: "استيراد سندات القبض",
    noun: "سند",
    permission: "receipts",
    backHref: "/receipts",
    intro: "كل صف سند قبض. اكتب رقم الفاتورة ليُخصص المبلغ عليها، أو اتركه فارغاً ليوزع على أقدم فواتير العميل، أو اختر «دفعة مقدمة».",
    fields: [
      { key: "customer", label: "العميل", en: "Customer", required: true, rule: MUST_MATCH, aliases: ["اسم العميل", "contact", "customer name"], width: 26 },
      { key: "receiptDate", label: "التاريخ", en: "Date", required: true, rule: "مثل 2026-10-05 أو 05/10/2026", aliases: ["تاريخ السند", "payment date"], width: 13 },
      { key: "amount", label: "المبلغ", en: "Amount", required: true, rule: "أكبر من صفر", aliases: ["المبلغ المستلم", "amount received"], width: 12 },
      { key: "cashAccount", label: "تم الدفع من خلال", en: "Paid through", required: true, rule: "رقم أو اسم الصندوق/البنك مثل 110101", aliases: ["الحساب", "الصندوق", "البنك", "paid through account", "account"], width: 22 },
      { key: "currency", label: "العملة", en: "Currency", rule: "فارغ = SAR", width: 9 },
      { key: "kind", label: "النوع", en: "Type", rule: "دفعة عن فواتير أو دفعة مقدمة، فارغ = عن فواتير", aliases: ["نوع الدفعة"], width: 16 },
      { key: "invoice", label: "رقم الفاتورة", en: "Invoice number", rule: "رقم الفاتورة في النظام أو رقمها المستورد", aliases: ["الفاتورة", "invoice", "invoice no"], width: 18 },
      { key: "method", label: "طريقة الدفع", en: "Method", rule: "نقد، تحويل، شيك، بطاقة؛ فارغ = تحويل", aliases: ["payment method"], width: 12 },
      { key: "reference", label: "المرجع", en: "Reference", aliases: ["رقم المرجع", "reference number"], width: 14 },
      { key: "notes", label: "الوصف", en: "Description", aliases: ["البيان", "ملاحظات", "notes"], width: 24 },
    ],
    samples: [
      { customer: "شركة مثال للتجارة", receiptDate: "2026-10-10", amount: "3450", cashAccount: "110201", currency: "SAR", kind: "دفعة عن فواتير", invoice: "INV-001", method: "تحويل", reference: "TRX-889", notes: "سداد فاتورة أكتوبر" },
      { customer: "شركة مثال للتجارة", receiptDate: "2026-10-12", amount: "5000", cashAccount: "110101", currency: "SAR", kind: "دفعة مقدمة", invoice: "", method: "نقد", reference: "", notes: "" },
    ],
  },

  "journal-entries": {
    entity: "journal-entries",
    title: "استيراد القيود اليومية",
    noun: "قيد",
    permission: "journal_entries",
    backHref: "/journal",
    groupBy: "reference",
    intro: "كل صف سطر قيد. السطور التي تحمل رقم القيد نفسه تكوّن قيداً واحداً يجب أن يتوازن مدينه ودائنه.",
    fields: [
      { key: "reference", label: "رقم القيد", en: "Journal number", required: true, rule: "يجمع سطور القيد الواحد، ولا يُستورد مرتين", aliases: ["الرقم المرجعي", "reference", "journal no", "رقم المرجع"], width: 14 },
      { key: "entryDate", label: "التاريخ", en: "Date", required: true, rule: "مثل 2026-10-05 أو 05/10/2026", aliases: ["تاريخ القيد", "journal date"], width: 13 },
      { key: "description", label: "وصف القيد", en: "Journal description", rule: "يكفي في السطر الأول", aliases: ["البيان", "الوصف", "description", "notes"], width: 26 },
      { key: "account", label: "الحساب", en: "Account", required: true, rule: "رقم الحساب أو اسمه كما في الشجرة", aliases: ["رمز الحساب", "اسم الحساب", "account code", "account name"], width: 22 },
      { key: "lineDescription", label: "وصف السطر", en: "Line description", aliases: ["line description", "وصف"], width: 22 },
      { key: "debit", label: "مدين", en: "Debit", rule: "مدين أو دائن في كل سطر", width: 12 },
      { key: "credit", label: "دائن", en: "Credit", width: 12 },
      { key: "costCenter", label: "مركز التكلفة", en: "Cost center", rule: "لوحة المركبة أو رمز المركز", aliases: ["المركبة", "cost center"], width: 16 },
      { key: "party", label: "الجهة", en: "Contact", rule: "اسم العميل أو المورد كما في النظام", aliases: ["جهة الاتصال", "contact", "العميل", "المورد"], width: 22 },
    ],
    samples: [
      { reference: "JV-001", entryDate: "2026-10-31", description: "استحقاق إيجار المكتب لشهر أكتوبر", account: "6105", lineDescription: "إيجار أكتوبر", debit: "5000", credit: "", costCenter: "", party: "" },
      { reference: "JV-001", entryDate: "2026-10-31", description: "", account: "110101", lineDescription: "", debit: "", credit: "5000", costCenter: "", party: "" },
    ],
  },

  violations: {
    entity: "violations",
    title: "استيراد المخالفات المرورية",
    noun: "مخالفة",
    permission: "violations",
    backHref: "/violations",
    intro: "كل صف مخالفة. السائق يُحدد تلقائياً من سجل الإسناد في تاريخ المخالفة، ورقم المخالفة يمنع تكرارها.",
    fields: [
      { key: "violationDate", label: "تاريخ المخالفة", en: "Date", required: true, rule: "مثل 2026-10-05 أو 05/10/2026", aliases: ["التاريخ"], width: 13 },
      { key: "vehicle", label: "المركبة", en: "Vehicle plate", required: true, rule: "اللوحة كما في النظام", aliases: ["اللوحة", "رقم اللوحة", "plate"], width: 14 },
      { key: "reference", label: "رقم المخالفة", en: "Violation number", rule: "لا يتكرر", aliases: ["رقم المخالفة لدى المرور", "reference"], width: 16 },
      { key: "violationType", label: "نوع المخالفة", en: "Type", required: true, aliases: ["المخالفة", "النوع", "type"], width: 20 },
      { key: "location", label: "الموقع", en: "Location", aliases: ["المكان", "location"], width: 18 },
      { key: "amount", label: "المبلغ", en: "Amount", required: true, rule: "أكبر من صفر", aliases: ["قيمة المخالفة", "amount"], width: 11 },
      { key: "chargeTo", label: "على من", en: "Charge to", required: true, rule: "السائق أو الشركة", aliases: ["يتحملها", "charge to"], width: 11 },
      { key: "notes", label: "ملاحظات", en: "Notes", width: 20 },
    ],
    samples: [
      { violationDate: "2026-10-12", vehicle: "أ ب ج 1234", reference: "TR-55120", violationType: "تجاوز السرعة", location: "طريق الرياض الدمام", amount: "300", chargeTo: "السائق", notes: "" },
    ],
  },
  products: {
    entity: "products",
    title: "استيراد الأصناف والخدمات",
    noun: "صنف",
    permission: "inventory",
    backHref: "/products",
    intro: "كل صف صنف. الرصيد الافتتاحي (اختياري) يُدخل الكمية للمستودع بتكلفة الشراء مقابل الأرباح المبقاة.",
    fields: [
      { key: "code", label: "رمز الصنف", en: "SKU", rule: "لا يتكرر؛ فارغ = يُولّد تلقائياً", aliases: ["الرمز", "sku", "code", "رقم الصنف"], width: 14 },
      { key: "nameAr", label: "اسم الصنف", en: "Name", required: true, aliases: ["الاسم", "name", "اسم المنتج"], width: 28 },
      { key: "kind", label: "النوع", en: "Type", rule: "مخزني أو خدمة، فارغ = مخزني", aliases: ["type"], width: 10 },
      { key: "category", label: "الفئة", en: "Category", aliases: ["التصنيف", "category"], width: 16 },
      { key: "unit", label: "الوحدة", en: "Unit", rule: "فارغ = حبة", aliases: ["unit"], width: 9 },
      { key: "purchasePrice", label: "سعر الشراء", en: "Purchase price", aliases: ["التكلفة", "cost", "purchase price"], width: 12 },
      { key: "salePrice", label: "سعر البيع", en: "Selling price", aliases: ["selling price", "price"], width: 12 },
      { key: "reorderLevel", label: "حد إعادة الطلب", en: "Reorder level", aliases: ["الحد الأدنى"], width: 12 },
      { key: "barcode", label: "الباركود", en: "Barcode", width: 16 },
      { key: "openingQty", label: "الرصيد الافتتاحي", en: "Opening quantity", rule: "للصنف المخزني؛ بتكلفة سعر الشراء", aliases: ["الكمية", "quantity"], width: 12 },
      { key: "warehouse", label: "المستودع", en: "Warehouse", rule: "فارغ = المستودع الرئيسي", width: 16 },
    ],
    samples: [
      { code: "OIL-15W40", nameAr: "زيت محرك 15W40 – جالون", kind: "مخزني", category: "زيوت", unit: "جالون", purchasePrice: "85", salePrice: "", reorderLevel: "10", barcode: "", openingQty: "40", warehouse: "المستودع الرئيسي" },
      { code: "", nameAr: "شغل يد ميكانيكا", kind: "خدمة", category: "خدمات الورشة", unit: "ساعة", purchasePrice: "", salePrice: "", reorderLevel: "", barcode: "", openingQty: "", warehouse: "" },
    ],
  },
  "maintenance-orders": {
    entity: "maintenance-orders",
    title: "استيراد أوامر الصيانة",
    noun: "أمر",
    permission: "maintenance",
    backHref: "/maintenance",
    intro: "كل صف بند (قطعة غيار أو شغل يد)، والصفوف بنفس «رقم الأمر» أمر واحد. تُستورد الأوامر مسودات، ثم تعتمدها من القائمة جماعياً. صرف القطع من المستودع يُضاف من شاشة الأمر.",
    groupBy: "ref",
    fields: [
      { key: "ref", label: "رقم الأمر", en: "Order reference", required: true, rule: "يجمع بنود الأمر الواحد؛ لا يُحفظ كرقم", aliases: ["رقم المرجع", "المرجع", "reference"], width: 12 },
      { key: "orderDate", label: "التاريخ", en: "Date", required: true, rule: "مثل 2026-10-05 أو 05/10/2026", aliases: ["تاريخ الأمر"], width: 13 },
      { key: "vehicle", label: "المركبة", en: "Vehicle plate", required: true, rule: "اللوحة كما في النظام", aliases: ["اللوحة", "plate"], width: 14 },
      { key: "type", label: "نوع الصيانة", en: "Type", rule: "ميكانيكا، كهرباء، استهلاكية، سمكرة ودهان، إطارات، أخرى", aliases: ["النوع"], width: 16 },
      { key: "workshop", label: "الورشة الخارجية", en: "Workshop", rule: "فارغ = ورشة داخلية؛ الاسم كما في الموردين", aliases: ["الورشة", "المورد", "supplier"], width: 20 },
      { key: "supplierInvoiceNo", label: "رقم فاتورة الورشة", en: "Workshop invoice", aliases: ["رقم الفاتورة", "invoice number"], width: 14 },
      { key: "cashAccount", label: "الصندوق (للورشة الداخلية)", en: "Cash account", rule: "رقم الحساب أو اسمه", aliases: ["الصندوق"], width: 14 },
      { key: "odometer", label: "قراءة العداد", en: "Odometer", aliases: ["العداد"], width: 11 },
      { key: "lineKind", label: "نوع البند", en: "Line type", rule: "قطعة غيار أو شغل يد؛ فارغ = قطعة غيار", aliases: ["البند"], width: 12 },
      { key: "description", label: "الوصف", en: "Description", required: true, aliases: ["وصف البند", "description"], width: 26 },
      { key: "quantity", label: "الكمية", en: "Quantity", rule: "فارغ = 1", aliases: ["qty"], width: 8 },
      { key: "unitPrice", label: "سعر الوحدة", en: "Unit price", required: true, rule: "قبل الضريبة", aliases: ["السعر", "price"], width: 11 },
      { key: "vat", label: "الضريبة", en: "VAT", rule: "15% أو بدون؛ فارغ = 15%", aliases: ["ضريبة"], width: 9 },
      { key: "notes", label: "ملاحظات", en: "Notes", width: 18 },
    ],
    samples: [
      { ref: "1", orderDate: "2026-10-12", vehicle: "أ ب ج 1234", type: "ميكانيكا", workshop: "ورشة الخليج", supplierInvoiceNo: "W-7781", cashAccount: "", odometer: "185400", lineKind: "قطعة غيار", description: "طقم فحمات فرامل", quantity: "2", unitPrice: "350", vat: "15%", notes: "" },
      { ref: "1", orderDate: "2026-10-12", vehicle: "أ ب ج 1234", type: "ميكانيكا", workshop: "ورشة الخليج", supplierInvoiceNo: "W-7781", cashAccount: "", odometer: "185400", lineKind: "شغل يد", description: "تركيب وضبط الفرامل", quantity: "1", unitPrice: "200", vat: "15%", notes: "" },
    ],
  },
  "breakdown-requests": {
    entity: "breakdown-requests",
    title: "استيراد بلاغات الأعطال",
    noun: "بلاغ",
    permission: "maintenance",
    backHref: "/maintenance/requests",
    intro: "كل صف بلاغ عطل. يدخل بانتظار مراجعة المشرف، ويُعتمد حسب تكلفته التقديرية.",
    fields: [
      { key: "reportDate", label: "التاريخ", en: "Date", required: true, rule: "مثل 2026-10-05 أو 05/10/2026", width: 13 },
      { key: "vehicle", label: "المركبة", en: "Vehicle plate", required: true, rule: "اللوحة كما في النظام", aliases: ["اللوحة", "plate"], width: 14 },
      { key: "description", label: "وصف العطل", en: "Description", required: true, aliases: ["العطل", "الوصف"], width: 30 },
      { key: "priority", label: "الأولوية", en: "Priority", rule: "منخفضة أو عادية أو عاجلة؛ فارغ = عادية", width: 11 },
      { key: "estimatedCost", label: "التكلفة التقديرية", en: "Estimated cost", aliases: ["التكلفة"], width: 13 },
    ],
    samples: [{ reportDate: "2026-10-12", vehicle: "أ ب ج 1234", description: "تسريب زيت من المحرك", priority: "عاجلة", estimatedCost: "1200" }],
  },
  "maintenance-plans": {
    entity: "maintenance-plans",
    title: "استيراد خطط الصيانة الدورية",
    noun: "خطة",
    permission: "maintenance",
    backHref: "/maintenance/plans",
    intro: "كل صف خطة لمركبة. نفس المركبة واسم الصيانة مرة ثانية يعدّل الخطة القائمة.",
    fields: [
      { key: "vehicle", label: "المركبة", en: "Vehicle plate", required: true, rule: "اللوحة كما في النظام", aliases: ["اللوحة", "plate"], width: 14 },
      { key: "title", label: "اسم الصيانة", en: "Title", required: true, aliases: ["الصيانة"], width: 22 },
      { key: "type", label: "النوع", en: "Type", rule: "ميكانيكا، كهرباء، استهلاكية، سمكرة ودهان، إطارات، أخرى", width: 16 },
      { key: "intervalDays", label: "كل (يوم)", en: "Interval days", required: true, rule: "عدد الأيام بين كل تنفيذ", aliases: ["المدة", "الأيام"], width: 10 },
      { key: "lastDone", label: "آخر تنفيذ", en: "Last done", rule: "تاريخ؛ فارغ = مستحقة الآن", width: 13 },
    ],
    samples: [{ vehicle: "أ ب ج 1234", title: "تغيير زيت وفلاتر", type: "استهلاكية", intervalDays: "45", lastDone: "2026-09-01" }],
  },
};

export const DELETE_ROW_MARK = "احذف الصف";

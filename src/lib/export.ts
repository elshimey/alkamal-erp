// يعمل في الخادم فقط: تصدير كل بيانات الشركة إلى ملف Excel واحد، ورقة لكل جدول.
// أسماء الأعمدة بالعربية، والمعرّفات المرتبطة (العميل، الحساب، المركبة…) تُستبدل بأسمائها.
import ExcelJS from "exceljs";
import { sql } from "drizzle-orm";
import type { Db } from "@/db";

const DARK = "FF1B2126";

// ترتيب الأوراق وأسماؤها؛ ما لم يُذكر هنا لا يُصدَّر (جداول داخلية كالجلسات والصور)
const TABLES: [string, string][] = [
  ["company_profile", "بيانات المنشأة"],
  ["accounts", "شجرة الحسابات"],
  ["cost_centers", "مراكز التكلفة"],
  ["bank_accounts", "البنوك والصناديق"],
  ["currencies", "العملات"],
  ["exchange_rates", "أسعار الصرف"],
  ["tax_codes", "رموز الضريبة"],
  ["parties", "العملاء والموردون"],
  ["party_roles", "أنواع الجهات"],
  ["vehicle_types", "أنواع المركبات"],
  ["vehicles", "المركبات"],
  ["vehicle_assignments", "إسناد المركبات"],
  ["fleet_documents", "سجل الوثائق"],
  ["employees", "الموظفون"],
  ["drivers", "السائقون"],
  ["locations", "المواقع"],
  ["routes", "المسارات"],
  ["contracts", "العقود"],
  ["contract_rates", "أسعار العقود"],
  ["charge_types", "أنواع المصاريف"],
  ["waybills", "الشحنات"],
  ["trip_stages", "مراحل الرحلات"],
  ["waybill_fuel", "ديزل الرحلات"],
  ["waybill_expenses", "مصاريف الرحلات"],
  ["sales_invoices", "فواتير المبيعات"],
  ["sales_invoice_lines", "بنود فواتير المبيعات"],
  ["receipts", "سندات القبض"],
  ["receipt_allocations", "توزيع سندات القبض"],
  ["receipt_adjustments", "تسويات سندات القبض"],
  ["adjustment_notes", "الإشعارات الدائنة والمدينة"],
  ["adjustment_note_lines", "بنود الإشعارات"],
  ["purchase_invoices", "فواتير المشتريات"],
  ["purchase_invoice_lines", "بنود فواتير المشتريات"],
  ["expenses", "المصروفات"],
  ["payments", "سندات الصرف"],
  ["payment_allocations", "توزيع سندات الصرف"],
  ["journal_entries", "قيود اليومية"],
  ["journal_lines", "سطور القيود"],
  ["fiscal_periods", "الفترات المحاسبية"],
  ["bank_reconciliations", "التسويات البنكية"],
  ["fixed_assets", "الأصول الثابتة"],
  ["asset_depreciation", "الإهلاك"],
  ["warehouses", "المستودعات"],
  ["products", "الأصناف"],
  ["stock_docs", "المستندات المخزنية"],
  ["stock_doc_lines", "بنود المستندات المخزنية"],
  ["stock_moves", "حركة المخزون"],
  ["maintenance_plans", "خطط الصيانة"],
  ["breakdown_requests", "طلبات الصيانة"],
  ["maintenance_orders", "أوامر الصيانة"],
  ["maintenance_lines", "بنود الصيانة"],
  ["traffic_violations", "المخالفات"],
  ["payroll_runs", "مسيرات الرواتب"],
  ["payroll_lines", "رواتب الموظفين"],
  ["employee_advances", "السلف"],
  ["custody_docs", "العهد"],
  ["hr_actions", "الإنذارات والجزاءات والحوافز"],
  ["leave_types", "أنواع الإجازات"],
  ["leave_requests", "الإجازات"],
  ["attendance", "الحضور"],
  ["evaluations", "التقييمات"],
  ["promotions", "الترقيات"],
  ["commission_advance_requests", "مقدم العمولة"],
  ["users", "المستخدمون"],
  ["roles", "الأدوار"],
  ["audit_log", "سجل التعديلات"],
];

// أعمدة لا تُصدَّر: كلمات المرور والصور والبيانات الداخلية
const HIDDEN = new Set(["password_hash", "logo", "data", "snapshot", "zatca_response"]);

const COLS: Record<string, string> = {
  id: "المعرّف", number: "الرقم", code: "الرمز", name: "الاسم", name_ar: "الاسم", name_en: "الاسم بالإنجليزية", title: "العنوان",
  status: "الحالة", kind: "النوع", type: "النوع", category: "الفئة", description: "الوصف", notes: "ملاحظات", note: "ملاحظة", reason: "السبب",
  amount: "المبلغ", vat_amount: "الضريبة", vat_rate: "نسبة الضريبة", vat_total: "إجمالي الضريبة", subtotal: "قبل الضريبة", total: "الإجمالي",
  quantity: "الكمية", unit: "الوحدة", unit_price: "سعر الوحدة", unit_cost: "تكلفة الوحدة", price: "السعر", cost: "التكلفة", rate: "السعر",
  debit: "مدين", credit: "دائن", debit_base: "مدين بالريال", credit_base: "دائن بالريال", balance: "الرصيد",
  currency_code: "العملة", exchange_rate: "سعر الصرف", discount_percent: "الخصم %",
  created_at: "تاريخ الإنشاء", updated_at: "آخر تعديل", created_by: "أنشأه", updated_by: "عدّله", approved_by: "اعتمده", approved_at: "تاريخ الاعتماد",
  posted_by: "رحّله", posted_at: "تاريخ الترحيل", reviewed_by: "راجعه", decided_by: "قرّره", completed_by: "أنجزه", completed_at: "تاريخ الإنجاز",
  issued_by: "أصدره", issued_at: "تاريخ الإصدار", closed_by: "أقفله", closed_at: "تاريخ الإقفال",
  is_active: "نشط", active: "نشط", is_system: "حساب نظام", is_postable: "يقبل القيد", is_international: "دولي",
  account_id: "الحساب", parent_id: "الحساب الأب", cost_center_id: "مركز التكلفة", party_id: "الجهة", customer_id: "العميل", supplier_id: "المورد",
  carrier_id: "الناقل", vehicle_id: "المركبة", driver_id: "السائق", employee_id: "الموظف", user_id: "المستخدم", role_id: "الدور",
  route_id: "المسار", contract_id: "العقد", waybill_id: "الشحنة", invoice_id: "الفاتورة", receipt_id: "سند القبض", payment_id: "سند الصرف",
  journal_entry_id: "القيد", entry_id: "القيد", payment_entry_id: "قيد السداد", cash_account_id: "حساب النقدية", bank_account_id: "الحساب البنكي",
  product_id: "الصنف", warehouse_id: "المستودع", to_warehouse_id: "إلى مستودع", charge_type_id: "نوع المصروف", tax_code_id: "رمز الضريبة",
  vehicle_type_id: "نوع المركبة", from_location_id: "من", to_location_id: "إلى", custody_account_id: "حساب العهدة", payable_account_id: "حساب المستحق",
  expense_account_id: "حساب المصروف", revenue_account_id: "حساب الإيراد", asset_account_id: "حساب الأصل", accumulated_account_id: "حساب مجمع الإهلاك",
  sales_invoice_id: "فاتورة المبيعات", purchase_invoice_id: "فاتورة المشتريات", note_id: "الإشعار", order_id: "أمر الصيانة", plan_id: "خطة الصيانة",
  run_id: "المسير", payroll_run_id: "المسير", advance_id: "السلفة", asset_id: "الأصل", fiscal_period_id: "الفترة", type_id: "النوع", sales_rep_id: "المندوب",
  reference: "المرجع", line_no: "رقم السطر", entry_date: "تاريخ القيد", invoice_date: "تاريخ الفاتورة", due_date: "تاريخ الاستحقاق",
  waybill_date: "تاريخ الشحنة", receipt_date: "تاريخ القبض", payment_date: "تاريخ الصرف", expense_date: "تاريخ المصروف", note_date: "تاريخ الإشعار",
  order_date: "تاريخ الأمر", doc_date: "التاريخ", move_date: "التاريخ", report_date: "تاريخ البلاغ", request_date: "تاريخ الطلب",
  violation_date: "تاريخ المخالفة", issue_date: "تاريخ الإصدار", expiry_date: "تاريخ الانتهاء", from_date: "من تاريخ", to_date: "إلى تاريخ",
  start_date: "تاريخ البداية", end_date: "تاريخ النهاية", hire_date: "تاريخ التعيين", birth_date: "تاريخ الميلاد", rate_date: "التاريخ",
  month: "الشهر", year: "السنة", day: "اليوم", days: "الأيام",
  plate: "اللوحة", make: "الصنع", model: "الطراز", color: "اللون", chassis: "رقم الهيكل", serial_number: "الرقم التسلسلي", odometer: "العداد",
  odometer_start: "العداد عند البداية", odometer_end: "العداد عند النهاية", liters: "اللترات", weight_tons: "الوزن (طن)", distance_km: "المسافة (كم)",
  shipper: "المرسل", consignee: "المستلم", container_number: "رقم الحاوية", driver_commission: "عمولة السائق", stage: "المرحلة", at: "الوقت",
  mobile: "الجوال", phone: "الهاتف", email: "البريد", vat_number: "الرقم الضريبي", cr_number: "السجل التجاري", city: "المدينة", country: "الدولة",
  district: "الحي", street: "الشارع", building_no: "رقم المبنى", postal_code: "الرمز البريدي", additional_no: "الرقم الإضافي", national_address: "العنوان الوطني",
  iban: "الآيبان", bank_name: "البنك", account_number: "رقم الحساب", credit_limit: "حد الائتمان", payment_terms_days: "مدة السداد (يوم)",
  national_id: "الهوية", nationality: "الجنسية", residency_number: "الإقامة", license_number: "الرخصة", job_title: "المسمى الوظيفي",
  basic_salary: "الراتب الأساسي", housing_allowance: "بدل السكن", basic: "الأساسي", housing: "السكن", allowances: "البدلات", deductions: "الاستقطاعات",
  net: "الصافي", login: "اسم الدخول", last_login_at: "آخر دخول", expires_at: "تاريخ الانتهاء", role: "الدور", entity: "الجدول", entity_id: "رقم السجل",
  action: "العملية", changes: "التغييرات", source_type: "المصدر", source_id: "رقم المصدر", payer: "الدافع", method: "طريقة الدفع", priority: "الأولوية",
  paid_amount: "المدفوع", vendor_name: "المورد", supplier_invoice_no: "رقم فاتورة المورد", invoice_number: "رقم الفاتورة", level: "المستوى",
  normal_balance: "طبيعة الحساب", purchase_price: "سعر الشراء", sale_price: "سعر البيع", reorder_level: "حد إعادة الطلب", barcode: "الباركود",
  absence_days: "أيام الغياب", absence_deduction: "خصم الغياب", acquisition_date: "تاريخ الاقتناء", acquisition_entry_id: "قيد الاقتناء",
  action_date: "التاريخ", additions: "الإضافات", advance_date: "تاريخ السلفة", advance_deduction: "خصم السلفة", app_language: "لغة التطبيق",
  applied_amount: "المطبّق", authority: "الجهة المصدرة", base_score: "الدرجة الأساسية", bill_to: "على حساب", branch: "الفرع",
  breakdown_request_id: "طلب الصيانة", carrier_cost: "تكلفة الناقل", carrier_driver_mobile: "جوال سائق الناقل", carrier_driver_name: "سائق الناقل",
  carrier_plate: "لوحة الناقل", charge_to: "على حساب", close_date: "تاريخ الإقفال", close_entry_id: "قيد الإقفال", close_notes: "ملاحظات الإقفال",
  collector: "المحصّل", commission_class: "فئة العمولة", commissions: "العمولات", completed_date: "تاريخ الإنجاز", cost_account_id: "حساب التكلفة",
  counted_qty: "الكمية المعدودة", country_code: "رمز الدولة", custody_limit: "سقف العهدة", customs_declaration: "البيان الجمركي",
  customs_document: "الوثيقة الجمركية", debit_account_id: "الحساب المدين", decimals: "الخانات العشرية", deduction: "الخصم", default_currency: "العملة الافتراضية",
  delivery_address: "عنوان التسليم", delivery_note_number: "رقم إشعار التسليم", depreciation_start: "بداية الإهلاك", disposal_date: "تاريخ الاستبعاد",
  doc_id: "المستند", effective_date: "تاريخ السريان", empty_return: "عودة فارغة", eosb_accrual: "مخصص نهاية الخدمة", estimated_cost: "التكلفة التقديرية",
  estimated_diesel_liters: "الديزل التقديري (لتر)", execution: "التنفيذ", final_score: "الدرجة النهائية", from_basic: "الأساسي السابق", from_title: "المسمى السابق",
  gosi_employee: "التأمينات على الموظف", gosi_employer: "التأمينات على المنشأة", gosi_subject: "خاضع للتأمينات", incentives: "الحوافز", installment: "القسط",
  interval_days: "كل (يوم)", is_annual: "سنوية", is_base: "العملة الأساسية", is_border_crossing: "منفذ حدودي", is_opening: "افتتاحية", is_saudi: "سعودي",
  key: "المفتاح", last_done_date: "آخر تنفيذ", late_minutes: "دقائق التأخير", latitude: "خط العرض", leave_days: "أيام الإجازة", locale: "اللغة",
  location: "الموقع", longitude: "خط الطول", offset_account_id: "الحساب المقابل", opening_depreciation: "الإهلاك الافتتاحي", other_allowances: "بدلات أخرى",
  override_reason: "سبب تجاوز السعر", ownership: "الملكية", ownership_date: "تاريخ التملك", paid: "مدفوعة", penalties: "الجزاءات", period_end: "نهاية الفترة",
  plan: "خطة التوزيع", points: "النقاط", price_note: "ملاحظة السعر", provider: "المنفّذ", registration_type: "نوع التسجيل", reject_reason: "سبب الرفض",
  rejection_reason: "سبب الرفض", repaid_amount: "المسدد", requires_cost_center: "يتطلب مركز تكلفة", return_waybill_id: "شحنة العودة",
  returned_amount: "المبلغ المعاد", sales_rep_commission: "عمولة المندوب", salvage_value: "القيمة التخريدية", scores: "الدرجات", serial_no: "الرقم التسلسلي",
  source: "المصدر", statement_balance: "رصيد كشف البنك", statement_date: "تاريخ الكشف", swift: "سويفت", system_qty: "كمية النظام", to_basic: "الأساسي الجديد",
  to_title: "المسمى الجديد", transport_card_number: "بطاقة هيئة النقل", useful_life_months: "العمر الإنتاجي (شهر)", value: "القيمة",
  violation_type: "نوع المخالفة", violations: "المخالفات", warnings: "الإنذارات", waybill_expense_id: "مصروف الشحنة", website: "الموقع الإلكتروني",
  yearly_days: "الأيام السنوية", zatca_status: "حالة زاتكا",
};

// قيم الحالات والأنواع بالعربية
const VALUES: Record<string, string> = {
  draft: "مسودة", pending: "بانتظار الاعتماد", posted: "مرحّل", approved: "معتمد", rejected: "مرفوض", cancelled: "ملغى", issued: "صادرة", paid: "مدفوع",
  settled: "مسوّى", completed: "مكتمل", in_progress: "قيد التنفيذ", open: "مفتوحة", closed: "مقفلة", active: "نشط", expired: "منتهٍ", suspended: "موقوف",
  disposed: "مستبعد", delivered: "مسلّم", returned: "مُعاد", invoiced: "مفوترة", in_transit: "في الطريق", pending_supervisor: "بانتظار المشرف",
  pending_approval: "بانتظار الاعتماد", on_leave: "إجازة", terminated: "منتهية خدمته", maintenance: "صيانة", stopped: "متوقفة", sold: "مباعة",
  asset: "أصول", liability: "التزامات", equity: "حقوق ملكية", revenue: "إيرادات", cost_of_revenue: "تكلفة الإيرادات", expense: "مصروفات",
  debit: "مدين", credit: "دائن", customer: "عميل", supplier: "مورد", carrier: "ناقل", workshop: "ورشة", fuel_station: "محطة وقود",
  customs_broker: "مخلص جمركي", sales_rep: "مندوب", individual: "فرد", company: "شركة", fleet: "أسطول الشركة", cash: "نقدي", transfer: "تحويل",
  cheque: "شيك", card: "بطاقة", custody: "عهدة", fuel_card: "بطاقة وقود", station_credit: "آجل على المحطة", driver_custody: "عهدة السائق",
  driver: "السائق", vehicle: "مركبة", admin: "إدارية", other: "أخرى", owned: "ملك", leased: "مستأجرة", domestic: "داخلي", international: "خارجي",
  loading: "تحميل", border: "الحدود", delivery: "تسليم", present: "حاضر", absent: "غائب", late: "متأخر", leave: "إجازة",
  warning: "إنذار", penalty: "جزاء", incentive: "حافز", internal: "داخلية", external: "خارجية", part: "قطعة", labor: "عمالة", stock: "مخزني",
  service: "خدمة", adjustment: "تسوية", count: "جرد", invoice_payment: "سداد فواتير", advance: "دفعة مقدمة", refund: "استرداد",
  sales_credit: "إشعار دائن مبيعات", sales_debit: "إشعار مدين مبيعات", purchase_debit: "إشعار مدين مشتريات", purchase_credit: "إشعار دائن مشتريات",
  output: "مخرجات", input: "مدخلات", zero_rated: "نسبة صفرية", exempt: "معفى", low: "منخفضة", normal: "عادية", urgent: "عاجلة",
  not_sent: "لم تُرسل", accepted: "مقبولة", in_kind: "عينية", create: "إنشاء", update: "تعديل", delete: "حذف",
};

// العمود الذي يظهر بدل المعرّف عند الربط
const DISPLAY = ["name_ar", "plate", "number", "name", "login", "code"];

type Row = Record<string, unknown>;
const rowsOf = (r: unknown) => r as unknown as Row[];

/** يبني ملف Excel بكل بيانات الشركة الحالية. */
export async function exportAllData(db: Db, companyName: string) {
  const cols = rowsOf(
    await db.execute(sql`select table_name, column_name, data_type from information_schema.columns where table_schema = current_schema() order by table_name, ordinal_position`),
  );
  const fks = rowsOf(
    await db.execute(sql`
      select tc.table_name, kcu.column_name, ccu.table_name as ref_table
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
      join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
      where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = current_schema()`),
  );
  const columns = new Map<string, { name: string; type: string }[]>();
  for (const c of cols) {
    const t = String(c.table_name);
    if (!columns.has(t)) columns.set(t, []);
    columns.get(t)!.push({ name: String(c.column_name), type: String(c.data_type) });
  }
  const refOf = new Map(fks.map((f) => [`${f.table_name}.${f.column_name}`, String(f.ref_table)]));

  // أسماء العرض للجداول المرتبط بها (السائق اسمه في جدول الموظفين، والحساب برمزه واسمه)
  const labels = new Map<string, Map<string, string>>();
  const labelsFor = async (table: string) => {
    if (labels.has(table)) return labels.get(table)!;
    const have = new Set((columns.get(table) ?? []).map((c) => c.name));
    let q: string | null = null;
    if (table === "accounts") q = `select id, code || ' ' || name_ar as label from accounts`;
    else if (table === "drivers") q = `select d.id, e.name_ar as label from drivers d join employees e on e.id = d.employee_id`;
    else if (table === "routes") q = `select r.id, a.name_ar || ' ← ' || b.name_ar as label from routes r join locations a on a.id = r.from_location_id join locations b on b.id = r.to_location_id`;
    else {
      const col = DISPLAY.find((c) => have.has(c));
      if (col) q = `select id, ${col}::text as label from "${table}"`;
    }
    const map = new Map<string, string>();
    if (q) for (const r of rowsOf(await db.execute(sql.raw(q)).catch(() => []))) map.set(String(r.id), String(r.label ?? ""));
    labels.set(table, map);
    return map;
  };

  const wb = new ExcelJS.Workbook();
  wb.creator = "نظام إدارة النقل والحسابات";
  wb.created = new Date();
  const index = wb.addWorksheet("الفهرس", { views: [{ rightToLeft: true }] });
  index.columns = [{ width: 34 }, { width: 14 }];
  index.addRow([`تصدير بيانات ${companyName}`]).font = { bold: true, size: 14 };
  index.addRow([`بتاريخ ${new Date().toLocaleString("en-GB", { timeZone: "Asia/Riyadh" })}`]);
  index.addRow([]);
  const ih = index.addRow(["الورقة", "عدد الصفوف"]);
  ih.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: DARK } };
  });

  const used = new Set<string>();
  for (const [table, title] of TABLES) {
    const tcols = (columns.get(table) ?? []).filter((c) => !HIDDEN.has(c.name) && c.type !== "bytea");
    if (!tcols.length) continue;
    // سجل التعديلات قد يكبر كثيراً؛ يكفي آخر 20 ألف تعديل
    const order = table === "audit_log" ? " order by id desc limit 20000" : tcols.some((c) => c.name === "id") ? " order by id" : "";
    const data = rowsOf(await db.execute(sql.raw(`select ${tcols.map((c) => `"${c.name}"`).join(", ")} from "${table}"${order}`)));
    const refs = await Promise.all(tcols.map((c) => (refOf.has(`${table}.${c.name}`) ? labelsFor(refOf.get(`${table}.${c.name}`)!) : null)));

    let name = title.slice(0, 31);
    for (let i = 2; used.has(name); i++) name = `${title.slice(0, 28)} ${i}`;
    used.add(name);
    const ws = wb.addWorksheet(name, { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
    ws.columns = tcols.map((c) => ({ header: COLS[c.name] ?? c.name, width: Math.min(40, Math.max(10, (COLS[c.name] ?? c.name).length + 4)) }));
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: "FFFFFFFF" } };
    head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: DARK } };
    head.alignment = { vertical: "middle", wrapText: true };
    for (const r of data) {
      ws.addRow(
        tcols.map((c, i) => {
          const v = r[c.name];
          if (v == null) return null;
          if (refs[i]) return refs[i]!.get(String(v)) ?? String(v);
          if (c.type === "numeric" || c.type === "bigint" || c.type === "integer") return Number(v);
          if (c.type === "boolean") return v ? "نعم" : "لا";
          if (c.type === "USER-DEFINED" || ((c.name === "action" || c.name === "role") && typeof v === "string")) return VALUES[String(v)] ?? String(v);
          if (c.type.startsWith("timestamp")) return new Date(v as string);
          if (typeof v === "object") return JSON.stringify(v);
          return v as string;
        }),
      );
    }
    tcols.forEach((c, i) => {
      if (c.type.startsWith("timestamp")) ws.getColumn(i + 1).numFmt = "yyyy-mm-dd hh:mm";
      else if (c.type === "numeric" && !refs[i]) ws.getColumn(i + 1).numFmt = "#,##0.00";
    });
    const link = index.addRow([title, data.length]);
    link.getCell(1).value = { text: title, hyperlink: `#'${name}'!A1` };
    link.getCell(1).font = { color: { argb: "FF1D4ED8" }, underline: true };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

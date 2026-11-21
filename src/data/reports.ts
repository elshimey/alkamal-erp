import type { IconName } from "@/components/icons";
import type { Entity } from "@/lib/permissions";

// مركز التقارير على تقسيم وافق (قرار أحمد 2026-11-21، الخطوة 4ب): كل تقرير في قسمه، ويصل له البحث الشامل.
export interface ReportLink {
  href: string;
  title: string;
  description: string;
  icon: IconName;
  entity?: Entity;
  keywords?: string;
}

export const REPORT_GROUPS: { title: string; reports: ReportLink[] }[] = [
  {
    title: "المالية",
    reports: [
      { href: "/reports/income", title: "قائمة الدخل", description: "الإيرادات والتكاليف وصافي الربح بتبويب الوظيفة، مع المقارنة بالفترة السابقة.", icon: "chart", keywords: "أرباح وخسائر" },
      { href: "/reports/balance-sheet", title: "قائمة المركز المالي", description: "الأصول والالتزامات وحقوق الملكية في أي تاريخ، مع ربح السنة الجارية.", icon: "tree", keywords: "ميزانية" },
      { href: "/reports/cash-flow", title: "التدفق النقدي", description: "الداخل والخارج من الصناديق والبنوك مصنّفاً بالتحصيل والسداد والرواتب والمصروفات، ورصيد كل حساب.", icon: "cash", keywords: "نقدية سيولة" },
      { href: "/reports/cost-centers", title: "ربحية مراكز التكلفة", description: "إيراد وتكلفة وربح كل مركبة ومركز تكلفة، وهامش الربح.", icon: "truck", keywords: "ربحية المركبات" },
    ],
  },
  {
    title: "للمحاسب",
    reports: [
      { href: "/reports/trial-balance", title: "ميزان المراجعة", description: "الرصيد الافتتاحي والحركة والرصيد الختامي لكل حساب، بمستوى التفصيل الذي تختاره.", icon: "ledger" },
      { href: "/reports/ledger", title: "كشف حساب", description: "حركة أي حساب أو مجموعة حسابات برصيد متحرك، ويمكن تصفيته بمركز تكلفة.", icon: "document" },
      { href: "/reports/general-ledger", title: "الأستاذ العام", description: "كل الحسابات التي تحرّكت في الفترة، لكل حساب رصيده الافتتاحي وحركاته ورصيده الختامي.", icon: "book", keywords: "دفتر الأستاذ" },
      { href: "/reports/audit-log", title: "سجل التدقيق", description: "من أنشأ أو عدّل أو حذف ماذا ومتى، وما الذي تغيّر، مع التصفية بالمستخدم والنوع.", icon: "shield", keywords: "سجل التعديلات مراجعة" },
      { href: "/bank-accounts/reconcile", title: "التسوية البنكية", description: "مطابقة كشف البنك مع حركات الحساب في الدفاتر.", icon: "exchange", entity: "accounts", keywords: "مطابقة البنك" },
    ],
  },
  {
    title: "المبيعات",
    reports: [
      { href: "/reports/party-balances", title: "أرصدة العملاء", description: "الرصيد الافتتاحي والفوترة والتحصيل والمستحق على كل عميل في الفترة.", icon: "people", keywords: "ذمم مدينة" },
      { href: "/reports/party-statement", title: "كشف حساب عميل", description: "حركات العميل برصيد متحرك: ملخص بسطر لكل مستند، أو تفاصيل بكل بند.", icon: "document" },
      { href: "/reports/aging", title: "أعمار الديون المدينة", description: "الفواتير المفتوحة لكل عميل حسب أيام التأخير، مع رصيد الدفتر.", icon: "calendar", keywords: "متأخرات تحصيل" },
      { href: "/reports/sales-by-customer", title: "المبيعات حسب العميل", description: "الإيراد والمصاريف المستردة والضريبة لكل عميل ونسبته من المبيعات.", icon: "chart" },
      { href: "/reports/unbilled-charges", title: "مصاريف على العملاء لم تُفوتر", description: "ما دُفع على العملاء (الحساب 1114) ولم يدخل فاتورة صادرة، حسب العميل والشحنة.", icon: "document" },
    ],
  },
  {
    title: "المشتريات",
    reports: [
      { href: "/reports/party-balances?side=supplier", title: "أرصدة الموردين", description: "الرصيد الافتتاحي والمشتريات والسداد والمستحق لكل مورد وناقل وورشة ومخلص.", icon: "people", keywords: "ذمم دائنة" },
      { href: "/reports/party-statement?side=supplier", title: "كشف حساب مورد", description: "حركات المورد برصيد متحرك: ملخص أو تفاصيل.", icon: "document" },
      { href: "/reports/aging?side=supplier", title: "أعمار الديون الدائنة", description: "فواتير الموردين المفتوحة حسب أيام التأخير، مع رصيد الدفتر.", icon: "calendar", keywords: "مستحقات الموردين" },
      { href: "/reports/purchases-by-supplier", title: "المشتريات حسب المورد", description: "ما قُيد على كل مورد قبل الضريبة وبعدها.", icon: "chart" },
    ],
  },
  {
    title: "الضرائب",
    reports: [{ href: "/reports/vat", title: "إقرار ضريبة القيمة المضافة", description: "كل نوع ضريبة في خانته: الأساسية والصفرية والصادرات والمعفاة والمشتريات والجمارك والاحتساب العكسي.", icon: "invoice" }],
  },
  {
    title: "المخزون",
    reports: [{ href: "/reports/stock-movement", title: "حركة المخزون", description: "الافتتاحي والوارد والصادر والختامي لكل صنف كمية وقيمة، لكل المستودعات أو واحد.", icon: "list", entity: "inventory", keywords: "أصناف قطع غيار جرد" }],
  },
  {
    title: "الرواتب",
    reports: [{ href: "/reports/employee-statement", title: "كشف حساب موظف وعهدته", description: "حساب راتب الموظف المستحق (رواتب وعمولات وخصومات وصرف) وحساب عهدته برصيد متحرك.", icon: "user", keywords: "سائق عهدة راتب عمولة" }],
  },
];

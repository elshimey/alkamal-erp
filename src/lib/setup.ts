import { sql } from "drizzle-orm";
import type { Db } from "@/db";
import { getCompany, getInvoiceTemplate, invoiceReadiness } from "@/lib/company";
import type { Entity } from "@/lib/permissions";

export interface SetupStep {
  key: string;
  title: string;
  description: string;
  done: boolean;
  detail: string;
  href: string;
  action: string;
  importHref?: string;
  entity?: Entity;
}

// معالج إعداد شركة جديدة: كل خطوة تُحسب من البيانات الفعلية، فتكتمل وحدها حين يُدخل المستخدم ما تحتاجه
export async function setupSteps(db: Db): Promise<SetupStep[]> {
  const [company, template] = await Promise.all([getCompany(db), getInvoiceTemplate(db)]);
  const ready = invoiceReadiness(company);
  const [c] = (await db.execute(sql`
    select
      (select count(*) from bank_accounts)::int as banks,
      (select count(*) from vehicles)::int as vehicles,
      (select count(*) from drivers)::int as drivers,
      (select count(*) from drivers where user_id is not null)::int as driver_logins,
      (select count(*) from party_roles where role = 'customer')::int as customers,
      (select count(*) from routes)::int as routes,
      (select count(*) from contracts)::int as contracts,
      (select count(*) from users where is_active)::int as users,
      (select count(*) from journal_entries where source_type is null and status = 'posted')::int as manual_entries
  `)) as unknown as Record<string, number>[];
  const n = (k: string) => Number(c[k] ?? 0);
  const count = (k: string, noun: string) => (n(k) ? `${n(k).toLocaleString("en")} ${noun}` : "لم يُضف شيء بعد");

  return [
    {
      key: "company",
      title: "بيانات المنشأة",
      description: "الاسم والشعار والرقم الضريبي والسجل التجاري والعنوان الوطني؛ تظهر في الفواتير والتطبيق.",
      done: ready.missing.length === 0,
      detail: ready.missing.length ? `ينقص: ${ready.missing.join("، ")}` : "مكتملة",
      href: "/settings/company",
      action: "إكمال البيانات",
      entity: "settings",
    },
    {
      key: "template",
      title: "قالب الفاتورة والحساب البنكي",
      description: "لون الفاتورة ولغتها، والآيبان الذي يحوّل إليه العملاء، والشروط.",
      done: !!template.iban,
      detail: template.iban ? "الآيبان مضاف" : "لم يُضف الآيبان بعد",
      href: "/settings/invoice-template",
      action: "ضبط القالب",
      entity: "settings",
    },
    {
      key: "banks",
      title: "البنوك والصناديق",
      description: "حسابات البنك والصندوق التي تُقبض منها وتُدفع، برصيدها الافتتاحي.",
      done: n("banks") > 0,
      detail: count("banks", "حساب"),
      href: "/bank-accounts",
      action: "إضافة حساب",
      entity: "accounts",
    },
    {
      key: "vehicles",
      title: "المركبات",
      description: "الشاحنات برقم اللوحة؛ لكل مركبة مركز تكلفة يُنشأ تلقائياً لربحيتها.",
      done: n("vehicles") > 0,
      detail: count("vehicles", "مركبة"),
      href: "/vehicles",
      action: "إضافة مركبة",
      importHref: "/import/vehicles",
      entity: "vehicles",
    },
    {
      key: "drivers",
      title: "السائقون وتطبيقهم",
      description: "السائق وراتبه وعهدته، ثم حساب دخول لتطبيق السائق على جواله.",
      done: n("drivers") > 0 && n("driver_logins") > 0,
      detail: n("drivers") ? `${n("drivers")} سائق، ${n("driver_logins")} منهم بحساب دخول` : "لم يُضف شيء بعد",
      href: "/drivers",
      action: "إضافة سائق",
      entity: "drivers",
    },
    {
      key: "customers",
      title: "العملاء",
      description: "العملاء بأرقامهم الضريبية وبيانات التواصل لإرسال الفواتير.",
      done: n("customers") > 0,
      detail: count("customers", "عميل"),
      href: "/parties",
      action: "إضافة عميل",
      importHref: "/import/customers",
      entity: "parties",
    },
    {
      key: "routes",
      title: "المسارات والأسعار",
      description: "المدن والمسارات وعمولة السائق، وعقد أسعار لكل عميل يُسعّر الشحنات تلقائياً.",
      done: n("routes") > 0 && n("contracts") > 0,
      detail: `${n("routes")} مسار، ${n("contracts")} عقد`,
      href: n("routes") ? "/contracts" : "/routes",
      action: n("routes") ? "إضافة عقد" : "إضافة مسار",
      entity: "routes",
    },
    {
      key: "opening",
      title: "الأرصدة الافتتاحية",
      description: "قيد افتتاحي بأرصدة الحسابات في تاريخ بداية العمل على النظام (البنوك والعملاء والموردين والأصول).",
      done: n("manual_entries") > 0,
      detail: n("manual_entries") ? "يوجد قيد مرحّل" : "لا يوجد قيد افتتاحي",
      href: "/journal/new",
      action: "قيد افتتاحي",
      importHref: "/import/journal-entries",
      entity: "journal_entries",
    },
    {
      key: "users",
      title: "فريق العمل",
      description: "حسابات المحاسب ومشرف التشغيل وغيرهم، كلٌ بدور يحدد ما يراه.",
      done: n("users") > 1,
      detail: count("users", "مستخدم"),
      href: "/users",
      action: "إضافة مستخدم",
      entity: "users",
    },
  ];
}

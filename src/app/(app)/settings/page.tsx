import Link from "next/link";
import { db } from "@/db";
import { getTenant, requireUser } from "@/lib/auth";
import { can, type Entity } from "@/lib/permissions";
import { getCompany, invoiceReadiness } from "@/lib/company";
import { Icon, type IconName } from "@/components/icons";
import { PageHeader } from "@/components/ui";

interface Item {
  href?: string;
  title: string;
  description: string;
  icon: IconName;
  entity?: Entity;
  badge?: string;
}

// صفحة الإعدادات على طريقة وافق: بطاقات مجمعة، ويرى كل مستخدم ما تسمح به صلاحياته
const SECTIONS: { title: string; items: Item[] }[] = [
  {
    title: "إعدادات الملف الشخصي",
    items: [{ href: "/account", title: "حسابي", description: "بياناتك وتغيير كلمة المرور.", icon: "user" }],
  },
  {
    title: "إعدادات المنشأة",
    items: [
      { href: "/setup", title: "معالج إعداد الشركة", description: "خطوات تجهيز النظام بالترتيب، وما اكتمل منها وما بقي.", icon: "check", entity: "settings" },
      { href: "/settings/company", title: "بيانات المنشأة", description: "الشعار والاسم والرقم الضريبي والسجل والعنوان الوطني.", icon: "building", entity: "settings" },
      { href: "/settings/invoice-template", title: "قالب الفاتورة", description: "شكل الفاتورة ولونها ولغتها، والحساب البنكي والشروط.", icon: "invoice", entity: "settings" },
      { href: "/users", title: "المستخدمون", description: "إضافة أعضاء الفريق وتفعيل حساباتهم.", icon: "people", entity: "users" },
      { href: "/roles", title: "الأدوار والصلاحيات", description: "ما يراه ويفعله كل دور في كل شاشة.", icon: "shield", entity: "roles" },
    ],
  },
  {
    title: "الإعداد المحاسبي",
    items: [
      { href: "/accounts", title: "شجرة الحسابات", description: "الحسابات الرئيسية والفرعية وأرصدتها.", icon: "tree", entity: "accounts" },
      { href: "/cost-centers", title: "مراكز التكلفة", description: "مركز لكل مركبة، ومراكز الإدارة والورشة.", icon: "target", entity: "cost_centers" },
      { href: "/exchange-rates", title: "العملات وأسعار الصرف", description: "سعر الدينار الكويتي وغيره مقابل الريال.", icon: "exchange", entity: "accounts" },
    ],
  },
  {
    title: "إعداد التشغيل",
    items: [
      { href: "/routes", title: "المواقع والمسارات", description: "المدن والمسارات وعمولة السائق لكل مسار.", icon: "route", entity: "routes" },
      { href: "/contracts", title: "العقود والأسعار", description: "أسعار كل عميل وحدّه الائتماني.", icon: "contract", entity: "contracts" },
      { href: "/settings/hr", title: "الموارد البشرية", description: "نقاط الإنذار والترقية، ومقدم العمولة، ومعايير التقييم وأنواع الإجازات.", icon: "people", entity: "settings" },
      { href: "/vehicles", title: "المركبات", description: "إضافة مركبات الأسطول وبياناتها.", icon: "truck", entity: "vehicles" },
      { href: "/settings/driver-app", title: "تطبيق السائق", description: "رابط التطبيق ورمزه لإرساله للسائقين، وطريقة تثبيته على الجوال.", icon: "driver", entity: "drivers" },
    ],
  },
  {
    title: "قيد الإعداد",
    items: [
      { title: "الفاتورة الإلكترونية (زاتكا)", description: "الربط مع منصة فاتورة لهيئة الزكاة والضريبة.", icon: "shield", badge: "قريباً" },
    ],
  },
];

export default async function SettingsPage() {
  const user = await requireUser();
  const company = await getCompany(db);
  const ready = invoiceReadiness(company);
  const tenant = await getTenant();
  const platform: { title: string; items: Item[] }[] = user.perms.isAdmin
    ? [
        {
          title: "البيانات",
          items: [{ href: "/settings/export", title: "تصدير كل البيانات", description: "ملف Excel بكل أقسام النظام، ورقة لكل قسم.", icon: "download" }],
        },
        {
          title: "الاشتراك",
          items: tenant.isHome
            ? [{ href: "/owner", title: "الشركات المشتركة", description: "إضافة شركة بتجربة 15 يوماً، وتحويلها لاشتراك فعلي أو تمديدها أو إيقافها أو حذفها.", icon: "building" }]
            : [{ href: "/settings/subscription", title: "الاشتراك والبيانات", description: "حالة الاشتراك والأيام الباقية، والبدء من جديد بمسح بيانات التجربة.", icon: "shield" }],
        },
      ]
    : [];
  const sections = [...SECTIONS, ...platform].map((s) => ({ ...s, items: s.items.filter((i) => !i.entity || can(user.perms, i.entity, "view")) })).filter((s) => s.items.length);

  return (
    <>
      <PageHeader title="الإعدادات" description="كل إعدادات النظام في مكان واحد." />
      <div className="flex max-w-5xl flex-col gap-9">
        {sections.map((s, si) => (
          <section key={s.title} className="animate-rise stagger" style={{ "--i": si } as React.CSSProperties}>
            <h2 className="mb-3 text-base font-semibold text-brand-900">{s.title}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {s.items.map((i) => {
                const warn = i.href === "/settings/company" && ready.missing.length > 0;
                const body = (
                  <>
                    <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${i.href ? "bg-brand-50 text-brand-700 group-hover:bg-brand-600 group-hover:text-brand-900" : "bg-gray-100 text-gray-400"} transition-colors`}>
                      <Icon name={i.icon} className="size-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 font-semibold text-gray-800">
                        {i.title}
                        {i.badge && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-normal text-gray-500">{i.badge}</span>}
                        {warn && <span className="ltr-nums rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-normal text-amber-800">{ready.percent}%</span>}
                      </span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-gray-500">{i.description}</span>
                    </span>
                  </>
                );
                const cls = "group flex items-start gap-3 rounded-2xl border border-black/[0.06] bg-white p-4 shadow-[0_1px_2px_rgba(27,33,38,0.04)] transition";
                return i.href ? (
                  <Link key={i.title} href={i.href} className={`${cls} hover:-translate-y-0.5 hover:border-brand-500/40 hover:shadow-md`}>
                    {body}
                  </Link>
                ) : (
                  <div key={i.title} className={`${cls} opacity-70`}>
                    {body}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

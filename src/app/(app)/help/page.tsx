import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { Icon, type IconName } from "@/components/icons";
import { PageHeader } from "@/components/ui";
import { TourCards } from "./tour-cards";

const SUPPORT = "966535443598";

// ترتيب البدء: ما يُدخل أولاً حتى تعمل بقية الشاشات
const START: { title: string; href: string; text: string }[] = [
  { title: "بيانات المنشأة", href: "/settings/company", text: "الشعار والرقم الضريبي والعنوان الوطني، لتظهر في الفواتير." },
  { title: "المستخدمون", href: "/users", text: "أضف المحاسب والمدير، وحدد دور كل منهم." },
  { title: "المركبات والسائقون", href: "/vehicles", text: "أدخل الأسطول؛ كل مركبة تنشئ مركز تكلفتها تلقائياً." },
  { title: "الإسناد", href: "/assignments", text: "اربط كل سائق بمركبته من تاريخ معين." },
  { title: "العملاء والمسارات والعقود", href: "/parties", text: "العميل، ثم المسار، ثم سعره في العقد." },
  { title: "الشحنات", href: "/waybills", text: "كل رحلة شحنة؛ عند اعتمادها تُقيد تكاليفها على المركبة." },
  { title: "الفواتير وسندات القبض", href: "/invoices", text: "اجمع الشحنات المنفذة في فاتورة، ثم سجّل التحصيل." },
];

const TOPICS: { icon: IconName; title: string; points: string[] }[] = [
  {
    icon: "truck",
    title: "الأسطول",
    points: [
      "المركبات: كل مركبة لها مركز تكلفة تُحمَّل عليه مصاريفها وإيراداتها، فتظهر ربحيتها في التقارير.",
      "الإسناد والتسليم: من كان يقود أي مركبة في أي تاريخ؛ تعتمد عليه الشحنات والمخالفات تلقائياً.",
      "وثائق الأسطول: الاستمارات والرخص والتأمين، مع تنبيه قبل الانتهاء بـ 30 يوماً.",
      "المخالفات المرورية: تُسجل على المركبة، وتُخصم من راتب السائق أو تُحمَّل على الشركة.",
      "الصيانة: طلب عطل ← اعتماد ← أمر صيانة، والصيانة الدورية بالأيام.",
    ],
  },
  {
    icon: "waybill",
    title: "التشغيل والمبيعات",
    points: [
      "الشحنة: العميل والمسار والسائق والمراحل (تحميل، طريق، حدود، تسليم) والديزل والمصاريف.",
      "الاعتماد يرحّل قيد التكلفة على مركز تكلفة المركبة، وعمولة السائق على راتبه.",
      "الفاتورة: تجمع شحنات العميل المنفذة؛ الإيراد والضريبة يُقيدان عند الإصدار.",
      "سند القبض: يُخصص على أقدم فاتورة مستحقة تلقائياً.",
    ],
  },
  {
    icon: "invoice",
    title: "المشتريات والمصروفات",
    points: [
      "فواتير الموردين: الورش ومحطات الوقود والموردون، دائنة لحساب كل مورد.",
      "المصروفات: من عهدة السائق أو من الصندوق، تنتظر الاعتماد ثم تُقيد على المركبة.",
      "سندات الصرف: سداد الموردين والناقلين، وصرف العهد للسائقين.",
    ],
  },
  {
    icon: "people",
    title: "الموظفون والرواتب",
    points: [
      "المسير الشهري يُبنى من الرواتب والعمولات وأقساط السلف والمخالفات.",
      "تعدّل الغياب والإضافات، ثم تعتمد قيد الاستحقاق، ثم تصرف بالصافي من البنك مع ملف التحويل.",
      "التأمينات ومخصص نهاية الخدمة تُحسب تلقائياً.",
    ],
  },
  {
    icon: "chart",
    title: "التقارير",
    points: [
      "كل التقارير من القيود المرحّلة فقط: ميزان المراجعة، الدخل، المركز المالي، كشف الحساب، ربحية المركبات، إقرار الضريبة.",
      "كل تقرير يُصدَّر إلى Excel ويُطبع.",
    ],
  },
  {
    icon: "cash",
    title: "إدخال البيانات بسرعة",
    points: [
      "الشاشات التي فيها «شيت» تقبل اللصق من Excel مباشرة: انسخ الصفوف والصقها في أي خلية.",
      "«تنزيل القالب» يعطيك ملفاً بالأعمدة المطلوبة، و«استيراد ملف» يقرأه.",
      "الصفوف المرفوضة تبقى مع سبب الرفض لتصححها، والمقبولة تُحفظ.",
    ],
  },
];

export default async function HelpPage() {
  await requireUser();
  return (
    <>
      <PageHeader title="المساعدة ودليل النظام" description="كيف تبدأ، وما تفعله كل شاشة، وكيف تتواصل مع الدعم الفني." />

      <div className="mb-8 grid gap-4 md:grid-cols-3">
        <a
          href={`https://wa.me/${SUPPORT}?text=${encodeURIComponent("مرحباً، أحتاج مساعدة في البرنامج")}`}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex items-center gap-4 rounded-2xl bg-asphalt-900 p-5 text-white transition hover:-translate-y-0.5"
        >
          <span className="flex size-12 items-center justify-center rounded-xl bg-brand-600 text-brand-900">
            <Icon name="chat" className="size-6" />
          </span>
          <span>
            <span className="block font-semibold">الدعم الفني على واتساب</span>
            <span className="ltr-nums mt-0.5 block text-sm text-white/60">+{SUPPORT}</span>
          </span>
        </a>
        <a href={`tel:+${SUPPORT}`} className="flex items-center gap-4 rounded-2xl bg-white p-5 shadow-sm transition hover:-translate-y-0.5">
          <span className="flex size-12 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <Icon name="phone" className="size-6" />
          </span>
          <span>
            <span className="block font-semibold text-gray-800">اتصال مباشر</span>
            <span className="ltr-nums mt-0.5 block text-sm text-gray-500">+{SUPPORT}</span>
          </span>
        </a>
        <a
          href={`https://wa.me/${SUPPORT}?text=${encodeURIComponent("اقتراح ميزة جديدة للبرنامج: ")}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-4 rounded-2xl bg-white p-5 shadow-sm transition hover:-translate-y-0.5"
        >
          <span className="flex size-12 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <Icon name="sparkle" className="size-6" />
          </span>
          <span>
            <span className="block font-semibold text-gray-800">طلب ميزة جديدة</span>
            <span className="mt-0.5 block text-sm text-gray-500">اقترح ما تحتاجه في النظام</span>
          </span>
        </a>
      </div>

      <h2 className="mb-1 text-base font-semibold text-brand-900">الدورات المستندية: جولات تفاعلية</h2>
      <p className="mb-3 text-sm text-gray-500">اختر دورة فينقلك البرنامج إلى كل خطوة، ويضيء البند المطلوب برقمه، ويشرح ما تفعله وأثره المحاسبي، ويختم بالقيود التي تكوّنت.</p>
      <div className="mb-9">
        <TourCards />
      </div>

      <h2 className="mb-3 text-base font-semibold text-brand-900">ابدأ من هنا</h2>
      <ol className="mb-9 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {START.map((s, i) => (
          <li key={s.href}>
            <Link href={s.href} className="flex h-full gap-3 rounded-2xl border border-black/[0.06] bg-white p-4 transition hover:border-brand-500/40 hover:shadow-md">
              <span className="ltr-nums flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-600 font-display font-semibold text-brand-900">{i + 1}</span>
              <span>
                <span className="block font-semibold text-gray-800">{s.title}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-gray-500">{s.text}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>

      <h2 className="mb-3 text-base font-semibold text-brand-900">شرح الأقسام</h2>
      <div className="flex max-w-4xl flex-col gap-2">
        {TOPICS.map((t) => (
          <details key={t.title} className="group rounded-2xl border border-black/[0.06] bg-white open:shadow-sm">
            <summary className="flex cursor-pointer list-none items-center gap-3 p-4 font-semibold text-gray-800">
              <Icon name={t.icon} className="size-5 text-brand-600" />
              <span className="flex-1">{t.title}</span>
              <svg viewBox="0 0 24 24" className="size-4 text-gray-400 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </summary>
            <ul className="list-disc space-y-1.5 px-10 pb-4 text-sm leading-relaxed text-gray-600">
              {t.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </>
  );
}

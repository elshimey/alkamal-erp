import { baseSql } from "@/db";
import { currentSchema } from "@/db/tenant";
import { companyCode } from "@/lib/platform";
import Link from "next/link";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { requirePermission } from "@/lib/auth";
import { getBrand } from "@/lib/brand";
import { Card, PageHeader } from "@/components/ui";
import { CopyLink } from "./copy-link";

// رابط تطبيق السائق يُبنى من عنوان الموقع نفسه، فيبقى صحيحاً لو تغير النطاق
export default async function DriverAppPage() {
  await requirePermission("drivers", "view");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "alkamal-erp.vercel.app";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const url = `${proto}://${host}/driver`;
  const qr = await QRCode.toString(url, { type: "svg", margin: 1, color: { dark: "#1b2126", light: "#ffffff" } });
  const code = await companyCode(baseSql, await currentSchema());
  const message = `تطبيق السائق – ${(await getBrand()).name}\n${url}\nرمز الشركة: ${code ?? ""}\nادخل برمز الشركة واسم الدخول وكلمة المرور التي أرسلناها لك، ثم أضف التطبيق إلى الشاشة الرئيسية.`;

  return (
    <>
      <PageHeader title="تطبيق السائق" description="تطبيق ويب يعمل من متصفح الجوال ويُثبَّت كأيقونة على الشاشة الرئيسية، بلا متجر تطبيقات. أرسل الرابط للسائق مع اسم الدخول وكلمة المرور.">
        <Link href="/settings" className="text-sm text-brand-700 hover:underline">
          الإعدادات
        </Link>
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <Card title="رابط التطبيق">
          <CopyLink url={url} whatsapp={`https://wa.me/?text=${encodeURIComponent(message)}`} />
          <ol className="mt-6 flex flex-col gap-3 text-sm text-gray-700">
            <li>
              <span className="font-semibold text-brand-900">1. أنشئ دخولاً للسائق</span> من{" "}
              <Link href="/drivers" className="text-brand-700 hover:underline">
                صفحة السائقين
              </Link>{" "}
              (بطاقة «حساب دخول لتطبيق السائق»): اسم الدخول جواله، وكلمة مرور أولى.
            </li>
            <li>
              <span className="font-semibold text-brand-900">2. أرسل له الرابط</span> بزر واتساب أعلاه، أو يصوّر الرمز من جواله.
            </li>
            <li>
              <span className="font-semibold text-brand-900">3. التثبيت على الجوال:</span> في آيفون يفتح الرابط من Safari ثم «مشاركة» ← «إضافة إلى الشاشة الرئيسية». وفي أندرويد يفتحه من Chrome ثم القائمة ⋮ ← «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».
            </li>
            <li>
              <span className="font-semibold text-brand-900">4. اللغة:</span> يختار السائق العربية أو الأردية أو الهندية أو الإنجليزية من داخل التطبيق.
            </li>
          </ol>
        </Card>
        <Card title="رمز التطبيق">
          <div className="mx-auto w-56 rounded-xl border border-gray-100 p-2" dangerouslySetInnerHTML={{ __html: qr }} />
          <p className="mt-3 text-center text-xs text-gray-500">يوجّه السائق كاميرا جواله إلى الرمز فيفتح التطبيق.</p>
        </Card>
      </div>
    </>
  );
}

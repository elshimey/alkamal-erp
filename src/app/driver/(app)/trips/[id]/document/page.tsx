import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { getDriverContext } from "@/lib/driver-auth";
import { ownTrip } from "@/lib/driver-app";
import { getCompany, getInvoiceTemplate } from "@/lib/company";
import { waybillDoc } from "@/lib/waybills";
import { WaybillDocument } from "@/components/waybill-document";
import { PrintButton } from "@/components/print-button";

/** وثيقة النقل في تطبيق السائق: تظهر بعد أن يرسلها المكتب، ليعرضها عند نقاط التفتيش والمنافذ. */
export default async function TransportDocPage({ params }: { params: Promise<{ id: string }> }) {
  const { driver, t } = await getDriverContext();
  if (!driver) return null;
  const id = Number((await params).id);
  const w = await ownTrip(db, driver.id, id).catch(() => null);
  if (!w || !w.sentToDriverAt) notFound();
  const [doc, company, template] = await Promise.all([waybillDoc(db, id), getCompany(db), getInvoiceTemplate(db)]);
  if (!doc) notFound();
  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-2 print:hidden">
        <Link href={`/driver/trips/${id}`} className="text-sm text-brand-700">
          ← {t.back}
        </Link>
        <PrintButton label="PDF / طباعة" />
      </div>
      <div dir="rtl" className="-mx-2">
        <WaybillDocument company={company} doc={doc} template={template} compact variant="transport" />
      </div>
    </>
  );
}

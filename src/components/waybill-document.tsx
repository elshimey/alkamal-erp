import type { CompanyProfile } from "@/lib/company";
import type { waybillDoc } from "@/lib/waybills";
import { DEFAULT_TEMPLATE, type InvoiceTemplate } from "@/lib/invoice-template";
import { TRIP_STAGES } from "@/data/waybills";
import { Facts, Frame } from "@/components/maintenance-document";

type Doc = NonNullable<Awaited<ReturnType<typeof waybillDoc>>>;
const when = (d: Date | string) => new Date(d).toLocaleString("en-GB", { timeZone: "Asia/Riyadh", dateStyle: "short", timeStyle: "short" });

/** بوليصة الشحن: تُسلَّم للسائق والمستلم، وفيها بيانات الحمولة والرحلة وتوقيع الاستلام، دون أسعار. */
export function WaybillDocument({ company, doc, template = DEFAULT_TEMPLATE, compact = false }: { company: CompanyProfile; doc: Doc; template?: InvoiceTemplate; compact?: boolean }) {
  const { w } = doc;
  const fleet = w.execution === "fleet";
  return (
    <Frame
      company={company}
      template={template}
      compact={compact}
      title="بوليصة شحن"
      en="Waybill"
      meta={[
        ["الرقم", w.number],
        ["التاريخ", w.waybillDate],
      ]}
      signatures={["توقيع السائق", "اسم المستلم وتوقيعه", "الختم وتاريخ الاستلام"]}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Facts
          rows={[
            ["العميل", doc.customer],
            ["الشاحن", w.shipper],
            ["المستلم", w.consignee],
            ["عنوان التسليم", w.deliveryAddress],
          ]}
        />
        <Facts
          rows={[
            ["المسار", `${doc.from} ← ${doc.to}${w.isInternational ? " (دولي)" : ""}`],
            fleet ? ["المركبة", doc.plate] : ["الناقل", doc.carrier],
            ["السائق", fleet ? [doc.driver, doc.driverMobile].filter(Boolean).join(" · ") : [w.carrierDriverName, w.carrierDriverMobile, w.carrierPlate].filter(Boolean).join(" · ")],
          ]}
        />
      </div>
      <h3 className="mt-6 mb-2 text-sm font-semibold text-[var(--inv-dark)]">الحمولة</h3>
      <Facts
        rows={[
          ["رقم الحاوية", w.containerNumber],
          ["الوزن", w.weightTons ? `${Number(w.weightTons).toLocaleString("en")} طن` : null],
          ["البيان الجمركي", w.customsDeclaration],
          ["سند التسليم", w.deliveryNoteNumber],
          ["المسافة", w.distanceKm ? `${w.distanceKm.toLocaleString("en")} كم` : null],
          ["ملاحظات", w.notes],
        ]}
      />
      {doc.stages.length > 0 && (
        <>
          <h3 className="mt-6 mb-2 text-sm font-semibold text-[var(--inv-dark)]">مراحل الرحلة</h3>
          <ol className="grid gap-2 text-xs sm:grid-cols-4">
            {doc.stages.map((st) => (
              <li key={st.id} className="rounded-lg border border-gray-200 px-3 py-2">
                <div className="font-semibold">{TRIP_STAGES[st.stage]}</div>
                <div className="ltr-nums text-gray-500" dir="ltr">
                  {when(st.at)}
                </div>
                {st.odometer != null && <div className="ltr-nums text-gray-500">{st.odometer.toLocaleString("en")} كم</div>}
              </li>
            ))}
          </ol>
        </>
      )}
      <p className="mt-6 rounded-lg bg-gray-50 px-4 py-3 text-xs text-gray-600">
        أقر المستلم باستلام الشحنة الموضحة أعلاه بحالة سليمة ومطابقة، ما لم تُذكر ملاحظة عند الاستلام.
      </p>
    </Frame>
  );
}

import type { ReactNode } from "react";
import type { CompanyProfile } from "@/lib/company";
import type { waybillDoc } from "@/lib/waybills";
import { DEFAULT_TEMPLATE, type InvoiceTemplate } from "@/lib/invoice-template";
import { FREIGHT_PAYERS, GOODS_CONDITIONS, LOGISTI_STATUSES, PACKAGE_UNITS, PAYMENT_METHODS, PLATE_TYPES, TRIP_STAGES, WEIGHT_UNITS } from "@/data/waybills";
import { Facts, Frame } from "@/components/maintenance-document";

type Doc = NonNullable<Awaited<ReturnType<typeof waybillDoc>>>;
const when = (d: Date | string) => new Date(d).toLocaleString("en-GB", { timeZone: "Asia/Riyadh", dateStyle: "short", timeStyle: "short" });
const label = <T extends Record<string, string>>(map: T, v: string | null | undefined) => (v && v in map ? map[v as keyof T] : v || null);
const qty = (v: string | number | null | undefined) => (v == null || v === "" ? "" : Number(v).toLocaleString("en", { maximumFractionDigits: 3 }));
const join = (...xs: (string | null | undefined)[]) => xs.filter(Boolean).join(" · ") || null;

/** بضاعة الشحنة: سطر لكل صنف بعدده ووزنه وحالته. */
function GoodsTable({ goods }: { goods: Doc["goods"] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs text-gray-500">
          <tr>
            <th className="px-3 py-2 text-start font-medium">#</th>
            <th className="px-3 py-2 text-start font-medium">الوصف</th>
            <th className="px-3 py-2 text-start font-medium">العدد</th>
            <th className="px-3 py-2 text-start font-medium">الوزن</th>
            <th className="px-3 py-2 text-start font-medium">الأبعاد</th>
            <th className="px-3 py-2 text-start font-medium">الحالة</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {goods.map((g, i) => (
            <tr key={g.id ?? i}>
              <td className="ltr-nums px-3 py-2 text-gray-400">{i + 1}</td>
              <td className="px-3 py-2">{g.description}</td>
              <td className="ltr-nums px-3 py-2">{join(qty(g.quantity), label(PACKAGE_UNITS, g.packageUnit))}</td>
              <td className="ltr-nums px-3 py-2">{g.weight != null ? `${qty(g.weight)} ${label(WEIGHT_UNITS, g.weightUnit)}` : ""}</td>
              <td className="ltr-nums px-3 py-2">{g.dimensions}</td>
              <td className="px-3 py-2">{label(GOODS_CONDITIONS, g.condition)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Part({ n, title, children }: { n?: number; title: string; children: ReactNode }) {
  return (
    <section className="break-inside-avoid">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--inv-dark)]">
        {n != null && <span className="ltr-nums grid size-5 place-items-center rounded-full bg-[var(--inv-accent)] text-[10px] text-white">{n}</span>}
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * بوليصة الشحن (تُسلَّم للسائق والمستلم، دون أسعار)، أو «وثيقة النقل» بترتيب وثيقة منصة لوجستي:
 * الناقل، التواريخ، الشاحنة، السائق، المرسل، المرسل إليه، خط السير، البضاعة، أجور النقل.
 */
export function WaybillDocument({
  company,
  doc,
  template = DEFAULT_TEMPLATE,
  compact = false,
  variant = "waybill",
}: {
  company: CompanyProfile;
  doc: Doc;
  template?: InvoiceTemplate;
  compact?: boolean;
  variant?: "waybill" | "transport";
}) {
  const { w } = doc;
  const fleet = w.execution === "fleet";
  const goods = doc.goods ?? [];
  const plate = fleet ? doc.plate : w.carrierPlate;
  const driver = fleet ? doc.driver : w.carrierDriverName;
  const driverMobile = fleet ? doc.driverMobile : w.carrierDriverMobile;
  const place = (city: string | null, country: string | null) => (city && country && city !== country ? `${city}، ${country}` : city || country);

  if (variant === "transport") {
    return (
      <Frame
        company={company}
        template={template}
        compact={compact}
        title="وثيقة نقل"
        en="Transport Document"
        meta={[
          ["رقم الشحنة", w.number],
          ["التاريخ", w.waybillDate],
          ...(w.logistiNumber ? ([["رقم وثيقة لوجستي", w.logistiNumber]] as [string, string][]) : []),
          ["قابلة للتداول", w.negotiable ? "نعم" : "لا"],
        ]}
        signatures={["توقيع المرسل", "توقيع السائق", "توقيع المرسل إليه"]}
      >
        {/* عمودان حين يتسع المكان (الطباعة والمعاينة الجانبية)، وعمود واحد في المعاينة الضيقة والجوال */}
        <div className="@container">
          <div className="grid gap-5 @xl:grid-cols-2">
            <Part n={1} title="الناقل">
              <Facts
                rows={[
                  ["الاسم", fleet ? company.nameAr : doc.carrier],
                  ["الجوال", fleet ? company.phone : null],
                  ["رقم ترخيص النقل", fleet ? company.transportLicenseNo : null],
                  ["الرقم الموحد للمنشأة", fleet ? company.establishmentNo : null],
                ]}
              />
            </Part>
            <Part n={2} title="التواريخ">
              <Facts
                rows={[
                  ["تاريخ الاستلام", w.pickupDate ?? w.waybillDate],
                  ["تاريخ التسليم المتوقع", w.expectedDeliveryDate ?? "—"],
                ]}
              />
            </Part>
            <Part n={3} title="الشاحنة">
              <Facts
                rows={[
                  ["رقم اللوحة", plate ?? "—"],
                  ["نوع اللوحة", label(PLATE_TYPES, doc.plateType)],
                  ["المقطورة", doc.trailerPlate],
                ]}
              />
            </Part>
            <Part n={4} title="السائق">
              <Facts
                rows={[
                  ["الاسم", driver ?? "—"],
                  ["رقم الهوية / الإقامة", fleet ? doc.driverIdNumber : null],
                  ["الجوال", driverMobile],
                  ["الجنسية", fleet ? doc.driverNationality : null],
                ]}
              />
            </Part>
            <Part n={5} title="المرسل">
              <Facts
                rows={[
                  ["الاسم", w.shipper],
                  ["الجوال", w.shipperPhone],
                  ["المدينة", w.shipperCity],
                  ["العنوان", w.shipperAddress],
                  ["ملاحظات", w.shipperNotes],
                ]}
              />
            </Part>
            <Part n={6} title="المرسل إليه">
              <Facts
                rows={[
                  ["الاسم", w.consignee],
                  ["الجوال", w.consigneePhone],
                  ["المدينة", w.consigneeCity],
                  ["العنوان", w.deliveryAddress],
                  ["ملاحظات", w.consigneeNotes],
                ]}
              />
            </Part>
          </div>
        </div>
        <div className="mt-5 grid gap-5">
          <Part n={7} title="خط السير">
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 text-sm">
              <span>
                <span className="block text-xs text-gray-500">من</span>
                <b>{place(doc.from, doc.fromCountry)}</b>
              </span>
              <span className="text-[var(--inv-accent)]">←</span>
              <span>
                <span className="block text-xs text-gray-500">إلى</span>
                <b>{place(doc.to, doc.toCountry)}</b>
              </span>
              {w.isInternational && <span className="ms-auto rounded-md bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-800">نقل دولي</span>}
            </div>
          </Part>
          <Part n={8} title="البضاعة">
            {goods.length ? (
              <GoodsTable goods={goods} />
            ) : (
              <Facts
                rows={[
                  ["الوزن", w.weightTons ? `${qty(w.weightTons)} طن` : "—"],
                  ["رقم الحاوية", w.containerNumber],
                ]}
              />
            )}
          </Part>
          <Part n={9} title="أجور النقل">
            <Facts
              rows={[
                ["تُدفع من قِبل", label(FREIGHT_PAYERS, w.freightPayer)],
                ["طريقة الدفع", label(PAYMENT_METHODS, w.paymentMethod)],
                ["تعليمات", w.freightInstructions],
              ]}
            />
          </Part>
        </div>
        {w.logistiNumber && (
          <p className="mt-4 text-xs text-gray-500">
            وثيقة لوجستي رقم <span className="ltr-nums font-semibold">{w.logistiNumber}</span> · {label(LOGISTI_STATUSES, w.logistiStatus)}
          </p>
        )}
      </Frame>
    );
  }

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
        ...(w.logistiNumber ? ([["وثيقة لوجستي", w.logistiNumber]] as [string, string][]) : []),
      ]}
      signatures={["توقيع السائق", "اسم المستلم وتوقيعه", "الختم وتاريخ الاستلام"]}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Facts
          rows={[
            ["العميل", doc.customer],
            ["الشاحن", join(w.shipper, w.shipperPhone, w.shipperCity)],
            ["المستلم", join(w.consignee, w.consigneePhone, w.consigneeCity)],
            ["عنوان التسليم", w.deliveryAddress],
          ]}
        />
        <Facts
          rows={[
            ["المسار", `${doc.from} ← ${doc.to}${w.isInternational ? " (دولي)" : ""}`],
            fleet ? ["المركبة", join(doc.plate, doc.trailerPlate && `مقطورة ${doc.trailerPlate}`)] : ["الناقل", doc.carrier],
            ["السائق", fleet ? join(doc.driver, doc.driverMobile) : join(w.carrierDriverName, w.carrierDriverMobile, w.carrierPlate)],
            ["الاستلام / التسليم المتوقع", w.pickupDate || w.expectedDeliveryDate ? `${w.pickupDate ?? "—"} ← ${w.expectedDeliveryDate ?? "—"}` : null],
          ]}
        />
      </div>
      <h3 className="mt-6 mb-2 text-sm font-semibold text-[var(--inv-dark)]">الحمولة</h3>
      {goods.length > 0 && (
        <div className="mb-3">
          <GoodsTable goods={goods} />
        </div>
      )}
      <Facts
        rows={[
          ["رقم الحاوية", w.containerNumber],
          ["الوزن", w.weightTons ? `${qty(w.weightTons)} طن` : null],
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

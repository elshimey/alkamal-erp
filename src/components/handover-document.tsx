import type { CompanyProfile } from "@/lib/company";
import type { handoverDoc } from "@/lib/handovers";
import { CONDITION, FUEL_LEVEL, HANDOVER_KIND } from "@/data/handovers";
import { DEFAULT_TEMPLATE, type InvoiceTemplate } from "@/lib/invoice-template";
import { Facts, Frame } from "@/components/maintenance-document";
import { fmtDate } from "@/lib/format";

export type HandoverDocData = NonNullable<Awaited<ReturnType<typeof handoverDoc>>>;

const FUEL_EN = { quarter: "1/4", half: "1/2", three_quarters: "3/4", full: "Full" } as const;
const COND_EN = { good: "Good", notes: "With remarks" } as const;

/** عنوان عربي وتحته الإنجليزي (قرار أحمد 2026-11-24: المحضر بالعربي والإنجليزي لأن أغلب السائقين أجانب). */
function Bi({ ar, en }: { ar: string; en: string }) {
  return (
    <>
      {ar}
      <span className="block text-[10px] text-gray-400" dir="ltr">
        {en}
      </span>
    </>
  );
}

/** صيغة الإقرار حسب نوع المحضر، بالعربي ثم الإنجليزي. */
export function handoverStatement(d: Pick<HandoverDocData, "fromName" | "toName"> & { kind: HandoverDocData["h"]["kind"]; company: string; companyEn?: string | null; tools: boolean }) {
  const from = d.fromName ?? "……";
  const to = d.toName ?? "……";
  const coEn = d.companyEn || d.company;
  const toolsAr = d.tools ? " ومعها العدد والأدوات المبينة في الجدول" : "";
  const toolsEn = d.tools ? " together with the tools and equipment listed in the table" : "";
  if (d.kind === "receive")
    return {
      ar: `أقر أنا السائق ${to} بأنني استلمت من ${d.company} المركبة الموضحة بياناتها أعلاه${toolsAr}، بعد معاينتها، وبالحالة المذكورة في الملاحظات. وأتعهد بالمحافظة عليها واستخدامها لأعمال الشركة فقط، وإعادتها بالحالة نفسها عند الطلب، وأتحمل مسؤولية أي تلف أو فقد ينتج عن سوء الاستخدام أو الإهمال، والمخالفات المرورية خلال فترة عهدتي.`,
      en: `I, driver ${to}, acknowledge that I have received from ${coEn} the vehicle described above${toolsEn}, after inspecting it, in the condition stated in the remarks. I undertake to keep it safe, use it for company business only, and return it in the same condition on request. I am responsible for any damage or loss caused by misuse or negligence, and for traffic violations during my custody.`,
    };
  if (d.kind === "return")
    return {
      ar: `أقر أنا السائق ${from} بأنني سلّمت إلى ${d.company} المركبة الموضحة بياناتها أعلاه${toolsAr}، وقد استلمها مندوب الشركة بالحالة المذكورة في الملاحظات، وتنتهي عهدتي عليها من تاريخه، مع بقاء مسؤوليتي عن أي مخالفات أو أضرار تثبت خلال فترة عهدتي.`,
      en: `I, driver ${from}, acknowledge that I have returned to ${coEn} the vehicle described above${toolsEn}. The company representative received it in the condition stated in the remarks. My custody ends on this date, and I remain responsible for any violations or damage proven during my custody.`,
    };
  return {
    ar: `تم في تاريخه تسليم المركبة الموضحة بياناتها أعلاه${toolsAr} من السائق ${from} (المسلِّم) إلى السائق ${to} (المستلم) بحضور مندوب الشركة. ويقر المستلم بأنه عاين المركبة واستلمها بالحالة المذكورة في الملاحظات، وتنتقل العهدة إليه من تاريخه، ويبقى المسلِّم مسؤولاً عن أي مخالفات أو أضرار قبل هذا التاريخ.`,
    en: `On this date the vehicle described above${toolsEn} was handed over from driver ${from} (handing over) to driver ${to} (receiving) in the presence of the company representative. The receiving driver confirms inspecting and receiving it in the condition stated in the remarks; custody passes to the receiving driver from this date, and the handing-over driver remains responsible for any violations or damage before this date.`,
  };
}

function Sign({ ar, en, name }: { ar: string; en: string; name?: string | null }) {
  return (
    <span className="block">
      <span className="block font-semibold text-gray-700">{ar}</span>
      <span className="block text-[10px]" dir="ltr">
        {en}
      </span>
      {name && <span className="mt-0.5 block text-gray-800">{name}</span>}
    </span>
  );
}

/** محضر استلام/تسليم المركبة: بيانات المركبة والسائقين، والعدد والأدوات، والإقرار، والتوقيعات. */
export function HandoverDocument({ company, doc, template = DEFAULT_TEMPLATE, compact = false }: { company: CompanyProfile; doc: HandoverDocData; template?: InvoiceTemplate; compact?: boolean }) {
  const { h } = doc;
  const k = HANDOVER_KIND[h.kind];
  const st = handoverStatement({ kind: h.kind, fromName: doc.fromName, toName: doc.toName, company: company.nameAr, companyEn: company.nameEn, tools: doc.items.length > 0 });
  const rep = <Sign ar="مندوب الشركة" en="Company Representative" name={h.companyRep} />;
  const giver = <Sign ar="السائق المسلِّم" en="Handing-over Driver" name={doc.fromName} />;
  const taker = <Sign ar="السائق المستلم" en="Receiving Driver" name={doc.toName} />;
  const signatures = h.kind === "receive" ? [taker, rep] : h.kind === "return" ? [giver, rep] : [giver, taker, rep];
  const model = [doc.make, doc.model, doc.year].filter(Boolean).join(" ");
  return (
    <Frame
      company={company}
      template={template}
      compact={compact}
      title={k.title}
      en={k.en}
      meta={[
        ["الرقم No.", h.number],
        ["التاريخ Date", fmtDate(h.handoverDate)],
      ]}
      signatures={signatures}
    >
      <Facts
        rows={[
          [<Bi key="p" ar="اللوحة" en="Plate No." />, doc.plate],
          [<Bi key="m" ar="الطراز" en="Make / Model" />, model || null],
          [<Bi key="c" ar="رقم الشاسيه" en="Chassis No." />, doc.chassis],
          [<Bi key="o" ar="قراءة العداد" en="Odometer" />, h.odometer != null ? `${h.odometer.toLocaleString("en")} كم / km` : null],
          [<Bi key="f" ar="مستوى الوقود" en="Fuel Level" />, h.fuelLevel ? `${FUEL_LEVEL[h.fuelLevel]} / ${FUEL_EN[h.fuelLevel]}` : null],
          [<Bi key="s" ar="الحالة العامة" en="Condition" />, h.condition ? `${CONDITION[h.condition]} / ${COND_EN[h.condition]}` : null],
          [<Bi key="g" ar="السائق المسلِّم" en="Handing-over Driver" />, doc.fromName ? [doc.fromName, doc.fromId && `هوية / ID ${doc.fromId}`].filter(Boolean).join(" · ") : null],
          [<Bi key="t" ar="السائق المستلم" en="Receiving Driver" />, doc.toName ? [doc.toName, doc.toId && `هوية / ID ${doc.toId}`].filter(Boolean).join(" · ") : null],
        ]}
      />
      {doc.items.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <p className="mb-1.5 text-sm font-semibold text-gray-700">
            العدد والأدوات المسلَّمة مع المركبة <span className="text-xs font-normal text-gray-400">Tools &amp; equipment handed over with the vehicle</span>
          </p>
          <table data-report className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-600">
                <th className="border border-gray-200 px-2 py-1.5 text-start">
                  <Bi ar="الصنف" en="Item" />
                </th>
                <th className="border border-gray-200 px-2 py-1.5 text-start">
                  <Bi ar="العدد" en="Qty" />
                </th>
                <th className="border border-gray-200 px-2 py-1.5 text-start">
                  <Bi ar="الحالة / الرقم" en="Condition / Serial" />
                </th>
              </tr>
            </thead>
            <tbody>
              {doc.items.map((it) => (
                <tr key={it.id}>
                  <td className="border border-gray-200 px-2 py-1.5">{it.name}</td>
                  <td className="ltr-nums border border-gray-200 px-2 py-1.5">{it.qty}</td>
                  <td className="border border-gray-200 px-2 py-1.5">{it.condition ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {h.notes && (
        <p className="mt-4 text-sm">
          <span className="font-semibold text-gray-700">ملاحظات / Remarks: </span>
          {h.notes}
        </p>
      )}
      <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50/60 px-4 py-3 text-xs leading-relaxed text-gray-700">
        <p>{st.ar}</p>
        <p className="mt-2 text-gray-500" dir="ltr">
          {st.en}
        </p>
      </div>
    </Frame>
  );
}

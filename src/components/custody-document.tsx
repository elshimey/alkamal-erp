import type { CompanyProfile } from "@/lib/company";
import type { custodyDoc } from "@/lib/hr";
import { DEFAULT_TEMPLATE, type InvoiceTemplate } from "@/lib/invoice-template";
import { CUSTODY_KIND, CUSTODY_STATUS } from "@/data/hr";
import { amountInWords } from "@/lib/tafqit";
import { Facts, Frame } from "@/components/maintenance-document";
import { fmt } from "@/lib/format";

type Doc = NonNullable<Awaited<ReturnType<typeof custodyDoc>>>;

/** إقرار استلام عهدة: ما سُلّم للموظف وحالته، ويوقعه المستلم والمسلّم والمعتمد. */
export function CustodyDocument({ company, doc, template = DEFAULT_TEMPLATE, compact = false }: { company: CompanyProfile; doc: Doc; template?: InvoiceTemplate; compact?: boolean }) {
  const { c } = doc;
  const amount = Number(c.amount);
  const closed = c.status === "settled" || c.status === "returned";
  return (
    <Frame
      company={company}
      template={template}
      compact={compact}
      title={`إقرار استلام عهدة ${CUSTODY_KIND[c.kind]}`}
      en="Custody Receipt"
      meta={[
        ["الرقم", c.number],
        ["التاريخ", c.docDate],
        ["الحالة", CUSTODY_STATUS[c.status].label],
      ]}
      signatures={["المستلم", "أمين الصندوق / المسلّم", "المعتمد"]}
    >
      <Facts
        rows={[
          ["الموظف", doc.employee],
          ["الوظيفة", doc.jobTitle],
          ["الهوية / الإقامة", doc.nationalId],
          ["العهدة", c.description],
          ["الرقم التسلسلي", c.serialNo],
          ["الكمية", Number(c.quantity) !== 1 ? String(Number(c.quantity)) : null],
          [c.kind === "cash" ? "المبلغ" : "القيمة التقديرية", amount ? `${fmt(amount)} ر.س` : null],
          ["صُرفت من", doc.cash],
          ["قيد التسليم", c.isOpening ? "عهدة افتتاحية: رصيدها في القيد الافتتاحي" : doc.entry],
          ["تاريخ الإغلاق", c.closeDate],
          ["المُعاد", closed && c.kind === "cash" ? `${fmt(c.returnedAmount)} ر.س` : null],
          ["قيد الإغلاق", doc.closeEntry],
          ["ملاحظات", [c.notes, c.closeNotes].filter(Boolean).join(" · ") || null],
        ]}
      />
      {c.kind === "cash" && amount > 0 && <p className="mt-3 text-xs text-gray-600">{amountInWords(amount, "SAR")}</p>}
      <p className="mt-5 text-xs leading-relaxed text-gray-600">
        أقر أنا الموقع أدناه باستلام العهدة الموضحة أعلاه بحالة سليمة، وأتعهد بالمحافظة عليها واستخدامها لأغراض العمل فقط، وبإعادتها أو تسوية قيمتها بمستندات عند الطلب أو عند انتهاء خدمتي، وأتحمل قيمة ما يتلف أو يفقد منها بتقصير مني.
      </p>
    </Frame>
  );
}

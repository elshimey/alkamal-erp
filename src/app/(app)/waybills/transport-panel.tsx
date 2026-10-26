"use client";

import { useRef, useState } from "react";
import { RecordPanel, type PanelResult } from "@/components/record-panel";
import { WaybillDocument } from "@/components/waybill-document";
import type { CompanyProfile } from "@/lib/company";
import type { InvoiceTemplate } from "@/lib/invoice-template";
import type { TransportDraft } from "@/lib/transport-draft";
import { TransportFields } from "./transport-fields";

type Doc = Parameters<typeof WaybillDocument>[0]["doc"];

/** نافذة وثيقة النقل وحدها (للشحنة المعتمدة أو المفوترة أيضاً) ومعاينتها كما تُطبع. */
export function TransportPanel({
  doc,
  initial,
  cities,
  company,
  template,
  action,
  closeHref,
}: {
  doc: Doc;
  initial: TransportDraft;
  cities: string[];
  company: CompanyProfile;
  template: InvoiceTemplate;
  action: (data: FormData) => Promise<PanelResult>;
  closeHref: string;
}) {
  const [t, setT] = useState(initial);
  const box = useRef<HTMLDivElement>(null);
  const preview = {
    ...doc,
    w: {
      ...doc.w,
      ...Object.fromEntries(Object.entries(t).filter(([k]) => k !== "goods" && k !== "negotiable").map(([k, v]) => [k, v || null])),
      negotiable: t.negotiable,
      freightPayer: t.freightPayer,
      paymentMethod: t.paymentMethod,
      logistiStatus: t.logistiStatus,
    },
    goods: t.goods.filter((g) => g.description.trim()).map((g) => ({ ...g, quantity: g.quantity || null, weight: g.weight || null })),
  } as unknown as Doc;

  return (
    <RecordPanel title={`وثيقة النقل · ${doc.w.number}`} subtitle="بيانات وثيقة لوجستي: المرسل والمستلم والبضاعة وأجور النقل" closeHref={closeHref} action={action} creating={false} wide>
      <div ref={box} className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <TransportFields
            value={t}
            onChange={(v) => {
              setT(v);
              box.current?.dispatchEvent(new Event("input", { bubbles: true }));
            }}
            cities={cities}
            open
          />
        </div>
        <aside className="sticky top-0 hidden min-w-0 lg:block" aria-label="معاينة وثيقة النقل">
          <div className="mb-2 flex items-center gap-2 text-xs text-gray-500">
            <span className="size-2 animate-pulse rounded-full bg-green-500" />
            معاينة مباشرة كما ستُطبع الوثيقة
          </div>
          <div className="max-h-[calc(100vh-9rem)] overflow-y-auto rounded-2xl bg-gray-50 p-3">
            <WaybillDocument company={company} doc={preview} template={template} compact variant="transport" />
          </div>
        </aside>
      </div>
    </RecordPanel>
  );
}

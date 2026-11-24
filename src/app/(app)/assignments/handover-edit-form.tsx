"use client";

import { useState } from "react";
import type { QuickOption } from "@/lib/quick-add-types";
import type { CompanyProfile } from "@/lib/company";
import type { InvoiceTemplate } from "@/lib/invoice-template";
import { FUEL_LEVEL, HANDOVER_KIND, type FuelLevel } from "@/data/handovers";
import { FormCombo } from "@/components/form-combo";
import { DateInput } from "@/components/date-input";
import { PanelField, PanelSection, Segmented } from "@/components/panel-ui";
import { RecordPanel, type PanelResult } from "@/components/record-panel";
import { HandoverDocument, type HandoverDocData } from "@/components/handover-document";
import { Icon } from "@/components/icons";
import { Input } from "@/components/ui";
import { StatusSection, ToolsSection, handoverField, toLines, type HandoverLine } from "./handover-form";

/**
 * تعديل محضر، أو إنشاء محضر لإسناد سُجّل قبل المحاضر، ثم طباعته (طلب أحمد 2026-11-24).
 * النوع والمركبة ثابتان؛ التاريخ والعداد يُعدَّلان في الإسناد نفسه، والسائق المستلم قابل للتغيير.
 */
export function HandoverEditForm({
  action,
  closeHref,
  doc: initial,
  isNew,
  drivers,
  driverIds,
  itemNames,
  rep,
  company,
  template,
}: {
  action: (data: FormData) => Promise<PanelResult>;
  closeHref: string;
  /** المحضر الحالي، أو هيكله من الإسناد القديم (رقمه «HO-…») */
  doc: HandoverDocData;
  isNew: boolean;
  drivers: QuickOption[];
  driverIds: Record<string, string | null>;
  itemNames: string[];
  rep: string;
  company: CompanyProfile;
  template: InvoiceTemplate;
}) {
  const kind = initial.h.kind;
  const [driverId, setDriverId] = useState(initial.h.toDriverId ? String(initial.h.toDriverId) : "");
  const [date, setDate] = useState(initial.h.handoverDate);
  const [odometer, setOdometer] = useState(initial.h.odometer != null ? String(initial.h.odometer) : "");
  const [fuel, setFuel] = useState<FuelLevel | "">(initial.h.fuelLevel ?? "");
  const [condition, setCondition] = useState<"good" | "notes">(initial.h.condition ?? "good");
  const [companyRep, setCompanyRep] = useState(initial.h.companyRep ?? rep);
  const [notes, setNotes] = useState(initial.h.notes ?? "");
  const [lines, setLines] = useState<HandoverLine[]>(() => toLines(initial.items));
  const [preview, setPreview] = useState(true);

  const items = lines.filter((l) => l.name.trim());
  const toName = drivers.find((d) => d.value === driverId)?.label ?? initial.toName;
  const doc: HandoverDocData = {
    ...initial,
    h: {
      ...initial.h,
      handoverDate: date || initial.h.handoverDate,
      odometer: odometer ? Number(odometer) : null,
      fuelLevel: fuel || null,
      condition,
      companyRep: companyRep.trim() || null,
      notes: notes.trim() || null,
    },
    toName: kind === "return" ? null : toName,
    toId: kind === "return" ? null : (driverIds[driverId] ?? initial.toId),
    items: items.map((l, i) => ({ id: i, handoverId: initial.h.id, lineNo: i + 1, name: l.name.trim(), qty: Number(l.qty) || 1, condition: l.condition.trim() || null })),
  };

  return (
    <RecordPanel
      title={isNew ? `محضر لإسناد سابق: ${HANDOVER_KIND[kind].short}` : `تعديل المحضر ${initial.h.number}`}
      subtitle={`${HANDOVER_KIND[kind].title} · ${initial.plate}${isNew ? " · يُرقّم عند الحفظ" : ""}`}
      closeHref={closeHref}
      savedHref="/assignments?doc={id}"
      action={action}
      creating={false}
      wide
      toolbar={
        <button type="button" onClick={() => setPreview((p) => !p)} aria-label={preview ? "إخفاء المعاينة" : "إظهار المعاينة"} className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50">
          <Icon name="document" className="size-4" />
          <span className="hidden sm:inline">{preview ? "إخفاء المعاينة" : "إظهار المعاينة"}</span>
        </button>
      }
    >
      <input type="hidden" name="fuelLevel" value={fuel} />
      <input type="hidden" name="condition" value={condition} />
      <input type="hidden" name="items" value={JSON.stringify(items.map((l) => ({ name: l.name.trim(), qty: Number(l.qty) || 1, condition: l.condition.trim() || null })))} />
      <div className={`grid items-start gap-6 ${preview ? "xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]" : ""}`}>
        <div className="min-w-0">
          <PanelSection title="المركبة والسائق">
            <p className="rounded-xl bg-sky-50 px-4 py-2.5 text-sm text-sky-900">
              المركبة: <b>{initial.plate}</b>
              {initial.fromName && (
                <>
                  {" "}· السائق المسلِّم: <b>{initial.fromName}</b>
                </>
              )}
            </p>
            {kind !== "return" && (
              <PanelField label={kind === "transfer" ? "السائق الجديد (المستلم)" : "السائق المستلم"} required hint="تغييره يغيّر سائق الإسناد نفسه">
                <FormCombo key="drv" name="driverId" options={drivers} defaultValue={driverId} required onChange={setDriverId} placeholder="اكتب اسم السائق…" />
              </PanelField>
            )}
            <PanelField label="التاريخ" required hint="يُعدَّل في الإسناد أيضاً">
              <DateInput name="date" required value={date} onChange={(e) => setDate(e.target.value)} className={handoverField} />
            </PanelField>
            <PanelField label="قراءة العداد">
              <Input name="odometer" type="number" min={0} dir="ltr" value={odometer} onChange={(e) => setOdometer(e.target.value)} className="w-full" />
            </PanelField>
            <PanelField label="مستوى الوقود">
              <Segmented<FuelLevel | "">
                label="مستوى الوقود"
                value={fuel}
                onChange={setFuel}
                options={[{ value: "", label: "—" }, ...(Object.keys(FUEL_LEVEL) as FuelLevel[]).map((f) => ({ value: f, label: FUEL_LEVEL[f] }))]}
              />
            </PanelField>
          </PanelSection>
          <ToolsSection itemNames={itemNames} lines={lines} setLines={setLines} />
          <StatusSection condition={condition} setCondition={setCondition} companyRep={companyRep} setCompanyRep={setCompanyRep} notes={notes} setNotes={setNotes} />
        </div>
        {preview && (
          <div className="min-w-0 xl:sticky xl:top-4">
            <p className="mb-2 text-xs text-gray-500">معاينة المحضر كما يُطبع</p>
            <HandoverDocument company={company} doc={doc} template={template} compact />
          </div>
        )}
      </div>
    </RecordPanel>
  );
}

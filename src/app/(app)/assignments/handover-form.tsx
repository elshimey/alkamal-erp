"use client";

import { useEffect, useState } from "react";
import type { QuickOption } from "@/lib/quick-add-types";
import type { CompanyProfile } from "@/lib/company";
import type { InvoiceTemplate } from "@/lib/invoice-template";
import type { HandoverKind } from "@/db/schema";
import { CONDITION, FUEL_LEVEL, HANDOVER_KIND, type FuelLevel } from "@/data/handovers";
import { FormCombo } from "@/components/form-combo";
import { DateInput } from "@/components/date-input";
import { PanelField, PanelSection, Segmented } from "@/components/panel-ui";
import { RecordPanel, type PanelResult } from "@/components/record-panel";
import { HandoverDocument, type HandoverDocData } from "@/components/handover-document";
import { Icon } from "@/components/icons";
import { Input } from "@/components/ui";
import { assignmentWarnings } from "./actions";

export type HandoverVehicle = { id: number; plate: string; make: string | null; model: string | null; year: number | null; chassis: string | null; odometer: number };
export type OpenAssignment = { id: number; vehicleId: number; driverId: number; driver: string; fromDate: string; odometer: number; items: Item[] };
type Item = { name: string; qty: number; condition: string | null };
type Line = { key: number; name: string; qty: string; condition: string };

const field = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none";
let seq = 0;
const KIND_HINT: Record<HandoverKind, string> = { receive: "السائق يستلم مركبة غير مسندة", return: "السائق يعيد المركبة وتنتهي عهدته", transfer: "تنتقل العهدة من سائق لسائق ويوقع الاثنان" };
const toLines = (items: Item[]): Line[] => items.map((i) => ({ key: ++seq, name: i.name, qty: String(i.qty), condition: i.condition ?? "" }));

/**
 * نافذة محضر الاستلام والتسليم: النوع أولاً (يغيّر الخانات وصيغة الإقرار)، والمعاينة بجانبها كما تُطبع،
 * والعدد والأدوات بنوداً. التسليم يأتي بأدوات الاستلام جاهزة.
 */
export function HandoverForm({
  action,
  closeHref,
  initialKind,
  initialAssignment,
  vehicles,
  assignments,
  drivers,
  driverIds,
  itemNames,
  today,
  rep,
  canOverride,
  company,
  template,
}: {
  action: (data: FormData) => Promise<PanelResult>;
  closeHref: string;
  initialKind: HandoverKind;
  initialAssignment?: number;
  /** الرؤوس كلها (الحرة للاستلام، وبيانات المسندة للمعاينة) */
  vehicles: HandoverVehicle[];
  assignments: OpenAssignment[];
  /** السائقون الذين ليست معهم مركبة */
  drivers: QuickOption[];
  driverIds: Record<string, string | null>;
  itemNames: string[];
  today: string;
  rep: string;
  canOverride: boolean;
  company: CompanyProfile;
  template: InvoiceTemplate;
}) {
  const [kind, setKind] = useState<HandoverKind>(initialKind);
  const [vehicleId, setVehicleId] = useState("");
  const [assignmentId, setAssignmentId] = useState(initialAssignment ? String(initialAssignment) : "");
  const [driverId, setDriverId] = useState("");
  const [date, setDate] = useState(today);
  const [odometer, setOdometer] = useState("");
  const [fuel, setFuel] = useState<FuelLevel | "">("");
  const [condition, setCondition] = useState<"good" | "notes">("good");
  const [companyRep, setCompanyRep] = useState(rep);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>(() => toLines(assignments.find((a) => a.id === initialAssignment)?.items ?? []));
  const [warnings, setWarnings] = useState<string[]>([]);
  const [preview, setPreview] = useState(true);

  const busy = new Set(assignments.map((a) => a.vehicleId));
  const freeVehicles = vehicles.filter((v) => !busy.has(v.id));
  const asg = assignments.find((a) => String(a.id) === assignmentId);
  const vehicle = vehicles.find((v) => v.id === (kind === "receive" ? Number(vehicleId) : asg?.vehicleId));
  const driverName = drivers.find((d) => d.value === driverId)?.label ?? null;
  const lastOdo = kind === "receive" ? vehicle?.odometer : asg?.odometer;

  const pickKind = (k: HandoverKind) => {
    setKind(k);
    setWarnings([]);
    if (k === "receive") setLines([]);
    else setLines(toLines(asg?.items ?? []));
  };
  const pickAssignment = (v: string) => {
    setAssignmentId(v);
    setLines(toLines(assignments.find((a) => String(a.id) === v)?.items ?? []));
  };

  // الوثائق المانعة المنتهية للمركبة والسائق المستلم، قبل الحفظ
  const checkVehicle = kind === "receive" ? Number(vehicleId) || null : null;
  const checkDriver = kind === "return" ? null : Number(driverId) || null;
  useEffect(() => {
    let live = true;
    if (!checkVehicle && !checkDriver) return;
    assignmentWarnings(checkVehicle, checkDriver, date).then((w) => live && setWarnings(w));
    return () => {
      live = false;
    };
  }, [checkVehicle, checkDriver, date]);
  const shown = checkVehicle || checkDriver ? warnings : [];

  const items = lines.filter((l) => l.name.trim());
  const used = new Set(lines.map((l) => l.name.trim()));
  const setLine = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = (name = "") => setLines((ls) => [...ls, { key: ++seq, name, qty: "1", condition: "" }]);

  const doc: HandoverDocData = {
      h: {
        id: 0,
        number: "HO-…",
        kind,
        vehicleId: vehicle?.id ?? 0,
        fromDriverId: null,
        toDriverId: null,
        handoverDate: date || today,
        odometer: odometer ? Number(odometer) : (lastOdo ?? null),
        fuelLevel: fuel || null,
        condition,
        companyRep: companyRep.trim() || null,
        notes: notes.trim() || null,
        assignmentId: null,
        closedAssignmentId: null,
        createdBy: null,
        createdAt: new Date(0),
      },
      plate: vehicle?.plate ?? "……",
      make: vehicle?.make ?? null,
      model: vehicle?.model ?? null,
      year: vehicle?.year ?? null,
      chassis: vehicle?.chassis ?? null,
      fromName: kind === "receive" ? null : (asg?.driver ?? "……"),
      fromId: kind === "receive" || !asg ? null : (driverIds[String(asg.driverId)] ?? null),
      toName: kind === "return" ? null : (driverName ?? "……"),
      toId: kind === "return" ? null : (driverIds[driverId] ?? null),
      items: items.map((l, i) => ({ id: i, handoverId: 0, lineNo: i + 1, name: l.name.trim(), qty: Number(l.qty) || 1, condition: l.condition.trim() || null })),
  };

  const assignedOpts: QuickOption[] = assignments.map((a) => ({ value: String(a.id), label: `${vehicles.find((v) => v.id === a.vehicleId)?.plate ?? ""} · ${a.driver}` }));

  return (
    <RecordPanel
      title={HANDOVER_KIND[kind].title}
      subtitle="يُرقّم عند الحفظ، ثم يُطبع ليوقّع عليه السائق"
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
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="fuelLevel" value={fuel} />
      <input type="hidden" name="condition" value={condition} />
      <input type="hidden" name="items" value={JSON.stringify(items.map((l) => ({ name: l.name.trim(), qty: Number(l.qty) || 1, condition: l.condition.trim() || null })))} />
      <div className={`grid items-start gap-6 ${preview ? "xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]" : ""}`}>
        <div className="min-w-0">
          <PanelSection title="نوع المحضر">
            <div role="radiogroup" aria-label="نوع المحضر" className="grid gap-2 @lg:grid-cols-3">
              {(Object.keys(HANDOVER_KIND) as HandoverKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={kind === k}
                  onClick={() => pickKind(k)}
                  className={`flex flex-col gap-0.5 rounded-xl border-2 px-3 py-2.5 text-start transition-colors ${kind === k ? "border-brand-500 bg-brand-50 shadow-sm" : "border-gray-200 bg-white hover:border-gray-300"}`}
                >
                  <span className="font-display text-sm font-semibold text-gray-900">{HANDOVER_KIND[k].short}</span>
                  <span className="text-xs text-gray-500">{KIND_HINT[k]}</span>
                </button>
              ))}
            </div>
          </PanelSection>

          <PanelSection title="المركبة والسائق">
            {kind === "receive" ? (
              <PanelField label="المركبة" required hint="الرؤوس غير المسندة فقط، أو أضف مركبة جديدة من القائمة">
                <FormCombo key="veh" name="vehicleId" options={freeVehicles.map((v) => ({ value: String(v.id), label: v.plate }))} create="vehicle" required onChange={setVehicleId} placeholder="اكتب اللوحة…" />
              </PanelField>
            ) : (
              <>
                <PanelField label="المركبة" required hint="المركبات المسندة حالياً">
                  <FormCombo key="asg" name="assignmentId" options={assignedOpts} defaultValue={assignmentId} required onChange={pickAssignment} placeholder="اكتب اللوحة أو السائق…" />
                </PanelField>
                {asg && (
                  <p className="rounded-xl bg-sky-50 px-4 py-2.5 text-sm text-sky-900">
                    السائق الحالي (المسلِّم): <b>{asg.driver}</b> · منذ {asg.fromDate.split("-").reverse().join("/")}
                  </p>
                )}
              </>
            )}
            {kind !== "return" && (
              <PanelField label={kind === "transfer" ? "السائق الجديد (المستلم)" : "السائق المستلم"} required hint="السائقون الذين ليست معهم مركبة، أو أضف سائقاً جديداً">
                <FormCombo key={`drv-${kind}`} name="driverId" options={drivers} create="driver" required onChange={setDriverId} placeholder="اكتب اسم السائق…" />
              </PanelField>
            )}
            <PanelField label="التاريخ" required>
              <DateInput name="date" required value={date} min={kind === "receive" ? undefined : asg?.fromDate} onChange={(e) => setDate(e.target.value)} className={field} />
            </PanelField>
            <PanelField label="قراءة العداد" hint={lastOdo != null ? `آخر قراءة مسجلة ${lastOdo.toLocaleString("en")}` : "فارغ = آخر قراءة مسجلة"}>
              <Input name="odometer" type="number" min={lastOdo ?? 0} dir="ltr" value={odometer} placeholder={lastOdo != null ? String(lastOdo) : ""} onChange={(e) => setOdometer(e.target.value)} className="w-full" />
            </PanelField>
            <PanelField label="مستوى الوقود">
              <Segmented<FuelLevel | "">
                label="مستوى الوقود"
                value={fuel}
                onChange={setFuel}
                options={[{ value: "", label: "—" }, ...(Object.keys(FUEL_LEVEL) as FuelLevel[]).map((f) => ({ value: f, label: FUEL_LEVEL[f] }))]}
              />
            </PanelField>
            {shown.length > 0 && (
              <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                <p className="font-semibold">وثائق مانعة منتهية:</p>
                <ul className="mt-1 list-disc ps-5">
                  {shown.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
                <p className="mt-2 text-xs">{canOverride ? "جدّد الوثيقة، أو اكتب سبب التجاوز أدناه ليُسمح بالاستلام." : "جدّد الوثيقة أولاً؛ الاستلام لن يُحفظ إلا بتجاوز من مستخدم يملك صلاحية تجاوز الضوابط."}</p>
              </div>
            )}
            {canOverride && shown.length > 0 && (
              <PanelField label="سبب التجاوز" required>
                <Input name="overrideReason" className="w-full" />
              </PanelField>
            )}
          </PanelSection>

          <PanelSection title="العدد والأدوات" optional open hint="ما يُسلَّم مع المركبة">
            <div className="flex flex-wrap gap-1.5">
              {itemNames
                .filter((n) => !used.has(n))
                .slice(0, 12)
                .map((n) => (
                  <button key={n} type="button" onClick={() => addLine(n)} className="rounded-full border border-dashed border-gray-300 bg-gray-50 px-3 py-1 text-xs text-gray-700 hover:border-brand-500 hover:bg-brand-50">
                    + {n}
                  </button>
                ))}
            </div>
            {lines.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-[minmax(0,1.6fr)_4.5rem_minmax(0,1fr)_2rem] gap-2 text-xs font-medium text-gray-500 max-sm:grid-cols-[minmax(0,1fr)_4rem_2rem]">
                  <span>الصنف</span>
                  <span>العدد</span>
                  <span className="max-sm:hidden">الحالة / الرقم التسلسلي</span>
                  <span />
                </div>
                {lines.map((l) => (
                  <div key={l.key} className="line-in grid grid-cols-[minmax(0,1.6fr)_4.5rem_minmax(0,1fr)_2rem] items-center gap-2 max-sm:grid-cols-[minmax(0,1fr)_4rem_2rem]">
                    <input aria-label="الصنف" list="handover-items" value={l.name} onChange={(e) => setLine(l.key, { name: e.target.value })} className={field} />
                    <input aria-label="العدد" type="number" min={1} dir="ltr" value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} className={field} />
                    <input aria-label="الحالة" placeholder="جيد" value={l.condition} onChange={(e) => setLine(l.key, { condition: e.target.value })} className={`${field} max-sm:col-span-2`} />
                    <button type="button" aria-label="حذف الصنف" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="rounded-lg p-1.5 text-gray-500 hover:bg-red-50 hover:text-red-700 max-sm:row-start-1 max-sm:col-start-3">
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <datalist id="handover-items">
              {itemNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            <button type="button" onClick={() => addLine()} className="rounded-xl border border-dashed border-gray-300 py-2 text-sm font-semibold text-brand-800 hover:bg-brand-50">
              + إضافة صنف
            </button>
          </PanelSection>

          <PanelSection title="الحالة والملاحظات" optional open>
            <PanelField label="الحالة العامة">
              <Segmented label="الحالة العامة" value={condition} onChange={setCondition} options={(Object.keys(CONDITION) as ("good" | "notes")[]).map((c) => ({ value: c, label: CONDITION[c] }))} />
            </PanelField>
            <PanelField label="مندوب الشركة" hint="يوقّع على المحضر">
              <Input name="companyRep" value={companyRep} onChange={(e) => setCompanyRep(e.target.value)} className="w-full" />
            </PanelField>
            <PanelField label="ملاحظات">
              <textarea name="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="خدوش، حالة الإطارات…" className={field} />
            </PanelField>
          </PanelSection>
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

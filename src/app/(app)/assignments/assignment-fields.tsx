"use client";

import { useEffect, useState } from "react";
import type { QuickOption } from "@/lib/quick-add-types";
import { FormCombo } from "@/components/form-combo";
import { PanelField } from "@/components/panel-ui";
import { Input } from "@/components/ui";
import { assignmentWarnings } from "./actions";

/**
 * حقول الاستلام: المركبة والسائق والتاريخ، مع تحذير فوري إن كانت لهما وثيقة مانعة منتهية.
 * handover: تسليم المركبة لسائق آخر؛ المركبة ثابتة، والتاريخ والعداد للتسليم والاستلام معاً.
 */
export function AssignmentFields({
  vehicles,
  drivers,
  odometers,
  today,
  canOverride,
  handover,
}: {
  vehicles: QuickOption[];
  drivers: QuickOption[];
  odometers: Record<string, number>;
  today: string;
  canOverride: boolean;
  handover?: { vehicleId: number; minDate: string };
}) {
  const [vehicle, setVehicle] = useState(handover ? String(handover.vehicleId) : "");
  const [driver, setDriver] = useState("");
  const [date, setDate] = useState(today);
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    if (!vehicle && !driver) return;
    assignmentWarnings(Number(vehicle) || null, Number(driver) || null, date).then((w) => live && setWarnings(w));
    return () => {
      live = false;
    };
  }, [vehicle, driver, date]);

  const odo = vehicle ? odometers[vehicle] : undefined;
  const shown = vehicle || driver ? warnings : [];
  return (
    <div className="flex flex-col gap-3">
      {!handover && (
        <PanelField label="المركبة" required hint="الرؤوس غير المسندة فقط، أو أضف مركبة جديدة من القائمة">
          <FormCombo name="vehicleId" options={vehicles} create="vehicle" required onChange={setVehicle} placeholder="اكتب اللوحة…" />
        </PanelField>
      )}
      <PanelField label={handover ? "السائق الجديد" : "السائق"} required hint="السائقون الذين ليست معهم مركبة، أو أضف سائقاً جديداً من القائمة">
        <FormCombo name="driverId" options={drivers} create="driver" required onChange={setDriver} placeholder="اكتب اسم السائق…" />
      </PanelField>
      <PanelField label={handover ? "تاريخ التسليم والاستلام" : "تاريخ الاستلام"} required>
        <Input type="date" name="fromDate" defaultValue={today} min={handover?.minDate} required className="w-full" onChange={(e) => setDate(e.target.value)} />
      </PanelField>
      <PanelField label={handover ? "قراءة العداد عند التسليم" : "قراءة العداد"} hint={odo != null ? `آخر قراءة مسجلة ${odo.toLocaleString("en")}` : "فارغ = آخر قراءة مسجلة"}>
        <Input name="odometerStart" type="number" min={odo ?? 0} dir="ltr" placeholder={odo != null ? String(odo) : ""} className="w-full" />
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
    </div>
  );
}

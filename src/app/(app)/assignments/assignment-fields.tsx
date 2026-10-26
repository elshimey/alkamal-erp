"use client";

import { useEffect, useState } from "react";
import type { QuickOption } from "@/lib/quick-add-types";
import { FormCombo } from "@/components/form-combo";
import { PanelField } from "@/components/panel-ui";
import { Input } from "@/components/ui";
import { assignmentWarnings } from "./actions";

/** حقول الاستلام: المركبة والسائق والتاريخ، مع تحذير فوري إن كانت لهما وثيقة مانعة منتهية. */
export function AssignmentFields({
  vehicles,
  drivers,
  odometers,
  today,
  canOverride,
}: {
  vehicles: QuickOption[];
  drivers: QuickOption[];
  odometers: Record<string, number>;
  today: string;
  canOverride: boolean;
}) {
  const [vehicle, setVehicle] = useState("");
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
      <PanelField label="المركبة" required hint="الرؤوس غير المسندة فقط">
        <FormCombo name="vehicleId" options={vehicles} required onChange={setVehicle} placeholder="اكتب اللوحة…" />
      </PanelField>
      <PanelField label="السائق" required hint="السائقون غير المسندين فقط">
        <FormCombo name="driverId" options={drivers} required onChange={setDriver} placeholder="اكتب اسم السائق…" />
      </PanelField>
      <PanelField label="تاريخ الاستلام" required>
        <Input type="date" name="fromDate" defaultValue={today} required className="w-full" onChange={(e) => setDate(e.target.value)} />
      </PanelField>
      <PanelField label="قراءة العداد" hint={odo != null ? `آخر قراءة مسجلة ${odo.toLocaleString("en")}` : "فارغ = آخر قراءة مسجلة"}>
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

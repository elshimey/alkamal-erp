"use client";

import { useState } from "react";
import { Input } from "@/components/ui";
import { LinesEditor, type LineColumn } from "@/components/lines-editor";
import { PanelField } from "@/components/panel-ui";

type Opt = { value: string; label: string };
const plus30 = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 30);
  return d.toISOString().slice(0, 10);
};

/** تاريخ الفاتورة واستحقاقها: الاستحقاق يتبع التاريخ بعد 30 يوماً حتى يغيّره المستخدم. */
export function PurchaseDates({ today }: { today: string }) {
  const [date, setDate] = useState(today);
  const [due, setDue] = useState(plus30(today));
  const [touched, setTouched] = useState(false);
  return (
    <>
      <PanelField label="تاريخ الفاتورة" required>
        <Input
          type="date"
          name="date"
          value={date}
          required
          className="w-full"
          onChange={(e) => {
            setDate(e.target.value);
            if (!touched && e.target.value) setDue(plus30(e.target.value));
          }}
        />
      </PanelField>
      <PanelField label="تاريخ الاستحقاق" required hint="يُملأ بعد 30 يوماً من التاريخ، ويمكن تغييره">
        <Input
          type="date"
          name="dueDate"
          value={due}
          required
          className="w-full"
          onChange={(e) => {
            setDue(e.target.value);
            setTouched(true);
          }}
        />
      </PanelField>
    </>
  );
}

/** بنود فاتورة المورد بطاقات: الصنف أو الحساب، المركبة، البيان، المبلغ ونوع الضريبة، والمجاميع مباشرة. */
export function PurchaseLines({
  products,
  warehouses,
  accounts,
  vehicles,
  taxes,
}: {
  products: Opt[];
  warehouses: Opt[];
  accounts: Opt[];
  vehicles: Opt[];
  taxes: (Opt & { rate: number; reverse: boolean })[];
}) {
  const base = taxes.find((t) => t.rate === 15 && !t.reverse) ?? taxes[0];
  const columns: LineColumn[] = [
    { key: "productId", label: "الصنف", type: "select", options: products, create: "product", placeholder: "اختياري", wide: true, defaultValue: "" },
    { key: "warehouseId", label: "المستودع", type: "select", options: warehouses, placeholder: "للصنف المخزني" },
    { key: "quantity", label: "الكمية", type: "number" },
    { key: "accountId", label: "الحساب", type: "select", options: accounts, create: "account", placeholder: "حساب الصنف", wide: true, defaultValue: "" },
    { key: "vehicleId", label: "المركبة", type: "select", options: vehicles, create: "vehicle", placeholder: "اللوحة…", wide: true, defaultValue: "" },
    { key: "description", label: "البيان", wide: true },
    { key: "amount", label: "المبلغ قبل الضريبة", type: "number", required: true },
    { key: "vat", label: "نوع الضريبة", type: "select", options: taxes, defaultValue: base?.value, wide: true },
  ];
  const rates = new Map(taxes.map((t) => [t.value, t.reverse ? 0 : t.rate]));
  return (
    <LinesEditor
      columns={columns}
      minRows={1}
      layout="cards"
      addLabel="+ إضافة بند"
      totals={{ price: "amount", vat: "vat" }}
      vatRateOf={(r) => rates.get(r.vat ?? "") ?? 0}
    />
  );
}

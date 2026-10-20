import { Field, Input, Select } from "@/components/ui";
import type * as s from "@/db/schema";

type Product = typeof s.products.$inferSelect;
type Opt = { id: number; code: string; nameAr: string };

/** حقول نموذج الصنف (الإضافة والتعديل). */
export function ProductFields({ p, stockAccounts, serviceAccounts, categories }: { p?: Product; stockAccounts: Opt[]; serviceAccounts: Opt[]; categories: string[] }) {
  return (
    <>
      <Field label="النوع">
        <Select name="kind" defaultValue={p?.kind ?? "stock"}>
          <option value="stock">صنف مخزني</option>
          <option value="service">خدمة</option>
        </Select>
      </Field>
      <Field label="اسم الصنف">
        <Input name="nameAr" required defaultValue={p?.nameAr} placeholder="مثل: فلتر زيت مرسيدس" />
      </Field>
      <Field label="الرمز (SKU)" hint="فارغ = يُولّد تلقائياً">
        <Input name="code" defaultValue={p?.code} dir="ltr" />
      </Field>
      <Field label="الفئة">
        <Input name="category" defaultValue={p?.category ?? ""} list="product-categories" placeholder="زيوت، فلاتر، إطارات…" />
        <datalist id="product-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </Field>
      <Field label="الوحدة">
        <Input name="unit" defaultValue={p?.unit ?? "حبة"} />
      </Field>
      <Field label="سعر الشراء">
        <Input name="purchasePrice" inputMode="decimal" defaultValue={p ? Number(p.purchasePrice) || "" : ""} placeholder="0.00" />
      </Field>
      <Field label="سعر البيع">
        <Input name="salePrice" inputMode="decimal" defaultValue={p ? Number(p.salePrice) || "" : ""} placeholder="0.00" />
      </Field>
      <Field label="حد إعادة الطلب" hint="تنبيه عند نزول الرصيد إليه">
        <Input name="reorderLevel" inputMode="decimal" defaultValue={p ? Number(p.reorderLevel) || "" : ""} placeholder="0" />
      </Field>
      <Field label="الحساب" hint="المخزني: حساب المخزون؛ الخدمة: حساب مصروفها">
        <Select name="accountId" defaultValue={p?.accountId ?? ""}>
          <option value="">الافتراضي</option>
          <optgroup label="حسابات المخزون">
            {stockAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} {a.nameAr}
              </option>
            ))}
          </optgroup>
          <optgroup label="حسابات الخدمات">
            {serviceAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} {a.nameAr}
              </option>
            ))}
          </optgroup>
        </Select>
      </Field>
      <Field label="الباركود">
        <Input name="barcode" defaultValue={p?.barcode ?? ""} dir="ltr" />
      </Field>
      <Field label="ملاحظات">
        <Input name="notes" defaultValue={p?.notes ?? ""} />
      </Field>
    </>
  );
}

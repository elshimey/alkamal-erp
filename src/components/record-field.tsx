import { resolveOptions, type FieldDef } from "@/lib/records";
import { PasswordInput } from "@/components/password-input";
import { Field, Input, Select } from "@/components/ui";
import { PanelField } from "@/components/panel-ui";
import { FormCombo } from "@/components/form-combo";

const str = (v: unknown) => (v == null ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v));

/** حقل نموذج من تعريف الكيان. row: تخطيط وافق (العنوان بجانب الحقل)، وإلا العنوان فوقه. */
export async function FieldInput({ f, value, disabled = false, row = false }: { f: FieldDef; value: unknown; disabled?: boolean; row?: boolean }) {
  if (f.type === "bool")
    return (
      <label className={`flex items-center gap-2 text-sm font-medium text-gray-700 ${row ? "" : "pt-7"}`}>
        <input type="checkbox" name={f.key} defaultChecked={!!value} disabled={disabled} className="size-4" />
        {f.label}
      </label>
    );
  if (f.type === "multi") {
    const opts = await resolveOptions(f);
    const chosen = new Set((value as string[] | undefined) ?? []);
    return (
      <fieldset className="col-span-full">
        <legend className="mb-2 text-sm font-medium text-gray-700">{f.label}</legend>
        <div className="flex flex-wrap gap-4">
          {opts.map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name={f.key} value={o.value} defaultChecked={chosen.has(o.value)} disabled={disabled} className="size-4" />
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  let input;
  if (f.type === "select" && (f.create || f.custom) && !disabled) {
    // قائمة بحث مع «+ إضافة» (نوع جديد، حساب جديد…)
    input = <FormCombo name={f.key} options={await resolveOptions(f)} defaultValue={str(value)} create={f.create} scope={f.scope} required={f.required} placeholder="اختر أو أضف…" />;
  } else if (f.type === "select") {
    const opts = await resolveOptions(f);
    input = (
      <Select name={f.key} defaultValue={str(value)} required={f.required} disabled={disabled}>
        {!f.required && <option value="">—</option>}
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    );
  } else if (f.type === "textarea") {
    input = (
      <textarea name={f.key} defaultValue={str(value)} rows={2} disabled={disabled} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
    );
  } else if (f.type === "password") {
    input = <PasswordInput name={f.key} dir="ltr" autoComplete="new-password" disabled={disabled} />;
  } else {
    input = (
      <Input
        name={f.key}
        type={f.type === "date" ? "date" : "text"}
        inputMode={f.type === "number" ? "decimal" : undefined}
        defaultValue={str(value)}
        required={f.required}
        dir={f.ltr || f.type === "number" ? "ltr" : undefined}
        disabled={disabled}
      />
    );
  }
  if (row) return <PanelField label={f.label} required={f.required} hint={f.hint}>{input}</PanelField>;
  return (
    <Field label={f.label} hint={f.hint}>
      {input}
    </Field>
  );
}


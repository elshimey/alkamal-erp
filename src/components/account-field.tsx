"use client";

import type { QuickOption } from "@/lib/quick-add-types";
import { FormCombo } from "./form-combo";

/**
 * خانة الحساب الموحدة في كل البرنامج: الحسابات مجمّعة تحت حسابها الأب (العنوان عريض والحسابات تحته)،
 * الاسم ورقمه بجانبه، بحث بالاسم أو الرقم، و«+ إضافة» يفتح حساباً جديداً مع اختيار الأب.
 * الخيارات من toAccountOptions أو accountOptions في الخادم. scope رموز الآباء المقترحين للإضافة (مثل "1101,1102").
 */
export function AccountField({
  name,
  options,
  defaultValue = "",
  required,
  scope,
  placeholder = "ابحث باسم الحساب أو رقمه…",
  onChange,
  className = "",
  keepOnReset,
  moreOptions,
}: {
  name: string;
  options: QuickOption[];
  defaultValue?: string | number | null;
  required?: boolean;
  scope?: string;
  placeholder?: string;
  onChange?: (value: string) => void;
  className?: string;
  /** تبقى بعد الحفظ وتفريغ النموذج */
  keepOnReset?: boolean;
  /** باقي الشجرة: بند «عرض كل الشجرة» داخل القائمة يضيفها بعد الخيارات المقترحة (السداد من أي حساب) */
  moreOptions?: QuickOption[];
}) {
  return (
    <div className={className}>
      <FormCombo name={name} options={options} moreOptions={moreOptions} defaultValue={defaultValue == null ? "" : String(defaultValue)} create="account" scope={scope} required={required} placeholder={placeholder} onChange={onChange} keepOnReset={keepOnReset} />
    </div>
  );
}

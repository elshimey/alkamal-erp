import { toAccountOptions } from "@/lib/lookups";
import { AccountField } from "./account-field";

type Account = { id: number; code: string; nameAr: string; currencyCode?: string | null };

/**
 * اختيار الحساب الذي يُصرف منه المبلغ (عهدة الرحلة، سداد المخالفات…) بمنتقي الحسابات الموحد:
 * الصناديق والبنوك والعهد مجمّعة تحت حسابها الأب، والصندوق الأول مختار مسبقاً، و«+ إضافة» يضيف حساباً جديداً.
 */
export async function CashAccountField({
  options,
  name = "cashAccountId",
  label = "تُصرف عهدة الرحلة من",
  deferrable = false,
}: {
  options: Account[];
  name?: string;
  label?: string;
  /** خيار «لم تُصرف بعد»: تُصرف لاحقاً من «سندات صرف تحت المراجعة» */
  deferrable?: boolean;
}) {
  const first = options.find((a) => a.code.startsWith("1101")) ?? options[0];
  return (
    <div className="text-sm">
      <span className="mb-1.5 block font-medium text-gray-700">{label}</span>
      <AccountField name={name} options={await toAccountOptions(options)} defaultValue={first?.id} scope="1101,1102,1105" required />
      {deferrable && (
        <label className="mt-2 flex items-center gap-2 text-gray-700">
          <input type="checkbox" name="deferCustody" value="1" className="size-4 accent-brand-600" />
          لم تُصرف بعد (تُصرف لاحقاً من «سندات صرف تحت المراجعة»)
        </label>
      )}
    </div>
  );
}

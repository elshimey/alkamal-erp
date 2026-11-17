import { toAccountOptions } from "@/lib/lookups";
import { AccountField } from "./account-field";

type Account = { id: number; code: string; nameAr: string; currencyCode?: string | null };

/**
 * اختيار الحساب الذي يُصرف منه المبلغ (عهدة الرحلة، سداد المخالفات…) بمنتقي الحسابات الموحد:
 * الصناديق والبنوك والعهد مجمّعة تحت حسابها الأب، والصندوق الأول مختار مسبقاً، و«+ إضافة» يضيف حساباً جديداً.
 */
export async function CashAccountField({ options, name = "cashAccountId", label = "تُصرف عهدة الرحلة من" }: { options: Account[]; name?: string; label?: string }) {
  const first = options.find((a) => a.code.startsWith("1101")) ?? options[0];
  return (
    <div className="text-sm">
      <span className="mb-1.5 block font-medium text-gray-700">{label}</span>
      <AccountField name={name} options={await toAccountOptions(options)} defaultValue={first?.id} scope="1101,1102,1105" required />
    </div>
  );
}

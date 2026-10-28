/** اختيار الصندوق أو البنك الذي تُصرف منه عهدة الرحلة عند الإرسال للسائق. */
export function CashAccountField({ options }: { options: { id: number; code: string; nameAr: string }[] }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-gray-600">تُصرف عهدة الرحلة من</span>
      <select name="cashAccountId" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" defaultValue={options[0]?.id}>
        {options.map((a) => (
          <option key={a.id} value={a.id}>
            {a.code} · {a.nameAr}
          </option>
        ))}
      </select>
    </label>
  );
}

/** اختيار الحساب الذي تُصرف منه عهدة الرحلة عند الإرسال للسائق: صندوق أو بنك أو أي حساب تفصيلي في الدليل. */
export function CashAccountField({ options }: { options: { id: number; code: string; nameAr: string }[] }) {
  const cash = options.filter((a) => /^110[12]/.test(a.code));
  const other = options.filter((a) => !/^110[12]/.test(a.code));
  const row = (a: { id: number; code: string; nameAr: string }) => (
    <option key={a.id} value={a.id}>
      {a.code} · {a.nameAr}
    </option>
  );
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-gray-600">تُصرف عهدة الرحلة من</span>
      <select name="cashAccountId" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" defaultValue={options[0]?.id}>
        <optgroup label="الصناديق والبنوك">{cash.map(row)}</optgroup>
        <optgroup label="حسابات أخرى من الدليل (خزينة فرعية، عهدة موظف…)">{other.map(row)}</optgroup>
      </select>
    </label>
  );
}

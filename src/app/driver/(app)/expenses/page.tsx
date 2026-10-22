import { db } from "@/db";
import { getDriverContext } from "@/lib/driver-auth";
import { driverExpenses } from "@/lib/driver-app";
import { todayRiyadh } from "@/lib/dates";
import { DRIVER_EXPENSE_ACCOUNTS, type DriverExpenseType } from "@/data/driver-i18n";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { expenseAction } from "../../actions";
import { DField, DInput, fmt, Pill, Section } from "../../driver-ui";

const TONE = { pending: "amber", approved: "green", rejected: "red" } as const;

export default async function DriverExpenses() {
  const { driver, t } = await getDriverContext();
  if (!driver) return null;
  const rows = await driverExpenses(db, driver.id);
  const types = Object.keys(DRIVER_EXPENSE_ACCOUNTS) as DriverExpenseType[];

  return (
    <>
      <Section title={t.addExpense}>
        <ActionForm action={expenseAction} className="flex flex-col gap-3">
          <DField label={t.expenseType}>
            <div className="grid grid-cols-2 gap-2">
              {types.map((k, i) => (
                <label key={k} className="cursor-pointer">
                  <input type="radio" name="type" value={k} defaultChecked={i === 0} className="peer sr-only" />
                  <span className="block rounded-xl border border-gray-300 px-3 py-2.5 text-center text-sm font-medium peer-checked:border-asphalt-900 peer-checked:bg-asphalt-900 peer-checked:text-brand-500">
                    {t.expenseTypes[k]}
                  </span>
                </label>
              ))}
            </div>
          </DField>
          <div className="grid grid-cols-2 gap-3">
            <DField label={`${t.amount} (${t.sar})`}>
              <DInput name="amount" inputMode="decimal" dir="ltr" required />
            </DField>
            <DField label={t.vat} hint={t.optional}>
              <DInput name="vatAmount" inputMode="decimal" dir="ltr" />
            </DField>
          </div>
          <DField label={t.description} hint={t.optional}>
            <DInput name="description" />
          </DField>
          <div className="grid grid-cols-2 gap-3">
            <DField label={t.vendor} hint={t.optional}>
              <DInput name="vendorName" />
            </DField>
            <DField label={t.date}>
              <DInput name="date" type="date" defaultValue={todayRiyadh()} dir="ltr" />
            </DField>
          </div>
          <SubmitButton pendingLabel={t.saving} className="w-full py-3 text-base">
            {t.save}
          </SubmitButton>
        </ActionForm>
      </Section>

      <Section title={t.expensesTitle}>
        {rows.length === 0 && <p className="text-sm text-gray-400">{t.nothing}</p>}
        <ul className="divide-y divide-gray-100">
          {rows.map(({ e }) => (
            <li key={e.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{e.description}</div>
                <div className="text-xs text-gray-400"><span className="ltr-nums">
                  {e.expenseDate} · {e.number}
                </span></div>
                {e.status === "rejected" && e.rejectReason && <div className="text-xs text-red-600">{e.rejectReason}</div>}
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="ltr-nums text-sm font-semibold">{fmt(Number(e.amount) + Number(e.vatAmount))}</span>
                <Pill tone={TONE[e.status]}>{t.expenseStatus[e.status]}</Pill>
              </div>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

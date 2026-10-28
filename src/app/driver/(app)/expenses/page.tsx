import Link from "next/link";
import { db } from "@/db";
import { getDriverContext } from "@/lib/driver-auth";
import { driverExpenses, driverTrips, maintenanceTypeOptions, ownTrip, tripCustodySummary } from "@/lib/driver-app";
import { listAttachments } from "@/lib/attachments";
import { DRIVER_EXPENSE_ACCOUNTS, type DriverExpenseType } from "@/data/driver-i18n";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { DriverForm, PhotoInput } from "../../offline";
import { editExpenseAction, voidExpenseAction } from "../../actions";
import { ExpenseFields } from "../../expense-fields";
import { CustodyBox, DField, DInput, fmt, Pill, Section } from "../../driver-ui";

const TONE = { pending: "amber", approved: "green", rejected: "red", voided: "gray" } as const;
const TYPES = Object.keys(DRIVER_EXPENSE_ACCOUNTS) as DriverExpenseType[];

export default async function DriverExpenses({ searchParams }: { searchParams: Promise<{ trip?: string }> }) {
  const { driver, t, lang } = await getDriverContext();
  if (!driver) return null;
  const tripId = Number((await searchParams).trip) || null;
  const trip = tripId ? await ownTrip(db, driver.id, tripId).catch(() => null) : null;
  const [rows, open, types, [box]] = await Promise.all([
    driverExpenses(db, driver.id, trip?.id),
    driverTrips(db, driver.id, { open: true, limit: 30 }),
    maintenanceTypeOptions(db),
    trip ? tripCustodySummary(db, driver.id, [trip.id]) : Promise.resolve([]),
  ]);
  const photos = await listAttachments(db, "expenses", rows.map((r) => r.e.id));
  const photoOf = new Map<number, number>();
  for (const a of photos) if (!photoOf.has(a.entityId)) photoOf.set(a.entityId, a.id);
  const maintenance = types.map((m) => ({ value: m.id, label: lang === "ar" ? m.nameAr : (m.nameEn ?? m.nameAr) }));
  // الرحلات المفتوحة، والرحلة المختارة حتى لو أُغلقت
  const trips = open.map((w) => ({ value: w.id, label: `${w.number} · ${w.from} – ${w.to}` }));
  if (trip && !trips.some((w) => w.value === trip.id)) trips.unshift({ value: trip.id, label: trip.number });
  const describe = (r: (typeof rows)[number]) => {
    const kind = r.e.driverKind as DriverExpenseType | null;
    const name = kind && kind in t.expenseTypes ? t.expenseTypes[kind] : r.e.description;
    const m = r.maintenance ? (lang === "ar" ? r.maintenance : (r.maintenanceEn ?? r.maintenance)) : null;
    return [name, m].filter(Boolean).join(" · ");
  };

  return (
    <>
      {trip && (
        <>
          <Link href={`/driver/trips/${trip.id}`} className="mb-3 inline-block text-sm text-brand-700">
            ← {t.back}
          </Link>
          <Section title={`${t.x.tripExpenses} · ${trip.number}`}>{box && <CustodyBox t={t} box={box} />}</Section>
        </>
      )}

      <Section title={trip ? t.x.addForTrip : t.addExpense}>
        <DriverForm actionKey="expense" savedOffline={t.savedOffline} className="flex flex-col gap-3">
          <ExpenseFields t={t} types={TYPES} maintenance={maintenance} trips={trips} defaults={{ waybillId: trip?.id ?? null }} idPrefix="new" />
          <PhotoInput label={t.x.receiptRequired} required />
          <SubmitButton pendingLabel={t.saving} className="w-full py-3 text-base">
            {t.save}
          </SubmitButton>
        </DriverForm>
      </Section>

      <Section title={trip ? t.x.tripExpenses : t.expensesTitle}>
        {rows.length === 0 && <p className="text-sm text-gray-400">{t.nothing}</p>}
        <ul className="divide-y divide-gray-100">
          {rows.map((r) => {
            const { e } = r;
            const total = Number(e.amount) + Number(e.vatAmount);
            const editable = e.status === "pending" && !!e.driverKind;
            return (
              <li key={e.id} className={`py-3 ${e.status === "voided" ? "opacity-60" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className={`text-sm font-medium ${e.status === "voided" ? "line-through" : ""}`}>
                      {describe(r)}
                      {photoOf.has(e.id) && (
                        <a href={`/driver/files/${photoOf.get(e.id)}`} target="_blank" rel="noreferrer" className="ms-1" aria-label={t.photos}>
                          📷
                        </a>
                      )}
                    </div>
                    <div className="text-xs text-gray-400">
                      <span className="ltr-nums">
                        {e.expenseDate} · {e.number}
                        {r.trip && !trip ? ` · ${r.trip}` : ""}
                      </span>
                    </div>
                    {(e.payer === "cash" || e.reportedPayer === "company") && <div className="text-xs text-sky-700">{t.x.companyPaid}</div>}
                    {e.status === "rejected" && e.rejectReason && <div className="text-xs text-red-600">{e.rejectReason}</div>}
                    {e.status === "voided" && e.voidReason && <div className="text-xs text-gray-500">{e.voidReason}</div>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="ltr-nums text-sm font-semibold">{fmt(total)}</span>
                    <Pill tone={TONE[e.status]}>{t.expenseStatus[e.status]}</Pill>
                  </div>
                </div>
                {editable && (
                  <div className="mt-2 flex flex-col gap-2">
                    <details className="rounded-xl border border-gray-200 px-3 py-2 [&_summary::-webkit-details-marker]:hidden">
                      <summary className="cursor-pointer text-sm font-semibold text-brand-700">✏️ {t.x.edit}</summary>
                      <ActionForm action={editExpenseAction.bind(null, e.id)} resetOnSuccess={false} className="mt-3 flex flex-col gap-3">
                        <ExpenseFields
                          t={t}
                          types={TYPES}
                          maintenance={maintenance}
                          trips={trips}
                          idPrefix={`e${e.id}`}
                          defaults={{
                            kind: e.driverKind as DriverExpenseType,
                            amount: String(total),
                            payer: e.reportedPayer === "company" ? "company" : "custody",
                            waybillId: e.waybillId,
                            maintenanceTypeId: e.maintenanceTypeId,
                          }}
                        />
                        <PhotoInput label={t.receiptPhoto} />
                        <SubmitButton pendingLabel={t.saving}>{t.save}</SubmitButton>
                      </ActionForm>
                    </details>
                    <details className="rounded-xl border border-gray-200 px-3 py-2 [&_summary::-webkit-details-marker]:hidden">
                      <summary className="cursor-pointer text-sm font-semibold text-red-700">🚫 {t.x.mistake}</summary>
                      <ActionForm action={voidExpenseAction.bind(null, e.id)} className="mt-3 flex flex-col gap-3">
                        <input type="hidden" name="waybillId" value={e.waybillId ?? ""} />
                        <DField label={t.x.mistakeReason}>
                          <DInput name="reason" />
                        </DField>
                        <SubmitButton pendingLabel={t.saving} className="!bg-red-600 !text-white">
                          {t.x.mistakeConfirm}
                        </SubmitButton>
                      </ActionForm>
                    </details>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Section>
    </>
  );
}

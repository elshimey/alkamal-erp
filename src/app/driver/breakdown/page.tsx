import { db } from "@/db";
import { getDriverContext } from "@/lib/driver-auth";
import { driverBreakdowns } from "@/lib/driver-app";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { breakdownAction } from "../actions";
import { DField, DTextarea, Pill, Section } from "../driver-ui";

const TONE = { pending_supervisor: "amber", pending_approval: "amber", approved: "blue", in_progress: "blue", completed: "green", rejected: "red" } as const;
const PRIORITY_TONE = { low: "gray", normal: "blue", urgent: "red" } as const;

export default async function DriverBreakdown() {
  const { driver, t } = await getDriverContext();
  if (!driver) return null;
  const rows = await driverBreakdowns(db, driver.id);

  return (
    <>
      <Section title={t.breakdownTitle}>
        {!driver.vehicle ? (
          <p className="text-sm text-amber-900">{t.noVehicle}</p>
        ) : (
          <ActionForm action={breakdownAction} className="flex flex-col gap-3">
            <p className="text-sm text-gray-500">{t.breakdownHint}</p>
            <DField label={t.breakdownDesc}>
              <DTextarea name="description" required rows={4} />
            </DField>
            <DField label={t.priority}>
              <div className="grid grid-cols-3 gap-2">
                {(["low", "normal", "urgent"] as const).map((p) => (
                  <label key={p} className="cursor-pointer">
                    <input type="radio" name="priority" value={p} defaultChecked={p === "normal"} className="peer sr-only" />
                    <span
                      className={`block rounded-xl border border-gray-300 py-2.5 text-center text-sm font-medium ${p === "urgent" ? "peer-checked:border-red-600 peer-checked:bg-red-600 peer-checked:text-white" : "peer-checked:border-asphalt-900 peer-checked:bg-asphalt-900 peer-checked:text-brand-500"}`}
                    >
                      {t.priorities[p]}
                    </span>
                  </label>
                ))}
              </div>
            </DField>
            <SubmitButton pendingLabel={t.saving} className="w-full py-3 text-base">
              {t.send}
            </SubmitButton>
          </ActionForm>
        )}
      </Section>

      <Section title={t.myRequests}>
        {rows.length === 0 && <p className="text-sm text-gray-400">{t.nothing}</p>}
        <ul className="divide-y divide-gray-100">
          {rows.map(({ r, plate }) => (
            <li key={r.id} className="py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="ltr-nums text-xs text-gray-400">
                  {r.reportDate} · {r.number} · {plate}
                </span>
                <Pill tone={TONE[r.status]}>{t.breakdownStatus[r.status]}</Pill>
              </div>
              <p className="mt-1 text-sm">{r.description}</p>
              <div className="mt-1 flex items-center gap-2">
                <Pill tone={PRIORITY_TONE[r.priority]}>{t.priorities[r.priority]}</Pill>
                {r.status === "rejected" && r.rejectReason && <span className="text-xs text-red-600">{r.rejectReason}</span>}
              </div>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

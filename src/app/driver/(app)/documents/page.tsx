import { db } from "@/db";
import { getDriverContext } from "@/lib/driver-auth";
import { todayRiyadh } from "@/lib/dates";
import { listSubmissions, ownerDocuments, type DocState } from "@/lib/documents";
import { SubmitButton } from "@/components/action-form";
import { DriverForm, PhotoInput } from "../../offline";
import { DField, DInput, DSelect, Pill, Section } from "../../driver-ui";

const TONE: Record<DocState, "green" | "amber" | "red" | "gray"> = { valid: "green", soon: "amber", expired: "red", missing: "gray", none: "gray" };
const SUB_TONE = { pending: "amber", approved: "green", rejected: "red" } as const;

export default async function DriverDocuments() {
  const { driver, t } = await getDriverContext();
  if (!driver) return null;
  const today = todayRiyadh();
  const [mine, vehicle, subs] = await Promise.all([
    ownerDocuments(db, "driver", driver.id, today),
    driver.vehicle ? ownerDocuments(db, "vehicle", driver.vehicle.id, today) : Promise.resolve([]),
    listSubmissions(db, { driverId: driver.id, limit: 20 }),
  ]);
  const pendingTypes = new Set(subs.filter((s) => s.sub.status === "pending").map((s) => s.type.id));
  // الوثائق المسجلة أو الإلزامية فقط؛ الاختيارية غير المسجلة لا تُشغل الشاشة
  const visible = (rows: typeof mine) => rows.filter((r) => r.current || r.type.required);

  const list = (rows: typeof mine) => (
    <ul className="divide-y divide-gray-100">
      {visible(rows).map(({ type, current, state }) => (
        <li key={type.id} className="flex items-center justify-between gap-3 py-2.5">
          <span className="min-w-0">
            <span className="block text-sm font-medium">{type.nameAr}</span>
            <span className="ltr-nums block text-xs text-gray-400">
              {current ? (current.doc.expiryDate ? `${t.docs.expires} ${current.doc.expiryDate}` : t.docs.noExpiry) : "—"}
            </span>
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1">
            <Pill tone={TONE[state]}>{t.docs.states[state]}</Pill>
            {pendingTypes.has(type.id) && <Pill tone="amber">{t.docs.pending}</Pill>}
          </span>
        </li>
      ))}
    </ul>
  );
  const options = [...mine, ...vehicle].filter((r) => r.type.isActive);

  return (
    <>
      <Section title={t.docs.mine}>
        {list(mine)}
      </Section>
      {driver.vehicle && (
        <Section title={`${t.docs.vehicle} · ${driver.vehicle.plate}`}>
          {list(vehicle)}
        </Section>
      )}
      <Section title={t.docs.upload}>
        <DriverForm actionKey="document" savedOffline={t.savedOffline} className="flex flex-col gap-3">
          <p className="text-sm text-gray-500">{t.docs.uploadHint}</p>
          <DField label={t.docs.type}>
            <DSelect name="documentTypeId" required defaultValue="">
              <option value="" disabled>
                …
              </option>
              {options.map((r) => (
                <option key={r.type.id} value={r.type.id}>
                  {r.type.nameAr}
                  {r.type.ownerKind === "vehicle" && driver.vehicle ? ` (${driver.vehicle.plate})` : ""}
                </option>
              ))}
            </DSelect>
          </DField>
          <DField label={t.docs.expiry}>
            <DInput name="expiryDate" type="date" dir="ltr" />
          </DField>
          <DField label={t.docs.number}>
            <DInput name="number" dir="ltr" />
          </DField>
          <PhotoInput label={t.docs.photo} required />
          <SubmitButton pendingLabel={t.saving} className="w-full py-3 text-base">
            {t.send}
          </SubmitButton>
        </DriverForm>
      </Section>
      {subs.length > 0 && (
        <Section title={t.docs.myUploads}>
          <ul className="divide-y divide-gray-100">
            {subs.map(({ sub, type }) => (
              <li key={sub.id} className="py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{type.nameAr}</span>
                  <Pill tone={SUB_TONE[sub.status]}>{sub.status === "pending" ? t.docs.pending : sub.status === "approved" ? t.docs.approved : t.docs.rejected}</Pill>
                </div>
                {sub.status === "rejected" && sub.reviewNote && <p className="mt-1 text-xs text-red-600">{sub.reviewNote}</p>}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

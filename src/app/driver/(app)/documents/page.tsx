import { db } from "@/db";
import { getDriverContext } from "@/lib/driver-auth";
import { todayRiyadh } from "@/lib/dates";
import { listSubmissions, ownerDocuments } from "@/lib/documents";
import { driverDocuments } from "@/lib/driver-docs";
import { SubmitButton } from "@/components/action-form";
import { DriverForm, PhotoInput } from "../../offline";
import { DField, DInput, DSelect, Pill, Section } from "../../driver-ui";
import { DocsView } from "./docs-view";

const SUB_TONE = { pending: "amber", approved: "green", rejected: "red" } as const;

/** «وثائقي» (قرار أحمد 2026-11-21): ثلاثة أزرار ثابتة (وثائقي، المركبة، المقطورة)، والضغط على الوثيقة يفتحها كاملة مع «تنزيل». */
export default async function DriverDocuments({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { driver, t } = await getDriverContext();
  if (!driver) return null;
  const today = todayRiyadh();
  const [{ mine, vehicle, trailer, trailerDocs }, subs] = await Promise.all([driverDocuments(db, driver, today), listSubmissions(db, { driverId: driver.id, limit: 20 })]);
  const pendingTypes = subs.filter((s) => s.sub.status === "pending").map((s) => s.type.id);
  // خيارات الرفع: أنواع الوثائق النشطة للسائق ومركبته ومقطورته
  const [mineTypes, vehicleTypes, trailerTypes] = await Promise.all([
    ownerDocuments(db, "driver", driver.id, today),
    driver.vehicle ? ownerDocuments(db, "vehicle", driver.vehicle.id, today) : Promise.resolve([]),
    trailer ? ownerDocuments(db, "trailer", trailer.id, today) : Promise.resolve([]),
  ]);
  const options = [
    ...mineTypes.filter((r) => r.type.isActive).map((r) => ({ id: r.type.id, label: r.type.nameAr })),
    ...vehicleTypes.filter((r) => r.type.isActive).map((r) => ({ id: r.type.id, label: `${r.type.nameAr} (${driver.vehicle!.plate})` })),
    ...trailerTypes.filter((r) => r.type.isActive).map((r) => ({ id: r.type.id, label: `${r.type.nameAr} (${trailer!.plate})` })),
  ];
  const tab = (await searchParams).tab;

  const upload = (
    <DriverForm actionKey="document" savedOffline={t.savedOffline} className="flex flex-col gap-3">
      <p className="text-sm text-gray-500">{t.docs.uploadHint}</p>
      <DField label={t.docs.type}>
        <DSelect name="documentTypeId" required defaultValue="">
          <option value="" disabled>
            …
          </option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
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
      <PhotoInput label={t.docs.photo} required allowFiles errorLabel={t.docs.fileError} />
      <SubmitButton pendingLabel={t.saving} className="w-full py-3 text-base">
        {t.send}
      </SubmitButton>
    </DriverForm>
  );

  return (
    <>
      <DocsView
        t={t.docs}
        initialTab={tab === "vehicle" || tab === "trailer" ? tab : "mine"}
        groups={{
          mine: { plate: null, rows: mine, empty: null },
          vehicle: { plate: driver.vehicle?.plate ?? null, rows: vehicle, empty: driver.vehicle ? null : t.docs.noVehicle },
          trailer: { plate: trailer?.plate ?? null, rows: trailerDocs, empty: trailer ? null : t.docs.noTrailer },
        }}
        driverName={driver.name}
        pendingTypes={pendingTypes}
        upload={upload}
      />
      {subs.length > 0 && (
        <div className="mt-4">
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
        </div>
      )}
    </>
  );
}

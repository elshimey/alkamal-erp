import Link from "next/link";
import { getDriverContext } from "@/lib/driver-auth";
import { customerOptions, routeOptions } from "@/lib/lookups";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { startTripAction } from "../../../actions";
import { DField, DInput, DSelect, DTextarea, Section } from "../../../driver-ui";

export default async function NewTrip() {
  const { driver, t } = await getDriverContext();
  if (!driver) return null;
  const [customers, routes] = await Promise.all([customerOptions(), routeOptions()]);
  return (
    <>
      <Link href="/driver" className="mb-3 inline-block text-sm text-brand-700">
        ← {t.back}
      </Link>
      <Section title={t.newTrip}>
        {!driver.vehicle ? (
          <p className="text-sm text-amber-900">{t.noVehicle}</p>
        ) : (
          <ActionForm action={startTripAction} resetOnSuccess={false} className="flex flex-col gap-4">
            <DField label={t.customer}>
              <DSelect name="customerId" required defaultValue="">
                <option value="" disabled>
                  {t.choose}
                </option>
                {customers.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </DSelect>
            </DField>
            <DField label={t.route}>
              <DSelect name="routeId" required defaultValue="">
                <option value="" disabled>
                  {t.choose}
                </option>
                {routes.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </DSelect>
            </DField>
            <DField label={t.shipper}>
              <DInput name="shipper" required />
            </DField>
            <DField label={t.consignee}>
              <DInput name="consignee" required />
            </DField>
            <div className="grid grid-cols-2 gap-3">
              <DField label={t.container} hint={t.optional}>
                <DInput name="containerNumber" dir="ltr" />
              </DField>
              <DField label={t.weight} hint={t.optional}>
                <DInput name="weightTons" inputMode="decimal" dir="ltr" />
              </DField>
            </div>
            <DField label={t.odometer}>
              <DInput name="odometer" inputMode="numeric" dir="ltr" required />
            </DField>
            <DField label={t.note} hint={t.optional}>
              <DTextarea name="notes" rows={2} />
            </DField>
            <SubmitButton pendingLabel={t.saving} className="w-full py-3.5 text-base">
              {t.startTrip}
            </SubmitButton>
          </ActionForm>
        )}
      </Section>
    </>
  );
}

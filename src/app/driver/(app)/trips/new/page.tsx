import Link from "next/link";
import { getDriverContext } from "@/lib/driver-auth";
import { SubmitButton } from "@/components/action-form";
import { DriverForm, GeoFields, PhotoInput } from "../../../offline";
import { Section } from "../../../driver-ui";

// رحلة يبدؤها السائق: صورة فاتورة الطرف الأول فقط؛ المركبة من إسناده، والوقت والموقع تلقائياً، والمكتب يكمل الباقي
export default async function NewTrip() {
  const { driver, t } = await getDriverContext();
  if (!driver) return null;
  return (
    <>
      <Link href="/driver" className="mb-3 inline-block text-sm text-brand-700">
        ← {t.back}
      </Link>
      <Section title={t.req.start}>
        {!driver.vehicle ? (
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t.noVehicle}</p>
        ) : (
          <DriverForm actionKey="tripRequest" savedOffline={t.savedOffline} doneHref="/driver" className="flex flex-col gap-3">
            <p className="text-sm text-gray-600">{t.req.startHint}</p>
            <p className="text-sm">
              <span className="text-gray-400">{t.vehicle}: </span>
              <b>{driver.vehicle.plate}</b>
            </p>
            <GeoFields />
            <PhotoInput label={t.req.invoicePhoto} required />
            <PhotoInput name="photo2" label={t.req.invoicePhoto2} />
            <SubmitButton pendingLabel={t.saving} className="flex w-full flex-col items-center gap-1 !rounded-2xl !py-5 text-xl">
              <span aria-hidden className="text-3xl">🚚</span>
              {t.req.startBtn}
            </SubmitButton>
          </DriverForm>
        )}
      </Section>
    </>
  );
}

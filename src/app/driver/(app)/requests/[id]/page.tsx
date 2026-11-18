import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { getDriverContext } from "@/lib/driver-auth";
import { driverTripRequest } from "@/lib/driver-trip-requests";
import { listAttachments } from "@/lib/attachments";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { DriverForm, GeoFields, PhotoInput } from "../../../offline";
import { cancelRequestAction, undoRequestStageAction } from "../../../actions";
import { Pill, Section } from "../../../driver-ui";

// رحلة بدأها السائق ولم يحوّلها المكتب بعد: يسجل التحميل ثم التسليم بالصور، أو يلغيها إن بدأها بالخطأ
export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { driver, t } = await getDriverContext();
  if (!driver) return null;
  const id = Number((await params).id);
  const r = await driverTripRequest(db, driver.id, id).catch(() => null);
  if (!r) notFound();
  const photos = await listAttachments(db, "driver_trip_requests", [r.id]);
  const time = (at: Date) => at.toLocaleString("en-GB", { timeZone: "Asia/Riyadh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const pending = r.status === "pending";

  return (
    <>
      <Link href="/driver" className="mb-3 inline-block text-sm text-brand-700">
        ← {t.back}
      </Link>
      <Section>
        <div className="flex items-center justify-between gap-2">
          <span className="ltr-nums text-sm text-gray-500">{time(r.requestedAt)}</span>
          {pending ? <Pill tone="amber">{t.req.waiting}</Pill> : r.status === "rejected" ? <Pill tone="red">{t.req.rejected}</Pill> : <Pill>{t.req.cancelled}</Pill>}
        </div>
        <h1 className="mt-2 text-xl font-bold text-asphalt-900">{t.req.title}</h1>
        {pending && <p className="mt-2 text-sm text-gray-600">{t.req.waitingHint}</p>}
        {r.status === "rejected" && (
          <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">
            <b>{t.rejected}:</b> {r.rejectionReason}
          </p>
        )}
        {r.status === "converted" && r.waybillId && (
          <Link href={`/driver/trips/${r.waybillId}`} className="mt-3 block rounded-xl bg-green-50 p-3 text-sm font-semibold text-green-800">
            {t.notify.request_accepted} ←
          </Link>
        )}
      </Section>

      {pending && r.next && (
        <DriverForm actionKey="requestStage" savedOffline={t.savedOffline} className="mb-3 flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm">
          <input type="hidden" name="requestId" value={r.id} />
          <input type="hidden" name="stage" value={r.next} />
          <GeoFields />
          <PhotoInput label={t.flow.photo} required />
          <PhotoInput name="photo2" label={t.flow.photo2} />
          <SubmitButton pendingLabel={t.saving} className={`flex w-full flex-col items-center gap-1 !rounded-2xl !py-5 text-xl ${r.next === "delivery" ? "!bg-green-600 !text-white" : ""}`}>
            <span aria-hidden className="text-3xl">{r.next === "delivery" ? "✅" : "📦"}</span>
            {r.next === "delivery" ? t.flow.delivered : t.flow.loaded}
          </SubmitButton>
        </DriverForm>
      )}

      {r.stages.length > 0 && (
        <Section title={t.timeline}>
          <ol className="relative ms-3 border-s-2 border-dashed border-brand-600/50">
            {r.stages.map((st) => (
              <li key={st.id} className="relative ms-5 pb-4 last:pb-1">
                <span className="absolute -start-[29px] top-1 size-4 rounded-full border-2 border-white bg-brand-600 ring-2 ring-brand-600/30" />
                <div className="font-medium">{t.stages[st.stage]}</div>
                <div className="ltr-nums text-xs text-gray-500">{time(st.at)}</div>
              </li>
            ))}
          </ol>
          {pending && (
            <details className="mt-2 rounded-xl border border-gray-200 px-3 py-2 [&_summary::-webkit-details-marker]:hidden">
              <summary className="cursor-pointer text-sm font-semibold text-red-700">↩️ {t.x.undo}</summary>
              <ActionForm action={undoRequestStageAction.bind(null, r.id)} className="mt-2 flex flex-col gap-2">
                <p className="text-sm text-gray-600">{t.x.undoConfirm.replace("{stage}", t.stages[r.stages.at(-1)!.stage])}</p>
                <SubmitButton pendingLabel={t.saving} className="!bg-red-600 !text-white">
                  {t.x.undo}
                </SubmitButton>
              </ActionForm>
            </details>
          )}
        </Section>
      )}

      {photos.length > 0 && (
        <Section title={t.photos}>
          <div className="grid grid-cols-3 gap-2">
            {photos.map((ph) => (
              <a key={ph.id} href={`/driver/files/${ph.id}`} target="_blank" rel="noreferrer" className="block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/driver/files/${ph.id}`} alt="" loading="lazy" className="aspect-square w-full rounded-lg object-cover ring-1 ring-black/10" />
              </a>
            ))}
          </div>
        </Section>
      )}

      {pending && (
        <details className="mb-4 rounded-2xl bg-white px-4 py-3 shadow-sm [&_summary::-webkit-details-marker]:hidden">
          <summary className="cursor-pointer text-sm font-semibold text-red-700">{t.req.cancel}</summary>
          <ActionForm action={cancelRequestAction.bind(null, r.id)} className="mt-2 flex flex-col gap-2">
            <p className="text-sm text-gray-600">{t.req.cancelConfirm}</p>
            <SubmitButton pendingLabel={t.saving} className="!bg-red-600 !text-white">
              {t.req.cancel}
            </SubmitButton>
          </ActionForm>
        </details>
      )}
    </>
  );
}

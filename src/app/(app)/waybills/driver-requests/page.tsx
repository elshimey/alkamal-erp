import Link from "next/link";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { linkableWaybills, listTripRequests, type TripRequestStatus } from "@/lib/driver-trip-requests";
import { listAttachments, ATTACHMENT_KINDS, type AttachmentKind } from "@/lib/attachments";
import { fmtDate } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, EmptyRow, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { linkRequestAction, rejectRequestAction } from "../actions";

// رحلات بدأها السائقون من التطبيق (قواعد الدورات، القسم 10): تُحوَّل لشحنة جديدة أو تُربط بشحنة موجودة، أو تُرفض بسبب.
const BASE = "/waybills/driver-requests";
const STATUS: Record<TripRequestStatus, { label: string; tone: "amber" | "green" | "red" | "gray" }> = {
  pending: { label: "بانتظار التحويل", tone: "amber" },
  converted: { label: "حُوّلت لشحنة", tone: "green" },
  rejected: { label: "مرفوضة", tone: "red" },
  cancelled: { label: "ألغاها السائق", tone: "gray" },
};
const isStatus = (v?: string): v is TripRequestStatus => !!v && v in STATUS;
const time = (at: Date) => at.toLocaleString("en-GB", { timeZone: "Asia/Riyadh", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const STAGE_AR: Record<string, string> = { loading: "تحميل", delivery: "تسليم" };

export default async function DriverTripRequestsPage({ searchParams }: { searchParams: Promise<{ status?: string; open?: string }> }) {
  const user = await requirePermission("waybills", "view");
  const sp = await searchParams;
  const status = sp.status === "all" ? undefined : isStatus(sp.status) ? sp.status : "pending";
  const { rows, counts } = await listTripRequests(db, { status });
  const canAct = can(user.perms, "waybills", "create");
  const open = rows.find((x) => x.r.id === Number(sp.open)) ?? null;
  const [photos, linkable] = await Promise.all([
    listAttachments(db, "driver_trip_requests", rows.map((x) => x.r.id)),
    open && open.r.status === "pending" && canAct ? linkableWaybills(db, open.r.id) : Promise.resolve([]),
  ]);
  const href = (p: { status?: string; open?: number }) => {
    const q = new URLSearchParams();
    const st = p.status ?? sp.status;
    if (st) q.set("status", st);
    if (p.open) q.set("open", String(p.open));
    return `${BASE}${q.size ? `?${q}` : ""}`;
  };
  const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
  // بعد التحويل تنتقل الصور للشحنة نفسها
  const openPhotos = open ? (open.r.status === "converted" ? [] : photos.filter((p) => p.entityId === open.r.id)) : [];

  return (
    <>
      <PageHeader
        title="رحلات بدأها السائقون"
        description="السائق يصوّر فاتورة الطرف الأول من التطبيق، والمركبة من إسناده والوقت والموقع تلقائياً، ويسجل التحميل والتسليم. حوّلها لشحنة (تكمل العميل والمسار والسعر)، أو اربطها بشحنة أنشأتها له للرحلة نفسها، أو ارفضها بسبب يصله. لا قيد قبل التحويل."
      >
        <Link href="/waybills" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50">
          ← الشحنات
        </Link>
      </PageHeader>

      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {(Object.entries(STATUS) as [TripRequestStatus, (typeof STATUS)[TripRequestStatus]][]).map(([k, v]) => (
          <Link key={k} href={href({ status: k })} scroll={false} className={`rounded-full border px-3 py-1.5 ${status === k ? "border-brand-600 bg-brand-50 font-semibold text-brand-900" : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"}`}>
            {v.label} <span className="ltr-nums text-xs text-gray-500">{counts[k] ?? 0}</span>
          </Link>
        ))}
        <Link href={href({ status: "all" })} scroll={false} className={`rounded-full border px-3 py-1.5 ${!status ? "border-brand-600 bg-brand-50 font-semibold text-brand-900" : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"}`}>
          الكل <span className="ltr-nums text-xs text-gray-500">{total}</span>
        </Link>
      </div>

      <div className={open ? "grid items-start gap-4 lg:grid-cols-[1fr_minmax(22rem,30rem)]" : ""}>
        <Table head={["الوقت", "السائق", "المركبة", "المراحل", "الصور", "الحالة", ""]}>
          {rows.length === 0 && <EmptyRow cols={7}>لا توجد رحلات {status ? `«${STATUS[status].label}»` : ""}</EmptyRow>}
          {rows.map(({ r, driver, plate, waybillNumber, stages }) => (
            <tr key={r.id} className={r.id === open?.r.id ? "bg-brand-50/60" : undefined}>
              <Td className="ltr-nums whitespace-nowrap">{time(r.requestedAt)}</Td>
              <Td>{driver}</Td>
              <Td className="whitespace-nowrap">{plate}</Td>
              <Td className="whitespace-nowrap text-xs">{stages.length ? stages.map((x) => STAGE_AR[x.stage] ?? x.stage).join(" ← ") : <span className="text-gray-400">لم يحمّل بعد</span>}</Td>
              <Td className="ltr-nums">{r.status === "converted" ? "—" : photos.filter((p) => p.entityId === r.id).length}</Td>
              <Td>
                <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                {waybillNumber && (
                  <Link href={`/waybills?open=${r.waybillId}`} className="ltr-nums mt-1 block text-xs text-brand-700 hover:underline">
                    {waybillNumber}
                  </Link>
                )}
              </Td>
              <Td>
                <Link href={href({ open: r.id })} scroll={false} className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50">
                  {r.status === "pending" && canAct ? "مراجعة" : "عرض"}
                </Link>
              </Td>
            </tr>
          ))}
        </Table>

        {open && (
          <Card title={`رحلة ${open.driver}`} className="lg:sticky lg:top-20">
            <div className="mb-3 flex justify-end">
              <Link href={href({})} scroll={false} aria-label="إغلاق" className="rounded-lg px-2 py-1 text-sm text-gray-500 hover:bg-gray-100">
                ✕
              </Link>
            </div>
            <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-gray-500">بدأها</dt>
              <dd className="ltr-nums">{time(open.r.requestedAt)}</dd>
              <dt className="text-gray-500">المركبة</dt>
              <dd>{open.plate}</dd>
              <dt className="text-gray-500">الموقع</dt>
              <dd>
                {open.r.latitude && open.r.longitude ? (
                  <a href={`https://www.google.com/maps?q=${open.r.latitude},${open.r.longitude}`} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">
                    عرض على الخريطة
                  </a>
                ) : (
                  <span className="text-gray-400">لم يسمح الجوال بالموقع</span>
                )}
              </dd>
              {open.stages.map((st) => (
                <div key={st.id} className="contents">
                  <dt className="text-gray-500">{STAGE_AR[st.stage] ?? st.stage}</dt>
                  <dd className="ltr-nums">
                    {time(st.at)}
                    {st.odometer != null && ` · ${st.odometer.toLocaleString("en")} كم`}
                  </dd>
                </div>
              ))}
              {open.r.rejectionReason && (
                <>
                  <dt className="text-gray-500">سبب الرفض</dt>
                  <dd className="text-red-700">{open.r.rejectionReason}</dd>
                </>
              )}
              {open.r.decidedAt && (
                <>
                  <dt className="text-gray-500">في</dt>
                  <dd className="ltr-nums">{fmtDate(open.r.decidedAt.toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" }))}</dd>
                </>
              )}
            </dl>

            {openPhotos.length > 0 && (
              <div className="mb-4 grid grid-cols-3 gap-2">
                {openPhotos.map((ph) => (
                  <a key={ph.id} href={`/files/${ph.id}`} target="_blank" rel="noreferrer" className="block text-center text-[11px] text-gray-500">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/files/${ph.id}`} alt="" loading="lazy" className="mb-1 aspect-square w-full rounded-lg object-cover ring-1 ring-black/10" />
                    {ATTACHMENT_KINDS[ph.kind as AttachmentKind] ?? "صورة"}
                  </a>
                ))}
              </div>
            )}
            {open.r.status === "converted" && open.r.waybillId && (
              <Link href={`/waybills?open=${open.r.waybillId}`} className="block rounded-xl bg-green-50 px-3 py-2 text-sm font-semibold text-green-800">
                الشحنة {open.waybillNumber}: المراحل والصور فيها ←
              </Link>
            )}

            {open.r.status === "pending" && canAct && (
              <div className="flex flex-col gap-4">
                <Link href={`/waybills?fromRequest=${open.r.id}`} className="rounded-lg bg-brand-600 px-4 py-2.5 text-center text-sm font-semibold text-brand-900 shadow-sm hover:bg-brand-500">
                  تحويل لشحنة جديدة
                </Link>
                <p className="-mt-2 text-xs text-gray-500">تفتح نافذة الشحنة بالسائق والمركبة والتاريخ؛ تكمل العميل والمسار والسعر، ويمكنك فيها «حفظ واعتماد وإصدار فاتورة فوراً».</p>

                <details className="rounded-xl border border-gray-200 px-3 py-2">
                  <summary className="cursor-pointer text-sm font-semibold text-gray-800">ربط بشحنة موجودة لنفس السائق</summary>
                  {linkable.length === 0 ? (
                    <p className="mt-2 text-sm text-gray-500">لا توجد شحنة لهذا السائق والمركبة قبل الاعتماد دون مراحل منه.</p>
                  ) : (
                    <ActionForm action={linkRequestAction.bind(null, open.r.id)} className="mt-2 flex flex-col gap-2">
                      <Field label="الشحنة">
                        <Select name="waybillId" required defaultValue="">
                          <option value="" disabled>
                            اختر الشحنة
                          </option>
                          {linkable.map((w) => (
                            <option key={w.id} value={w.id}>
                              {w.number} · {fmtDate(w.date)} · {w.customer}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <SubmitButton>ربط ونقل المراحل والصور</SubmitButton>
                    </ActionForm>
                  )}
                </details>

                <details className="rounded-xl border border-red-200 px-3 py-2">
                  <summary className="cursor-pointer text-sm font-semibold text-red-700">رفض</summary>
                  <ActionForm action={rejectRequestAction.bind(null, open.r.id)} className="mt-2 flex flex-col gap-2">
                    <Field label="السبب (يصل للسائق)">
                      <Input name="reason" required />
                    </Field>
                    <SubmitButton className="!bg-red-600 !text-white">رفض الرحلة</SubmitButton>
                  </ActionForm>
                </details>
              </div>
            )}
          </Card>
        )}
      </div>
    </>
  );
}

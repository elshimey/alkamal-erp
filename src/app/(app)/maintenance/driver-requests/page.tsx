import Link from "next/link";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { driverMaintenanceRequests, type DriverRequestStatus } from "@/lib/maintenance";
import { listAttachments } from "@/lib/attachments";
import { customListOptions } from "@/lib/custom-lists";
import { cashAccounts } from "@/lib/invoices";
import { supplierOptions } from "@/lib/purchases";
import { fmtDate } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { Badge, Card, EmptyRow, Field, Input, PageHeader, Table, Td } from "@/components/ui";
import { MaintenanceTabs } from "../tabs";
import { approveDriverRequest, rejectDriverRequest, revertDriverRequest } from "../actions";
import { ReviewForm } from "./review-form";

const BASE = "/maintenance/driver-requests";
const fmt = (v: number) => v.toLocaleString("en", { maximumFractionDigits: 2 });
const STATUS: Record<DriverRequestStatus, { label: string; tone: "amber" | "green" | "red" | "gray" }> = {
  pending: { label: "بانتظار الاعتماد", tone: "amber" },
  approved: { label: "معتمد", tone: "green" },
  rejected: { label: "مرفوض", tone: "red" },
  voided: { label: "ألغاه السائق", tone: "gray" },
};
const isStatus = (v?: string): v is DriverRequestStatus => !!v && v in STATUS;

export default async function DriverRequestsPage({ searchParams }: { searchParams: Promise<{ status?: string; open?: string }> }) {
  const user = await requirePermission("maintenance", "view");
  const sp = await searchParams;
  // يفتح على ما ينتظر الاعتماد؛ «all» يعرض الكل
  const status = sp.status === "all" ? undefined : isStatus(sp.status) ? sp.status : "pending";
  const [list, all] = await Promise.all([driverMaintenanceRequests(db, { status }), driverMaintenanceRequests(db, {}, 2000)]);
  const counts = Object.fromEntries(Object.keys(STATUS).map((k) => [k, all.filter((x) => x.e.status === k).length])) as Record<DriverRequestStatus, number>;
  const photos = new Map((await listAttachments(db, "expenses", list.map((r) => r.e.id))).map((a) => [a.entityId, a.id]));
  const canApprove = can(user.perms, "maintenance", "approve");
  const open = list.find((x) => x.e.id === Number(sp.open)) ?? null;
  const [kinds, suppliers, cashes] = open && open.e.status === "pending" && canApprove ? await Promise.all([customListOptions(db, "maintenance_kind"), supplierOptions(db), cashAccounts(db)]) : [[], [], []];
  const href = (p: { status?: string; open?: number }) => {
    const q = new URLSearchParams();
    const st = p.status ?? sp.status;
    if (st) q.set("status", st);
    if (p.open) q.set("open", String(p.open));
    return `${BASE}${q.size ? `?${q}` : ""}`;
  };
  const total = (e: (typeof list)[number]["e"]) => Number(e.amount) + Number(e.vatAmount);

  return (
    <>
      <PageHeader
        title="الصيانة"
        description="ما يرفعه السائقون من الطريق (صيانة أو إطارات) بصورة الفاتورة والمبلغ. عند الاعتماد تختار نوع الصيانة ومن دفع: عهدة السائق، أو صندوق الشركة، أو دين على الورشة (يُنشأ له أمر صيانة خارجي)."
      />
      <MaintenanceTabs active="driver" badges={{ driver: counts.pending }} />

      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {(Object.entries(STATUS) as [DriverRequestStatus, (typeof STATUS)[DriverRequestStatus]][]).map(([k, v]) => (
          <Link key={k} href={href({ status: k })} scroll={false} className={`rounded-full border px-3 py-1.5 ${status === k ? "border-brand-600 bg-brand-50 font-semibold text-brand-900" : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"}`}>
            {v.label} <span className="ltr-nums text-xs text-gray-500">{counts[k]}</span>
          </Link>
        ))}
        <Link href={href({ status: "all" })} scroll={false} className={`rounded-full border px-3 py-1.5 ${!status ? "border-brand-600 bg-brand-50 font-semibold text-brand-900" : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"}`}>
          الكل <span className="ltr-nums text-xs text-gray-500">{all.length}</span>
        </Link>
      </div>

      <div className={open ? "grid items-start gap-4 lg:grid-cols-[1fr_minmax(22rem,28rem)]" : ""}>
        <Table head={["الرقم", "التاريخ", "السائق", "المركبة", "النوع", "المبلغ", "الفاتورة", "الحالة", ""]}>
          {list.length === 0 && <EmptyRow cols={9}>لا توجد طلبات {status ? `«${STATUS[status].label}»` : ""}</EmptyRow>}
          {list.map(({ e, plate, driver, kind, order }) => (
            <tr key={e.id} className={e.id === open?.e.id ? "bg-brand-50/60" : undefined}>
              <Td className="ltr-nums whitespace-nowrap font-medium">
                <Link href={href({ open: e.id })} scroll={false} className="text-brand-700 hover:underline">
                  {e.number}
                </Link>
              </Td>
              <Td className="ltr-nums whitespace-nowrap">{fmtDate(e.expenseDate)}</Td>
              <Td>{driver ?? "—"}</Td>
              <Td className="whitespace-nowrap">{plate ?? "—"}</Td>
              <Td>{kind ?? (e.driverKind === "tires" ? "إطارات" : "صيانة")}</Td>
              <Td className="ltr-nums font-semibold whitespace-nowrap">{fmt(total(e))}</Td>
              <Td>
                {photos.has(e.id) ? (
                  <a href={`/files/${photos.get(e.id)}`} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand-700 hover:underline">
                    عرض الصورة
                  </a>
                ) : (
                  <span className="text-xs text-gray-400">بلا صورة</span>
                )}
              </Td>
              <Td>
                <Badge tone={STATUS[e.status].tone}>{STATUS[e.status].label}</Badge>
                {order && <div className="ltr-nums mt-1 text-xs text-gray-500">أمر {order}</div>}
              </Td>
              <Td>
                <Link href={href({ open: e.id })} scroll={false} className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50">
                  {e.status === "pending" && canApprove ? "مراجعة" : "عرض"}
                </Link>
              </Td>
            </tr>
          ))}
        </Table>

        {open && (
          <Card title={`طلب ${open.e.number}`} className="lg:sticky lg:top-20">
            <div className="mb-4 flex items-start justify-between gap-2">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-gray-500">السائق</dt>
                <dd>{open.driver ?? "—"}</dd>
                <dt className="text-gray-500">المركبة</dt>
                <dd>{open.plate ?? "—"}</dd>
                <dt className="text-gray-500">التاريخ</dt>
                <dd className="ltr-nums">{fmtDate(open.e.expenseDate)}</dd>
                <dt className="text-gray-500">البيان</dt>
                <dd>{open.e.description}</dd>
                <dt className="text-gray-500">المبلغ</dt>
                <dd className="ltr-nums font-semibold">{fmt(total(open.e))}</dd>
                {open.order && (
                  <>
                    <dt className="text-gray-500">أمر الصيانة</dt>
                    <dd className="ltr-nums">
                      <Link href={`/maintenance/${open.e.maintenanceOrderId}`} className="text-brand-700 hover:underline">
                        {open.order}
                      </Link>
                    </dd>
                  </>
                )}
                {open.entry && (
                  <>
                    <dt className="text-gray-500">القيد</dt>
                    <dd className="ltr-nums">{open.entry}</dd>
                  </>
                )}
                {open.e.rejectReason && (
                  <>
                    <dt className="text-gray-500">سبب الرفض</dt>
                    <dd className="text-red-700">{open.e.rejectReason}</dd>
                  </>
                )}
              </dl>
              <Link href={href({})} scroll={false} aria-label="إغلاق" className="rounded-lg px-2 text-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700">
                ×
              </Link>
            </div>
            {photos.has(open.e.id) && (
              <a href={`/files/${photos.get(open.e.id)}`} target="_blank" rel="noreferrer" className="mb-4 block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/files/${photos.get(open.e.id)}`} alt="صورة الفاتورة" className="max-h-64 w-full rounded-lg border border-gray-200 object-contain" />
              </a>
            )}
            {open.e.status === "pending" && canApprove && (
              <>
                <ReviewForm
                  action={approveDriverRequest.bind(null, open.e.id)}
                  kinds={kinds}
                  defaultKind={open.e.driverKind === "tires" ? "tires" : "mechanical"}
                  suppliers={suppliers}
                  cashes={cashes}
                  reportedPayer={open.e.reportedPayer}
                />
                <details className="mt-4 border-t border-gray-100 pt-3">
                  <summary className="cursor-pointer text-sm text-red-700">رفض الطلب</summary>
                  <ActionForm action={rejectDriverRequest.bind(null, open.e.id)} className="mt-2 flex flex-wrap items-end gap-2">
                    <Field label="سبب الرفض (يصل للسائق)">
                      <Input name="reason" required className="w-64" />
                    </Field>
                    <SubmitButton>رفض</SubmitButton>
                  </ActionForm>
                </details>
              </>
            )}
            {open.e.status === "approved" && canApprove && (
              <ActionForm action={revertDriverRequest.bind(null, open.e.id)} resetOnSuccess={false}>
                <input type="hidden" name="op" />
                <ConfirmSubmit op="revert" danger title={`إرجاع الطلب ${open.e.number}`} text={`يلغي القيد${open.order ? " ويحذف أمر الصيانة الذي أُنشئ له" : ""}، ويعود الطلب «بانتظار الاعتماد».`} submit="إرجاع">
                  إرجاع لبانتظار الاعتماد
                </ConfirmSubmit>
              </ActionForm>
            )}
          </Card>
        )}
      </div>
    </>
  );
}

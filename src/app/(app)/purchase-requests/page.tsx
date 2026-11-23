import Link from "next/link";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { fmtDate } from "@/lib/format";
import { listRequests, PR_STATUS, requestLines } from "@/lib/purchasing";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { DocCard, DocCards, Plate } from "@/components/doc-card";
import { ListActions } from "@/components/list-actions";
import { Badge, EmptyRow, Input, PageHeader, Table, Td } from "@/components/ui";
import { removeRequest, requestDecision } from "./actions";
import { RequestPanel } from "./request-panel";

type Row = Awaited<ReturnType<typeof listRequests>>[number]["r"];
type Perms = { canCreate: boolean; canApprove: boolean; canRevert: boolean; canDelete: boolean };

/** أزرار الطلب حسب حالته، نفسها في الجدول وفي بطاقة الجوال (big = أزرار البطاقة الكبيرة). */
function RequestActions({ r, p, big }: { r: Row; p: Perms; big?: boolean }) {
  const sz = big ? "h-11 w-full justify-center text-sm" : "!px-2 !py-1 text-xs";
  const out = [];
  if (r.status === "draft" && p.canApprove)
    out.push(
      <ActionForm key="ok" action={requestDecision.bind(null, r.id, "approve")}>
        <SubmitButton className={sz}>اعتماد</SubmitButton>
      </ActionForm>,
    );
  if (r.status === "approved" && p.canCreate)
    out.push(
      <Link key="po" href={`/purchase-orders?request=${r.id}`} className={`inline-flex items-center rounded-lg bg-brand-600 font-semibold text-brand-900 ${big ? sz : "px-2 py-1 text-xs"}`}>
        إصدار أمر شراء
      </Link>,
    );
  if ((r.status === "approved" || r.status === "rejected") && p.canRevert)
    out.push(
      <ActionForm key="re" action={requestDecision.bind(null, r.id, "reopen")}>
        <SubmitButton variant="secondary" className={sz}>
          لمسودة
        </SubmitButton>
      </ActionForm>,
    );
  if (r.status === "draft" && p.canApprove)
    out.push(
      <details key="no" className={big ? "text-sm" : "text-xs"}>
        <summary className={big ? "flex h-11 cursor-pointer list-none items-center justify-center rounded-lg border border-gray-300 bg-white font-medium text-gray-700" : "cursor-pointer text-gray-500 hover:text-red-700"}>رفض</summary>
        <ActionForm action={requestDecision.bind(null, r.id, "reject")} className="mt-1 flex gap-1">
          <Input name="reason" placeholder="السبب" required className={big ? "min-w-0 flex-1" : "!h-8 !text-xs"} />
          <SubmitButton variant="secondary" className={`${big ? "" : "!px-2 !py-1 text-xs"} text-red-700`}>
            رفض
          </SubmitButton>
        </ActionForm>
      </details>,
    );
  if ((r.status === "draft" || r.status === "rejected") && p.canDelete)
    out.push(
      <ActionForm key="del" action={removeRequest.bind(null, r.id)}>
        <SubmitButton variant="secondary" className={`${sz} text-red-700`}>
          حذف
        </SubmitButton>
      </ActionForm>,
    );
  return out;
}

export default async function PurchaseRequestsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const user = await requirePermission("purchase_invoices", "view");
  const sp = await searchParams;
  const rows = await listRequests(db);
  const lines = await requestLines(db, rows.map((r) => r.r.id));
  const canCreate = can(user.perms, "purchase_invoices", "create");
  const canApprove = can(user.perms, "purchase_invoices", "approve");
  const canRevert = can(user.perms, "purchase_invoices", "revert");
  const canDelete = can(user.perms, "purchase_invoices", "delete");
  const perms = { canCreate, canApprove, canRevert, canDelete };
  const creating = sp.new === "1" && canCreate;
  const linesOf = (id: number) => lines.filter((l) => l.requestId === id);
  const total = (id: number) => {
    const ls = linesOf(id).filter((l) => l.estimatedPrice != null);
    return ls.length ? ls.reduce((s, l) => s + Number(l.quantity) * Number(l.estimatedPrice), 0) : null;
  };

  return (
    <>
      <PageHeader title="طلبات الشراء" description="الورشة أو التشغيل يطلب القطع والإطارات والمستلزمات، والمدير يعتمد، ثم يصدر للطلب المعتمد أمر شراء للمورد.">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/purchase-orders" className="text-sm font-medium text-brand-700 hover:underline">
            أوامر الشراء ←
          </Link>
          {canCreate && <ListActions newHref="/purchase-requests?new=1" newLabel="طلب شراء" />}
        </div>
      </PageHeader>

      <DocCards empty="لا توجد طلبات شراء بعد">
        {rows.map(({ r, plate, by }) => {
          const t = total(r.id);
          const acts = RequestActions({ r, p: perms, big: true });
          return (
            <DocCard
              key={r.id}
              number={r.number}
              status={PR_STATUS[r.status]}
              date={r.requestDate}
              party={
                <span className="block text-sm leading-6 font-medium whitespace-normal">
                  {linesOf(r.id).map((l) => (
                    <span key={l.id} className="block">
                      {l.description} × <span className="ltr-nums">{Number(l.quantity).toLocaleString("en")}</span>
                    </span>
                  ))}
                </span>
              }
              meta={
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {plate ? <Plate>{plate}</Plate> : <span>بدون مركبة</span>}
                  {r.neededBy && (
                    <span>
                      مطلوب قبل <span className="ltr-nums">{fmtDate(r.neededBy)}</span>
                    </span>
                  )}
                  {by && <span>{by}</span>}
                  {r.notes && <span className="text-gray-400">{r.notes}</span>}
                  {r.rejectReason && <span className="text-red-600">سبب الرفض: {r.rejectReason}</span>}
                </span>
              }
              amount={t == null ? null : t.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              currency={t == null ? undefined : "SAR تقديري"}
              next={r.status === "draft" ? "ينتظر الاعتماد" : r.status === "approved" ? "أصدر أمر الشراء" : null}
              actions={acts.length ? acts : null}
            />
          );
        })}
      </DocCards>

      <div className="max-md:hidden">
      <Table head={["الرقم", "التاريخ", "الأصناف", "المركبة", "مطلوب قبل", "مقدم الطلب", "الحالة", ""]}>
        {rows.length === 0 && <EmptyRow cols={8}>لا توجد طلبات شراء بعد</EmptyRow>}
        {rows.map(({ r, plate, by }) => (
          <tr key={r.id}>
            <Td className="ltr-nums font-medium whitespace-nowrap">{r.number}</Td>
            <Td className="ltr-nums whitespace-nowrap">{fmtDate(r.requestDate)}</Td>
            <Td className="text-xs">
              {linesOf(r.id).map((l) => (
                  <div key={l.id}>
                    {l.description} × <span className="ltr-nums">{Number(l.quantity).toLocaleString("en")}</span>
                  </div>
                ))}
              {r.notes && <div className="text-gray-400">{r.notes}</div>}
              {r.rejectReason && <div className="text-red-600">سبب الرفض: {r.rejectReason}</div>}
            </Td>
            <Td>{plate ?? "—"}</Td>
            <Td className="ltr-nums">{r.neededBy ?? "—"}</Td>
            <Td className="text-xs">{by ?? "—"}</Td>
            <Td>
              <Badge tone={PR_STATUS[r.status].tone}>{PR_STATUS[r.status].label}</Badge>
            </Td>
            <Td>
              <div className="flex flex-wrap items-center gap-2">{RequestActions({ r, p: perms })}</div>
            </Td>
          </tr>
        ))}
      </Table>
      </div>
      {creating && <RequestPanel closeHref="/purchase-requests" />}
    </>
  );
}

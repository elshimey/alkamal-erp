import Link from "next/link";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { cashAccounts } from "@/lib/invoices";
import { getHrSettings, listAdvanceRequests } from "@/lib/hr";
import { todayRiyadh } from "@/lib/dates";
import { parseDocFilter, type DocListParams } from "@/lib/doc-filters";
import { ADVANCE_REQUEST_STATUS } from "@/data/hr";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, EmptyRow, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { RowCheck, SelectAll, SelectionTotal } from "@/components/row-selection";
import { DocToolbar } from "@/components/doc-toolbar";
import { approveAdvanceAction, bulkAdvances, rejectAdvanceAction } from "../actions";
import { fmt, HrTabs, Kpis } from "../ui";

const BASE = "/hr/advances";
const BULK_FORM = "bulk-advances";
const STATUSES = Object.fromEntries(Object.entries(ADVANCE_REQUEST_STATUS).map(([k, v]) => [k, v.label]));

export default async function AdvanceRequestsPage({ searchParams }: { searchParams: Promise<DocListParams> }) {
  const user = await requirePermission("payroll", "view");
  const sp = await searchParams;
  const today = todayRiyadh();
  const df = parseDocFilter(sp, Object.keys(STATUSES), today);
  const [settings, cashes, list, month] = await Promise.all([
    getHrSettings(db),
    cashAccounts(db),
    listAdvanceRequests(db, { q: df.q, status: df.status, from: df.from, to: df.to }),
    listAdvanceRequests(db, { from: `${today.slice(0, 7)}-01`, to: today }),
  ]);
  const canApprove = can(user.perms, "payroll", "approve");
  const pending = list.filter((x) => x.r.status === "pending");
  const day = Number(today.slice(8, 10));
  const isOpen = day >= settings.advanceOpenDay && day <= settings.advanceCloseDay;

  const cashSelect = (
    <Select name="cashAccountId" defaultValue="" className="w-40">
      <option value="">اعتماد دون صرف</option>
      {cashes.map((a) => (
        <option key={a.id} value={a.id}>
          صرف من {a.nameAr}
        </option>
      ))}
    </Select>
  );

  return (
    <>
      <PageHeader
        title="الموارد البشرية"
        description="يطلب السائق من تطبيقه مقدم عمولة نقداً (في أيام الطلب وبحد شهري حسب فئته) أو سلفة من العهدة التي معه. مقدم العمولة يُستقطع كاملاً من مسير الشهر ويُصرف من الصندوق أو البنك. سلفة العهدة تُقيد على عهدة السائق (مدين سلف الموظفين، دائن عهدة السائق) وتُقسّط على الرواتب بالقسط الذي تحدده."
      />
      <HrTabs active="advances" />
      <Kpis
        items={[
          { label: "نافذة الطلب", value: `${settings.advanceOpenDay} – ${settings.advanceCloseDay}`, hint: isOpen ? "مفتوحة اليوم" : "مغلقة اليوم", href: "/settings/hr" },
          { label: "سقف الداخلي / الدولي", value: `${fmt(settings.advanceCapDomestic)} / ${fmt(settings.advanceCapInternational)}`, href: "/settings/hr" },
          { label: "مقدم العمولة هذا الشهر", value: fmt(month.filter((x) => x.r.status !== "rejected" && x.r.source !== "custody").reduce((t, x) => t + Number(x.r.amount), 0)) },
          { label: "بانتظار الاعتماد", value: pending.length, strong: true },
        ]}
      />

      <DocToolbar base={BASE} params={sp} statuses={STATUSES} allStatuses="كل الحالات" pay={false} views={false} sorts={{}} noun="طلب" exportName="طلبات-مقدم-العمولة" count={list.length} placeholder="ابحث بالرقم أو السائق" />

      {canApprove && pending.length > 0 && (
        <ActionForm id={BULK_FORM} action={bulkAdvances} className="mb-3 flex flex-wrap items-end gap-3 rounded-2xl bg-white px-4 py-2.5 shadow-sm">
          <SelectionTotal form={BULK_FORM} noun="طلب" />
          <Field label="صرف مقدم العمولة">{cashSelect}</Field>
          <span className="pb-2 text-xs text-gray-500">سلف العهدة تُقيد على عهدة السائق بقسط يساوي مبلغها</span>
          <SubmitButton variant="secondary">اعتماد المحدد</SubmitButton>
        </ActionForm>
      )}

      <Table head={[canApprove && pending.length ? <SelectAll key="all" form={BULK_FORM} /> : "", "الرقم", "التاريخ", "السائق", "النوع", "المبلغ", "ملاحظة", "الحالة", ""]}>
        {list.length === 0 && <EmptyRow cols={9}>لا توجد طلبات بعد. يطلبها السائق من تبويب «رصيدي» في تطبيقه.</EmptyRow>}
        {list.map(({ r, name, commissionClass, advance }) => (
          <tr key={r.id} className="transition hover:bg-brand-50/40">
            <Td>{canApprove && r.status === "pending" && <RowCheck form={BULK_FORM} id={r.id} amount={r.amount} />}</Td>
            <Td className="ltr-nums font-medium whitespace-nowrap text-brand-700">{r.number}</Td>
            <Td className="ltr-nums whitespace-nowrap">{r.requestDate}</Td>
            <Td className="font-medium">{name}</Td>
            <Td>
              {r.source === "custody" ? <Badge tone="blue">سلفة من العهدة</Badge> : "مقدم عمولة"}
              <div className="text-xs text-gray-400">{commissionClass === "international" ? "دولي" : "داخلي"}</div>
            </Td>
            <Td className="ltr-nums font-semibold">{fmt(r.amount)}</Td>
            <Td>
              {r.notes}
              {r.rejectReason && <div className="text-xs text-red-600">سبب الرفض: {r.rejectReason}</div>}
            </Td>
            <Td>
              <Badge tone={ADVANCE_REQUEST_STATUS[r.status].tone}>{ADVANCE_REQUEST_STATUS[r.status].label}</Badge>
              {advance && (
                <Link href="/payroll/advances" className="ltr-nums mt-1 block text-xs text-brand-700 hover:underline">
                  {advance}
                </Link>
              )}
            </Td>
            <Td>
              {r.status === "pending" && canApprove && (
                <div className="flex flex-wrap items-center gap-2">
                  <ActionForm action={approveAdvanceAction.bind(null, r.id)} resetOnSuccess={false} className="flex items-center gap-1.5">
                    {r.source === "custody" ? <Input name="installment" inputMode="decimal" dir="ltr" placeholder={`القسط الشهري (${fmt(r.amount)})`} className="w-36" /> : cashSelect}
                    <SubmitButton>اعتماد</SubmitButton>
                  </ActionForm>
                  <ActionForm action={rejectAdvanceAction.bind(null, r.id)} className="flex items-center gap-1.5">
                    <Input name="reason" placeholder="سبب الرفض" className="w-28" />
                    <SubmitButton variant="secondary">رفض</SubmitButton>
                  </ActionForm>
                </div>
              )}
            </Td>
          </tr>
        ))}
      </Table>
    </>
  );
}

import Link from "next/link";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { employeeOptions } from "@/lib/lookups";
import { leaveBalances, listLeaves, listLeaveTypes, type LeaveFilter } from "@/lib/hr";
import { todayRiyadh } from "@/lib/dates";
import { listHref, parseDocFilter, type DocListParams } from "@/lib/doc-filters";
import { LEAVE_STATUS } from "@/data/hr";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { SheetEditor } from "@/components/sheet-editor";
import { Badge, EmptyRow, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { RowCheck, SelectAll, SelectionTotal } from "@/components/row-selection";
import { DocToolbar } from "@/components/doc-toolbar";
import { bulkLeaves, leaveStep, rejectLeaveAction, saveLeaveRows } from "../actions";
import { EntryPanel, HrTabs, Kpis } from "../ui";

const BASE = "/hr/leaves";
const BULK_FORM = "bulk-leaves";
const STATUSES = Object.fromEntries(Object.entries(LEAVE_STATUS).map(([k, v]) => [k, v.label]));

export default async function LeavesPage({ searchParams }: { searchParams: Promise<DocListParams & { type?: string; employee?: string; tab?: string; year?: string }> }) {
  const user = await requirePermission("leaves", "view");
  const sp = await searchParams;
  const today = todayRiyadh();
  const year = Number(sp.year) || Number(today.slice(0, 4));
  const df = parseDocFilter(sp, Object.keys(STATUSES), today);
  const filter: LeaveFilter = { q: df.q, from: df.from, to: df.to, status: df.status, typeId: Number(sp.type) || undefined, employeeId: Number(sp.employee) || undefined };
  const balancesTab = sp.tab === "balances";
  const [employees, types, list, pendingAll, current, balances] = await Promise.all([
    employeeOptions(),
    listLeaveTypes(db, true),
    listLeaves(db, filter),
    listLeaves(db, { status: "pending" }),
    listLeaves(db, { status: "approved", from: today, to: today }),
    balancesTab ? leaveBalances(db, year) : Promise.resolve(null),
  ]);
  const canApprove = can(user.perms, "leaves", "approve");
  const canCancel = can(user.perms, "leaves", "revert");
  const pending = list.filter((x) => x.l.status === "pending");

  return (
    <>
      <PageHeader
        title="الموارد البشرية"
        description="طلب ثم اعتماد. الرصيد السنوي حسب نظام العمل: 21 يوماً، و30 يوماً بعد خمس سنوات خدمة. الإجازة بدون راتب تُخصم في المسير تلقائياً، والسائق في إجازة معتمدة لا تُسند إليه رحلة."
      />
      <HrTabs active="leaves" />
      <Kpis
        items={[
          { label: "في إجازة اليوم", value: current.length, hint: current.slice(0, 3).map((x) => x.employee).join("، ") || "لا أحد" },
          { label: "طلبات بانتظار الاعتماد", value: pendingAll.length, strong: true, href: listHref(BASE, {}, { status: "pending" }) },
          { label: "أيام معتمدة هذا العام", value: list.filter((x) => x.l.status === "approved" && x.l.fromDate.startsWith(String(year))).reduce((t, x) => t + x.l.days, 0) },
          { label: "أنواع الإجازات", value: types.length, href: "/settings/hr", hint: "تعديل من الإعدادات" },
        ]}
      />

      <nav className="mb-5 flex gap-2 text-sm">
        <Link href={BASE} className={`rounded-full px-4 py-1.5 ${!balancesTab ? "bg-asphalt-900 text-brand-500" : "bg-white text-gray-600 shadow-sm"}`}>
          الطلبات
        </Link>
        <Link href={`${BASE}?tab=balances`} className={`rounded-full px-4 py-1.5 ${balancesTab ? "bg-asphalt-900 text-brand-500" : "bg-white text-gray-600 shadow-sm"}`}>
          أرصدة الإجازات
        </Link>
      </nav>

      {balances ? (
        <>
          <form className="mb-4 flex items-center gap-2 text-sm">
            <input type="hidden" name="tab" value="balances" />
            <Input type="number" name="year" defaultValue={year} className="w-28" />
            <button className="rounded-lg border border-gray-300 bg-white px-3 py-2 hover:bg-gray-50">عرض السنة</button>
          </form>
          <Table head={["الموظف", ...balances.types.map((t) => t.nameAr)]}>
            {balances.rows.length === 0 && <EmptyRow cols={balances.types.length + 1}>لا يوجد موظفون</EmptyRow>}
            {balances.rows.map((r) => (
              <tr key={r.id}>
                <Td className="font-medium">
                  {r.name}
                  <div className="text-xs font-normal text-gray-500">{r.isDriver ? "سائق" : "إداري"}</div>
                </Td>
                {r.balances.map((b) => (
                  <Td key={b.typeId} className="ltr-nums">
                    <span className={`font-semibold ${b.left <= 0 ? "text-red-600" : "text-brand-900"}`}>{b.left}</span>
                    <span className="text-xs text-gray-400"> / {b.quota}</span>
                    {b.pending > 0 && <div className="text-[11px] text-amber-700">{b.pending} بانتظار الاعتماد</div>}
                  </Td>
                ))}
              </tr>
            ))}
          </Table>
          <p className="mt-3 text-xs text-gray-500">المتبقي / المستحق للسنة. الإجازة بدون راتب والأنواع بلا رصيد لا تظهر هنا.</p>
        </>
      ) : (
        <>
          {can(user.perms, "leaves", "create") && (
            <EntryPanel icon="calendar" title="طلبات إجازة" hint="لعدة موظفين معاً، أو الصق من Excel">
              <SheetEditor
                templateName="طلبات الإجازة"
                action={saveLeaveRows}
                initialRows={3}
                columns={[
                  { key: "employeeId", label: "الموظف", type: "select", required: true, options: employees, width: "11rem" },
                  { key: "typeId", label: "النوع", type: "select", required: true, options: types.map((t) => ({ value: String(t.id), label: t.nameAr })), width: "9rem" },
                  { key: "fromDate", label: "من", type: "date", required: true },
                  { key: "toDate", label: "إلى", type: "date", required: true },
                  { key: "reason", label: "السبب", width: "16rem" },
                ]}
              />
            </EntryPanel>
          )}

          <DocToolbar base={BASE} params={sp} statuses={STATUSES} allStatuses="كل الحالات" pay={false} views={false} sorts={{}} noun="طلب" exportName="الإجازات" count={list.length} placeholder="ابحث بالرقم أو الموظف أو السبب" />
          <form className="mb-4 flex flex-wrap items-center gap-2 text-sm print:hidden">
            {(["q", "period", "status"] as const).map((k) => sp[k] && <input key={k} type="hidden" name={k} value={sp[k]} />)}
            <Select name="type" defaultValue={filter.typeId ?? ""} className="w-40">
              <option value="">كل الأنواع</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nameAr}
                </option>
              ))}
            </Select>
            <Select name="employee" defaultValue={filter.employeeId ?? ""} className="w-44">
              <option value="">كل الموظفين</option>
              {employees.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <button className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50">تصفية</button>
          </form>

          {canApprove && pending.length > 0 && (
            <ActionForm id={BULK_FORM} action={bulkLeaves} className="mb-3 flex flex-wrap items-center gap-3 rounded-2xl bg-white px-4 py-2.5 shadow-sm">
              <SelectionTotal form={BULK_FORM} noun="طلب" />
              <SubmitButton variant="secondary">اعتماد المحدد</SubmitButton>
            </ActionForm>
          )}

          <Table head={[canApprove && pending.length ? <SelectAll key="all" form={BULK_FORM} /> : "", "الرقم", "الموظف", "النوع", "من", "إلى", "الأيام", "السبب", "الحالة", ""]}>
            {list.length === 0 && <EmptyRow cols={10}>{filter.q || filter.status || filter.typeId || filter.employeeId ? "لا توجد طلبات بهذه الشروط" : "لا توجد طلبات إجازة بعد"}</EmptyRow>}
            {list.map(({ l, employee, type, paid }) => (
              <tr key={l.id} className="transition hover:bg-brand-50/40">
                <Td>{canApprove && l.status === "pending" && <RowCheck form={BULK_FORM} id={l.id} amount={String(l.days)} />}</Td>
                <Td className="ltr-nums font-medium whitespace-nowrap text-brand-700">{l.number}</Td>
                <Td className="font-medium">{employee}</Td>
                <Td>
                  {type}
                  {!paid && <div className="text-xs text-red-600">تُخصم من الراتب</div>}
                </Td>
                <Td className="ltr-nums whitespace-nowrap">{l.fromDate}</Td>
                <Td className="ltr-nums whitespace-nowrap">{l.toDate}</Td>
                <Td className="ltr-nums font-semibold">{l.days}</Td>
                <Td>
                  {l.reason}
                  {l.rejectReason && <div className="text-xs text-red-600">سبب الرفض: {l.rejectReason}</div>}
                </Td>
                <Td>
                  <Badge tone={LEAVE_STATUS[l.status].tone}>{LEAVE_STATUS[l.status].label}</Badge>
                </Td>
                <Td>
                  <div className="flex flex-wrap items-center gap-2">
                    {l.status === "pending" && canApprove && (
                      <>
                        <ActionForm action={leaveStep.bind(null, l.id, "approve")} resetOnSuccess={false} className="flex items-center gap-1.5">
                          <label className="flex items-center gap-1 text-[11px] text-gray-500" title="اعتماد ولو تجاوز الرصيد">
                            <input type="checkbox" name="override" className="size-3.5" />
                            تجاوز الرصيد
                          </label>
                          <SubmitButton>اعتماد</SubmitButton>
                        </ActionForm>
                        <ActionForm action={rejectLeaveAction.bind(null, l.id)} className="flex items-center gap-1.5">
                          <Input name="reason" placeholder="سبب الرفض" className="w-28" />
                          <SubmitButton variant="secondary">رفض</SubmitButton>
                        </ActionForm>
                      </>
                    )}
                    {(l.status === "pending" || l.status === "approved") && canCancel && (
                      <ActionForm action={leaveStep.bind(null, l.id, "cancel")} resetOnSuccess={false}>
                        <SubmitButton variant="secondary">إلغاء</SubmitButton>
                      </ActionForm>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </>
  );
}

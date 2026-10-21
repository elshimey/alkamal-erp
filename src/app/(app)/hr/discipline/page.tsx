import Link from "next/link";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { employeeOptions } from "@/lib/lookups";
import { getHrSettings, listHrActions, type HrActionFilter } from "@/lib/hr";
import { todayRiyadh } from "@/lib/dates";
import { listHref, parseDocFilter, type DocListParams } from "@/lib/doc-filters";
import { HR_ACTION_KIND, HR_ACTION_STATUS } from "@/data/hr";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { SheetEditor } from "@/components/sheet-editor";
import { Badge, EmptyRow, Field, PageHeader, Select, Table, Td } from "@/components/ui";
import { RowCheck, SelectAll, SelectionTotal } from "@/components/row-selection";
import { DocToolbar } from "@/components/doc-toolbar";
import { bulkHrActions, hrActionStep, saveHrActionRows } from "../actions";
import { EntryPanel, fmt, HrTabs, Kpis } from "../ui";

const BASE = "/hr/discipline";
const BULK_FORM = "bulk-hr-actions";
const STATUSES = Object.fromEntries(Object.entries(HR_ACTION_STATUS).map(([k, v]) => [k, v.label]));
type Kind = keyof typeof HR_ACTION_KIND;

export default async function DisciplinePage({ searchParams }: { searchParams: Promise<DocListParams & { kind?: string; employee?: string }> }) {
  const user = await requirePermission("hr_actions", "view");
  const sp = await searchParams;
  const today = todayRiyadh();
  const df = parseDocFilter(sp, Object.keys(STATUSES), today);
  const filter: HrActionFilter = {
    q: df.q,
    from: df.from,
    to: df.to,
    status: df.status,
    kind: sp.kind && sp.kind in HR_ACTION_KIND ? (sp.kind as Kind) : undefined,
    employeeId: Number(sp.employee) || undefined,
  };
  const monthStart = `${today.slice(0, 7)}-01`;
  const [employees, settings, list, month] = await Promise.all([
    employeeOptions(),
    getHrSettings(db),
    listHrActions(db, filter),
    listHrActions(db, { from: monthStart, to: today, status: "approved" }),
  ]);
  const canApprove = can(user.perms, "hr_actions", "approve");
  const canCancel = can(user.perms, "hr_actions", "revert");
  const drafts = list.filter((x) => x.a.status === "draft");
  const sum = (k: Kind) => month.filter((x) => x.a.kind === k).reduce((t, x) => t + Number(x.a.amount), 0);
  const selectable = canApprove || canCancel ? list.filter((x) => x.a.status !== "cancelled" && !(x.a.payrollRunId && x.runStatus !== "draft")) : [];

  return (
    <>
      <PageHeader
        title="الموارد البشرية"
        description={`الإنذار يخصم ${settings.warningPoints} نقطة من تقييم الشهر (تُعدّل لكل إنذار). الجزاء يُخصم من الراتب ويُحتجز في حساب 2116 لصالح العمال كما يشترط نظام العمل، والحافز يضاف للراتب. كلاهما يدخل مسير شهره تلقائياً بعد الاعتماد.`}
      />
      <HrTabs active="actions" />
      <Kpis
        items={[
          { label: "إنذارات هذا الشهر", value: month.filter((x) => x.a.kind === "warning").length, hint: "معتمدة، تخصم من التقييم" },
          { label: "جزاءات هذا الشهر", value: fmt(sum("penalty")), hint: "تُخصم في المسير" },
          { label: "حوافز هذا الشهر", value: fmt(sum("incentive")), hint: "تضاف في المسير" },
          { label: "مسودات بانتظار الاعتماد", value: drafts.length, strong: true, href: listHref(BASE, {}, { status: "draft" }) },
        ]}
      />

      {can(user.perms, "hr_actions", "create") && (
        <EntryPanel icon="alert" title="تسجيل إنذارات وجزاءات وحوافز" hint="عدة موظفين معاً، أو الصق من Excel">
          <SheetEditor
            templateName="الإنذارات والجزاءات والحوافز"
            action={saveHrActionRows}
            initialRows={3}
            columns={[
              { key: "kind", label: "النوع", type: "select", required: true, width: "6rem", options: Object.entries(HR_ACTION_KIND).map(([value, k]) => ({ value, label: k.label })) },
              { key: "employeeId", label: "الموظف", type: "select", required: true, options: employees, width: "11rem" },
              { key: "actionDate", label: "التاريخ", type: "date", placeholder: today },
              { key: "reason", label: "السبب", required: true, width: "18rem" },
              { key: "amount", label: "المبلغ (جزاء أو حافز)", type: "number", width: "8rem" },
              { key: "points", label: "نقاط الإنذار", type: "number", width: "6rem", placeholder: String(settings.warningPoints) },
            ]}
          />
        </EntryPanel>
      )}

      <DocToolbar base={BASE} params={sp} statuses={STATUSES} allStatuses="كل الحالات" pay={false} views={false} sorts={{}} noun="مستند" exportName="الإنذارات-والجزاءات-والحوافز" count={list.length} placeholder="ابحث بالرقم أو الموظف أو السبب" />
      <form className="mb-4 flex flex-wrap items-center gap-2 text-sm print:hidden">
        {(["q", "period", "status"] as const).map((k) => sp[k] && <input key={k} type="hidden" name={k} value={sp[k]} />)}
        <Select name="kind" defaultValue={filter.kind ?? ""} className="w-32">
          <option value="">كل الأنواع</option>
          {Object.entries(HR_ACTION_KIND).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
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

      {selectable.length > 0 && (
        <ActionForm id={BULK_FORM} action={bulkHrActions} className="mb-3 flex flex-wrap items-end gap-3 rounded-2xl bg-white px-4 py-2.5 shadow-sm">
          <SelectionTotal form={BULK_FORM} noun="مستند" />
          <Field label="الإجراء">
            <Select name="op" defaultValue={canApprove ? "approve" : "cancel"} className="w-44">
              {canApprove && <option value="approve">اعتماد المسودات</option>}
              {canCancel && <option value="cancel">إلغاء</option>}
            </Select>
          </Field>
          <SubmitButton variant="secondary">تنفيذ على المحدد</SubmitButton>
        </ActionForm>
      )}

      <Table head={[selectable.length ? <SelectAll key="all" form={BULK_FORM} /> : "", "الرقم", "التاريخ", "الموظف", "النوع", "السبب", "الأثر", "المسير", "الحالة", ""]}>
        {list.length === 0 && <EmptyRow cols={10}>{filter.q || filter.status || filter.kind || filter.employeeId ? "لا توجد مستندات بهذه الشروط" : "لا توجد إنذارات ولا جزاءات ولا حوافز بعد"}</EmptyRow>}
        {list.map(({ a, employee, run, runStatus }) => (
          <tr key={a.id} className="transition hover:bg-brand-50/40">
            <Td>{selectable.some((x) => x.a.id === a.id) && <RowCheck form={BULK_FORM} id={a.id} amount={a.amount} />}</Td>
            <Td className="ltr-nums font-medium whitespace-nowrap text-brand-700">{a.number}</Td>
            <Td className="ltr-nums whitespace-nowrap">{a.actionDate}</Td>
            <Td className="font-medium">{employee}</Td>
            <Td>
              <Badge tone={HR_ACTION_KIND[a.kind].tone}>{HR_ACTION_KIND[a.kind].label}</Badge>
            </Td>
            <Td>{a.reason}</Td>
            <Td className="ltr-nums whitespace-nowrap">
              {a.kind === "warning" ? <span className="text-amber-700">−{a.points} نقطة</span> : <span className={a.kind === "penalty" ? "text-red-600" : "text-green-700"}>{a.kind === "penalty" ? "−" : "+"}{fmt(a.amount)}</span>}
            </Td>
            <Td className="text-xs whitespace-nowrap">
              {a.kind === "warning" ? (
                "—"
              ) : run ? (
                <span className={runStatus === "draft" ? "text-amber-700" : "text-green-700"}>
                  {runStatus === "draft" ? "في مسودة " : "في "}
                  <span className="ltr-nums">{run}</span>
                </span>
              ) : a.status === "approved" ? (
                <span className="text-gray-500">بانتظار المسير</span>
              ) : (
                "—"
              )}
            </Td>
            <Td>
              <Badge tone={HR_ACTION_STATUS[a.status].tone}>{HR_ACTION_STATUS[a.status].label}</Badge>
            </Td>
            <Td>
              <div className="flex gap-2">
                {a.status === "draft" && canApprove && (
                  <ActionForm action={hrActionStep.bind(null, a.id, "approve")} resetOnSuccess={false}>
                    <SubmitButton className="whitespace-nowrap">اعتماد</SubmitButton>
                  </ActionForm>
                )}
                {a.status !== "cancelled" && canCancel && !(a.payrollRunId && runStatus !== "draft") && (
                  <ActionForm action={hrActionStep.bind(null, a.id, "cancel")} resetOnSuccess={false}>
                    <SubmitButton variant="secondary">إلغاء</SubmitButton>
                  </ActionForm>
                )}
              </div>
            </Td>
          </tr>
        ))}
      </Table>
      <p className="mt-3 text-xs text-gray-500">
        مخالفات السائق المرورية {settings.violationsAsWarnings ? "تُحسب إنذارات" : "لا تُحسب إنذارات"} في التقييم الشهري. تعديل النقاط والإعدادات من{" "}
        <Link href="/settings/hr" className="text-brand-700 underline">
          إعدادات الموارد البشرية
        </Link>
        .
      </p>
    </>
  );
}

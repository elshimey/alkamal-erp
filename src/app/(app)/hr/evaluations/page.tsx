import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { evaluationMonth, getHrSettings, listCriteria, listPromotions, promotionCandidates } from "@/lib/hr";
import { todayRiyadh } from "@/lib/dates";
import { monthLabel } from "@/data/payroll";
import { EVALUATION_STATUS, scoreLevel } from "@/data/hr";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, EmptyRow, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { RowCheck, SelectAll, SelectionTotal } from "@/components/row-selection";
import { bulkEvaluations, promoteAction, saveEvaluationsAction } from "../actions";
import { fmt, HrTabs, Kpis } from "../ui";

const BULK_FORM = "bulk-evaluations";

export default async function EvaluationsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const user = await requirePermission("evaluations", "view");
  const sp = await searchParams;
  const today = todayRiyadh();
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : today.slice(0, 7);
  const [settings, criteria, rows, candidates, promotions] = await Promise.all([getHrSettings(db), listCriteria(db, true), evaluationMonth(db, month), promotionCandidates(db), listPromotions(db, 20)]);
  const canEdit = can(user.perms, "evaluations", "create");
  const canApprove = can(user.perms, "evaluations", "approve");
  const canRevert = can(user.perms, "evaluations", "revert");
  const done = rows.filter((r) => r.evaluation);
  const avg = done.length ? done.reduce((t, r) => t + Number(r.evaluation!.finalScore), 0) / done.length : 0;
  const totalWeight = criteria.reduce((t, c) => t + c.weight, 0);

  return (
    <>
      <PageHeader
        title="الموارد البشرية"
        description={`كل معيار من 0 إلى 10 بوزنه، والدرجة من 100. يُخصم عن كل إنذار معتمد نقاطه${settings.violationsAsWarnings ? `، وعن كل مخالفة مرورية للسائق ${settings.warningPoints} نقطة` : ""}. الترقية تظهر مستحقة بعد ${settings.promotionMonths} أشهر متتالية بدرجة ${settings.promotionScore} فأعلى.`}
      />
      <HrTabs active="evaluations" />
      <Kpis
        items={[
          { label: `مُقيَّمون في ${monthLabel(month)}`, value: `${done.length} / ${rows.length}` },
          { label: "متوسط الدرجة", value: done.length ? fmt(avg) : "—", hint: done.length ? scoreLevel(avg).label : undefined, strong: true },
          { label: "معتمدة", value: done.filter((r) => r.evaluation!.status === "approved").length },
          { label: "مستحقون للترقية", value: candidates.length },
        ]}
      />

      <form className="mb-4 flex items-center gap-2 text-sm">
        <Input type="month" name="month" defaultValue={month} className="w-44" />
        <button className="rounded-lg border border-gray-300 bg-white px-3 py-2 hover:bg-gray-50">عرض الشهر</button>
      </form>

      {criteria.length === 0 ? (
        <Card className="mb-6">أضف معايير التقييم من إعدادات الموارد البشرية أولاً.</Card>
      ) : (
        <Card title={`تقييم ${monthLabel(month)}`} className="mb-6">
          {canApprove && done.length > 0 && (
            <ActionForm id={BULK_FORM} action={bulkEvaluations} className="mb-3 flex flex-wrap items-end gap-3">
              <SelectionTotal form={BULK_FORM} noun="تقييم" />
              <Field label="الإجراء">
                <Select name="op" defaultValue="approve" className="w-36">
                  <option value="approve">اعتماد</option>
                  {canRevert && <option value="revert">إرجاع لمسودة</option>}
                </Select>
              </Field>
              <SubmitButton variant="secondary">تنفيذ على المحدد</SubmitButton>
            </ActionForm>
          )}
          <ActionForm action={saveEvaluationsAction.bind(null, month)} resetOnSuccess={false}>
            {criteria.map((c) => (
              <input key={c.id} type="hidden" name="criterion" value={c.id} />
            ))}
            <Table
              head={[
                canApprove && done.length ? <SelectAll key="all" form={BULK_FORM} /> : "",
                "الموظف",
                ...criteria.map((c) => (
                  <span key={c.id} title={`الوزن ${c.weight} من ${totalWeight}`} className="block max-w-[6.5rem] leading-snug whitespace-normal">
                    {c.nameAr}
                    <span className="block text-[10px] font-normal opacity-70">وزن {c.weight}</span>
                  </span>
                )),
                "الإنذارات",
                "الدرجة",
                "الحالة",
              ]}
            >
              {rows.length === 0 && <EmptyRow cols={criteria.length + 5}>لا يوجد موظفون</EmptyRow>}
              {rows.map((r) => {
                const ev = r.evaluation;
                const locked = ev?.status === "approved" || !canEdit;
                const score = ev ? Number(ev.finalScore) : null;
                const level = score != null ? scoreLevel(score) : null;
                return (
                  <tr key={r.id}>
                    <Td>{ev && canApprove && <RowCheck form={BULK_FORM} id={ev.id} amount={ev.finalScore} />}</Td>
                    <Td className="font-medium whitespace-nowrap">
                      <input type="hidden" name="employee" value={r.id} />
                      {r.name}
                      <div className="text-xs font-normal text-gray-500">{r.isDriver ? "سائق" : (r.jobTitle ?? "إداري")}</div>
                    </Td>
                    {criteria.map((c) => (
                      <Td key={c.id}>
                        <Input type="number" min={0} max={10} step="0.5" name={`s_${r.id}_${c.id}`} defaultValue={ev?.scores[String(c.id)] ?? ""} disabled={locked} className="w-14" />
                      </Td>
                    ))}
                    <Td className="text-xs whitespace-nowrap">
                      {r.warnings ? <span className="text-amber-700">{r.warnings} إنذار</span> : null}
                      {r.violations ? <div className="text-red-600">{r.violations} مخالفة</div> : null}
                      {!r.warnings && !r.violations && "—"}
                    </Td>
                    <Td className="whitespace-nowrap">
                      {ev ? (
                        <>
                          <span className="ltr-nums font-semibold text-brand-900">{fmt(ev.finalScore)}</span> <Badge tone={level!.tone}>{level!.label}</Badge>
                          {Number(ev.deduction) > 0 && (
                            <div className="ltr-nums text-[11px] text-gray-400">
                              {fmt(ev.baseScore)} − {fmt(ev.deduction)}
                            </div>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td>{ev ? <Badge tone={EVALUATION_STATUS[ev.status].tone}>{EVALUATION_STATUS[ev.status].label}</Badge> : <span className="text-xs text-gray-400">لم يُقيَّم</span>}</Td>
                  </tr>
                );
              })}
            </Table>
            {canEdit && rows.length > 0 && (
              <div className="mt-4 flex items-center gap-3">
                <SubmitButton>حفظ التقييمات</SubmitButton>
                <span className="text-xs text-gray-500">يُحفظ من أدخلت له درجة فقط. المعتمد مقفل حتى يُرجع لمسودة.</span>
              </div>
            )}
          </ActionForm>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="المستحقون للترقية">
          {candidates.length === 0 && <p className="text-sm text-gray-500">لا يوجد مستحق بعد. يظهر هنا من أكمل {settings.promotionMonths} تقييمات معتمدة متتالية بدرجة {settings.promotionScore} فأعلى.</p>}
          <ul className="space-y-4">
            {candidates.map((c) => (
              <li key={c.employeeId} className="rounded-xl border border-gray-200 p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-brand-900">{c.name}</div>
                    <div className="text-xs text-gray-500">
                      {c.jobTitle ?? "—"} · الأساسي <span className="ltr-nums">{fmt(c.basic)}</span>
                    </div>
                  </div>
                  <Badge tone="green">متوسط {fmt(c.average)}</Badge>
                </div>
                {canApprove && (
                  <ActionForm action={promoteAction} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="employeeId" value={c.employeeId} />
                    <Field label="المسمى الجديد">
                      <Input name="toTitle" defaultValue={c.jobTitle ?? ""} className="w-36" />
                    </Field>
                    <Field label="الأساسي الجديد">
                      <Input type="number" step="0.01" min={0} name="toBasic" required defaultValue={c.basic} className="w-28" />
                    </Field>
                    <Field label="من تاريخ">
                      <Input type="date" name="effectiveDate" defaultValue={today} className="w-36" />
                    </Field>
                    <SubmitButton>ترقية</SubmitButton>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="سجل الترقيات">
          <Table head={["الموظف", "التاريخ", "المسمى", "الأساسي"]}>
            {promotions.length === 0 && <EmptyRow cols={4}>لا توجد ترقيات بعد</EmptyRow>}
            {promotions.map(({ p, name }) => (
              <tr key={p.id}>
                <Td className="font-medium">{name}</Td>
                <Td className="ltr-nums whitespace-nowrap">{p.effectiveDate}</Td>
                <Td className="text-xs">
                  {p.fromTitle ?? "—"} ← <b>{p.toTitle ?? "—"}</b>
                </Td>
                <Td className="ltr-nums text-xs whitespace-nowrap">
                  {fmt(p.fromBasic)} ← <b>{fmt(p.toBasic)}</b>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}

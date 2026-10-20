import Link from "next/link";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { employeeOptions } from "@/lib/lookups";
import { cashAccounts } from "@/lib/invoices";
import { custodyDoc, custodyExpenseAccounts, listCustody, type CustodyFilter } from "@/lib/hr";
import { getCompany, getInvoiceTemplate } from "@/lib/company";
import { todayRiyadh } from "@/lib/dates";
import { listHref, parseDocFilter, type DocListParams } from "@/lib/doc-filters";
import { CUSTODY_KIND, CUSTODY_STATUS } from "@/data/hr";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { SheetEditor } from "@/components/sheet-editor";
import { Badge, EmptyRow, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { RowCheck, SelectAll, SelectionTotal } from "@/components/row-selection";
import { BulkPdfButton } from "@/components/bulk-pdf";
import { DocToolbar } from "@/components/doc-toolbar";
import { Icon } from "@/components/icons";
import { CustodyDocument } from "@/components/custody-document";
import { bulkCustody, closeCustodyAction, custodyStep, deliverCustodyAction, saveCustodyRows } from "../actions";
import { EntryPanel, fmt, HrTabs, Kpis, YES_NO } from "../ui";

const BASE = "/hr/custody";
const BULK_FORM = "bulk-custody";
// خطوة للخلف: المغلقة ← مسلّمة ← معتمدة ← مسودة (الافتتاحية لا ترجع عن التسليم)
const stepBack = (c: { status: string; isOpening: boolean }) => ["settled", "returned", "approved"].includes(c.status) || (c.status === "delivered" && !c.isOpening);
const STATUSES = Object.fromEntries(Object.entries(CUSTODY_STATUS).map(([k, v]) => [k, v.label]));

export default async function CustodyPage({ searchParams }: { searchParams: Promise<DocListParams & { kind?: string; employee?: string }> }) {
  const user = await requirePermission("custody", "view");
  const sp = await searchParams;
  const today = todayRiyadh();
  const df = parseDocFilter(sp, Object.keys(STATUSES), today);
  const filter: CustodyFilter = {
    q: df.q,
    from: df.from,
    to: df.to,
    status: df.status,
    kind: sp.kind === "cash" || sp.kind === "in_kind" ? sp.kind : undefined,
    employeeId: Number(sp.employee) || undefined,
  };
  const openId = Number(sp.open) || null;
  const [employees, cashes, expenses, list, all, openDoc, company, template] = await Promise.all([
    employeeOptions(),
    cashAccounts(db),
    custodyExpenseAccounts(db),
    listCustody(db, filter),
    listCustody(db, {}, 5000),
    openId ? custodyDoc(db, openId) : Promise.resolve(null),
    getCompany(db),
    getInvoiceTemplate(db),
  ]);
  const canCreate = can(user.perms, "custody", "create");
  const canApprove = can(user.perms, "custody", "approve");
  const canRevert = can(user.perms, "custody", "revert");
  const canCancel = can(user.perms, "custody", "delete");
  const open = all.filter((x) => x.c.status === "delivered");
  const cashOpen = open.filter((x) => x.c.kind === "cash").reduce((t, x) => t + Number(x.c.amount) - Number(x.c.returnedAmount), 0);
  const kindOpen = open.filter((x) => x.c.kind === "in_kind").reduce((t, x) => t + Number(x.c.amount), 0);
  const waiting = all.filter((x) => x.c.status === "draft" || x.c.status === "approved").length;
  const selectable = canApprove ? list.filter((x) => x.c.status === "draft" || x.c.status === "approved") : [];

  return (
    <>
      <PageHeader
        title="الموارد البشرية"
        description="العهدة النقدية تُقيد عند التسليم (مدين عهدة الموظف، دائن الصندوق) وتُغلق بإعادة المتبقي أو تسويته بمستندات. العينية (جوال، عدة، بطاقة وقود) سجل رقابي بقيمتها دون قيد. لا تُنهى خدمة موظف عليه عهدة مفتوحة."
      />
      <HrTabs active="custody" />
      <Kpis
        items={[
          { label: "عهد مفتوحة لدى الموظفين", value: open.length, hint: "مسلّمة ولم تُسوَّ" },
          { label: "نقدية مفتوحة", value: fmt(cashOpen), hint: "رصيدها في حسابات 1105", strong: true },
          { label: "عينية مفتوحة (قيمة تقديرية)", value: fmt(kindOpen) },
          { label: "بانتظار الاعتماد أو التسليم", value: waiting, href: listHref(BASE, {}, { status: "draft" }) },
        ]}
      />

      {canCreate && (
        <EntryPanel icon="handover" title="تسجيل عُهد" hint="اكتب أو الصق من Excel؛ «افتتاحية» للعهد القائمة قبل البرنامج">
          <SheetEditor
            templateName="العهد"
            action={saveCustodyRows}
            initialRows={3}
            columns={[
              { key: "kind", label: "النوع", type: "select", required: true, width: "6rem", options: Object.entries(CUSTODY_KIND).map(([value, label]) => ({ value, label })) },
              { key: "employeeId", label: "الموظف", type: "select", required: true, options: employees, width: "11rem" },
              { key: "docDate", label: "التاريخ", type: "date", placeholder: today },
              { key: "description", label: "الوصف", required: true, width: "14rem", placeholder: "جوال، عدة، مبلغ مصاريف طريق…" },
              { key: "quantity", label: "الكمية", type: "number", width: "5rem", placeholder: "1" },
              { key: "amount", label: "المبلغ / القيمة", type: "number", width: "7rem" },
              { key: "serialNo", label: "الرقم التسلسلي", ltr: true, width: "8rem" },
              { key: "isOpening", label: "افتتاحية", type: "select", options: YES_NO, width: "5rem", placeholder: "لا" },
              { key: "notes", label: "ملاحظات", width: "9rem" },
            ]}
          />
        </EntryPanel>
      )}

      <DocToolbar base={BASE} params={sp} statuses={STATUSES} allStatuses="كل الحالات" pay={false} views={false} sorts={{}} noun="عهدة" exportName="العهد" count={list.length} placeholder="ابحث بالرقم أو الموظف أو الوصف أو الرقم التسلسلي" />
      <form className="mb-4 flex flex-wrap items-center gap-2 text-sm print:hidden">
        {(["q", "period", "status"] as const).map((k) => sp[k] && <input key={k} type="hidden" name={k} value={sp[k]} />)}
        <Select name="kind" defaultValue={filter.kind ?? ""} className="w-32">
          <option value="">كل الأنواع</option>
          <option value="cash">نقدية</option>
          <option value="in_kind">عينية</option>
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
        <span className="ms-auto">
          <BulkPdfButton kind="custody" ids={list.map((x) => x.c.id)} />
        </span>
      </form>

      {openDoc && (
        <section className="animate-flyout mb-6 rounded-2xl bg-gray-100/70 shadow-inner">
          <div className="flex flex-wrap items-center gap-3 rounded-t-2xl border-b border-gray-200 bg-white px-5 py-3">
            <Link href={listHref(BASE, sp, { open: undefined })} scroll={false} aria-label="إغلاق المعاينة" className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100">
              <Icon name="close" className="size-4" />
            </Link>
            <span className="ltr-nums font-display text-lg font-semibold text-brand-900">{openDoc.c.number}</span>
            <Badge tone={CUSTODY_STATUS[openDoc.c.status].tone}>{CUSTODY_STATUS[openDoc.c.status].label}</Badge>
            <div className="ms-auto flex flex-wrap items-center gap-2">
              <Link href={`/print/custody?ids=${openDoc.c.id}`} target="_blank" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50">
                طباعة الإقرار
              </Link>
              {openDoc.c.status === "draft" && canApprove && (
                <ActionForm action={custodyStep.bind(null, openDoc.c.id, "approve")} resetOnSuccess={false}>
                  <SubmitButton>اعتماد</SubmitButton>
                </ActionForm>
              )}
              {openDoc.c.status === "approved" && canApprove && (
                <ActionForm action={deliverCustodyAction.bind(null, openDoc.c.id)} resetOnSuccess={false} className="flex items-center gap-2">
                  <Input type="date" name="date" defaultValue={openDoc.c.docDate} className="w-40" />
                  {openDoc.c.kind === "cash" && (
                    <Select name="cashAccountId" required defaultValue="" className="w-44">
                      <option value="" disabled>
                        صُرفت من
                      </option>
                      {cashes.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.nameAr}
                        </option>
                      ))}
                    </Select>
                  )}
                  <SubmitButton>تسليم للموظف</SubmitButton>
                </ActionForm>
              )}
              {canRevert && stepBack(openDoc.c) && (
                <ActionForm action={custodyStep.bind(null, openDoc.c.id, "revert")} resetOnSuccess={false}>
                  <SubmitButton variant="secondary">إرجاع خطوة</SubmitButton>
                </ActionForm>
              )}
              {(["draft", "approved"].includes(openDoc.c.status) || (openDoc.c.isOpening && openDoc.c.status === "delivered")) && canCancel && (
                <ActionForm action={custodyStep.bind(null, openDoc.c.id, "cancel")} resetOnSuccess={false}>
                  <SubmitButton variant="secondary">إلغاء</SubmitButton>
                </ActionForm>
              )}
            </div>
          </div>
          {openDoc.c.status === "delivered" && canApprove && (
            <ActionForm action={closeCustodyAction.bind(null, openDoc.c.id)} resetOnSuccess={false} className="flex flex-wrap items-end gap-3 border-b border-gray-200 bg-white px-5 py-3">
              <Field label="الإغلاق">
                <Select name="outcome" defaultValue="returned" className="w-40">
                  <option value="returned">{openDoc.c.kind === "cash" ? "إرجاع المبلغ كاملاً" : "استلام العهدة"}</option>
                  <option value="settled">{openDoc.c.kind === "cash" ? "تسوية بمستندات" : "تسوية (تالف أو مستهلك)"}</option>
                </Select>
              </Field>
              <Field label="التاريخ">
                <Input type="date" name="date" defaultValue={today} className="w-40" />
              </Field>
              {openDoc.c.kind === "cash" && (
                <>
                  <Field label="المُعاد للصندوق">
                    <Input type="number" step="0.01" min={0} name="returnedAmount" placeholder={fmt(openDoc.c.amount)} className="w-32" />
                  </Field>
                  <Field label="إلى">
                    <Select name="cashAccountId" defaultValue="" className="w-40">
                      <option value="">—</option>
                      {cashes.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.nameAr}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="مصروف بمستندات">
                    <Input type="number" step="0.01" min={0} name="spentAmount" className="w-32" />
                  </Field>
                  <Field label="على حساب">
                    <Select name="expenseAccountId" defaultValue="" className="w-48">
                      <option value="">—</option>
                      {expenses.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} {a.nameAr}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </>
              )}
              <Field label="ملاحظة">
                <Input name="notes" className="w-48" />
              </Field>
              <SubmitButton>إغلاق العهدة</SubmitButton>
              {openDoc.c.kind === "cash" && <p className="w-full text-xs text-gray-500">مصاريف السائق المعتمدة من التطبيق نزلت من عهدته مسبقاً، فلا تُدخلها هنا. أدخل فقط ما لم يُسجل بعد.</p>}
            </ActionForm>
          )}
          <div className="p-4 sm:p-6">
            <div className="mx-auto max-w-3xl">
              <CustodyDocument company={company} doc={openDoc} template={template} compact />
            </div>
          </div>
        </section>
      )}

      {selectable.length > 0 && (
        <ActionForm id={BULK_FORM} action={bulkCustody} className="mb-3 flex flex-wrap items-end gap-3 rounded-2xl bg-white px-4 py-2.5 shadow-sm">
          <SelectionTotal form={BULK_FORM} noun="عهدة" />
          <Field label="الإجراء">
            <Select name="op" defaultValue="approve" className="w-44">
              <option value="approve">اعتماد المسودات</option>
              <option value="deliver">تسليم المعتمدة</option>
            </Select>
          </Field>
          <Field label="تاريخ التسليم">
            <Input type="date" name="date" defaultValue={today} className="w-40" />
          </Field>
          <Field label="للنقدية: من">
            <Select name="cashAccountId" defaultValue="" className="w-44">
              <option value="">—</option>
              {cashes.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nameAr}
                </option>
              ))}
            </Select>
          </Field>
          <SubmitButton variant="secondary">تنفيذ على المحدد</SubmitButton>
        </ActionForm>
      )}

      <Table head={[selectable.length ? <SelectAll key="all" form={BULK_FORM} /> : "", "الرقم", "التاريخ", "الموظف", "العهدة", "النوع", "المبلغ / القيمة", "الحالة", ""]}>
        {list.length === 0 && <EmptyRow cols={9}>{filter.q || filter.status || filter.kind || filter.employeeId ? "لا توجد عهد بهذه الشروط" : "لا توجد عهد بعد"}</EmptyRow>}
        {list.map(({ c, employee, isDriver }) => {
          const href = listHref(BASE, sp, { open: String(c.id) });
          return (
            <tr key={c.id} className={c.id === openId ? "bg-brand-50/70" : "transition hover:bg-brand-50/40"}>
              <Td>{canApprove && (c.status === "draft" || c.status === "approved") && <RowCheck form={BULK_FORM} id={c.id} amount={c.amount} />}</Td>
              <Td className="font-medium whitespace-nowrap">
                <Link href={href} scroll={false} className="ltr-nums text-brand-700 hover:underline">
                  {c.number}
                </Link>
                {c.isOpening && <div className="text-xs font-normal text-gray-400">افتتاحية</div>}
              </Td>
              <Td className="ltr-nums whitespace-nowrap">{c.docDate}</Td>
              <Td className="font-medium">
                {employee}
                <div className="text-xs font-normal text-gray-500">{isDriver ? "سائق" : "إداري"}</div>
              </Td>
              <Td>
                {c.description}
                {c.serialNo && <div className="ltr-nums text-xs text-gray-400">{c.serialNo}</div>}
              </Td>
              <Td>
                <Badge tone={c.kind === "cash" ? "amber" : "blue"}>{CUSTODY_KIND[c.kind]}</Badge>
              </Td>
              <Td className="ltr-nums font-semibold">
                {Number(c.amount) ? fmt(c.amount) : "—"}
                {Number(c.quantity) !== 1 && <div className="text-xs font-normal text-gray-400">× {Number(c.quantity)}</div>}
              </Td>
              <Td>
                <Badge tone={CUSTODY_STATUS[c.status].tone}>{CUSTODY_STATUS[c.status].label}</Badge>
                {c.closeDate && <div className="ltr-nums text-[11px] text-gray-400">{c.closeDate}</div>}
              </Td>
              <Td>
                <Link href={href} scroll={false} aria-label="معاينة" className="inline-flex rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-brand-700">
                  <Icon name="expand" className="size-4" />
                </Link>
              </Td>
            </tr>
          );
        })}
      </Table>
    </>
  );
}

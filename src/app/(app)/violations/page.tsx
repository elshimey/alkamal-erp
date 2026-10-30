import Link from "next/link";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { driverOptions, vehicleOptions } from "@/lib/lookups";
import { fundingAccounts } from "@/lib/invoices";
import { CashAccountField } from "@/components/cash-account-field";
import { listViolations, violationSummary, violationTypeOptions, type ViolationFilter } from "@/lib/violations";
import { todayRiyadh } from "@/lib/dates";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { SheetEditor } from "@/components/sheet-editor";
import { Badge, Card, EmptyRow, LimitRow, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { pay, remove, revertPayment, saveViolations } from "./actions";
import { RowCheck, SelectAll, SelectionTotal } from "@/components/row-selection";
import { violationDoc } from "@/lib/violations";
import { getCompany, getInvoiceTemplate } from "@/lib/company";
import { listHref, parseDocFilter, type DocListParams } from "@/lib/doc-filters";
import { BulkPdfButton } from "@/components/bulk-pdf";
import { DocToolbar } from "@/components/doc-toolbar";
import { Icon } from "@/components/icons";
import { AddModeBar, ListActions } from "@/components/list-actions";
import { ViolationDocument } from "@/components/violation-document";
import { fmt } from "@/lib/format";
import { listAttachments } from "@/lib/attachments";
import { ViolationPanel } from "./violation-panel";

const PAY_FORM = "pay-violations";
const STATUSES = { posted: "غير مسددة للمرور", paid: "مسددة" };
const BASE = "/violations";

export default async function ViolationsPage({ searchParams }: { searchParams: Promise<DocListParams & { charge?: string; vehicle?: string; driver?: string; add?: string; new?: string }> }) {
  const user = await requirePermission("violations", "view");
  const sp = await searchParams;
  const canCreate = can(user.perms, "violations", "create");
  const adding = sp.add === "1" && canCreate;
  const creating = sp.new === "1" && canCreate;
  const df = parseDocFilter(sp, Object.keys(STATUSES), todayRiyadh());
  const filter: ViolationFilter = {
    q: df.q,
    from: df.from,
    to: df.to,
    status: sp.status === "posted" || sp.status === "paid" ? sp.status : undefined,
    chargeTo: sp.charge === "driver" || sp.charge === "company" ? sp.charge : undefined,
    vehicleId: Number(sp.vehicle) || undefined,
    driverId: Number(sp.driver) || undefined,
  };
  const today = todayRiyadh();
  const openId = Number(sp.open) || null;
  const [vehicles, drivers, cashes, list, sum, openDoc, company, template, violationTypes] = await Promise.all([
    vehicleOptions(),
    driverOptions(),
    fundingAccounts(db),
    listViolations(db, filter),
    violationSummary(db),
    openId ? violationDoc(db, openId) : Promise.resolve(null),
    getCompany(db),
    getInvoiceTemplate(db),
    violationTypeOptions(db),
  ]);
  const [photo] = openId ? await listAttachments(db, "traffic_violations", [openId]) : [];
  const canPay = can(user.perms, "violations", "approve");
  const unpaid = list.filter((x) => x.v.status === "posted");

  return (
    <>
      <PageHeader
        title="المخالفات المرورية"
        description="تُسجل المخالفة على المركبة ويُعرف السائق من سجل الإسناد في تاريخها. على السائق تُخصم من راتبه في المسير، وعلى الشركة تُقيد مصروفاً على المركبة. القيد يُنشأ فور الحفظ."
      >
        {!adding && (
          <ListActions
            newHref={canCreate && listHref(BASE, { ...sp, open: undefined, new: "1" } as DocListParams, {})}
            newLabel="تسجيل مخالفة"
            addHref={canCreate && "/violations?add=1"}
            addLabel="تسجيل مخالفات جماعي"
            importHref={canCreate && "/import/violations"}
          />
        )}
      </PageHeader>
      {adding && <AddModeBar backHref="/violations" backLabel="المخالفات المرورية" title="تسجيل مخالفات" />}

      {!adding && (
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {[
          { label: "غير مسدد للمرور", value: sum.unpaid, hint: `${sum.unpaidCount} مخالفة`, strong: true },
          { label: "على السائقين ولم تُخصم", value: sum.undeducted, hint: "تُخصم في مسير الرواتب القادم" },
          { label: "محمّلة على الشركة", value: sum.company, hint: "مصروف على مراكز تكلفة المركبات" },
        ].map((k) => (
          <div key={k.label} className={`rounded-2xl p-4 shadow-sm ${k.strong ? "bg-asphalt-900 text-white" : "bg-white"}`}>
            <div className={`text-xs ${k.strong ? "text-white/70" : "text-gray-500"}`}>{k.label}</div>
            <div className="mt-1 text-xl font-semibold">
              <span className="ltr-nums">{fmt(k.value)}</span>
            </div>
            <div className={`mt-1 text-xs ${k.strong ? "text-brand-500" : "text-gray-400"}`}>{k.hint}</div>
          </div>
        ))}
      </div>
      )}

      {adding && (
        <Card className="mb-6">
          <SheetEditor
            templateName="المخالفات"
            action={saveViolations}
            initialRows={4}
            columns={[
              { key: "date", label: "تاريخ المخالفة", type: "date", placeholder: today },
              { key: "vehicleId", label: "المركبة", type: "select", required: true, options: vehicles, width: "8rem", create: "vehicle" },
              { key: "reference", label: "رقم المخالفة", ltr: true, width: "8rem" },
              { key: "type", label: "نوع المخالفة", type: "select", required: true, width: "11rem", placeholder: "سرعة، وقوف، حمولة…", options: violationTypes, create: "violation_type" },
              { key: "location", label: "الموقع", width: "9rem" },
              { key: "amount", label: "المبلغ", type: "number", required: true, width: "6rem" },
              {
                key: "chargeTo",
                label: "على من",
                type: "select",
                required: true,
                width: "7rem",
                options: [
                  { value: "driver", label: "السائق" },
                  { value: "company", label: "الشركة" },
                ],
              },
              { key: "driverId", label: "السائق (اختياري)", type: "select", options: drivers, width: "9rem", create: "driver" },
              { key: "notes", label: "ملاحظات", width: "9rem" },
            ]}
          />
          <p className="mt-2 text-xs text-gray-500">
            اترك السائق فارغاً ليُحدد تلقائياً من{" "}
            <Link href="/assignments" className="text-brand-700 underline">
              سجل الإسناد
            </Link>{" "}
            في تاريخ المخالفة. رقم المخالفة يمنع تسجيلها مرتين.
          </p>
        </Card>
      )}

      {!adding && (
        <>
      <DocToolbar base={BASE} params={sp} statuses={STATUSES} allStatuses="كل الحالات" pay={false} views={false} sorts={{}} noun="مخالفة" exportName="المخالفات" count={list.length} placeholder="ابحث بالرقم أو اللوحة أو السائق أو النوع" />
      <form className="mb-4 flex flex-wrap items-center gap-2 text-sm print:hidden">
        {(["q", "period", "status"] as const).map((k) => sp[k] && <input key={k} type="hidden" name={k} value={sp[k]} />)}
        <Select name="charge" defaultValue={filter.chargeTo ?? ""} className="w-32">
          <option value="">على الكل</option>
          <option value="driver">على السائق</option>
          <option value="company">على الشركة</option>
        </Select>
        <Select name="vehicle" defaultValue={filter.vehicleId ?? ""} className="w-36">
          <option value="">كل المركبات</option>
          {vehicles.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <Select name="driver" defaultValue={filter.driverId ?? ""} className="w-40">
          <option value="">كل السائقين</option>
          {drivers.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <button className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50">تصفية</button>
        <span className="ms-auto">
          <BulkPdfButton kind="violations" ids={list.map((x) => x.v.id)} />
        </span>
      </form>

      {openDoc && (
        <section className="animate-flyout mb-6 rounded-2xl bg-gray-100/70 shadow-inner">
          <div className="flex flex-wrap items-center gap-3 rounded-t-2xl border-b border-gray-200 bg-white px-5 py-3">
            <Link href={listHref(BASE, sp, { open: undefined })} scroll={false} aria-label="إغلاق المعاينة" className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100">
              <Icon name="close" className="size-4" />
            </Link>
            <span className="ltr-nums font-display text-lg font-semibold text-brand-900">{openDoc.v.number}</span>
            <Badge tone={openDoc.v.status === "paid" ? "green" : "red"}>{openDoc.v.status === "paid" ? "مسددة" : "غير مسددة"}</Badge>
            {photo && (
              <a href={`/files/${photo.id}`} target="_blank" rel="noreferrer" className="ms-auto rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-brand-700 shadow-sm hover:bg-gray-50">
                📎 صورة المخالفة
              </a>
            )}
            <Link href={`/print/violations?ids=${openDoc.v.id}`} target="_blank" className={`${photo ? "" : "ms-auto "}rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50`}>
              طباعة
            </Link>
          </div>
          <div className="p-4 sm:p-6">
            <div className="mx-auto max-w-3xl">
              <ViolationDocument company={company} doc={openDoc} template={template} compact />
            </div>
          </div>
        </section>
      )}

      {canPay && unpaid.length > 0 && (
        <Card title="سداد المخالفات للمرور" className="mb-4">
          <ActionForm id={PAY_FORM} action={pay} className="flex flex-wrap items-end gap-3">
            <SelectionTotal form={PAY_FORM} noun="مخالفة" />
            <Field label="تاريخ السداد">
              <Input type="date" name="paymentDate" defaultValue={today} className="w-40" />
            </Field>
            <div className="w-full max-w-md basis-full">
              <CashAccountField options={cashes.filter((a) => a.code !== "2108")} label="تُسدد من حساب" />
            </div>
            <SubmitButton>سداد المحدد</SubmitButton>
          </ActionForm>
          <p className="mt-2 text-xs text-gray-500">حدد المخالفات من الجدول أدناه؛ يُنشأ قيد سداد واحد لها كلها.</p>
        </Card>
      )}

      <Table head={[canPay && unpaid.length ? <SelectAll key="all" form={PAY_FORM} /> : "", "الرقم", "التاريخ", "المركبة", "المخالفة", "على", "المبلغ", "الخصم من الراتب", "الحالة", ""]}>
        {list.length === 0 && <EmptyRow cols={10}>لا توجد مخالفات</EmptyRow>}
        <LimitRow cols={10} shown={list.length} limit={300} />
        {list.map(({ v, plate, driver, entry, run, runStatus }) => (
          <tr key={v.id} className={v.id === openId ? "bg-brand-50/70" : undefined}>
            <Td>{canPay && v.status === "posted" && <RowCheck form={PAY_FORM} id={v.id} amount={v.amount} />}</Td>
            <Td className="font-medium whitespace-nowrap">
              <Link href={listHref(BASE, sp, { open: String(v.id) })} scroll={false} className="ltr-nums text-brand-700 hover:underline">
                {v.number}
              </Link>
              {v.reference && <div className="ltr-nums text-xs font-normal text-gray-400">{v.reference}</div>}
            </Td>
            <Td className="ltr-nums whitespace-nowrap">{v.violationDate}</Td>
            <Td className="whitespace-nowrap">{plate}</Td>
            <Td>
              {v.violationType}
              {v.location && (
                <div className="text-xs text-gray-400">
                  <bdi>{v.location}</bdi>
                </div>
              )}
            </Td>
            <Td>
              <Badge tone={v.chargeTo === "driver" ? "amber" : "blue"}>{v.chargeTo === "driver" ? "السائق" : "الشركة"}</Badge>
              {driver && <div className="text-xs text-gray-500">{driver}</div>}
            </Td>
            <Td className="ltr-nums font-semibold">{fmt(v.amount)}</Td>
            <Td className="text-xs whitespace-nowrap">
              {v.chargeTo === "company" ? (
                "—"
              ) : run ? (
                <span className={`whitespace-nowrap ${runStatus === "draft" ? "text-amber-700" : "text-green-700"}`}>
                  {runStatus === "draft" ? "في مسودة " : "خُصمت في "}
                  <span className="ltr-nums">{run}</span>
                </span>
              ) : (
                <span className="text-gray-500">بانتظار المسير</span>
              )}
            </Td>
            <Td>
              <Badge tone={v.status === "paid" ? "green" : "red"}>{v.status === "paid" ? "مسددة" : "غير مسددة"}</Badge>
              {v.paymentDate && <div className="ltr-nums text-[11px] text-gray-400">{v.paymentDate}</div>}
              {entry && <div className="ltr-nums text-[11px] whitespace-nowrap text-gray-400">{entry}</div>}
            </Td>
            <Td>
              <div className="flex flex-wrap gap-2">
                {v.status === "paid" && can(user.perms, "violations", "revert") && (
                  <ActionForm action={revertPayment.bind(null, v.id)} resetOnSuccess={false}>
                    <SubmitButton variant="secondary" className="whitespace-nowrap">إلغاء السداد</SubmitButton>
                  </ActionForm>
                )}
                {v.status === "posted" && (!run || runStatus === "draft") && can(user.perms, "violations", "delete") && (
                  <ActionForm action={remove.bind(null, v.id)} resetOnSuccess={false}>
                    <SubmitButton variant="secondary">حذف</SubmitButton>
                  </ActionForm>
                )}
              </div>
            </Td>
          </tr>
        ))}
      </Table>
        </>
      )}
      {creating && <ViolationPanel closeHref={listHref(BASE, { ...sp, new: undefined } as DocListParams, {})} />}
    </>
  );
}

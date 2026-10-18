import Link from "next/link";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { driverOptions, vehicleOptions } from "@/lib/lookups";
import { cashAccounts } from "@/lib/invoices";
import { listViolations, violationSummary, type ViolationFilter } from "@/lib/violations";
import { todayRiyadh } from "@/lib/dates";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { SheetEditor } from "@/components/sheet-editor";
import { Badge, Card, EmptyRow, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { pay, remove, revertPayment, saveViolations } from "./actions";
import { RowCheck, SelectAll, SelectionTotal } from "./selection";

const fmt = (v: string | number) => Number(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PAY_FORM = "pay-violations";
const TABS = [
  { key: undefined, label: "الكل" },
  { key: "posted", label: "غير مسددة للمرور" },
  { key: "paid", label: "مسددة" },
] as const;

export default async function ViolationsPage({ searchParams }: { searchParams: Promise<{ status?: string; charge?: string; vehicle?: string; driver?: string }> }) {
  const user = await requirePermission("violations", "view");
  const sp = await searchParams;
  const filter: ViolationFilter = {
    status: sp.status === "posted" || sp.status === "paid" ? sp.status : undefined,
    chargeTo: sp.charge === "driver" || sp.charge === "company" ? sp.charge : undefined,
    vehicleId: Number(sp.vehicle) || undefined,
    driverId: Number(sp.driver) || undefined,
  };
  const today = todayRiyadh();
  const [vehicles, drivers, cashes, list, sum] = await Promise.all([vehicleOptions(), driverOptions(), cashAccounts(db), listViolations(db, filter), violationSummary(db)]);
  const canPay = can(user.perms, "violations", "approve");
  const unpaid = list.filter((x) => x.v.status === "posted");
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter((e): e is [string, string] => !!e[1]));
    const q = p.toString();
    return q ? `/violations?${q}` : "/violations";
  };

  return (
    <>
      <PageHeader
        title="المخالفات المرورية"
        description="تُسجل المخالفة على المركبة ويُعرف السائق من سجل الإسناد في تاريخها. على السائق تُخصم من راتبه في المسير، وعلى الشركة تُقيد مصروفاً على المركبة. القيد يُنشأ فور الحفظ."
      />

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

      {can(user.perms, "violations", "create") && (
        <Card title="تسجيل مخالفات" className="mb-6">
          <SheetEditor
            templateName="المخالفات"
            action={saveViolations}
            initialRows={4}
            columns={[
              { key: "date", label: "تاريخ المخالفة", type: "date", required: true, placeholder: today },
              { key: "vehicleId", label: "المركبة", type: "select", required: true, options: vehicles, width: "8rem" },
              { key: "reference", label: "رقم المخالفة", ltr: true, width: "8rem" },
              { key: "type", label: "نوع المخالفة", required: true, width: "11rem", placeholder: "سرعة، وقوف، حمولة…" },
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
              { key: "driverId", label: "السائق (اختياري)", type: "select", options: drivers, width: "9rem" },
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

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        {TABS.map((t) => (
          <Link
            key={t.label}
            href={qs({ status: t.key })}
            className={`rounded-full px-3.5 py-1.5 transition ${t.key === filter.status ? "bg-asphalt-900 font-semibold text-brand-500" : "bg-white text-gray-600 shadow-sm hover:bg-brand-50"}`}
          >
            {t.label}
          </Link>
        ))}
        <form className="ms-auto flex flex-wrap items-center gap-2">
          {filter.status && <input type="hidden" name="status" value={filter.status} />}
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
        </form>
      </div>

      {canPay && unpaid.length > 0 && (
        <Card title="سداد المخالفات للمرور" className="mb-4">
          <ActionForm id={PAY_FORM} action={pay} className="flex flex-wrap items-end gap-3">
            <SelectionTotal form={PAY_FORM} />
            <Field label="تاريخ السداد">
              <Input type="date" name="paymentDate" defaultValue={today} className="w-40" />
            </Field>
            <Field label="من">
              <Select name="cashAccountId" required defaultValue="" className="w-48">
                <option value="" disabled>
                  الصندوق أو البنك
                </option>
                {cashes.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nameAr}
                  </option>
                ))}
              </Select>
            </Field>
            <SubmitButton>سداد المحدد</SubmitButton>
          </ActionForm>
          <p className="mt-2 text-xs text-gray-500">حدد المخالفات من الجدول أدناه؛ يُنشأ قيد سداد واحد لها كلها.</p>
        </Card>
      )}

      <Table head={[canPay && unpaid.length ? <SelectAll key="all" form={PAY_FORM} /> : "", "الرقم", "التاريخ", "المركبة", "المخالفة", "على", "المبلغ", "الخصم من الراتب", "الحالة", ""]}>
        {list.length === 0 && <EmptyRow cols={10}>لا توجد مخالفات</EmptyRow>}
        {list.map(({ v, plate, driver, entry, run, runStatus }) => (
          <tr key={v.id}>
            <Td>{canPay && v.status === "posted" && <RowCheck form={PAY_FORM} id={v.id} amount={v.amount} />}</Td>
            <Td className="font-medium whitespace-nowrap">
              <span className="ltr-nums">{v.number}</span>
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
  );
}

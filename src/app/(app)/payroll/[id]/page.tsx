import Link from "next/link";
import { notFound } from "next/navigation";
import { alias } from "drizzle-orm/pg-core";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { cashAccounts } from "@/lib/invoices";
import { payrollTotals } from "@/lib/payroll";
import { monthLabel, monthRange, PAYROLL_STATUS } from "@/data/payroll";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { SheetEditor } from "@/components/sheet-editor";
import { Badge, Card, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { adjustLines, approveRun, deleteRun, payRun, refreshRun, revertPay, revertRun } from "../actions";

const fmt = (v: string | number) => Number(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dash = (v: string | number) => (Number(v) ? fmt(v) : "—");

export default async function PayrollRunPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("payroll", "view");
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const je = alias(s.journalEntries, "je");
  const pje = alias(s.journalEntries, "pje");
  const [row] = await db
    .select({ r: s.payrollRuns, entry: je.number, payEntry: pje.number, bank: s.accounts.nameAr })
    .from(s.payrollRuns)
    .leftJoin(je, eq(je.id, s.payrollRuns.journalEntryId))
    .leftJoin(pje, eq(pje.id, s.payrollRuns.paymentEntryId))
    .leftJoin(s.accounts, eq(s.accounts.id, s.payrollRuns.bankAccountId))
    .where(eq(s.payrollRuns.id, id));
  if (!row) notFound();
  const { r } = row;
  const [lines, banks] = await Promise.all([
    db
      .select({ l: s.payrollLines, name: s.employees.nameAr, job: s.employees.jobTitle, iban: s.employees.iban, cc: s.costCenters.nameAr })
      .from(s.payrollLines)
      .innerJoin(s.employees, eq(s.employees.id, s.payrollLines.employeeId))
      .leftJoin(s.costCenters, eq(s.costCenters.id, s.payrollLines.costCenterId))
      .where(eq(s.payrollLines.runId, id))
      .orderBy(asc(s.employees.nameAr)),
    cashAccounts(db),
  ]);
  const t = payrollTotals(lines.map((x) => x.l));
  const draft = r.status === "draft";
  const { end } = monthRange(r.month);
  const missingIban = lines.filter((x) => Number(x.l.net) > 0 && !x.iban).length;

  return (
    <>
      <PageHeader title={`مسير ${monthLabel(r.month)}`} description={`${r.number} · ${lines.length} موظف · القيد بتاريخ ${end}`}>
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={PAYROLL_STATUS[r.status].tone}>{PAYROLL_STATUS[r.status].label}</Badge>
          {row.entry && <span className="ltr-nums text-xs text-gray-500">الاستحقاق {row.entry}</span>}
          {row.payEntry && <span className="ltr-nums text-xs text-gray-500">الصرف {row.payEntry}</span>}
          {r.status === "approved" && can(user.perms, "payroll", "revert") && (
            <ActionForm action={revertRun.bind(null, id)} resetOnSuccess={false}>
              <SubmitButton variant="secondary">إرجاع لمسودة</SubmitButton>
            </ActionForm>
          )}
          {r.status === "paid" && can(user.perms, "payroll", "revert") && (
            <ActionForm action={revertPay.bind(null, id)} resetOnSuccess={false}>
              <SubmitButton variant="secondary">إلغاء الصرف</SubmitButton>
            </ActionForm>
          )}
          {can(user.perms, "payroll", "export") && (
          <a href={`/payroll/${id}/bank`} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm hover:border-brand-600">
            ملف التحويل البنكي
          </a>
          )}
          <Link href="/payroll" className="text-sm text-brand-700 hover:underline">
            ← المسيرات
          </Link>
        </div>
      </PageHeader>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: "الرواتب والبدلات", value: t.basic + t.housing + t.otherAllowances + t.additions + t.incentives - t.absenceDeduction - t.deductions, hint: t.incentives ? `منها حوافز ${fmt(t.incentives)}` : undefined },
          { label: "عمولات البوالص", value: t.commissions, hint: "مقيدة من البوالص، تُصرف هنا" },
          { label: "الاستقطاعات", value: t.gosiEmployee + t.advanceDeduction + t.violations + t.penalties, hint: "تأمينات الموظف وأقساط السلف والمخالفات والجزاءات" },
          { label: "الصافي للصرف", value: t.net, strong: true },
        ].map((k) => (
          <div key={k.label} className={`rounded-2xl p-4 shadow-sm ${k.strong ? "bg-asphalt-900 text-white" : "bg-white"}`}>
            <div className={`text-xs ${k.strong ? "text-white/70" : "text-gray-500"}`}>{k.label}</div>
            <div className="ltr-nums mt-1 text-xl font-semibold">{fmt(k.value)}</div>
            {k.hint && <div className="mt-1 text-xs text-gray-400">{k.hint}</div>}
          </div>
        ))}
      </div>

      <Table head={["الموظف", "الأساسي", "السكن", "بدلات", "غياب", "إضافات وحوافز", "خصومات وجزاءات", "العمولات", "مخالفات", "قسط سلفة", "تأمينات", "الصافي"]}>
        {lines.map(({ l, name, job, cc }) => (
          <tr key={l.id}>
            <Td className="font-medium">
              {name}
              <div className="text-xs font-normal text-gray-500">{l.driverId ? `سائق · ${cc ?? "بلا مركبة"}` : (job ?? "إداري")}</div>
              {l.notes && <div className="text-xs font-normal text-amber-700">{l.notes}</div>}
            </Td>
            <Td className="ltr-nums">{dash(l.basic)}</Td>
            <Td className="ltr-nums">{dash(l.housing)}</Td>
            <Td className="ltr-nums">{dash(l.otherAllowances)}</Td>
            <Td className="ltr-nums text-red-600">
              {Number(l.absenceDays) + Number(l.leaveDays) ? `${Number(l.absenceDays) + Number(l.leaveDays)} يوم (${fmt(l.absenceDeduction)})` : "—"}
              {Number(l.leaveDays) > 0 && <div className="text-[11px] text-gray-500">{Number(l.leaveDays)} من الإجازات والحضور</div>}
            </Td>
            <Td className="ltr-nums text-green-700">
              {dash(l.additions)}
              {Number(l.incentives) > 0 && <div className="text-[11px]">حافز {fmt(l.incentives)}</div>}
            </Td>
            <Td className="ltr-nums text-red-600">
              {dash(l.deductions)}
              {Number(l.penalties) > 0 && <div className="text-[11px]">جزاء {fmt(l.penalties)}</div>}
            </Td>
            <Td className="ltr-nums text-green-700">{dash(l.commissions)}</Td>
            <Td className="ltr-nums text-red-600">{dash(l.violations)}</Td>
            <Td className="ltr-nums text-red-600">{dash(l.advanceDeduction)}</Td>
            <Td className="ltr-nums text-red-600">{dash(l.gosiEmployee)}</Td>
            <Td className={`ltr-nums font-semibold ${Number(l.net) < 0 ? "text-red-600" : "text-brand-900"}`}>{fmt(l.net)}</Td>
          </tr>
        ))}
        <tr className="bg-gray-50 font-semibold">
          <Td>الإجمالي</Td>
          <Td className="ltr-nums">{fmt(t.basic)}</Td>
          <Td className="ltr-nums">{fmt(t.housing)}</Td>
          <Td className="ltr-nums">{fmt(t.otherAllowances)}</Td>
          <Td className="ltr-nums">{fmt(t.absenceDeduction)}</Td>
          <Td className="ltr-nums">{fmt(t.additions + t.incentives)}</Td>
          <Td className="ltr-nums">{fmt(t.deductions + t.penalties)}</Td>
          <Td className="ltr-nums">{fmt(t.commissions)}</Td>
          <Td className="ltr-nums">{fmt(t.violations)}</Td>
          <Td className="ltr-nums">{fmt(t.advanceDeduction)}</Td>
          <Td className="ltr-nums">{fmt(t.gosiEmployee)}</Td>
          <Td className="ltr-nums">{fmt(t.net)}</Td>
        </tr>
      </Table>
      <p className="mt-3 mb-6 text-xs text-gray-500">
        على المنشأة أيضاً: حصتها في التأمينات <span className="ltr-nums">{fmt(t.gosiEmployer)}</span> ومخصص نهاية الخدمة{" "}
        <span className="ltr-nums">{fmt(t.eosbAccrual)}</span>. تكلفة السائق على مركز تكلفة مركبته (5103)، والإداريون على 6101.
        {missingIban > 0 && <span className="text-amber-700"> {missingIban} موظف بلا آيبان لن يظهر رقمه في ملف البنك.</span>}
      </p>

      <div className="grid gap-6 lg:grid-cols-2">
        {draft && can(user.perms, "payroll", "update") && (
          <Card title="الغياب والإضافات والخصومات" className="lg:col-span-2">
            <SheetEditor
              templateName={`تعديلات مسير ${monthLabel(r.month)}`}
              action={adjustLines.bind(null, id)}
              initialRows={3}
              columns={[
                { key: "employeeId", label: "الموظف", type: "select", required: true, options: lines.map((x) => ({ value: String(x.l.employeeId), label: x.name })), width: "12rem" },
                { key: "absenceDays", label: "أيام الغياب", type: "number", width: "6rem" },
                { key: "additions", label: "إضافات (إضافي، مكافأة)", type: "number", width: "9rem" },
                { key: "deductions", label: "خصومات (جزاء)", type: "number", width: "8rem" },
                { key: "advanceDeduction", label: "قسط السلفة", type: "number", width: "7rem" },
                { key: "notes", label: "ملاحظة", width: "14rem" },
              ]}
            />
            <p className="mt-2 text-xs text-gray-500">الخلية الفارغة تبقى كما هي. خصم الغياب = (الأساسي + السكن + البدلات) ÷ 30 × الأيام.</p>
          </Card>
        )}
        {draft && can(user.perms, "payroll", "update") && (
          <Card title="تحديث المسير">
            <ActionForm action={refreshRun.bind(null, id)} resetOnSuccess={false}>
              <SubmitButton variant="secondary">تحديث من الموظفين والعمولات والمخالفات والموارد البشرية</SubmitButton>
            </ActionForm>
            <p className="mt-2 text-xs text-gray-500">بعد تعديل راتب أو اعتماد بوالص أو مخالفات أو جزاءات وحوافز وإجازات بدون راتب وغياب. تعديلاتك أعلاه تبقى.</p>
          </Card>
        )}
        {draft && can(user.perms, "payroll", "approve") && (
          <Card title="الاعتماد وترحيل قيد الاستحقاق">
            <ActionForm action={approveRun.bind(null, id)} resetOnSuccess={false}>
              <SubmitButton>اعتماد المسير</SubmitButton>
            </ActionForm>
            <p className="mt-2 text-xs text-gray-500">مدين الرواتب والتأمينات ونهاية الخدمة، دائن حساب راتب كل موظف والتأمينات المستحقة وسلف الموظفين.</p>
          </Card>
        )}
        {r.status === "approved" && can(user.perms, "payroll", "approve") && (
          <Card title="صرف الرواتب بالصافي">
            <ActionForm action={payRun.bind(null, id)} resetOnSuccess={false} className="flex flex-wrap items-end gap-3">
              <Field label="من حساب">
                <Select name="bankAccountId">
                  <option value="">اختر البنك</option>
                  {banks.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nameAr}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="تاريخ الصرف">
                <Input name="paymentDate" type="date" defaultValue={end} min={end} />
              </Field>
              <SubmitButton>صرف {fmt(t.net)} ر.س</SubmitButton>
            </ActionForm>
          </Card>
        )}
        {r.status === "paid" && (
          <Card title="مصروف">
            <p className="text-sm text-gray-600">
              صُرف في <span className="ltr-nums">{r.paymentDate}</span> من {row.bank}.
            </p>
          </Card>
        )}
        {draft && can(user.perms, "payroll", "delete") && (
          <Card title="حذف المسودة">
            <ActionForm action={deleteRun.bind(null, id)} className="flex gap-2">
              <Input name="reason" placeholder="سبب الحذف" className="flex-1" />
              <SubmitButton variant="secondary">حذف</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}

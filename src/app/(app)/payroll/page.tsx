import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { todayRiyadh } from "@/lib/dates";
import { monthLabel, PAYROLL_STATUS } from "@/data/payroll";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, EmptyRow, Field, Input, PageHeader, Table, Td } from "@/components/ui";
import { PayrollTabs } from "./tabs";
import { createRun } from "./actions";

const fmt = (v: string | number) => Number(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function PayrollPage() {
  const user = await requirePermission("payroll", "view");
  const runs = await db
    .select({
      r: s.payrollRuns,
      count: sql<number>`count(${s.payrollLines.id})::int`,
      gross: sql<string>`coalesce(sum(${s.payrollLines.basic} + ${s.payrollLines.housing} + ${s.payrollLines.otherAllowances}), 0)`,
      commissions: sql<string>`coalesce(sum(${s.payrollLines.commissions}), 0)`,
      net: sql<string>`coalesce(sum(greatest(${s.payrollLines.net}, 0)), 0)`,
    })
    .from(s.payrollRuns)
    .leftJoin(s.payrollLines, eq(s.payrollLines.runId, s.payrollRuns.id))
    .groupBy(s.payrollRuns.id)
    .orderBy(desc(s.payrollRuns.month));
  const today = todayRiyadh();

  return (
    <>
      <PageHeader
        title="الرواتب"
        description="مسير لكل شهر: يُبنى تلقائياً من رواتب الموظفين وعمولات البوالص المعتمدة وأقساط السلف، ثم تعدّل الغياب والإضافات، فتعتمد قيد الاستحقاق، ثم تصرف بالصافي من البنك."
      />
      <PayrollTabs active="runs" />
      {can(user.perms, "payroll", "create") && (
        <Card title="مسير جديد" className="mb-6">
          <ActionForm action={createRun} className="flex flex-wrap items-end gap-3">
            <Field label="الشهر">
              <Input name="month" type="month" defaultValue={today.slice(0, 7)} />
            </Field>
            <SubmitButton>إنشاء المسير</SubmitButton>
          </ActionForm>
        </Card>
      )}
      <Table head={["الرقم", "الشهر", "الموظفون", "الرواتب والبدلات", "العمولات", "الصافي للصرف", "الحالة"]}>
        {runs.length === 0 && <EmptyRow cols={7}>لا توجد مسيرات بعد</EmptyRow>}
        {runs.map(({ r, count, gross, commissions, net }) => (
          <tr key={r.id}>
            <Td className="ltr-nums font-medium">
              <Link href={`/payroll/${r.id}`} className="text-brand-700 hover:underline">
                {r.number}
              </Link>
            </Td>
            <Td className="font-medium">{monthLabel(r.month)}</Td>
            <Td className="ltr-nums">{count}</Td>
            <Td className="ltr-nums">{fmt(gross)}</Td>
            <Td className="ltr-nums">{fmt(commissions)}</Td>
            <Td className="ltr-nums font-semibold">{fmt(net)}</Td>
            <Td>
              <Badge tone={PAYROLL_STATUS[r.status].tone}>{PAYROLL_STATUS[r.status].label}</Badge>
            </Td>
          </tr>
        ))}
      </Table>
    </>
  );
}

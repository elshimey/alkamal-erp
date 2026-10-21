import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { employeeCost, evaluationHistory, hrDashboard, openCustodyByEmployee } from "@/lib/hr";
import { todayRiyadh } from "@/lib/dates";
import { monthLabel } from "@/data/payroll";
import { scoreLevel } from "@/data/hr";
import { Badge, Card, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { fmt, HrTabs, Kpis } from "./ui";

export default async function HrDashboard({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requirePermission("employees", "view");
  const sp = await searchParams;
  const today = todayRiyadh();
  const [lastRun] = await db.select({ month: s.payrollRuns.month }).from(s.payrollRuns).orderBy(desc(s.payrollRuns.month)).limit(1);
  const costMonth = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : (lastRun?.month.slice(0, 7) ?? today.slice(0, 7));
  const [d, custody, cost, history] = await Promise.all([hrDashboard(db, today), openCustodyByEmployee(db), employeeCost(db, costMonth), evaluationHistory(db, today)]);
  const costTotal = cost.rows.reduce((t, r) => t + r.total, 0);
  const todo = [
    { n: d.pending.leaves, label: "طلب إجازة بانتظار الاعتماد", href: "/hr/leaves?status=pending" },
    { n: d.pending.advances, label: "طلب مقدم عمولة من السائقين", href: "/hr/advances?status=pending" },
    { n: d.pending.actions, label: "إنذار أو جزاء أو حافز مسودة", href: "/hr/discipline?status=draft" },
    { n: d.pending.custody, label: "عهدة بانتظار الاعتماد أو التسليم", href: "/hr/custody?status=approved" },
  ].filter((x) => x.n > 0);

  return (
    <>
      <PageHeader title="الموارد البشرية" description="الموظفون والسائقون، والعُهد، والانضباط، والإجازات والحضور، والتقييم والترقية، وتكلفة كل موظف على الشركة." />
      <HrTabs active="overview" />
      <Kpis
        items={[
          { label: "الموظفون على رأس العمل", value: d.employees, hint: `${d.drivers} سائق · ${d.staff} إداري`, href: "/employees" },
          { label: "في إجازة اليوم", value: d.onLeave.length, hint: d.onLeave.slice(0, 2).map((x) => x.name).join("، ") || "لا أحد", href: "/hr/leaves" },
          { label: "عهد نقدية مفتوحة", value: fmt(d.custody.cash), hint: `${d.custody.open} عهدة مفتوحة، وعينية بقيمة ${fmt(d.custody.inKind)}`, strong: true, href: "/hr/custody" },
          { label: "إنذارات هذا الشهر", value: d.month.warnings, hint: `جزاءات ${fmt(d.month.penalties)} · حوافز ${fmt(d.month.incentives)}`, href: "/hr/discipline" },
        ]}
      />

      {todo.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2 text-sm">
          {todo.map((x) => (
            <Link key={x.href} href={x.href} className="rounded-xl bg-brand-50 px-3 py-2 text-amber-900 hover:bg-brand-100">
              <b className="ltr-nums">{x.n}</b> {x.label}
            </Link>
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="العُهد المفتوحة لكل موظف">
          <Table head={["الموظف", "عدد", "نقدية", "عينية", "منذ"]}>
            {custody.length === 0 && <EmptyRow cols={5}>لا توجد عهد مفتوحة</EmptyRow>}
            {custody.map((c) => (
              <tr key={c.employeeId}>
                <Td className="font-medium">
                  <Link href={`/hr/custody?employee=${c.employeeId}&status=delivered`} className="hover:text-brand-700">
                    {c.name}
                  </Link>
                </Td>
                <Td className="ltr-nums">{c.n}</Td>
                <Td className="ltr-nums">{Number(c.cash) ? fmt(c.cash) : "—"}</Td>
                <Td className="ltr-nums">{Number(c.inKind) ? fmt(c.inKind) : "—"}</Td>
                <Td className="ltr-nums text-xs whitespace-nowrap">{c.oldest}</Td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card title="التقييم في آخر ستة أشهر">
          <Table head={["الموظف", ...history.months.map((m) => monthLabel(m).split(" ")[0])]}>
            {history.rows.length === 0 && <EmptyRow cols={7}>لا توجد تقييمات معتمدة بعد</EmptyRow>}
            {history.rows.map((r) => (
              <tr key={r.name}>
                <Td className="font-medium whitespace-nowrap">{r.name}</Td>
                {history.months.map((m) => {
                  const v = r.scores[m];
                  return (
                    <Td key={m} className="ltr-nums">
                      {v == null ? <span className="text-gray-300">—</span> : <Badge tone={scoreLevel(v).tone}>{Math.round(v)}</Badge>}
                    </Td>
                  );
                })}
              </tr>
            ))}
          </Table>
        </Card>

        <Card title={`تكلفة الموظف على الشركة – ${monthLabel(costMonth)}`} className="lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <form className="flex items-center gap-2">
              <input type="month" name="month" defaultValue={costMonth} className="h-9 rounded-lg border border-gray-200 px-2" />
              <button className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 hover:bg-gray-50">عرض</button>
            </form>
            {cost.run && (
              <Link href={`/payroll/${cost.run.id}`} className="text-brand-700 hover:underline">
                من المسير <span className="ltr-nums">{cost.run.number}</span>
              </Link>
            )}
          </div>
          <Table head={["الموظف", "مركز التكلفة", "الراتب المستحق", "العمولات", "تأمينات المنشأة ونهاية الخدمة", "الإجمالي"]}>
            {cost.rows.length === 0 && <EmptyRow cols={6}>لا يوجد مسير لهذا الشهر</EmptyRow>}
            {cost.rows.map((r) => (
              <tr key={r.name}>
                <Td className="font-medium">
                  {r.name}
                  <div className="text-xs font-normal text-gray-500">{r.isDriver ? "سائق" : "إداري"}</div>
                </Td>
                <Td className="text-xs">{r.cc ?? "الإدارة"}</Td>
                <Td className="ltr-nums">{fmt(r.salary)}</Td>
                <Td className="ltr-nums">{r.commissions ? fmt(r.commissions) : "—"}</Td>
                <Td className="ltr-nums">{fmt(r.employer)}</Td>
                <Td className="ltr-nums font-semibold">{fmt(r.total)}</Td>
              </tr>
            ))}
            {cost.rows.length > 0 && (
              <tr className="bg-gray-50 font-semibold">
                <Td>الإجمالي</Td>
                <Td />
                <Td className="ltr-nums">{fmt(cost.rows.reduce((t, r) => t + r.salary, 0))}</Td>
                <Td className="ltr-nums">{fmt(cost.rows.reduce((t, r) => t + r.commissions, 0))}</Td>
                <Td className="ltr-nums">{fmt(cost.rows.reduce((t, r) => t + r.employer, 0))}</Td>
                <Td className="ltr-nums">{fmt(costTotal)}</Td>
              </tr>
            )}
          </Table>
        </Card>
      </div>
      <p className="mt-4 text-xs text-gray-500">
        أرصدة الإجازات في{" "}
        <Link href="/hr/leaves?tab=balances" className="text-brand-700 underline">
          الإجازات ← أرصدة الإجازات
        </Link>
        . تكلفة الموظف = المستحق بعد الغياب والخصومات + العمولات + حصة المنشأة في التأمينات ومخصص نهاية الخدمة.
      </p>
    </>
  );
}

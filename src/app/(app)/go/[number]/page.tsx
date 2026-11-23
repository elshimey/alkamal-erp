import { eq } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requireUser } from "@/lib/auth";

/**
 * رقم المستند في رسالة الخطأ رابط يفتحه (`msgSegments` في src/lib/msg-links.ts): هذه الصفحة تعرف المستند
 * من رقمه وتنقل لصفحته أو لقائمته مفتوحاً فيها. صلاحية العرض تفحصها صفحة المستند نفسها.
 */
type Target = { table: PgTable & { id: PgColumn; number: PgColumn }; href: (id: number) => string };

const TARGETS: Record<string, Target[]> = {
  WB: [{ table: s.waybills, href: (id) => `/waybills/${id}` }],
  INV: [{ table: s.salesInvoices, href: (id) => `/invoices/${id}` }],
  DRF: [{ table: s.salesInvoices, href: (id) => `/invoices/${id}` }],
  RC: [{ table: s.receipts, href: (id) => `/receipts/${id}` }],
  RF: [{ table: s.receipts, href: (id) => `/receipts/${id}` }],
  JE: [{ table: s.journalEntries, href: (id) => `/journal/${id}` }],
  MO: [{ table: s.maintenanceOrders, href: (id) => `/maintenance/${id}` }],
  PI: [{ table: s.purchaseInvoices, href: (id) => `/purchases/${id}` }],
  PO: [{ table: s.purchaseOrders, href: (id) => `/purchase-orders/${id}` }],
  QT: [{ table: s.quotations, href: (id) => `/quotations/${id}` }],
  PR: [
    { table: s.payrollRuns, href: (id) => `/payroll/${id}` },
    { table: s.purchaseRequests, href: () => `/purchase-requests` },
  ],
  PV: [{ table: s.payments, href: () => `/payments` }],
  EX: [{ table: s.expenses, href: () => `/expenses` }],
  VIO: [{ table: s.trafficViolations, href: (id) => `/violations?open=${id}` }],
  ADV: [{ table: s.employeeAdvances, href: () => `/payroll/advances` }],
  CAR: [{ table: s.commissionAdvanceRequests, href: () => `/hr/advances` }],
  FA: [{ table: s.fixedAssets, href: (id) => `/fixed-assets?open=${id}` }],
  TR: [{ table: s.cashTransfers, href: () => `/transfers` }],
  BR: [
    { table: s.bankReconciliations, href: (id) => `/bank-accounts/reconcile/${id}` },
    { table: s.breakdownRequests, href: () => `/maintenance/requests` },
  ],
  FC: [{ table: s.fuelCardStatements, href: (id) => `/fuel-cards/${id}` }],
};

export default async function GoToDocument({ params }: { params: Promise<{ number: string }> }) {
  await requireUser();
  const number = decodeURIComponent((await params).number).trim();
  for (const t of TARGETS[number.split("-")[0]] ?? []) {
    const [row] = await db.select({ id: t.table.id }).from(t.table).where(eq(t.table.number, number)).limit(1);
    if (row) redirect(t.href(Number(row.id)));
  }
  notFound();
}

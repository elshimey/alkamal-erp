import "server-only";
import { desc, ilike, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { can, type Entity, type PermissionSet } from "@/lib/permissions";

export interface SearchHit {
  group: string;
  label: string;
  hint?: string;
  href: string;
}

/** بحث في المستندات والبيانات الأساسية بالرقم أو الاسم (حتى 5 نتائج لكل نوع). */
export async function searchRecords(perms: PermissionSet, raw: string): Promise<SearchHit[]> {
  const q = raw.trim();
  if (q.length < 2) return [];
  const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
  const has = (e: Entity) => can(perms, e, "view");
  const n = 5;
  type Job = Promise<SearchHit[]>;
  const jobs: Job[] = [];
  const add = (e: Entity, job: () => Job) => has(e) && jobs.push(job());
  const any = (...cols: SQL[]) => or(...cols)!;

  add("waybills", async () =>
    (await db.select({ id: s.waybills.id, number: s.waybills.number, c: s.waybills.containerNumber, date: s.waybills.waybillDate }).from(s.waybills).where(any(ilike(s.waybills.number, like), ilike(s.waybills.containerNumber, like))).orderBy(desc(s.waybills.id)).limit(n)).map((r) => ({
      group: "الشحنات",
      label: `شحنة ${r.number}`,
      hint: [r.date, r.c].filter(Boolean).join(" · "),
      href: `/waybills/${r.id}`,
    })),
  );
  add("sales_invoices", async () =>
    (await db.select({ id: s.salesInvoices.id, number: s.salesInvoices.number, date: s.salesInvoices.invoiceDate }).from(s.salesInvoices).where(any(ilike(s.salesInvoices.number, like), ilike(s.salesInvoices.reference, like))).orderBy(desc(s.salesInvoices.id)).limit(n)).map((r) => ({
      group: "فواتير المبيعات",
      label: `فاتورة ${r.number}`,
      hint: r.date,
      href: `/invoices/${r.id}`,
    })),
  );
  add("purchase_invoices", async () =>
    (await db.select({ id: s.purchaseInvoices.id, number: s.purchaseInvoices.number, ref: s.purchaseInvoices.supplierInvoiceNo }).from(s.purchaseInvoices).where(any(ilike(s.purchaseInvoices.number, like), ilike(s.purchaseInvoices.supplierInvoiceNo, like))).orderBy(desc(s.purchaseInvoices.id)).limit(n)).map((r) => ({
      group: "فواتير الموردين",
      label: `فاتورة مورد ${r.number}`,
      hint: r.ref ? `رقم المورد ${r.ref}` : undefined,
      href: `/purchases/${r.id}`,
    })),
  );
  add("receipts", async () =>
    (await db.select({ id: s.receipts.id, number: s.receipts.number, date: s.receipts.receiptDate }).from(s.receipts).where(any(ilike(s.receipts.number, like), ilike(s.receipts.reference, like))).orderBy(desc(s.receipts.id)).limit(n)).map((r) => ({
      group: "سندات القبض",
      label: `سند قبض ${r.number}`,
      hint: r.date,
      href: `/receipts/${r.id}`,
    })),
  );
  add("payments", async () =>
    (await db.select({ id: s.payments.id, number: s.payments.number }).from(s.payments).where(any(ilike(s.payments.number, like), ilike(s.payments.reference, like))).orderBy(desc(s.payments.id)).limit(n)).map((r) => ({
      group: "سندات الصرف",
      label: `سند صرف ${r.number}`,
      href: `/payments`,
    })),
  );
  add("expenses", async () =>
    (await db.select({ id: s.expenses.id, number: s.expenses.number }).from(s.expenses).where(any(ilike(s.expenses.number, like), ilike(s.expenses.reference, like))).orderBy(desc(s.expenses.id)).limit(n)).map((r) => ({
      group: "المصروفات",
      label: `مصروف ${r.number}`,
      href: `/expenses`,
    })),
  );
  add("journal_entries", async () =>
    (await db.select({ id: s.journalEntries.id, number: s.journalEntries.number, memo: s.journalEntries.description }).from(s.journalEntries).where(any(ilike(s.journalEntries.number, like), ilike(s.journalEntries.reference, like))).orderBy(desc(s.journalEntries.id)).limit(n)).map((r) => ({
      group: "القيود",
      label: `قيد ${r.number}`,
      hint: r.memo ?? undefined,
      href: `/journal/${r.id}`,
    })),
  );
  add("maintenance", async () =>
    (await db.select({ id: s.maintenanceOrders.id, number: s.maintenanceOrders.number }).from(s.maintenanceOrders).where(ilike(s.maintenanceOrders.number, like)).orderBy(desc(s.maintenanceOrders.id)).limit(n)).map((r) => ({
      group: "أوامر الصيانة",
      label: `أمر صيانة ${r.number}`,
      href: `/maintenance/${r.id}`,
    })),
  );
  add("sales_invoices", async () =>
    (await db.select({ id: s.adjustmentNotes.id, number: s.adjustmentNotes.number, kind: s.adjustmentNotes.kind }).from(s.adjustmentNotes).where(ilike(s.adjustmentNotes.number, like)).orderBy(desc(s.adjustmentNotes.id)).limit(n)).map((r) => ({
      group: "الإشعارات",
      label: `إشعار ${r.number}`,
      href: `/notes/${r.kind.startsWith("sales") ? "sales" : "purchase"}/${r.id}`,
    })),
  );
  add("parties", async () =>
    (await db.select({ id: s.parties.id, name: s.parties.nameAr, vat: s.parties.vatNumber, mobile: s.parties.mobile }).from(s.parties).where(any(ilike(s.parties.nameAr, like), ilike(s.parties.nameEn, like), ilike(s.parties.vatNumber, like), ilike(s.parties.mobile, like))).limit(n)).map((r) => ({
      group: "العملاء والموردون",
      label: r.name,
      hint: [r.vat, r.mobile].filter(Boolean).join(" · ") || undefined,
      href: `/records/parties/${r.id}`,
    })),
  );
  add("vehicles", async () =>
    (await db.select({ id: s.vehicles.id, plate: s.vehicles.plate, make: s.vehicles.make, model: s.vehicles.model }).from(s.vehicles).where(any(ilike(s.vehicles.plate, like), ilike(s.vehicles.chassis, like))).limit(n)).map((r) => ({
      group: "المركبات",
      label: `المركبة ${r.plate}`,
      hint: [r.make, r.model].filter(Boolean).join(" ") || undefined,
      href: `/records/vehicles/${r.id}`,
    })),
  );
  add("drivers", async () =>
    (await db.select({ id: s.drivers.id, name: s.employees.nameAr, mobile: s.drivers.mobile }).from(s.drivers).innerJoin(s.employees, sql`${s.employees.id} = ${s.drivers.employeeId}`).where(any(ilike(s.employees.nameAr, like), ilike(s.drivers.mobile, like), ilike(s.drivers.residencyNumber, like))).limit(n)).map((r) => ({
      group: "السائقون",
      label: r.name,
      hint: r.mobile ?? undefined,
      href: `/drivers/${r.id}`,
    })),
  );
  add("employees", async () =>
    (await db.select({ id: s.employees.id, name: s.employees.nameAr, job: s.employees.jobTitle }).from(s.employees).where(any(ilike(s.employees.nameAr, like), ilike(s.employees.nationalId, like))).limit(n)).map((r) => ({
      group: "الموظفون",
      label: r.name,
      hint: r.job ?? undefined,
      href: `/records/employees/${r.id}`,
    })),
  );
  add("inventory", async () =>
    (await db.select({ id: s.products.id, name: s.products.nameAr, code: s.products.code }).from(s.products).where(any(ilike(s.products.nameAr, like), ilike(s.products.code, like))).limit(n)).map((r) => ({
      group: "الأصناف",
      label: r.name,
      hint: r.code ?? undefined,
      href: `/products?q=${encodeURIComponent(r.code ?? r.name)}`,
    })),
  );
  add("accounts", async () =>
    (await db.select({ id: s.accounts.id, name: s.accounts.nameAr, code: s.accounts.code }).from(s.accounts).where(any(ilike(s.accounts.nameAr, like), ilike(s.accounts.code, `${q.replace(/[%_\\]/g, "")}%`))).orderBy(s.accounts.code).limit(n)).map((r) => ({
      group: "الحسابات",
      label: `${r.code} ${r.name}`,
      hint: "كشف الحساب",
      href: `/reports/ledger?account=${r.id}`,
    })),
  );
  return (await Promise.all(jobs)).flat();
}

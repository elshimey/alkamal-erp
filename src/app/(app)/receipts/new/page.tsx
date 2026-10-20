import Link from "next/link";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { cashAccounts } from "@/lib/invoices";
import { adjustmentAccounts, type ReceiptKind } from "@/lib/receipts";
import { todayRiyadh } from "@/lib/dates";
import { customerOptions } from "@/lib/lookups";
import { RECEIPT_KINDS } from "@/data/sales";
import { ReceiptForm } from "./form";

export default async function NewReceiptPage({ searchParams }: { searchParams: Promise<{ kind?: string; customer?: string; invoice?: string }> }) {
  const user = await requirePermission("receipts", "create");
  const sp = await searchParams;
  const kind: ReceiptKind = sp.kind === "advance" || sp.kind === "refund" ? sp.kind : "invoice_payment";
  const [customers, cash, adjustments, currencies] = await Promise.all([
    customerOptions(),
    cashAccounts(db),
    adjustmentAccounts(db),
    db.select({ code: s.currencies.code }).from(s.currencies).orderBy(asc(s.currencies.code)),
  ]);
  return (
    <div className="animate-rise">
      <div className="mb-5 flex flex-wrap items-center gap-2 text-sm text-gray-500">
        <Link href="/receipts" className="hover:text-brand-700">
          سندات العملاء
        </Link>
        <span>›</span>
        <span className="font-semibold text-brand-900">{kind === "refund" ? "تسجيل سند استرداد لعميل" : kind === "advance" ? "تسجيل دفعة مقدمة لعميل" : "تسجيل سند قبض من عميل"}</span>
      </div>
      {cash.length === 0 ? (
        <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
          أضف حساب صندوق أو بنك تفصيلي تحت 1101 أو 1102 من{" "}
          <Link href="/accounts" className="underline">
            شجرة الحسابات
          </Link>{" "}
          أولاً.
        </p>
      ) : (
        <ReceiptForm
          kind={kind}
          title={kind === "invoice_payment" ? "دفعة فواتير" : RECEIPT_KINDS[kind].label}
          customers={customers}
          cash={cash.map((a) => ({ value: String(a.id), label: `${a.code} ${a.nameAr}`, currency: a.currencyCode }))}
          adjustmentAccounts={adjustments.map((a) => ({ value: String(a.id), label: `${a.code} ${a.nameAr}`, name: a.nameAr }))}
          currencies={currencies.map((c) => c.code)}
          today={todayRiyadh()}
          initialCustomer={sp.customer ?? ""}
          initialInvoice={Number(sp.invoice) || null}
          willPost={can(user.perms, "receipts", "approve")}
        />
      )}
    </div>
  );
}

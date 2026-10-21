import Link from "next/link";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listCashAccounts } from "@/lib/banks";
import { todayRiyadh } from "@/lib/dates";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, Field, Input, PageHeader, Select } from "@/components/ui";
import { createBank, saveBankDetails } from "./actions";

const fmt = (v: number) => v.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ibanFmt = (v: string) => v.replace(/(.{4})/g, "$1 ").trim();

export default async function BankAccountsPage() {
  const user = await requirePermission("accounts", "view");
  const [rows, currencies] = await Promise.all([listCashAccounts(db), db.select({ code: s.currencies.code }).from(s.currencies).orderBy(asc(s.currencies.code))]);
  const canCreate = can(user.perms, "accounts", "create");
  const canEdit = can(user.perms, "accounts", "update");
  const total = rows.reduce((t, r) => t + r.balanceBase, 0);
  const groups = [
    { title: "الحسابات البنكية", kind: "bank" as const, items: rows.filter((r) => r.kind === "bank") },
    { title: "الصناديق", kind: "cash" as const, items: rows.filter((r) => r.kind === "cash") },
  ];

  return (
    <>
      <PageHeader title="الحسابات البنكية والصناديق" description="كل بنك أو صندوق حساب تفصيلي في الشجرة، ورصيده من القيود المرحّلة. منها يُختار «تم الدفع من خلال» في السندات.">
        <div className="rounded-2xl bg-asphalt-900 px-5 py-3 text-white">
          <div className="text-xs text-white/70">إجمالي النقد بالريال</div>
          <div className="ltr-nums font-display text-xl font-semibold">{fmt(total)}</div>
        </div>
      </PageHeader>

      {groups.map((g) => (
        <section key={g.kind} className="mb-8">
          <h2 className="mb-3 font-semibold text-brand-900">{g.title}</h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {g.items.length === 0 && <p className="text-sm text-gray-500">لا توجد حسابات بعد</p>}
            {g.items.map((r) => (
              <article key={r.a.id} className="flex flex-col rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-gray-900">{r.a.nameAr}</div>
                    <div className="text-xs text-gray-500">
                      <span className="ltr-nums">{r.a.code}</span>
                      {r.bank && <> · {r.bank.bankName}</>}
                      {r.bank?.branch && <> · {r.bank.branch}</>}
                    </div>
                  </div>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">{r.a.currencyCode ?? "SAR"}</span>
                </div>
                {r.bank?.iban && <div className="ltr-nums mt-3 rounded-lg bg-gray-50 px-3 py-1.5 font-mono text-xs tracking-wide text-gray-700" dir="ltr">{ibanFmt(r.bank.iban)}</div>}
                {r.bank?.accountNumber && <div className="ltr-nums mt-1 text-xs text-gray-500">رقم الحساب {r.bank.accountNumber}</div>}
                <div className="mt-4 flex items-end justify-between">
                  <div>
                    <div className="text-[11px] text-gray-500">الرصيد</div>
                    <div className={`ltr-nums font-display text-2xl font-semibold ${r.balance < 0 ? "text-red-700" : "text-brand-900"}`}>{fmt(r.balance)}</div>
                    {(r.a.currencyCode ?? "SAR") !== "SAR" && <div className="ltr-nums text-[11px] text-gray-400">≈ {fmt(r.balanceBase)} SAR</div>}
                  </div>
                  <div className="text-end text-[11px] text-gray-400">
                    {r.lastDate ? (
                      <>
                        آخر حركة <span className="ltr-nums">{r.lastDate}</span>
                      </>
                    ) : (
                      "لا حركات"
                    )}
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2 border-t border-gray-100 pt-3 text-xs">
                  <Link href={`/reports/ledger?account=${r.a.id}`} className="text-brand-700 hover:underline">
                    كشف الحساب
                  </Link>
                  <Link href="/receipts/new" className="text-brand-700 hover:underline">
                    سند قبض
                  </Link>
                  <Link href="/payments" className="text-brand-700 hover:underline">
                    سند صرف
                  </Link>
                  <Link href="/bank-accounts/reconcile" className="text-brand-700 hover:underline">
                    تسوية بنكية
                  </Link>
                </div>
                {canEdit && (
                  <details className="mt-2 text-sm">
                    <summary className="cursor-pointer text-xs text-gray-500 hover:text-brand-700">تعديل البيانات</summary>
                    <ActionForm action={saveBankDetails.bind(null, r.a.id)} resetOnSuccess={false} className="mt-3 grid gap-2">
                      <Input name="nameAr" defaultValue={r.a.nameAr} placeholder="اسم الحساب" />
                      {r.kind === "bank" && (
                        <>
                          <Input name="bankName" defaultValue={r.bank?.bankName ?? ""} placeholder="اسم البنك" />
                          <Input name="iban" defaultValue={r.bank?.iban ?? ""} placeholder="الآيبان SA…" dir="ltr" />
                          <div className="grid grid-cols-2 gap-2">
                            <Input name="accountNumber" defaultValue={r.bank?.accountNumber ?? ""} placeholder="رقم الحساب" dir="ltr" />
                            <Input name="swift" defaultValue={r.bank?.swift ?? ""} placeholder="SWIFT" dir="ltr" />
                          </div>
                          <Input name="branch" defaultValue={r.bank?.branch ?? ""} placeholder="الفرع" />
                        </>
                      )}
                      <SubmitButton>حفظ</SubmitButton>
                    </ActionForm>
                  </details>
                )}
              </article>
            ))}
          </div>
        </section>
      ))}

      {canCreate && (
        <Card title="إضافة بنك أو صندوق">
          <ActionForm action={createBank} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="النوع">
              <Select name="kind" defaultValue="bank">
                <option value="bank">حساب بنكي</option>
                <option value="cash">صندوق نقدي</option>
              </Select>
            </Field>
            <Field label="اسم الحساب">
              <Input name="nameAr" required placeholder="مثل: بنك الأهلي – الجاري" />
            </Field>
            <Field label="العملة">
              <Select name="currency" defaultValue="">
                <option value="">SAR</option>
                {currencies
                  .filter((c) => c.code !== "SAR")
                  .map((c) => (
                    <option key={c.code}>{c.code}</option>
                  ))}
              </Select>
            </Field>
            <Field label="اسم البنك" hint="للحساب البنكي">
              <Input name="bankName" placeholder="البنك الأهلي السعودي" />
            </Field>
            <Field label="الآيبان">
              <Input name="iban" placeholder="SA00 0000 0000 0000 0000 0000" dir="ltr" />
            </Field>
            <Field label="رقم الحساب">
              <Input name="accountNumber" dir="ltr" />
            </Field>
            <Field label="SWIFT">
              <Input name="swift" dir="ltr" />
            </Field>
            <Field label="الفرع">
              <Input name="branch" />
            </Field>
            <Field label="الرصيد الافتتاحي" hint="اختياري؛ يُقيد مقابل الأرباح المبقاة">
              <Input name="openingBalance" inputMode="decimal" placeholder="0.00" />
            </Field>
            <Field label="تاريخ الرصيد الافتتاحي">
              <Input type="date" name="openingDate" defaultValue={todayRiyadh()} />
            </Field>
            <div className="flex items-end">
              <SubmitButton>إضافة</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      )}
    </>
  );
}

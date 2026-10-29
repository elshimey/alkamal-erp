import { and, asc, eq, like, or, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";
import { addSubAccountTx } from "@/lib/accounts";
import { createJournalEntryTx } from "@/lib/ledger";

// الحسابات البنكية والصناديق: حساب تفصيلي تحت 1102 (البنوك) أو 1101 (الصناديق) مع بيانات البنك،
// والرصيد دائماً من القيود المرحّلة. الرصيد الافتتاحي يُقيد مقابل الأرباح المبقاة 3103.

export const CASH_PARENTS = { bank: "1102", cash: "1101" } as const;
const OPENING_EQUITY = "3103";

/** تحقق IBAN بخوارزمية mod 97؛ الآيبان السعودي 24 خانة يبدأ بـ SA. */
export function normalizeIban(raw: string) {
  const iban = raw.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) throw new Error("رقم الآيبان غير صحيح");
  if (iban.startsWith("SA") && iban.length !== 24) throw new Error("الآيبان السعودي 24 خانة");
  const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const d of digits) rem = (rem * 10 + Number(d)) % 97;
  if (rem !== 1) throw new Error("رقم الآيبان غير صحيح (خانة التحقق)");
  return iban;
}

export interface BankInput {
  kind: "bank" | "cash";
  nameAr: string;
  currencyCode?: string | null;
  bankName?: string | null;
  accountNumber?: string | null;
  iban?: string | null;
  swift?: string | null;
  branch?: string | null;
  openingBalance?: number;
  openingDate?: string;
  userId?: number;
}

export async function createCashAccount(db: Db, input: BankInput) {
  return db.transaction(async (tx) => {
    if (!input.nameAr.trim()) throw new Error("اكتب اسم الحساب");
    const [parent] = await tx.select().from(s.accounts).where(eq(s.accounts.code, CASH_PARENTS[input.kind]));
    if (!parent) throw new Error("حساب البنوك/الصناديق غير موجود في الشجرة");
    const account = await addSubAccountTx(tx, parent.id, input.nameAr, input.currencyCode || null);
    if (input.kind === "bank") {
      if (!input.bankName?.trim()) throw new Error("اكتب اسم البنك");
      await tx.insert(s.bankAccounts).values({
        accountId: account.id,
        bankName: input.bankName.trim(),
        accountNumber: input.accountNumber?.trim() || null,
        iban: input.iban?.trim() ? normalizeIban(input.iban) : null,
        swift: input.swift?.trim().toUpperCase() || null,
        branch: input.branch?.trim() || null,
      });
    }
    if (input.openingBalance) {
      if (!input.openingDate) throw new Error("حدد تاريخ الرصيد الافتتاحي");
      const [equity] = await tx.select().from(s.accounts).where(eq(s.accounts.code, OPENING_EQUITY));
      const cur = account.currencyCode ?? "SAR";
      if (cur !== "SAR") throw new Error("الرصيد الافتتاحي بعملة أجنبية يُسجل بقيد يدوي بسعر الصرف");
      const amount = Math.abs(input.openingBalance);
      const debitBank = input.openingBalance > 0;
      await createJournalEntryTx(tx, {
        entryDate: input.openingDate,
        description: `رصيد افتتاحي – ${account.nameAr}`,
        post: true,
        userId: input.userId,
        lines: [
          { accountId: account.id, [debitBank ? "debit" : "credit"]: amount, description: "رصيد افتتاحي" },
          { accountId: equity.id, [debitBank ? "credit" : "debit"]: amount, description: `رصيد افتتاحي – ${account.nameAr}` },
        ],
      });
    }
    return account;
  });
}

/** الصندوق أو البنك الذي يُصرف منه أو يُقبض فيه: حساب تفصيلي نشط تحت 1101 أو 1102. */
export async function cashAccountFor(db: Db | Tx, id: number | null | undefined, message: string) {
  const [cash] = id ? await db.select().from(s.accounts).where(eq(s.accounts.id, id)) : [];
  if (!cash || !cash.isPostable || !/^110[12]/.test(cash.code)) throw new Error(message);
  if (!cash.isActive) throw new Error(`الحساب ${cash.code} ${cash.nameAr} موقوف؛ اختر صندوقاً أو بنكاً نشطاً`);
  return cash;
}

export async function updateBankDetails(db: Db, accountId: number, input: Omit<BankInput, "kind" | "openingBalance" | "openingDate" | "currencyCode">) {
  return db.transaction(async (tx) => {
    const [a] = await tx.select().from(s.accounts).where(eq(s.accounts.id, accountId));
    if (!a || !a.isPostable || !/^110[12]/.test(a.code)) throw new Error("الحساب ليس صندوقاً ولا بنكاً");
    if (input.nameAr.trim() && input.nameAr.trim() !== a.nameAr) await tx.update(s.accounts).set({ nameAr: input.nameAr.trim() }).where(eq(s.accounts.id, accountId));
    if (!a.code.startsWith(CASH_PARENTS.bank)) return;
    if (!input.bankName?.trim()) throw new Error("اكتب اسم البنك");
    const values = {
      bankName: input.bankName.trim(),
      accountNumber: input.accountNumber?.trim() || null,
      iban: input.iban?.trim() ? normalizeIban(input.iban) : null,
      swift: input.swift?.trim().toUpperCase() || null,
      branch: input.branch?.trim() || null,
    };
    await tx.insert(s.bankAccounts).values({ accountId, ...values }).onConflictDoUpdate({ target: s.bankAccounts.accountId, set: values });
  });
}

/** الصناديق والبنوك مع أرصدتها بعملة الحساب وبالريال وآخر حركة. */
export async function listCashAccounts(db: Db | Tx) {
  const posted = sql`exists (select 1 from journal_entries e where e.id = journal_lines.entry_id and e.status = 'posted')`;
  const bal = (col: string) =>
    sql<string>`coalesce((select sum(${sql.raw(`journal_lines.debit${col} - journal_lines.credit${col}`)}) from journal_lines where journal_lines.account_id = ${s.accounts.id} and ${posted}), 0)`;
  const rows = await db
    .select({
      a: s.accounts,
      bank: s.bankAccounts,
      balance: bal(""),
      balanceBase: bal("_base"),
      lastDate: sql<string | null>`(select max(e.entry_date) from journal_lines l join journal_entries e on e.id = l.entry_id where l.account_id = accounts.id and e.status = 'posted')`,
      moves: sql<number>`(select count(*) from journal_lines l where l.account_id = accounts.id)::int`,
    })
    .from(s.accounts)
    .leftJoin(s.bankAccounts, eq(s.bankAccounts.accountId, s.accounts.id))
    .where(and(eq(s.accounts.isPostable, true), or(like(s.accounts.code, `${CASH_PARENTS.bank}%`), like(s.accounts.code, `${CASH_PARENTS.cash}%`))))
    .orderBy(asc(s.accounts.code));
  return rows.map((r) => ({ ...r, kind: r.a.code.startsWith(CASH_PARENTS.bank) ? ("bank" as const) : ("cash" as const), balance: Number(r.balance), balanceBase: Number(r.balanceBase) }));
}

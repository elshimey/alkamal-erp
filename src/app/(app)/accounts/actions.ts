"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requirePermission, requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { addSubAccount } from "@/lib/accounts";
import { errorMessage } from "@/lib/errors";
import type { FormState } from "@/components/action-form";

export async function createAccount(_: FormState, data: FormData): Promise<FormState> {
  await requirePermission("accounts", "create");
  const parentId = Number(data.get("parentId"));
  const nameAr = String(data.get("nameAr") ?? "").trim();
  const currency = String(data.get("currency") ?? "") || null;
  if (!parentId || !nameAr) return { error: "اختر الحساب الأب واكتب اسم الحساب" };
  try {
    const account = await addSubAccount(db, parentId, nameAr, currency);
    revalidatePath("/accounts");
    return { ok: `أُضيف الحساب ${account.code} ${account.nameAr}` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

// إضافة سريعة من نافذة الإرسال للسائق: صندوق (خزينة فرعية) أو بنك أو عهدة موظف، دون مغادرة الصفحة
const FUNDING_PARENTS = { cash: "1101", bank: "1102", custody: "1105" } as const;

export async function addFundingAccount(
  kind: keyof typeof FUNDING_PARENTS,
  nameAr: string,
): Promise<{ account: { id: number; code: string; nameAr: string } } | { error: string }> {
  const user = await requireUser();
  if (!can(user.perms, "accounts", "create")) return { error: "ليست لديك صلاحية إضافة حسابات؛ اطلبها من مدير النظام" };
  const code = FUNDING_PARENTS[kind];
  if (!code) return { error: "اختر نوع الحساب" };
  if (!nameAr.trim()) return { error: "اكتب اسم الحساب" };
  try {
    const [parent] = await db.select({ id: s.accounts.id }).from(s.accounts).where(eq(s.accounts.code, code));
    if (!parent) return { error: `الحساب الأب ${code} غير موجود في الدليل` };
    const account = await addSubAccount(db, parent.id, nameAr);
    revalidatePath("/accounts");
    return { account: { id: account.id, code: account.code, nameAr: account.nameAr } };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

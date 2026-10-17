"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
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

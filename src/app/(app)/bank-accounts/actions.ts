"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { createCashAccount, updateBankDetails } from "@/lib/banks";
import type { FormState } from "@/components/action-form";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function createBank(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("accounts", "create");
  try {
    const kind = str(fd, "kind") === "cash" ? "cash" : "bank";
    const opening = Number(str(fd, "openingBalance").replace(/,/g, "")) || 0;
    const a = await createCashAccount(db, {
      kind,
      nameAr: str(fd, "nameAr"),
      currencyCode: str(fd, "currency") || null,
      bankName: str(fd, "bankName"),
      accountNumber: str(fd, "accountNumber"),
      iban: str(fd, "iban"),
      swift: str(fd, "swift"),
      branch: str(fd, "branch"),
      openingBalance: opening,
      openingDate: str(fd, "openingDate"),
      userId: user.id,
    });
    revalidatePath("/bank-accounts");
    revalidatePath("/accounts");
    return { ok: `أُضيف الحساب ${a.code} ${a.nameAr}` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function saveBankDetails(accountId: number, _: FormState, fd: FormData): Promise<FormState> {
  await requirePermission("accounts", "update");
  try {
    await updateBankDetails(db, accountId, { nameAr: str(fd, "nameAr"), bankName: str(fd, "bankName"), accountNumber: str(fd, "accountNumber"), iban: str(fd, "iban"), swift: str(fd, "swift"), branch: str(fd, "branch") });
    revalidatePath("/bank-accounts");
    return { ok: "حُفظت البيانات" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

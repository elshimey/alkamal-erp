"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { createTransfer, deleteTransfer } from "@/lib/transfers";
import type { FormState } from "@/components/action-form";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const num = (fd: FormData, k: string) => {
  const v = str(fd, k).replace(/,/g, "");
  return v ? Number(v) : null;
};

export async function saveTransfer(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("payments", "create");
  try {
    const t = await createTransfer(db, {
      date: str(fd, "date"),
      fromAccountId: Number(str(fd, "fromAccountId")),
      toAccountId: Number(str(fd, "toAccountId")),
      amount: num(fd, "amount") ?? 0,
      receivedAmount: num(fd, "receivedAmount"),
      fee: num(fd, "fee") ?? 0,
      reference: str(fd, "reference"),
      notes: str(fd, "notes"),
      userId: user.id,
    });
    revalidatePath("/transfers");
    revalidatePath("/bank-accounts");
    return { ok: `سُجل التحويل ${t.number} بالقيد ${t.entryNumber}` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function removeTransfer(id: number, _: FormState): Promise<FormState> {
  await requirePermission("payments", "delete");
  try {
    await deleteTransfer(db, id);
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath("/transfers");
  revalidatePath("/bank-accounts");
  return { ok: "حُذف التحويل وقيده" };
}

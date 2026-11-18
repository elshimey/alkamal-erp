"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { addTaxCode, setTaxCodeActive } from "@/lib/tax-codes";
import { errorMessage } from "@/lib/errors";
import type { FormState } from "@/components/action-form";

export async function addTaxAction(_: FormState, fd: FormData): Promise<FormState> {
  await requirePermission("settings", "update");
  try {
    await addTaxCode(db, { name: String(fd.get("name") ?? ""), behavior: String(fd.get("behavior") ?? "") });
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath("/settings/taxes");
  return { ok: "أُضيف نوع الضريبة" };
}

export async function toggleTaxAction(_: FormState, fd: FormData): Promise<FormState> {
  await requirePermission("settings", "update");
  try {
    await setTaxCodeActive(db, Number(fd.get("id")), fd.get("active") === "1");
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath("/settings/taxes");
  return { ok: "حُفظ" };
}

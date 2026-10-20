"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { errorMessage } from "@/lib/errors";
import { createStockDoc, createWarehouse, deleteStockDoc, postStockDoc, revertStockDoc, saveCount, type StockDocInput } from "@/lib/inventory";
import type { FormState } from "@/components/action-form";

const refresh = () => {
  revalidatePath("/inventory");
  revalidatePath("/inventory/docs");
  revalidatePath("/products");
  revalidatePath("/journal");
};

export async function addWarehouse(_: FormState, fd: FormData): Promise<FormState> {
  await requirePermission("inventory", "create");
  try {
    const w = await createWarehouse(db, { nameAr: String(fd.get("nameAr") ?? ""), code: String(fd.get("code") ?? ""), location: String(fd.get("location") ?? "") });
    refresh();
    return { ok: `أُضيف ${w.nameAr}` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function saveStockDoc(input: Omit<StockDocInput, "userId">): Promise<{ id?: number; error?: string }> {
  const user = await requirePermission("inventory", "create");
  try {
    const post = input.post && input.kind !== "count" && can(user.perms, "inventory", "approve");
    const doc = await createStockDoc(db, { ...input, post, userId: user.id });
    refresh();
    return { id: doc.id };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function saveCounted(id: number, _: FormState, fd: FormData): Promise<FormState> {
  await requirePermission("inventory", "update");
  try {
    const counted: Record<number, number | null> = {};
    for (const [k, v] of fd.entries()) {
      if (!k.startsWith("c_")) continue;
      const raw = String(v).trim().replace(/,/g, "");
      counted[Number(k.slice(2))] = raw === "" ? null : Number(raw);
    }
    await saveCount(db, id, counted);
    if (fd.get("post") === "1") {
      await requirePermission("inventory", "approve");
      await postStockDoc(db, id);
    }
    refresh();
    return { ok: fd.get("post") === "1" ? "رُحّل الجرد" : "حُفظت الكميات" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function postDoc(id: number): Promise<FormState> {
  const user = await requirePermission("inventory", "approve");
  try {
    await postStockDoc(db, id, user.id);
    refresh();
    return { ok: "رُحّل المستند" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function revertDoc(id: number): Promise<FormState> {
  await requirePermission("inventory", "revert");
  try {
    await revertStockDoc(db, id);
    refresh();
    return { ok: "أُرجع المستند لمسودة" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function removeDoc(id: number, _: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("inventory", "delete");
  try {
    await deleteStockDoc(db, id, { reason: String(fd.get("reason") ?? ""), userId: user.id });
    refresh();
    return { ok: "حُذف المستند" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

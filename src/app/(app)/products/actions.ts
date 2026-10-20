"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { createProduct, updateProduct, type ProductInput } from "@/lib/inventory";
import type { FormState } from "@/components/action-form";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const n = (fd: FormData, k: string) => Number(str(fd, k).replace(/,/g, "")) || 0;

const input = (fd: FormData): ProductInput => ({
  code: str(fd, "code") || null,
  nameAr: str(fd, "nameAr"),
  nameEn: str(fd, "nameEn") || null,
  kind: str(fd, "kind") === "service" ? "service" : "stock",
  category: str(fd, "category") || null,
  unit: str(fd, "unit") || null,
  barcode: str(fd, "barcode") || null,
  purchasePrice: n(fd, "purchasePrice"),
  salePrice: n(fd, "salePrice"),
  reorderLevel: n(fd, "reorderLevel"),
  accountId: str(fd, "accountId") ? Number(str(fd, "accountId")) : null,
  notes: str(fd, "notes") || null,
});

export async function addProduct(_: FormState, fd: FormData): Promise<FormState> {
  await requirePermission("inventory", "create");
  try {
    const p = await createProduct(db, input(fd));
    revalidatePath("/products");
    return { ok: `أُضيف الصنف ${p.code} ${p.nameAr}` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function editProduct(id: number, _: FormState, fd: FormData): Promise<FormState> {
  await requirePermission("inventory", "update");
  try {
    await updateProduct(db, id, { ...input(fd), isActive: fd.get("isActive") === "on" });
    revalidatePath("/products");
    return { ok: "حُفظ الصنف" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

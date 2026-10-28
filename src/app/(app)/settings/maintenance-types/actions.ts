"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { saveMaintenanceType } from "@/lib/maintenance";
import { errorMessage } from "@/lib/errors";
import type { FormState } from "@/components/action-form";

export async function saveMaintenanceTypeAction(_: FormState, fd: FormData): Promise<FormState> {
  await requirePermission("settings", "update");
  const str = (k: string) => String(fd.get(k) ?? "").trim();
  try {
    await saveMaintenanceType(db, {
      id: Number(str("id")) || null,
      nameAr: str("nameAr"),
      nameEn: str("nameEn") || null,
      sortOrder: str("sortOrder") ? Number(str("sortOrder")) : null,
      isActive: fd.get("active") === "on",
    });
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath("/settings/maintenance-types");
  revalidatePath("/driver/expenses");
  revalidatePath("/driver/breakdown");
  return { ok: "حُفظ نوع الصيانة" };
}

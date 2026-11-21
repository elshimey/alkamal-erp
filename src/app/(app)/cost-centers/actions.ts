"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { createCostCenter } from "@/lib/cost-centers";
import type { FormState } from "@/components/action-form";

export async function addCostCenter(_: FormState, fd: FormData): Promise<FormState> {
  await requirePermission("cost_centers", "create");
  try {
    const cc = await createCostCenter(db, { nameAr: String(fd.get("nameAr") ?? ""), code: String(fd.get("code") ?? ""), type: String(fd.get("type") ?? "") });
    revalidatePath("/cost-centers");
    revalidatePath("/fixed-assets");
    revalidatePath("/expenses");
    return { ok: `أُضيف مركز التكلفة ${cc.nameAr} (${cc.code})` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

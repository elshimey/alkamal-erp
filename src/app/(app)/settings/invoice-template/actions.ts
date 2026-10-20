"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { saveInvoiceTemplate } from "@/lib/company";
import { errorMessage } from "@/lib/errors";
import type { FormState } from "@/components/action-form";

export async function saveTemplateAction(_: FormState, d: FormData): Promise<FormState> {
  const user = await requirePermission("settings", "update");
  try {
    await saveInvoiceTemplate(db, JSON.parse(String(d.get("template") ?? "{}")), user.id);
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath("/invoices", "layout");
  revalidatePath("/settings/invoice-template");
  return { ok: "حُفظ قالب الفاتورة، ويظهر في كل الفواتير والطباعة" };
}

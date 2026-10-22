"use server";

import { redirect } from "next/navigation";
import { baseSql, db } from "@/db";
import { getTenant, requireAdmin } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { resetTenant } from "@/lib/platform";
import type { FormState } from "@/components/action-form";

export async function resetAction(_: FormState, data: FormData): Promise<FormState> {
  await requireAdmin();
  const tenant = await getTenant();
  try {
    await resetTenant(baseSql, db, tenant.schema, String(data.get("confirm") ?? ""));
  } catch (err) {
    return { error: errorMessage(err) };
  }
  // الجلسات حُذفت مع البيانات؛ يدخل المستخدم من جديد
  redirect("/login");
}

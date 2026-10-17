"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { createDriver } from "@/lib/fleet";
import { errorMessage } from "@/lib/errors";
import type { FormState } from "@/components/action-form";

const optionalNum = z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().nonnegative().optional());
const optionalText = z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim() : undefined), z.string().optional());

const DriverSchema = z.object({
  nameAr: z.string().trim().min(2, "اسم السائق إلزامي"),
  mobile: optionalText,
  nationality: optionalText,
  nationalId: optionalText,
  residencyNumber: optionalText,
  licenseNumber: optionalText,
  transportCardNumber: optionalText,
  appLanguage: z.enum(["ar", "ur", "hi", "en"]),
  commissionClass: z.enum(["domestic", "international"]),
  hireDate: optionalText,
  basicSalary: optionalNum,
  custodyLimit: optionalNum,
});

export async function addDriver(_: FormState, data: FormData): Promise<FormState> {
  await requirePermission("drivers", "create");
  const parsed = DriverSchema.safeParse(Object.fromEntries(data));
  if (!parsed.success) return { error: parsed.error.issues.map((i) => i.message).join("\n") };
  try {
    const d = await createDriver(db, parsed.data);
    revalidatePath("/drivers");
    return { ok: `أُضيف السائق ${parsed.data.nameAr}، وحساب عهدته ${d.custodyAccountCode} وحساب رواتبه ${d.payableAccountCode}` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

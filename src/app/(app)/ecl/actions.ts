"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { ECL_BUCKETS, deleteEcl, postEcl, type EclBucket } from "@/lib/ecl";
import type { FormState } from "@/components/action-form";

export async function postProvision(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("journal_entries", "create");
  try {
    const asOf = String(fd.get("asOf") ?? "");
    const rates = Object.fromEntries(ECL_BUCKETS.map((b) => [b.key, Number(fd.get(b.key) ?? b.rate)])) as Record<EclBucket, number>;
    const e = await postEcl(db, asOf, rates, user.id);
    revalidatePath("/ecl");
    return { ok: `رُحّل قيد المخصص ${e.number}` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function removeProvision(id: number, _: FormState): Promise<FormState> {
  await requirePermission("journal_entries", "delete");
  try {
    await deleteEcl(db, id);
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath("/ecl");
  return { ok: "حُذف القيد" };
}

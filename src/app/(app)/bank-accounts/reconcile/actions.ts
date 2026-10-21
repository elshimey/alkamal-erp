"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import {
  addBankAdjustment,
  BANK_ADJUSTMENTS,
  completeReconciliation,
  createReconciliation,
  deleteReconciliation,
  reopenReconciliation,
  saveCleared,
  updateStatement,
} from "@/lib/reconciliation";
import type { FormState } from "@/components/action-form";

const PATH = "/bank-accounts/reconcile";
const refresh = (id?: number) => {
  revalidatePath(PATH);
  if (id) revalidatePath(`${PATH}/${id}`);
};

export async function createReconciliationAction(_: FormState, data: FormData): Promise<FormState> {
  const user = await requirePermission("accounts", "update");
  let id: number;
  try {
    const row = await createReconciliation(db, {
      accountId: Number(data.get("accountId")),
      statementDate: String(data.get("statementDate") ?? ""),
      statementBalance: Number(String(data.get("statementBalance") ?? "").replace(/,/g, "")),
      notes: String(data.get("notes") ?? ""),
      userId: user.id,
    });
    id = row.id;
  } catch (err) {
    return { error: errorMessage(err) };
  }
  refresh();
  redirect(`${PATH}/${id}`);
}

/** يحفظ التأشير، ومع complete يُكمل التسوية أيضاً. */
export async function saveClearedAction(id: number, lineIds: number[], complete: boolean): Promise<FormState> {
  const user = await requirePermission("accounts", "update");
  try {
    await saveCleared(db, id, lineIds);
    if (complete) await completeReconciliation(db, id, user.id);
    refresh(id);
    return { ok: complete ? "اكتملت التسوية" : "حُفظ التأشير" };
  } catch (err) {
    refresh(id);
    return { error: errorMessage(err) };
  }
}

export async function updateStatementAction(id: number, _: FormState, data: FormData): Promise<FormState> {
  await requirePermission("accounts", "update");
  try {
    await updateStatement(db, id, {
      statementDate: String(data.get("statementDate") ?? ""),
      statementBalance: Number(String(data.get("statementBalance") ?? "").replace(/,/g, "")),
    });
    refresh(id);
    return { ok: "حُدّث الكشف" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function addAdjustmentAction(id: number, _: FormState, data: FormData): Promise<FormState> {
  const user = await requirePermission("accounts", "update");
  try {
    const kind = String(data.get("kind")) as keyof typeof BANK_ADJUSTMENTS;
    const entry = await addBankAdjustment(db, id, {
      kind,
      amount: Number(String(data.get("amount") ?? "").replace(/,/g, "")),
      description: String(data.get("description") ?? ""),
      userId: user.id,
    });
    refresh(id);
    revalidatePath("/bank-accounts");
    return { ok: `رُحّل القيد ${entry.number} وأُشّر عليه` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function reopenReconciliationAction(id: number, _: FormState): Promise<FormState> {
  await requirePermission("accounts", "approve");
  try {
    await reopenReconciliation(db, id);
    refresh(id);
    return { ok: "أُعيدت التسوية مسودة" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function deleteReconciliationAction(id: number, _: FormState): Promise<FormState> {
  await requirePermission("accounts", "delete");
  try {
    await deleteReconciliation(db, id);
  } catch (err) {
    return { error: errorMessage(err) };
  }
  refresh();
  redirect(PATH);
}

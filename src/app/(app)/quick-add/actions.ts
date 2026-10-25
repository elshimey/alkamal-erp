"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { errorMessage, findPgError } from "@/lib/errors";
import { quickCreate, quickForm, quickPerm } from "@/lib/quick-add";
import {
  QUICK_KINDS,
  type QuickForm,
  type QuickKind,
  type QuickResult,
} from "@/lib/quick-add-types";

const LIST: Record<string, string> = {
  routes: "/routes",
  vehicles: "/vehicles",
  drivers: "/drivers",
  inventory: "/products",
  parties: "/parties",
};

export async function quickAddFormAction(
  kind: QuickKind,
): Promise<QuickForm | { error: string }> {
  if (!QUICK_KINDS.includes(kind)) return { error: "نوع غير معروف" };
  const user = await requireUser();
  if (!can(user.perms, quickPerm(kind), "create"))
    return { error: "ليست لديك صلاحية الإضافة هنا؛ اطلبها من مدير النظام" };
  return quickForm(kind, user.perms);
}

export async function quickAddAction(
  kind: QuickKind,
  values: Record<string, string>,
): Promise<QuickResult> {
  if (!QUICK_KINDS.includes(kind)) return { error: "نوع غير معروف" };
  const user = await requireUser();
  const perm = quickPerm(kind);
  if (!can(user.perms, perm, "create"))
    return { error: "ليست لديك صلاحية الإضافة هنا" };
  try {
    const res = await quickCreate(kind, values, user.perms);
    revalidatePath(LIST[perm]);
    if (values.withContract) revalidatePath("/contracts");
    return res;
  } catch (err) {
    if (findPgError(err)?.code === "23505")
      return {
        error: "مسجل مسبقاً بالبيانات نفسها (اللوحة أو الشاسيه أو الرمز)",
      };
    return { error: errorMessage(err) };
  }
}

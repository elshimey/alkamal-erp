"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { ALL_ACTIONS, ENTITIES, SPECIAL, SPECIAL_ENTITY, type Scope } from "@/lib/permissions";
import type { FormState } from "@/components/action-form";

export async function createRole(_: FormState, data: FormData): Promise<FormState> {
  await requirePermission("roles", "create");
  const nameAr = String(data.get("nameAr") ?? "").trim();
  const copyFrom = Number(data.get("copyFrom")) || null;
  if (nameAr.length < 2) return { error: "اكتب اسم الدور" };
  let roleId: number;
  try {
    roleId = await db.transaction(async (tx) => {
      const [role] = await tx.insert(s.roles).values({ nameAr }).returning({ id: s.roles.id });
      if (copyFrom) {
        const perms = await tx.select().from(s.rolePermissions).where(eq(s.rolePermissions.roleId, copyFrom));
        if (perms.length) await tx.insert(s.rolePermissions).values(perms.map((p) => ({ ...p, roleId: role.id })));
      }
      return role.id;
    });
  } catch (err) {
    return { error: errorMessage(err) };
  }
  redirect(`/roles/${roleId}`);
}

export async function saveRolePermissions(roleId: number, _: FormState, data: FormData): Promise<FormState> {
  await requirePermission("roles", "update");
  const [role] = await db.select().from(s.roles).where(eq(s.roles.id, roleId));
  if (!role) return { error: "الدور غير موجود" };
  if (role.isSystem) return { error: "الأدوار الأساسية ثابتة؛ انسخها إلى دور مخصص لتعديلها" };

  const selected = new Set(data.getAll("p").map(String));
  const rows: { roleId: number; entity: string; action: string; scope: Scope }[] = [];
  for (const entity of Object.keys(ENTITIES)) {
    const scope: Scope = data.get(`scope:${entity}`) === "own" ? "own" : "all";
    for (const action of ALL_ACTIONS) {
      if (selected.has(`${entity}:${action}`)) rows.push({ roleId, entity, action, scope });
    }
  }
  for (const special of Object.keys(SPECIAL)) {
    if (selected.has(`${SPECIAL_ENTITY}:${special}`)) rows.push({ roleId, entity: SPECIAL_ENTITY, action: special, scope: "all" });
  }

  await db.transaction(async (tx) => {
    await tx.delete(s.rolePermissions).where(eq(s.rolePermissions.roleId, roleId));
    if (rows.length) await tx.insert(s.rolePermissions).values(rows);
  });
  revalidatePath(`/roles/${roleId}`);
  return { ok: `حُفظت صلاحيات «${role.nameAr}» (${rows.length} صلاحية)` };
}

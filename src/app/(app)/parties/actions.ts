"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { createParty, type PartyRole } from "@/lib/operations";
import { cell, saveSheetRows, type SheetRow } from "@/lib/sheet-server";
import { PARTY_ROLES } from "@/data/operations";

export async function saveParties(rows: SheetRow[]) {
  await requirePermission("parties", "create");
  const result = await saveSheetRows(rows, async (r) => {
    const role = cell.required(r.role, "الدور") as PartyRole;
    if (!(role in PARTY_ROLES)) throw new Error("الدور غير معروف");
    const country = (r.country || "SA").toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) throw new Error("الدولة رمز من حرفين مثل SA");
    await createParty(db, {
      nameAr: cell.required(r.nameAr, "الاسم"),
      kind: r.kind === "individual" ? "individual" : "company",
      vatNumber: cell.text(r.vatNumber),
      crNumber: cell.text(r.crNumber),
      mobile: cell.text(r.mobile),
      email: cell.text(r.email),
      country,
      roles: [role],
    });
  });
  revalidatePath("/parties");
  return result;
}

"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { createParty, type PartyRole } from "@/lib/operations";
import { cell, saveSheetRows, type SheetRow } from "@/lib/sheet-server";
import { PARTY_ROLES } from "@/data/operations";
import { addPerson, removePerson, updatePerson, type PersonInput } from "@/lib/contacts";
import { errorMessage } from "@/lib/errors";
import type { FormState } from "@/components/action-form";
import type { PanelResult } from "@/components/record-panel";
import { parseForm, RECORDS } from "@/lib/records";

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
      address: { buildingNo: cell.text(r.buildingNo), street: cell.text(r.street), district: cell.text(r.district), city: cell.text(r.city), postalCode: cell.text(r.postalCode) },
      roles: [role],
    });
  });
  revalidatePath("/parties");
  return result;
}

/** إضافة جهة واحدة من النافذة (الزر الرئيسي «إضافة جهة»). */
export async function createPartyAction(data: FormData): Promise<PanelResult> {
  await requirePermission("parties", "create");
  try {
    const v = parseForm(RECORDS.parties, data);
    const t = (k: string) => (v[k] == null || v[k] === "" ? null : String(v[k]).trim());
    const country = (t("country") ?? "SA").toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) throw new Error("الدولة رمز من حرفين مثل SA");
    const roles = ((v.roles as string[] | undefined) ?? []).filter((r) => r in PARTY_ROLES) as PartyRole[];
    const nameAr = String(v.nameAr ?? "").trim();
    if (!nameAr) throw new Error("الاسم: إلزامي");
    const party = await createParty(db, {
      nameAr,
      nameEn: t("nameEn"),
      kind: v.kind === "individual" ? "individual" : "company",
      vatNumber: t("vatNumber"),
      crNumber: t("crNumber"),
      mobile: t("mobile"),
      email: t("email"),
      country,
      defaultCurrency: t("defaultCurrency") ?? "SAR",
      address: { buildingNo: t("buildingNo"), street: t("street"), district: t("district"), city: t("city"), postalCode: t("postalCode"), additionalNo: t("additionalNo") },
      roles,
    });
    revalidatePath("/parties");
    return { ok: `أُضيفت ${party.nameAr}`, id: party.id, label: party.nameAr };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

const person = (data: FormData): PersonInput => ({
  name: String(data.get("name") ?? ""),
  position: String(data.get("position") ?? ""),
  mobile: String(data.get("mobile") ?? ""),
  email: String(data.get("email") ?? ""),
  notes: String(data.get("notes") ?? ""),
});

async function personAction(fn: () => Promise<unknown>, ok: string): Promise<FormState> {
  await requirePermission("parties", "update");
  try {
    await fn();
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath("/parties");
  return { ok };
}

export const addPersonAction = async (partyId: number, _: FormState, data: FormData) => personAction(() => addPerson(db, partyId, person(data)), "أُضيف الشخص");
export const updatePersonAction = async (partyId: number, id: number, _: FormState, data: FormData) => personAction(() => updatePerson(db, id, person(data)), "حُفظ");
export const removePersonAction = async (partyId: number, id: number, _: FormState) => personAction(() => removePerson(db, id), "حُذف");

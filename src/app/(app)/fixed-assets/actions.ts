"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { createAsset, deleteAsset, disposeAsset, runDepreciation, undoLastDepreciation } from "@/lib/assets";
import type { FormState } from "@/components/action-form";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const n = (fd: FormData, k: string) => Number(str(fd, k).replace(/,/g, "")) || 0;
const id = (fd: FormData, k: string) => (str(fd, k) ? Number(str(fd, k)) : null);
const refresh = () => {
  revalidatePath("/fixed-assets");
  revalidatePath("/journal");
  revalidatePath("/reports");
};

export async function addAsset(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("fixed_assets", "create");
  try {
    const years = n(fd, "lifeYears");
    const a = await createAsset(db, {
      nameAr: str(fd, "nameAr"),
      assetAccountId: Number(str(fd, "assetAccountId")),
      vehicleId: id(fd, "vehicleId"),
      costCenterId: id(fd, "costCenterId"),
      acquisitionDate: str(fd, "acquisitionDate"),
      depreciationStart: str(fd, "depreciationStart") || null,
      cost: n(fd, "cost"),
      salvageValue: n(fd, "salvageValue"),
      usefulLifeMonths: Math.round(years * 12),
      openingDepreciation: n(fd, "openingDepreciation"),
      offsetAccountId: id(fd, "offsetAccountId"),
      notes: str(fd, "notes"),
      userId: user.id,
    });
    refresh();
    return { ok: `أُضيف الأصل ${a.number}` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function depreciate(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("fixed_assets", "approve");
  try {
    const done = await runDepreciation(db, str(fd, "upTo"), user.id);
    refresh();
    if (!done.length) return { ok: "لا يوجد إهلاك مستحق حتى هذا الشهر" };
    return { ok: `رُحّل ${done.length} قيد إهلاك: ${done.map((d) => `${d.periodEnd.slice(0, 7)} (${d.number})`).join("، ")}` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function undoDepreciation(): Promise<FormState> {
  await requirePermission("fixed_assets", "revert");
  try {
    const end = await undoLastDepreciation(db);
    refresh();
    return { ok: `أُلغي إهلاك شهر ${end.slice(0, 7)}` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function dispose(assetId: number, _: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("fixed_assets", "update");
  try {
    const r = await disposeAsset(db, assetId, { date: str(fd, "date"), proceeds: n(fd, "proceeds"), proceedsAccountId: id(fd, "proceedsAccountId"), userId: user.id });
    refresh();
    const res = r.result > 0 ? `ربح ${r.result.toFixed(2)}` : r.result < 0 ? `خسارة ${(-r.result).toFixed(2)}` : "بلا ربح أو خسارة";
    return { ok: `استُبعد الأصل بقيد ${r.entry.number} (${res})` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function removeAsset(assetId: number, _: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("fixed_assets", "delete");
  try {
    await deleteAsset(db, assetId, { reason: str(fd, "reason"), userId: user.id });
    refresh();
    return { ok: "حُذف الأصل" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

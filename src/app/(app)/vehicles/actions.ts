"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { saveOwnerDocumentFields } from "@/lib/documents";
import { insertVehicle, parseForm, RECORDS, saveRecord } from "@/lib/records";
import { joinPlate } from "@/lib/plates";
import { splitCustom } from "@/data/custom-lists";
import { errorMessage } from "@/lib/errors";
import type { PanelResult } from "@/components/record-panel";

/** حفظ مركبة واحدة من نافذة الإضافة أو التعديل، مع وثائقها في المعاملة نفسها. */
export async function saveVehicleAction(id: number | null, data: FormData): Promise<PanelResult> {
  const user = await requirePermission("vehicles", id ? "update" : "create");
  try {
    // اللوحة في خانتين (الأحرف والأرقام) تُجمع في نص واحد
    if (data.has("plateLetters") || data.has("plateNumbers")) data.set("plate", joinPlate(String(data.get("plateLetters") ?? ""), String(data.get("plateNumbers") ?? "")));
    const v = parseForm(RECORDS.vehicles, data);
    const plate = String(v.plate).trim();
    if (v.year != null && ((v.year as number) < 1980 || (v.year as number) > 2100)) throw new Error("سنة الصنع غير صالحة");
    if (!v.assetAccountId) throw new Error("حساب الأصل: إلزامي");
    const owner = (vid: number) => ({ kind: splitCustom(v.assetKind).base === "trailer" ? ("trailer" as const) : ("vehicle" as const), id: vid });

    let savedId = id;
    if (id) {
      await saveRecord("vehicles", id, v, async (tx) => {
        await saveOwnerDocumentFields(tx, owner(id), data, user.id);
      });
    } else {
      savedId = await db.transaction(async (tx) => {
        const vid = await insertVehicle(tx, v);
        await saveOwnerDocumentFields(tx, owner(vid), data, user.id);
        return vid;
      });
    }
    revalidatePath("/vehicles");
    revalidatePath("/fleet-documents", "layout");
    return { ok: id ? `حُفظت المركبة ${plate}` : `أُضيفت المركبة ${plate}`, id: savedId!, label: plate };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

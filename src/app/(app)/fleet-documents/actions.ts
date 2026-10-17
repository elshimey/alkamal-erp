"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { DOCUMENT_TYPES, type DocumentType } from "@/data/fleet";
import type { FormState } from "@/components/action-form";

export async function addDocument(_: FormState, data: FormData): Promise<FormState> {
  await requirePermission("fleet_documents", "create");
  const owner = String(data.get("owner") ?? "");
  const [kind, rawId] = owner.split(":");
  const ownerId = Number(rawId);
  const type = String(data.get("type") ?? "") as DocumentType;
  const expiryDate = String(data.get("expiryDate") ?? "");
  if (!["v", "d"].includes(kind) || !ownerId) return { error: "اختر صاحب الوثيقة" };
  if (!(type in DOCUMENT_TYPES)) return { error: "اختر نوع الوثيقة" };
  if (!expiryDate) return { error: "تاريخ الانتهاء إلزامي" };
  const issueDate = String(data.get("issueDate") ?? "") || null;
  if (issueDate && issueDate > expiryDate) return { error: "تاريخ الإصدار بعد تاريخ الانتهاء" };
  const cost = String(data.get("cost") ?? "");
  try {
    await db.insert(s.fleetDocuments).values({
      vehicleId: kind === "v" ? ownerId : null,
      driverId: kind === "d" ? ownerId : null,
      type,
      number: String(data.get("number") ?? "") || null,
      issueDate,
      expiryDate,
      authority: String(data.get("authority") ?? "") || null,
      cost: cost === "" ? null : cost,
    });
    revalidatePath("/fleet-documents");
    return { ok: `أُضيفت وثيقة ${DOCUMENT_TYPES[type]}` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

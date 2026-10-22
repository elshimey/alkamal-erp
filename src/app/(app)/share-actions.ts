"use server";

import { headers } from "next/headers";
import { requirePermission } from "@/lib/auth";
import { DOC_KINDS } from "@/lib/doc-kinds";
import { shareLink } from "@/lib/share";

/** ينشئ رابط مشاركة عاماً للمستند ويعيد عنوانه الكامل. */
export async function shareDocument(kind: string, id: number): Promise<{ url?: string; error?: string }> {
  const def = DOC_KINDS[kind];
  if (!def) return { error: "نوع مستند غير معروف" };
  await requirePermission(def.entity, "view");
  const token = await shareLink(kind, id);
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  return { url: `${proto}://${host}/share/${token}` };
}

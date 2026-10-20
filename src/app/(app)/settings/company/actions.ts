"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { saveCompany } from "@/lib/company";
import { errorMessage } from "@/lib/errors";
import type { FormState } from "@/components/action-form";

const str = (d: FormData, k: string) => String(d.get(k) ?? "").trim() || null;
// يقبل الأرقام العربية والمسافات في الأرقام الرسمية
const num = (d: FormData, k: string) => str(d, k)?.replace(/[٠-٩]/g, (x) => String("٠١٢٣٤٥٦٧٨٩".indexOf(x))).replace(/\s/g, "") || null;

export async function saveCompanyAction(_: FormState, d: FormData): Promise<FormState> {
  const user = await requirePermission("settings", "update");
  try {
    await saveCompany(
      db,
      {
        nameAr: str(d, "nameAr") ?? "",
        nameEn: str(d, "nameEn"),
        vatNumber: num(d, "vatNumber"),
        crNumber: num(d, "crNumber"),
        buildingNo: num(d, "buildingNo"),
        street: str(d, "street"),
        district: str(d, "district"),
        city: str(d, "city"),
        postalCode: num(d, "postalCode"),
        additionalNo: num(d, "additionalNo"),
        phone: str(d, "phone"),
        email: str(d, "email"),
        website: str(d, "website"),
        logo: str(d, "logo"),
      },
      user.id,
    );
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath("/", "layout");
  return { ok: "حُفظت بيانات المنشأة" };
}

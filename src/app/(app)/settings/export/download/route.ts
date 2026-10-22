import { db } from "@/db";
import { requireUser } from "@/lib/auth";
import { getCompany } from "@/lib/company";
import { exportAllData } from "@/lib/export";
import { todayRiyadh } from "@/lib/dates";

export const maxDuration = 60;

// تصدير كل بيانات الشركة: لمدير النظام فقط
export async function GET() {
  const user = await requireUser();
  if (!user.perms.isAdmin) return new Response("Forbidden", { status: 403 });
  const company = await getCompany(db);
  const name = company.nameAr || "الشركة";
  const file = await exportAllData(db, name);
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="erp-export-${todayRiyadh()}.xlsx"; filename*=UTF-8''${encodeURIComponent(`بيانات ${name} ${todayRiyadh()}.xlsx`)}`,
      "Cache-Control": "no-store",
    },
  });
}

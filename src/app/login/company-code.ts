import "server-only";
import { cookies } from "next/headers";
import { baseSql } from "@/db";
import { tenantFromCookies } from "@/db/tenant";
import { companyCode } from "@/lib/platform";

/** رمز آخر شركة دخل منها هذا الجهاز، ليُعبأ تلقائياً في صفحات الدخول. */
export async function lastCompanyCode() {
  const schema = tenantFromCookies(await cookies());
  return schema ? ((await companyCode(baseSql, schema)) ?? "") : "";
}

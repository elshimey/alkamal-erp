"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { IMPORT_SPECS } from "@/data/import-specs";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { errorMessage } from "@/lib/errors";
import { matchColumns, type ImportReport } from "@/lib/import-match";
import { runImport, type ImportRow } from "@/lib/importers";
import { readImportFile } from "@/lib/xlsx";

const MAX_BYTES = 10 * 1024 * 1024;

function specOf(entity: string) {
  const spec = IMPORT_SPECS[entity];
  if (!spec) throw new Error("بند الاستيراد غير معروف");
  return spec;
}

export type ParsedImport = { headers: string[]; rows: string[][]; rowNumbers: number[]; mapping: (string | null)[] } | { error: string };

/** يقرأ الملف المرفوع ويقترح ربط كل عمود بحقل في النظام. */
export async function parseImportFile(entity: string, form: FormData): Promise<ParsedImport> {
  const spec = specOf(entity);
  await requirePermission(spec.permission, "create");
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return { error: "اختر ملفاً" };
  if (file.size > MAX_BYTES) return { error: "حجم الملف أكبر من 10 ميجابايت" };
  try {
    const parsed = await readImportFile(file, spec);
    if (!parsed.rows.length) return { error: "لم أجد صفوف بيانات في الملف. أضف بياناتك أسفل صف العناوين (صفوف «احذف الصف» تُتجاهل)" };
    return { ...parsed, mapping: matchColumns(parsed.headers, spec.fields) };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function runImportAction(entity: string, rows: ImportRow[], dryRun: boolean): Promise<ImportReport> {
  const spec = specOf(entity);
  const user = await requirePermission(spec.permission, "create");
  // السندات تُرحّل مباشرة لمن يملك اعتمادها، وغيرها يُستورد مسودات
  const post = spec.entity === "receipts" && can(user.perms, "receipts", "approve");
  const report = await runImport(db, spec, rows, { dryRun, userId: user.id, post });
  if (!dryRun && report.ok) revalidatePath(spec.backHref);
  return report;
}

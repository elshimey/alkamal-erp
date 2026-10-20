import { notFound } from "next/navigation";
import { db } from "@/db";
import { IMPORT_SPECS } from "@/data/import-specs";
import { requirePermission } from "@/lib/auth";
import { templateLists } from "@/lib/importers";
import { buildTemplate } from "@/lib/xlsx";

// قالب الاستيراد بأعمدة البند وشروطه، مع ورقة بالقيم المعرفة في النظام
export async function GET(_req: Request, { params }: { params: Promise<{ entity: string }> }) {
  const spec = IMPORT_SPECS[(await params).entity];
  if (!spec) notFound();
  await requirePermission(spec.permission, "create");
  const file = await buildTemplate(spec, await templateLists(db, spec));
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="import-${spec.entity}.xlsx"; filename*=UTF-8''${encodeURIComponent(`قالب ${spec.title.replace("استيراد ", "")}.xlsx`)}`,
      "Cache-Control": "no-store",
    },
  });
}

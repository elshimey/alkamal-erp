import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { isRecordKind, RECORDS } from "@/lib/records";
import { bulkColumns, bulkRows, canBulkCreate, canBulkEdit } from "@/lib/bulk-records";
import { BulkEditor } from "@/components/bulk-editor";
import { saveBulkAction } from "../../actions";

// أعمدة لا تتكرر: تنبيه فوري في الشيت إن كُتبت قيمة مسجلة مسبقاً
const UNIQUE: Record<string, { key: string; label: string }> = { vehicles: { key: "plate", label: "اللوحة" } };

export default async function BulkEditPage({ params, searchParams }: { params: Promise<{ kind: string }>; searchParams: Promise<{ add?: string }> }) {
  const { kind } = await params;
  if (!isRecordKind(kind) || !canBulkEdit(kind)) notFound();
  const adding = (await searchParams).add === "1";
  const def = RECORDS[kind];
  const user = await requirePermission(def.perm, adding ? "create" : "update");
  const canCreate = canBulkCreate(kind) && can(user.perms, def.perm, "create");
  const [columns, rows] = await Promise.all([bulkColumns(kind), bulkRows(kind)]);
  return (
    <BulkEditor
      title={adding ? "إضافة جماعية" : "تعديل جماعي"}
      backHref={def.listHref}
      backLabel={def.listLabel}
      columns={columns}
      rows={rows}
      openHref={`/records/${kind}/{id}`}
      action={saveBulkAction.bind(null, kind)}
      canDelete={can(user.perms, def.perm, "delete")}
      canCreate={canCreate}
      newRows={adding ? 5 : 0}
      unique={UNIQUE[kind]}
    />
  );
}

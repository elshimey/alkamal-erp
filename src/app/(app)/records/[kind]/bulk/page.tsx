import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { isRecordKind, RECORDS } from "@/lib/records";
import { bulkColumns, bulkRows, canBulkEdit } from "@/lib/bulk-records";
import { BulkEditor } from "@/components/bulk-editor";
import { saveBulkAction } from "../../actions";

export default async function BulkEditPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!isRecordKind(kind) || !canBulkEdit(kind)) notFound();
  const def = RECORDS[kind];
  const user = await requirePermission(def.perm, "update");
  const [columns, rows] = await Promise.all([bulkColumns(kind), bulkRows(kind)]);
  return (
    <BulkEditor
      title="تعديل جماعي"
      backHref={def.listHref}
      backLabel={def.listLabel}
      columns={columns}
      rows={rows}
      openHref={`/records/${kind}/{id}`}
      action={saveBulkAction.bind(null, kind)}
      canDelete={can(user.perms, def.perm, "delete")}
    />
  );
}

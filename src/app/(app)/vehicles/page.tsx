import Link from "next/link";
import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { customLabels } from "@/lib/custom-lists";
import { Badge, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { ListActions } from "@/components/list-actions";
import { VehiclePanel } from "./vehicle-panel";

const STATUS = {
  active: { label: "تعمل", tone: "green" },
  maintenance: { label: "في الصيانة", tone: "amber" },
  stopped: { label: "متوقفة", tone: "gray" },
  sold: { label: "مباعة", tone: "red" },
} as const;

export default async function VehiclesPage({ searchParams }: { searchParams: Promise<{ add?: string; new?: string; edit?: string; embed?: string; q?: string }> }) {
  const user = await requirePermission("vehicles", "view");
  const sp = await searchParams;
  const canCreate = can(user.perms, "vehicles", "create");
  const canEdit = can(user.perms, "vehicles", "update");
  // الإضافة الجماعية في شيت واحد مع المركبات المسجلة (للاطلاع والتعديل ومنع التكرار)
  if (sp.add === "1" && canCreate) redirect("/records/vehicles/bulk?add=1");
  const editId = Number(sp.edit) || null;
  const panel = (sp.new === "1" && canCreate) || (editId && canEdit) ? <VehiclePanel id={editId} embed={sp.embed === "1"} initial={sp.q} /> : null;
  // من داخل مستند: النافذة وحدها دون الجدول
  if (panel && sp.embed === "1") return panel;
  const asset = alias(s.accounts, "asset");
  const [rows, labels] = await Promise.all([
    db
      .select({ v: s.vehicles, typeName: s.vehicleTypes.nameAr, ccCode: s.costCenters.code, accCode: asset.code, accName: asset.nameAr })
      .from(s.vehicles)
      .leftJoin(s.vehicleTypes, eq(s.vehicleTypes.id, s.vehicles.vehicleTypeId))
      .innerJoin(s.costCenters, eq(s.costCenters.id, s.vehicles.costCenterId))
      .leftJoin(asset, eq(asset.id, s.vehicles.assetAccountId))
      .orderBy(asc(s.vehicles.plate)),
    customLabels(db),
  ]);
  const custom = (id: number | null) => (id ? labels.get(id) : undefined);

  return (
    <>
      <PageHeader title="المركبات" description="الرؤوس والمقطورات (السطحات). كل مركبة تنشئ مركز تكلفتها تلقائياً، وتُربط بحساب أصلها في شجرة الحسابات.">
        {(
          <ListActions
            bulkHref={canEdit && "/records/vehicles/bulk"}
            newHref={canCreate && "/vehicles?new=1"}
            newLabel="إضافة مركبة"
            addHref={canCreate && "/records/vehicles/bulk?add=1"}
            importHref={canCreate && "/import/vehicles"}
          />
        )}
      </PageHeader>
      {rows.length > 0 && canEdit && <p className="mb-2 text-sm text-gray-500">اضغط اللوحة لتعديل بيانات المركبة ووثائقها.</p>}
      {(
      <Table head={["اللوحة", "النوع", "الماركة والطراز", "السنة", "العداد", "الملكية", "الحالة", "حساب الأصل", "مركز التكلفة", ""]}>
        {rows.length === 0 && <EmptyRow cols={10}>لا توجد مركبات بعد</EmptyRow>}
        {rows.map(({ v, typeName, ccCode, accCode, accName }) => (
          <tr key={v.id}>
            <Td className="font-medium">
              {canEdit ? (
                <Link href={`/vehicles?edit=${v.id}`} scroll={false} prefetch={false} className="text-brand-700 hover:underline">
                  {v.plate}
                </Link>
              ) : (
                v.plate
              )}
            </Td>
            <Td>
              {(v.assetKind === "trailer" || v.assetClassId) && <Badge tone="blue">{custom(v.assetClassId) ?? "مقطورة"}</Badge>} {typeName ?? (v.assetKind === "trailer" || v.assetClassId ? "" : "—")}
            </Td>
            <Td>{[v.make, v.model].filter(Boolean).join(" ") || "—"}</Td>
            <Td className="ltr-nums">{v.year ?? "—"}</Td>
            <Td className="ltr-nums">{v.odometer.toLocaleString("en")}</Td>
            <Td>{custom(v.ownershipClassId) ?? (v.ownership === "owned" ? "مملوكة" : "مستأجرة")}</Td>
            <Td>
              <Badge tone={STATUS[v.status].tone}>{custom(v.statusClassId) ?? STATUS[v.status].label}</Badge>
            </Td>
            <Td className="text-xs">{accCode ? `${accCode} ${accName}` : <span className="text-amber-700">غير مربوطة</span>}</Td>
            <Td className="text-gray-500">{ccCode}</Td>
            <Td>
              <Link href={`/fleet-documents/owner/${v.assetKind === "trailer" ? "trailer" : "vehicle"}-${v.id}`} className="text-xs font-medium text-brand-700 hover:underline">
                الوثائق
              </Link>
            </Td>
          </tr>
        ))}
      </Table>
      )}
      {panel}
    </>
  );
}

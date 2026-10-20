import { and, asc, eq, like } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { SheetEditor } from "@/components/sheet-editor";
import { Badge, Card, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { ImportLink } from "@/components/import-link";
import { saveVehicles } from "./actions";

const STATUS = {
  active: { label: "تعمل", tone: "green" },
  maintenance: { label: "في الصيانة", tone: "amber" },
  stopped: { label: "متوقفة", tone: "gray" },
  sold: { label: "مباعة", tone: "red" },
} as const;

export default async function VehiclesPage() {
  const user = await requirePermission("vehicles", "view");
  const asset = alias(s.accounts, "asset");
  const [rows, types, assetAccounts] = await Promise.all([
    db
      .select({ v: s.vehicles, typeName: s.vehicleTypes.nameAr, ccCode: s.costCenters.code, accCode: asset.code, accName: asset.nameAr })
      .from(s.vehicles)
      .leftJoin(s.vehicleTypes, eq(s.vehicleTypes.id, s.vehicles.vehicleTypeId))
      .innerJoin(s.costCenters, eq(s.costCenters.id, s.vehicles.costCenterId))
      .leftJoin(asset, eq(asset.id, s.vehicles.assetAccountId))
      .orderBy(asc(s.vehicles.plate)),
    db.select().from(s.vehicleTypes).orderBy(asc(s.vehicleTypes.nameAr)),
    db
      .select({ id: s.accounts.id, code: s.accounts.code, nameAr: s.accounts.nameAr })
      .from(s.accounts)
      .where(and(like(s.accounts.code, "1201%"), eq(s.accounts.isPostable, true), eq(s.accounts.isActive, true)))
      .orderBy(asc(s.accounts.code)),
  ]);

  return (
    <>
      <PageHeader title="المركبات" description="كل مركبة تُضاف تنشئ مركز تكلفتها تلقائياً، وتُربط بحساب أصلها في شجرة الحسابات.">
        {can(user.perms, "vehicles", "create") && <ImportLink entity="vehicles" />}
      </PageHeader>
      {can(user.perms, "vehicles", "create") && (
        <Card title="إدخال مركبات" className="mb-6">
          <SheetEditor
            templateName="المركبات"
            action={saveVehicles}
            columns={[
              { key: "plate", label: "اللوحة", required: true, placeholder: "أ ب ج 1234" },
              { key: "chassis", label: "رقم الشاسيه", required: true, ltr: true, width: "11rem" },
              {
                key: "assetAccountId",
                label: "حساب الأصل",
                type: "select",
                required: true,
                width: "12rem",
                options: assetAccounts.map((a) => ({ value: String(a.id), label: `${a.code} ${a.nameAr}` })),
              },
              { key: "vehicleTypeId", label: "النوع", type: "select", options: types.map((t) => ({ value: String(t.id), label: t.nameAr })) },
              { key: "make", label: "الماركة" },
              { key: "model", label: "الطراز" },
              { key: "year", label: "سنة الصنع", type: "number", width: "5rem" },
              { key: "ownership", label: "الملكية", type: "select", options: [{ value: "owned", label: "مملوكة" }, { value: "leased", label: "مستأجرة" }] },
              { key: "odometer", label: "العداد (كم)", type: "number", width: "6rem" },
            ]}
          />
        </Card>
      )}
      <Table head={["اللوحة", "النوع", "الماركة والطراز", "السنة", "العداد", "الملكية", "الحالة", "حساب الأصل", "مركز التكلفة"]}>
        {rows.length === 0 && <EmptyRow cols={9}>لا توجد مركبات بعد</EmptyRow>}
        {rows.map(({ v, typeName, ccCode, accCode, accName }) => (
          <tr key={v.id}>
            <Td className="font-medium">{v.plate}</Td>
            <Td>{typeName ?? "—"}</Td>
            <Td>{[v.make, v.model].filter(Boolean).join(" ") || "—"}</Td>
            <Td className="ltr-nums">{v.year ?? "—"}</Td>
            <Td className="ltr-nums">{v.odometer.toLocaleString("en")}</Td>
            <Td>{v.ownership === "owned" ? "مملوكة" : "مستأجرة"}</Td>
            <Td>
              <Badge tone={STATUS[v.status].tone}>{STATUS[v.status].label}</Badge>
            </Td>
            <Td className="text-xs">{accCode ? `${accCode} ${accName}` : <span className="text-amber-700">غير مربوطة</span>}</Td>
            <Td className="text-gray-500">{ccCode}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}

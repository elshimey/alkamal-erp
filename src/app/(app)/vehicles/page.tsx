import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { SheetEditor } from "@/components/sheet-editor";
import { Badge, Card, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { saveVehicles } from "./actions";

const STATUS = {
  active: { label: "تعمل", tone: "green" },
  maintenance: { label: "في الصيانة", tone: "amber" },
  stopped: { label: "متوقفة", tone: "gray" },
  sold: { label: "مباعة", tone: "red" },
} as const;

export default async function VehiclesPage() {
  const user = await requirePermission("vehicles", "view");
  const [rows, types] = await Promise.all([
    db
      .select({ v: s.vehicles, typeName: s.vehicleTypes.nameAr, ccCode: s.costCenters.code })
      .from(s.vehicles)
      .leftJoin(s.vehicleTypes, eq(s.vehicleTypes.id, s.vehicles.vehicleTypeId))
      .innerJoin(s.costCenters, eq(s.costCenters.id, s.vehicles.costCenterId))
      .orderBy(asc(s.vehicles.plate)),
    db.select().from(s.vehicleTypes).orderBy(asc(s.vehicleTypes.nameAr)),
  ]);

  return (
    <>
      <PageHeader title="المركبات" description="كل مركبة تُضاف تنشئ مركز تكلفتها تلقائياً." />
      {can(user.perms, "vehicles", "create") && (
        <Card title="إدخال مركبات" className="mb-6">
          <SheetEditor
            templateName="المركبات"
            action={saveVehicles}
            columns={[
              { key: "plate", label: "اللوحة", required: true, placeholder: "أ ب ج 1234" },
              { key: "chassis", label: "رقم الشاسيه", required: true, ltr: true, width: "11rem" },
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
      <Table head={["اللوحة", "النوع", "الماركة والطراز", "السنة", "العداد", "الملكية", "الحالة", "مركز التكلفة"]}>
        {rows.length === 0 && <EmptyRow cols={8}>لا توجد مركبات بعد</EmptyRow>}
        {rows.map(({ v, typeName, ccCode }) => (
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
            <Td className="text-gray-500">{ccCode}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
